import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { initialState, dashboardReducer } from "../src/dashboard/state.ts";
import { render } from "../src/dashboard/render.ts";
import { handleKey } from "../src/dashboard/input.ts";
import type { DashboardSnapshot } from "../src/daemon/store.ts";

describe("dashboard state/reducer", () => {
  it("initial state has offline connecting", () => {
    const s = initialState();
    assert.equal(s.daemon.status, "connecting");
    assert.equal(s.runs.length, 0);
  });

  it("SNAPSHOT updates daemon and runs", () => {
    const snap: DashboardSnapshot = {
      daemon: { running: true, pid: 123, lastRefresh: Date.now() },
      runs: [{ id: "r1", state: "running", createdAt: Date.now(), updatedAt: Date.now(), taskCount: 3, completed: 1, running: 1, failed: 0, queued: 1 }],
      activeRunCount: 1,
      taskCounts: { queued: 1, running: 1, completed: 1, failed: 0, cancelled: 0 },
      providers: [{ name: "fake", model: "fake", status: "registered" }],
      recentEvents: [],
    };
    const s0 = initialState();
    const s1 = dashboardReducer(s0, { type: "SNAPSHOT", payload: snap });
    assert.equal(s1.daemon.status, "online");
    assert.equal(s1.runs.length, 1);
    assert.equal(s1.selectedRunId, "r1");
  });

  it("SELECT changes selected", () => {
    const s0 = initialState();
    const s1 = dashboardReducer(s0, { type: "SELECT", runId: "r2" }); // no run, no change
    assert.equal(s1.selectedRunId, undefined);
  });

  it("MODAL and ERROR work", () => {
    const s0 = initialState();
    const s1 = dashboardReducer(s0, { type: "ERROR", error: "boom" });
    assert.equal(s1.lastError, "boom");
    const s2 = dashboardReducer(s1, { type: "MODAL", modal: { type: "confirm-abort", runId: "r1" } });
    assert.equal(s2.adminModal?.type, "confirm-abort");
  });
});

describe("dashboard render", () => {
  it("renders without crash for 80x24", () => {
    const state = initialState({ cols: 80, rows: 24 });
    const out = render(state);
    assert.ok(out.length > 100);
    assert.ok(out.includes("PI MANY AGENTS"));
    assert.ok(out.includes("DAEMON CONNECTING"));
  });

  it("renders wide 140x40 with providers", () => {
    const state = initialState({ cols: 140, rows: 40 });
    state.providers = [{ name: "qwen4", model: "qwen", status: "registered" }];
    const out = render(state);
    assert.ok(out.includes("PROVIDERS"));
    assert.ok(out.includes("qwen4"));
  });

  it("sanitizes control chars in titles", () => {
    const state = initialState({ cols: 80, rows: 24 });
    state.tasks = [{ id: "t1", title: "bad\x1b[31m title", state: "running", provider: "f" } as any];
    const out = render(state);
    assert.ok(!out.includes("\x1b[31m"));
  });
});

describe("dashboard input handling", () => {
  it("quit on q or Ctrl-C", () => {
    const state = initialState();
    assert.equal(handleKey(state, "q").quit, true);
    assert.equal(handleKey(state, "Q").quit, true);
    assert.equal(handleKey(state, "\u0003").quit, true);
  });

  it("refresh on r", () => {
    const state = initialState();
    assert.equal(handleKey(state, "r").refresh, true);
  });

  it("confirm-abort executes on y and cancels on n", () => {
    const state = initialState();
    state.adminModal = { type: "confirm-abort", runId: "r-test" };
    const yes = handleKey(state, "y");
    assert.deepEqual(yes.execute, { type: "abort", runId: "r-test" });
    assert.equal(yes.action?.type, "MODAL");

    const no = handleKey(state, "n");
    assert.equal(no.execute, undefined);
    assert.equal(no.action?.type, "MODAL");
  });

  it("confirm-abort-all accumulates buffer and executes on ABORT + Enter", () => {
    const state = initialState();
    state.adminModal = { type: "confirm-abort-all", confirmBuffer: "ABOR" };
    const addT = handleKey(state, "T");
    assert.equal(addT.action?.type, "MODAL_INPUT");
    if (addT.action?.type === "MODAL_INPUT") {
      assert.equal(addT.action.text, "ABORT");
    }

    state.adminModal.confirmBuffer = "ABORT";
    const enter = handleKey(state, "\r");
    assert.deepEqual(enter.execute, { type: "abort" });
  });
});
