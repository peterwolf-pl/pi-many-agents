import assert from "node:assert/strict";
import test from "node:test";
import { createTask } from "../src/core/task.ts";
import { OllamaProvider } from "../src/providers/ollama.ts";

test("OllamaProvider qwen4: resolves matching local tag dynamically", async () => {
  const provider = new OllamaProvider({
    name: "qwen4",
    fetchImpl: (async (url, init) => {
      if (String(url).endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "qwen4:latest" }, { name: "gemma4:latest" }] }));
      }
      if (String(url).endsWith("/api/show")) {
        const body = JSON.parse(String(init?.body)) as { model: string };
        assert.equal(body.model, "qwen4:latest");
        return new Response("{}");
      }
      return new Response(
        JSON.stringify({
          message: { content: "Qwen4 response ok" },
          prompt_eval_count: 10,
          eval_count: 20,
        })
      );
    }) as typeof fetch,
  });

  assert.equal(await provider.resolveModel(), "qwen4:latest");
  assert.equal(await provider.available(), true);

  const handle = await provider.spawn({ id: "w-qwen", provider: "qwen4", model: "qwen4:latest", timeoutMs: 2000 });
  const task = createTask({
    id: "task-qwen",
    title: "Qwen test",
    objective: "Local inference",
  });

  const result = await provider.execute(handle, task);
  assert.equal(result.report.status, "completed");
  assert.equal(result.report.summary, "Qwen4 response ok");
  assert.equal(result.report.usage?.inputTokens, 10);
  assert.equal(result.report.usage?.outputTokens, 20);
});

test("OllamaProvider qwen4: missing tag reports unavailable without cloud fallback", async () => {
  const provider = new OllamaProvider({
    name: "qwen4",
    fetchImpl: (async (url) => {
      if (String(url).endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "gemma4:latest" }] }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch,
  });

  assert.equal(await provider.resolveModel(), undefined);
  assert.equal(await provider.available(), false);

  const handle = await provider.spawn({ id: "w", provider: "qwen4", model: "qwen4", timeoutMs: 1000 });
  const task = createTask({ id: "t", title: "t", objective: "obj" });
  const result = await provider.execute(handle, task);

  assert.equal(result.report.status, "failed");
  assert.match(result.report.error ?? "", /is not available/);
});

test("OllamaProvider: task model override is validated and used as effective model", async () => {
  let executedModel: string | undefined;

  const provider = new OllamaProvider({
    name: "qwen4",
    model: "qwen4:latest",
    fetchImpl: (async (url, init) => {
      if (String(url).endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "qwen4:latest" }, { name: "qwen4:14b" }] }));
      }
      if (String(url).endsWith("/api/show")) {
        return new Response("{}");
      }
      if (String(url).endsWith("/api/chat")) {
        const body = JSON.parse(String(init?.body)) as { model: string };
        executedModel = body.model;
        return new Response(JSON.stringify({ message: { content: "override ok" } }));
      }
      return new Response("ok");
    }) as typeof fetch,
  });

  const handle = await provider.spawn({ id: "w", provider: "qwen4", model: "qwen4:latest", timeoutMs: 1000 });
  const task = createTask({
    id: "t",
    title: "t",
    objective: "obj",
    modelPolicy: { model: "qwen4:14b", reasoning: "low" },
  });

  const result = await provider.execute(handle, task);
  assert.equal(result.report.status, "completed");
  assert.equal(executedModel, "qwen4:14b");
});
