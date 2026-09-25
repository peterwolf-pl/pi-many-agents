import assert from "node:assert/strict";
import test from "node:test";
import { DockerMistralProvider, modelMatches } from "../src/providers/docker-mistral.ts";
import { createTask } from "../src/core/task.ts";

test("Docker Model Runner modelMatches helper", () => {
  assert.equal(modelMatches("ai/mistral", "ai/mistral"), true);
  assert.equal(modelMatches("docker.io/ai/mistral:latest", "ai/mistral"), true);
  assert.equal(modelMatches("ai/mistral:latest", "ai/mistral"), true);
  assert.equal(modelMatches("other-model", "ai/mistral"), false);
});

test("Docker Model Runner Mistral provider uses /chat/completions and OpenAI response format", async () => {
  const calledUrls: string[] = [];

  const provider = new DockerMistralProvider({
    baseUrl: "http://127.0.0.1:12434/engines/v1",
    model: "ai/mistral",
    fetchImpl: (async (url, init) => {
      calledUrls.push(String(url));
      if (String(url).endsWith("/models")) {
        return new Response(
          JSON.stringify({
            object: "list",
            data: [{ id: "docker.io/ai/mistral:latest", object: "model" }],
          })
        );
      }
      if (String(url).endsWith("/chat/completions")) {
        const body = JSON.parse(String(init?.body)) as { model: string };
        assert.equal(body.model, "ai/mistral");
        return new Response(
          JSON.stringify({
            id: "chatcmpl-123",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Mistral completion ok" },
              },
            ],
            usage: { prompt_tokens: 15, completion_tokens: 5 },
          })
        );
      }
      throw new Error(`Unexpected endpoint called: ${String(url)}`);
    }) as typeof fetch,
  });

  assert.equal(await provider.available(), true);
  assert.ok(calledUrls.some((u) => u.endsWith("/models")), "Must query /models");
  assert.ok(!calledUrls.some((u) => u.includes("/api/tags")), "Must NOT query old /api/tags");

  const handle = await provider.spawn({ id: "w1", provider: "mistral", model: "ai/mistral", timeoutMs: 2000 });
  const task = createTask({
    id: "task-mistral",
    title: "Test mistral",
    objective: "Run on Docker Model Runner",
    modelPolicy: { reasoning: "none", timeoutMs: 2000 },
    permissions: { read: true, write: false, shell: false },
  });

  const result = await provider.execute(handle, task);

  assert.ok(calledUrls.some((u) => u.endsWith("/chat/completions")), "Must call /chat/completions");
  assert.ok(!calledUrls.some((u) => u.includes("/api/chat")), "Must NOT use old /api/chat");

  assert.equal(result.report.status, "completed");
  assert.equal(result.report.summary, "Mistral completion ok");
  assert.equal(result.report.usage?.inputTokens, 15);
  assert.equal(result.report.usage?.outputTokens, 5);
});

test("Docker Model Runner Mistral: unavailable when model is missing from /models list", async () => {
  const provider = new DockerMistralProvider({
    baseUrl: "http://127.0.0.1:12434/engines/v1",
    model: "ai/mistral",
    fetchImpl: (async () => {
      return new Response(
        JSON.stringify({
          object: "list",
          data: [{ id: "ai/other-model", object: "model" }],
        })
      );
    }) as typeof fetch,
  });

  assert.equal(await provider.available(), false);

  const handle = await provider.spawn({ id: "w", provider: "mistral", model: "ai/mistral", timeoutMs: 1000 });
  const result = await provider.execute(
    handle,
    createTask({ id: "t", title: "t", objective: "obj" })
  );
  assert.equal(result.report.status, "failed");
  assert.match(result.report.error ?? "", /is not available/);
});

test("Docker Model Runner Mistral: handles HTTP error and timeout gracefully", async () => {
  const provider = new DockerMistralProvider({
    baseUrl: "http://127.0.0.1:12434/engines/v1",
    model: "ai/mistral",
    fetchImpl: (async (url) => {
      if (String(url).endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "ai/mistral" }] }));
      }
      return new Response("Service Unavailable", { status: 503 });
    }) as typeof fetch,
  });

  const handle = await provider.spawn({ id: "w", provider: "mistral", model: "ai/mistral", timeoutMs: 1000 });
  const result = await provider.execute(
    handle,
    createTask({ id: "t", title: "t", objective: "obj" })
  );
  assert.equal(result.report.status, "failed");
  assert.match(result.report.error ?? "", /HTTP 503/);
});
