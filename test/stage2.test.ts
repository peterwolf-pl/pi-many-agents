import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { dedupeTasks } from "../src/core/dedup.ts";
import { decomposeMarkdown } from "../src/core/decompose.ts";
import { dependencyGraph } from "../src/core/graph.ts";
import { PI_WORKER_PROFILES } from "../src/providers/catalog.ts";
import { createTask } from "../src/core/task.ts";
import { DEFAULT_CONFIG } from "../src/config/config.ts";
import { routeTask } from "../src/routing/rules.ts";
import { createOrchestrator, loadConfig } from "../src/index.ts";
import type { AgentTask } from "../src/types.ts";

function task(partial: Partial<AgentTask> & Pick<AgentTask, "id" | "title" | "objective">): AgentTask {
  return createTask({
    type: "inspect",
    modelPolicy: { reasoning: "none", maxTokens: 10, timeoutMs: 2000 },
    permissions: { read: true, write: false, shell: false },
    ...partial,
  });
}

test("catalog matches verified Pi providers", () => {
  const codex = PI_WORKER_PROFILES.find((profile) => profile.name === "openai-codex");
  assert.deepEqual(codex?.models, ["gpt-5.5", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-6-sol", "gpt-6-luna"]);
  assert.equal(PI_WORKER_PROFILES.find((profile) => profile.name === "gpt-6-luna")?.piProvider, "openai-codex");
  assert.ok(PI_WORKER_PROFILES.find((profile) => profile.name === "google-antigravity-2")?.models.includes("claude-opus-4-6"));
  assert.ok(PI_WORKER_PROFILES.find((profile) => profile.name === "google-antigravity-2")?.models.includes("gpt-oss-120b"));
  assert.equal(PI_WORKER_PROFILES.find((profile) => profile.name === "antigravity")?.models.includes("codex"), false);
});

test("model vendor is not the runtime provider", () => {
  const plan = routeTask(task({ id: "m", title: "m", objective: "m", modelPolicy: { reasoning: "low", provider: "google", model: "gemini" } }), DEFAULT_CONFIG);
  assert.equal(plan.provider, "fake");
  assert.equal(plan.modelProvider, "google");
  assert.equal(plan.model, "gemini");
});

test("dedupes identical objectives and keeps higher priority", () => {
  const result = dedupeTasks([
    task({ id: "low", title: "A", objective: "Same work", priority: 0 }),
    task({ id: "high", title: "B", objective: "Same work", priority: 5, dependencies: ["x"] }),
  ]);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0]?.id, "high");
  assert.deepEqual(result.dropped, [{ id: "low", kept: "high" }]);
  assert.deepEqual(result.tasks[0]?.dependencies, ["x"]);
});

test("builds a dependency graph and decomposes markdown", () => {
  const tasks = decomposeMarkdown("## Scheduler\nReview the queue.\n## Provider\nReview adapters.\n", { addIntegrateTask: true });
  const graph = dependencyGraph(tasks);
  assert.equal(graph.roots.length, 2);
  assert.deepEqual(graph.leaves, ["integrate"]);
  assert.equal(tasks.at(-1)?.dependencies.length, 2);
});

test("retries a retryable failure then reports failed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "many-retry-"));
  const config = await loadConfig(join(dir, "missing.json"));
  const orchestrator = createOrchestrator({ ...config, maxRetries: 1 });
  let progress = 0;
  orchestrator.bus.onEvent((event) => {
    if (event.type === "task.progress") progress += 1;
  });
  const result = await orchestrator.run([
    task({ id: "f", title: "fail", objective: "fail", context: "fail" }),
  ], { provider: "fake", maxRetries: 1, telemetryPath: join(dir, "t.jsonl") });
  assert.equal(progress, 1);
  assert.equal(result.reports[0]?.status, "failed");
  assert.match(result.statusText, /healthy=true/);
});

test("cancels a queued dependent without running it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "many-cancel-"));
  const config = await loadConfig(join(dir, "missing.json"));
  const orchestrator = createOrchestrator(config);
  const pending = orchestrator.run([
    task({ id: "slow", title: "slow", objective: "slow", context: "ok", modelPolicy: { reasoning: "none", maxTokens: 250, timeoutMs: 2000 } }),
    task({ id: "later", title: "later", objective: "later" }),
  ], { provider: "fake", maxConcurrentWorkers: 1, maxRetries: 0, telemetryPath: join(dir, "t.jsonl") });
  await orchestrator.cancelTask("later");
  const result = await pending;
  const later = result.reports.find((report) => report.taskId === "later");
  assert.ok(later);
  assert.notEqual(later?.status, "completed");
});
