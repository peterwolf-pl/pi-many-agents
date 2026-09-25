import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import { rm } from "node:fs/promises";
import { SqliteStore } from "../src/daemon/store.ts";
import type { AgentTask, AgentReport } from "../src/types.ts";

const TEST_DB = "/tmp/test-p5-state.db";

describe("daemon store", () => {
  after(async () => {
    try {
      await rm(TEST_DB);
      await rm(`${TEST_DB}-wal`);
      await rm(`${TEST_DB}-shm`);
    } catch {}
  });

  it("creates store with WAL and basic CRUD scoped by runId", async () => {
    const store = new SqliteStore(TEST_DB);
    const runId = "run-1";
    store.createRun(runId, { note: "first run" });

    const task: AgentTask = {
      id: "T1",
      title: "test",
      objective: "obj",
      type: "inspect",
      priority: 1,
      dependencies: [],
      modelPolicy: { reasoning: "low" },
      permissions: { read: true, write: false, shell: false },
    };
    store.upsertTask(runId, task, "queued");
    assert.equal(store.getTask(runId, "T1")?.id, "T1");
    assert.equal(store.listTasks(runId).length, 1);

    const report: AgentReport = {
      taskId: "T1",
      workerId: "w1",
      status: "completed",
      summary: "ok run 1",
      findings: [],
      durationMs: 10,
    };
    store.saveReport(runId, report);
    assert.equal(store.listReports(runId).length, 1);
    assert.equal(store.getReport(runId, "T1")?.summary, "ok run 1");

    // Second run with the same taskId "T1" does not overwrite run-1 report!
    const runId2 = "run-2";
    store.createRun(runId2);
    const report2: AgentReport = {
      taskId: "T1",
      workerId: "w2",
      status: "completed",
      summary: "ok run 2",
      findings: [],
      durationMs: 20,
    };
    store.saveReport(runId2, report2);
    assert.equal(store.getReport(runId, "T1")?.summary, "ok run 1");
    assert.equal(store.getReport(runId2, "T1")?.summary, "ok run 2");

    store.appendEvent({ version: 1, type: "task.started", workerId: "w1", timestamp: Date.now(), payload: {} }, runId);
    assert.ok(store.listEvents(runId).length >= 1);

    const status = store.getStatus();
    assert.equal(status.runs.total, 2);

    store.close();
  });

  it("restart detects incomplete runs and marks them aborted", () => {
    const store1 = new SqliteStore(TEST_DB);
    store1.createRun("run-interrupted");
    const task: AgentTask = {
      id: "T_int",
      title: "interrupted",
      objective: "interrupted task",
      type: "inspect",
      priority: 1,
      dependencies: [],
      modelPolicy: { reasoning: "low" },
      permissions: { read: true, write: false, shell: false },
    };
    store1.upsertTask("run-interrupted", task, "running");
    store1.close();

    // Reopen store as if daemon restarted
    const store2 = new SqliteStore(TEST_DB);
    const run = store2.getRun("run-interrupted");
    assert.equal(run?.state, "aborted");
    store2.close();
  });
});
