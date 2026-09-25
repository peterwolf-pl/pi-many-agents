import assert from "node:assert/strict";
import test from "node:test";
import { createTask } from "../src/core/task.ts";
import { OllamaProvider } from "../src/providers/ollama.ts";

test("gemma4 provider accepts the installed ollama tag", async () => {
  const provider = new OllamaProvider({
    name: "gemma4",
    model: "gemma4:latest",
    fetchImpl: (async (url) => {
      if (String(url).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "gemma4:latest" }] }));
      if (String(url).endsWith("/api/show")) return new Response("{}");
      return new Response(JSON.stringify({ message: { content: "local ok" }, prompt_eval_count: 2, eval_count: 1 }));
    }) as typeof fetch,
  });
  assert.equal(await provider.available(), true);
  const handle = await provider.spawn({ id: "w", provider: "gemma4", model: "gemma4:latest", timeoutMs: 1000 });
  const result = await provider.execute(handle, createTask({
    id: "t",
    title: "gemma",
    objective: "Reply",
    modelPolicy: { reasoning: "none", timeoutMs: 1000 },
    permissions: { read: true, write: false, shell: false },
  }));
  assert.equal(result.report.summary, "local ok");
});
