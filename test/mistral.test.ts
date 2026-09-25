import assert from "node:assert/strict";
import test from "node:test";
import { DockerMistralProvider } from "../src/providers/docker-mistral.ts";
import { createTask } from "../src/core/task.ts";

test("mistral docker provider reads a local chat response", async () => {
  const provider = new DockerMistralProvider({
    fetchImpl: (async (url) => {
      if (String(url).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "mistral:latest" }] }));
      return new Response(JSON.stringify({ message: { content: "ok" }, prompt_eval_count: 3, eval_count: 1 }));
    }) as typeof fetch,
  });
  assert.equal(await provider.available(), true);
  const handle = await provider.spawn({ id: "w", provider: "mistral", model: "mistral", timeoutMs: 1000 });
  const result = await provider.execute(handle, createTask({
    id: "t",
    title: "local",
    objective: "Say ok",
    modelPolicy: { reasoning: "none", timeoutMs: 1000 },
    permissions: { read: true, write: false, shell: false },
  }));
  assert.equal(result.report.status, "completed");
  assert.equal(result.report.usage?.outputTokens, 1);
});
