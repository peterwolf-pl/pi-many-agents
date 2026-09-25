import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import { mkdir, rm } from "node:fs/promises";
import { SqliteStore } from "../src/daemon/store.ts";
import type { AgentTask, AgentReport } from "../src/types.ts";

const TEST_DB = ".pi-many-agents/test-state.db";

describe("daemon store", () => {
  after(async () => {
    try { await rm(TEST_DB); } catch {}
  });

  it("creates store with WAL and basic CRUD", async () => {
    await mkdir(".pi-many-agents", { recursive: true });
    const store = new SqliteStore(TEST_DB);
    const task: AgentTask = {
      id: "T1", title: "test", objective: "obj", type: "inspect", priority: 1,
      dependencies: [], modelPolicy: { reasoning: "low" }, permissions: { read: true, write: false, shell: false }
    };
    store.upsertTask(task);
    assert.equal(store.getTask("T1")?.id, "T1");
    assert.equal(store.listTasks().length, 1);

    const report: AgentReport = {
      taskId: "T1", workerId: "w1", status: "completed", summary: "ok", findings: [], durationMs: 10
    };
    store.saveReport(report);
    assert.equal(store.listReports().length, 1);

    store.appendEvent({ version: 1, type: "task.started", workerId: "w1", timestamp: Date.now(), payload: {} });
    assert.ok(store.listEvents().length >= 1);

    store.close();
  });
});
