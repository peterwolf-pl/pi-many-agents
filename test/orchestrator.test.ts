import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertAcyclic, createTask } from "../src/core/task.ts";
import { TaskQueue } from "../src/core/scheduler.ts";
import { createOrchestrator, loadConfig } from "../src/index.ts";
import { parseReportPayload, wrapTextReport } from "../src/protocol/report.ts";
import { parseMessageLine } from "../src/protocol/messages.ts";
import type { AgentTask } from "../src/types.ts";
import type { ManyAgentsConfig } from "../src/config/config.ts";
import { MockProvider } from "./helpers/mock-provider.ts";
import type { Orchestrator } from "../src/core/orchestrator.ts";

function getOrchestrator(config: ManyAgentsConfig, signal?: AbortSignal): Orchestrator {
  const orchestrator = createOrchestrator(config, signal);
  orchestrator.registerProvider(new MockProvider("mock", signal));
  return orchestrator;
}

function task(partial: Partial<AgentTask> & Pick<AgentTask, "id" | "title">): AgentTask {
  return createTask({
    objective: partial.objective ?? partial.title,
    type: "inspect",
    modelPolicy: { reasoning: "none", maxTokens: 15, timeoutMs: 2000 },
    permissions: { read: true, write: false, shell: false },
    ...partial,
  });
}

test("creates explicit tasks and rejects cycles", () => {
  const created = createTask({ id: "t1", title: "Inspect", objective: "Look", type: "inspect", modelPolicy: { reasoning: "none" }, permissions: { read: true, write: false, shell: false } });
  assert.equal(created.permissions.write, false);
  assert.throws(() => assertAcyclic([
    task({ id: "a", title: "A", dependencies: ["b"] }),
    task({ id: "b", title: "B", dependencies: ["a"] }),
  ]));
});

test("dependency queue holds dependents", () => {
  const queue = new TaskQueue([
    task({ id: "a", title: "A" }),
    task({ id: "b", title: "B", dependencies: ["a"] }),
  ]);
  assert.deepEqual(queue.takeReady(2).map((item) => item.id), ["a"]);
  queue.mark("a", "completed");
  assert.deepEqual(queue.takeReady(2).map((item) => item.id), ["b"]);
});

test("parses protocol messages and reports", () => {
  const message = parseMessageLine('{"version":1,"type":"task.completed","workerId":"w","taskId":"t","timestamp":1,"payload":{}}');
  assert.equal(message?.type, "task.completed");
  assert.equal(parseMessageLine("not json"), undefined);
  assert.throws(() => parseReportPayload({ taskId: "t" }));
  const wrapped = wrapTextReport({ taskId: "t", workerId: "w", text: "plain prose", durationMs: 3 });
  assert.equal(wrapped.status, "partial");
});

test("runs independent workers concurrently and survives failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "many-"));
  const telemetry = join(dir, "telemetry.jsonl");
  const config = await loadConfig(join(dir, "missing.json"));
  const orchestrator = getOrchestrator(config);
  const started: Array<{ id: string; at: number }> = [];
  orchestrator.bus.onEvent((event) => {
    if (event.type === "task.started" && event.taskId) started.push({ id: event.taskId, at: Date.now() });
  });
  const result = await orchestrator.run([
    task({ id: "A", title: "scheduler", context: "ok", modelPolicy: { reasoning: "none", maxTokens: 80, timeoutMs: 2000 } }),
    task({ id: "B", title: "provider", context: "fail", modelPolicy: { reasoning: "none", maxTokens: 80, timeoutMs: 2000 } }),
    task({ id: "C", title: "tests", dependencies: ["A"], context: "ok", modelPolicy: { reasoning: "none", maxTokens: 20, timeoutMs: 2000 } }),
  ], { provider: "mock", maxConcurrentWorkers: 2, telemetryPath: telemetry });
  assert.equal(result.reports.length, 3);
  assert.equal(result.reports.find((report) => report.taskId === "B")?.status, "failed");
  assert.equal(result.reports.find((report) => report.taskId === "A")?.status, "completed");
  assert.equal(result.reports.find((report) => report.taskId === "C")?.status, "completed");
  const overlap = started.filter((item) => item.id === "A" || item.id === "B");
  assert.equal(overlap.length, 2);
  assert.ok(Math.abs(overlap[0].at - overlap[1].at) < 500);
  const lines = (await readFile(telemetry, "utf8")).trim().split("\n");
  assert.ok(lines.some((line) => line.includes("task.telemetry")));
  assert.match(result.statusText, /pi-many-agents/);
});

test("enforces max concurrency", async () => {
  const config = await loadConfig("/tmp/does-not-exist-many.json");
  const orchestrator = getOrchestrator(config);
  let running = 0;
  let max = 0;
  orchestrator.bus.onEvent((event) => {
    if (event.type === "task.started") {
      running += 1;
      max = Math.max(max, running);
    }
    if (event.type === "task.completed" || event.type === "task.failed") running -= 1;
  });
  await orchestrator.run([
    task({ id: "1", title: "one", modelPolicy: { reasoning: "none", maxTokens: 60, timeoutMs: 2000 } }),
    task({ id: "2", title: "two", modelPolicy: { reasoning: "none", maxTokens: 60, timeoutMs: 2000 } }),
    task({ id: "3", title: "three", modelPolicy: { reasoning: "none", maxTokens: 60, timeoutMs: 2000 } }),
  ], { provider: "mock", maxConcurrentWorkers: 1, telemetryPath: join(tmpdir(), `many-${Date.now()}.jsonl`) });
  assert.equal(max, 1);
});

test("handles timeout, cancellation, malformed output, and provider failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "many-edge-"));
  const config = await loadConfig(join(dir, "nope.json"));
  const timeoutRun = await getOrchestrator(config).run([
    task({ id: "hang", title: "hang", context: "hang", modelPolicy: { reasoning: "none", timeoutMs: 200 } }),
  ], { provider: "mock", telemetryPath: join(dir, "timeout.jsonl") });
  assert.equal(timeoutRun.reports[0]?.status, "failed");
  assert.match(timeoutRun.reports[0]?.error ?? "", /timeout/);

  const malformed = await getOrchestrator(config).run([
    task({ id: "bad", title: "bad", context: "malformed" }),
  ], { provider: "mock", telemetryPath: join(dir, "bad.jsonl") });
  assert.equal(malformed.reports[0]?.status, "failed");
  assert.match(malformed.reports[0]?.error ?? "", /malformed/);

  const controller = new AbortController();
  const pending = getOrchestrator(config, controller.signal).run([
    task({ id: "slow", title: "slow", context: "hang", modelPolicy: { reasoning: "none", timeoutMs: 5000 } }),
  ], { provider: "mock", signal: controller.signal, telemetryPath: join(dir, "cancel.jsonl") });
  setTimeout(() => controller.abort(), 50);
  const cancelled = await pending;
  assert.ok(cancelled.reports[0]);
  assert.notEqual(cancelled.reports[0]?.status, "completed");

  const missing = await getOrchestrator(config).run([
    task({ id: "x", title: "x" }),
  ], { provider: "missing", telemetryPath: join(dir, "missing.jsonl") });
  assert.equal(missing.reports[0]?.status, "failed");
  assert.match(missing.reports[0]?.error ?? "", /unknown provider/);
});
