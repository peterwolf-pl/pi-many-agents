import test from "node:test";
import assert from "node:assert/strict";
import { Orchestrator } from "../src/core/orchestrator.ts";
import { createTask } from "../src/core/task.ts";
import { DEFAULT_CONFIG } from "../src/config/config.ts";
import { FakeProvider } from "../src/providers/fake.ts";

test("P3: cancelling task A leaves task B running to completion", async () => {
  const orchestrator = new Orchestrator(DEFAULT_CONFIG);
  orchestrator.registerProvider(new FakeProvider());

  const taskA = createTask({
    id: "task-A",
    title: "Task A slow",
    objective: "Slow task A",
    type: "inspect",
    context: "sleep:200", // fake-worker supports sleep if context has sleep:ms or we simulate slow
  });

  const taskB = createTask({
    id: "task-B",
    title: "Task B fast",
    objective: "Fast task B",
    type: "inspect",
    context: "sleep:200",
  });

  const runPromise = orchestrator.run([taskA, taskB], {
    provider: "fake",
    maxConcurrentWorkers: 2,
    dedupe: false,
  });

  // Cancel task A after a brief moment
  setTimeout(() => {
    orchestrator.cancelTask("task-A").catch(() => {});
  }, 20);

  const result = await runPromise;
  const reportA = result.reports.find((r) => r.taskId === "task-A");
  const reportB = result.reports.find((r) => r.taskId === "task-B");

  assert.ok(reportA, "task-A must have a report");
  assert.equal(reportA.status, "partial", "task-A should be cancelled/partial");

  assert.ok(reportB, "task-B must have a report");
  assert.equal(reportB.status, "completed", "task-B should have completed successfully");
});

test("P3: pre-aborted run does not launch any workers", async () => {
  const orchestrator = new Orchestrator(DEFAULT_CONFIG);
  orchestrator.registerProvider(new FakeProvider());

  const task = createTask({
    id: "task-1",
    title: "Task 1",
    objective: "Do 1",
    type: "inspect",
  });

  const ac = new AbortController();
  ac.abort(); // pre-aborted

  const result = await orchestrator.run([task], {
    provider: "fake",
    signal: ac.signal,
  });

  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].status, "partial");
  assert.equal(result.reports[0].error, "cancelled");
});

test("P3: second run does not inherit cancellations from first run", async () => {
  const orchestrator = new Orchestrator(DEFAULT_CONFIG);
  orchestrator.registerProvider(new FakeProvider());

  const taskA = createTask({
    id: "task-reuse",
    title: "Task to cancel",
    objective: "Cancel this",
    type: "inspect",
    context: "sleep:200",
  });

  const p1 = orchestrator.run([taskA], { provider: "fake" });
  setTimeout(() => {
    orchestrator.cancelTask("task-reuse").catch(() => {});
  }, 20);
  const res1 = await p1;
  assert.equal(res1.reports[0].status, "partial");

  // Run 2 with the same taskId
  const res2 = await orchestrator.run([taskA], { provider: "fake" });
  assert.equal(res2.reports[0].status, "completed", "Task in run 2 must not be cancelled from run 1");
});
