import test from "node:test";
import assert from "node:assert/strict";
import { dedupeTasks } from "../src/core/dedup.ts";
import { createTask, assertAcyclic } from "../src/core/task.ts";
import { Orchestrator } from "../src/core/orchestrator.ts";
import { MockProvider } from "./helpers/mock-provider.ts";
import { DEFAULT_CONFIG } from "../src/config/config.ts";

test("P6: dedup rewrites dependencies so C -> B becomes C -> A without missing dependency error", () => {
  const taskA = createTask({
    id: "task-A",
    title: "Task A",
    objective: "Common objective",
    type: "inspect",
    priority: 10,
  });

  const taskB = createTask({
    id: "task-B",
    title: "Task B duplicate",
    objective: "Common objective",
    type: "inspect",
    priority: 5,
  });

  const taskC = createTask({
    id: "task-C",
    title: "Task C",
    objective: "Depends on B",
    type: "inspect",
    dependencies: ["task-B"],
    priority: 1,
  });

  const result = dedupeTasks([taskA, taskB, taskC]);
  assert.equal(result.dropped.length, 1);
  assert.equal(result.dropped[0].id, "task-B");
  assert.equal(result.dropped[0].kept, "task-A");

  // Verify task-C dependencies were rewritten to task-A
  const dedupedC = result.tasks.find((t) => t.id === "task-C");
  assert.ok(dedupedC);
  assert.deepEqual(dedupedC.dependencies, ["task-A"]);

  // assertAcyclic should pass on the rewritten tasks
  assert.doesNotThrow(() => assertAcyclic(result.tasks));
});

test("P6: tasks with different workspace or context are NOT deduplicated", () => {
  const task1 = createTask({
    id: "t1",
    title: "Task 1",
    objective: "Common objective",
    workspace: "/workspace/one",
    type: "inspect",
  });

  const task2 = createTask({
    id: "t2",
    title: "Task 2",
    objective: "Common objective",
    workspace: "/workspace/two",
    type: "inspect",
  });

  const result = dedupeTasks([task1, task2]);
  assert.equal(result.tasks.length, 2, "Tasks in different workspaces must not be deduplicated");
  assert.equal(result.dropped.length, 0);
});

test("P6: dependency reports are passed into dependent task context", async () => {
  const orchestrator = new Orchestrator(DEFAULT_CONFIG);
  orchestrator.registerProvider(new MockProvider());

  const taskA = createTask({
    id: "dep-A",
    title: "Initial Analysis",
    objective: "Analyze core logic",
    type: "inspect",
  });

  const taskB = createTask({
    id: "dep-B",
    title: "Integrate Analysis",
    objective: "Verify dependency reports were received",
    type: "inspect",
    dependencies: ["dep-A"],
  });

  const result = await orchestrator.run([taskA, taskB], {
    provider: "mock",
    maxConcurrentWorkers: 1,
  });

  assert.equal(result.reports.length, 2);
  const reportB = result.reports.find((r) => r.taskId === "dep-B");
  assert.equal(reportB?.status, "completed");
});
