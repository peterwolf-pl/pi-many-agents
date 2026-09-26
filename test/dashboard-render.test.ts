import test from "node:test";
import assert from "node:assert/strict";
import { initialState, dashboardReducer, type DashboardState } from "../src/dashboard/state.ts";
import { render, stripAnsi, visibleWidth, formatTokens, formatCost } from "../src/dashboard/render.ts";
import type { DashboardSnapshot } from "../src/daemon/store.ts";

test("Dashboard render helpers: formatTokens and formatCost", () => {
  assert.equal(formatTokens(undefined), "--");
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(500), "500");
  assert.equal(formatTokens(1500), "1.5k");
  assert.equal(formatTokens(2_500_000), "2.50M");

  assert.equal(formatCost(undefined), "--");
  assert.equal(formatCost(0.01234), "$0.0123");
});

test("Dashboard render helpers: stripAnsi and visibleWidth", () => {
  const colored = "\x1b[32mOK\x1b[0m";
  assert.equal(stripAnsi(colored), "OK");
  assert.equal(visibleWidth(colored), 2);
});

test("Dashboard render: displays usage summary and token counters", () => {
  const state = initialState({ cols: 140, rows: 40 });
  const snapshot: DashboardSnapshot = {
    daemon: { running: true, pid: 1234, lastRefresh: Date.now() },
    runs: [
      {
        id: "run-1",
        state: "completed",
        createdAt: Date.now() - 5000,
        updatedAt: Date.now(),
        taskCount: 2,
        completed: 2,
        running: 0,
        failed: 0,
        queued: 0,
        usage: {
          inputTokens: 1000,
          outputTokens: 500,
          cachedTokens: 200,
          totalTokens: 1500,
          estimatedCost: 0.005,
          costKnown: true,
          reportsWithUsage: 2,
          reportsTotal: 2,
        },
      },
    ],
    activeRunCount: 0,
    taskCounts: { queued: 0, running: 0, completed: 2, failed: 0, cancelled: 0 },
    providers: [{ name: "pi", model: "claude-sonnet-4-6", status: "registered" }],
    recentEvents: [],
    tasks: [
      {
        id: "t1",
        runId: "run-1",
        title: "Test Task 1",
        state: "completed",
        provider: "pi",
        model: "claude-sonnet-4-6",
        reasoning: "low",
        durationMs: 1200,
        usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
      },
    ],
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 200,
      totalTokens: 1500,
      estimatedCost: 0.005,
      costKnown: true,
      reportsWithUsage: 2,
      reportsTotal: 2,
    },
    providerUsage: [
      {
        provider: "pi",
        model: "claude-sonnet-4-6",
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 200,
        totalTokens: 1500,
        estimatedCost: 0.005,
        reportsWithUsage: 2,
        reportsTotal: 2,
      },
    ],
  };

  const s1 = dashboardReducer(state, { type: "SNAPSHOT", payload: snapshot });
  const output = render(s1);

  assert.ok(output.includes("PI MANY AGENTS"), "Header should be present");
  assert.ok(output.includes("1.5k") || output.includes("1500"), "Tokens should be rendered");
  assert.ok(output.includes("claude-sonnet"), "Model should be visible");
  assert.ok(output.includes("low"), "Reasoning should be visible");
  assert.ok(output.includes("RUNS"), "Runs panel should be present");
});

test("Dashboard render: handles tiny terminal gracefully without crashing", () => {
  const tinyState = initialState({ cols: 40, rows: 12 });
  assert.doesNotThrow(() => {
    const out = render(tinyState);
    assert.ok(out.length > 0);
  });
});

test("Dashboard render: sanitizes control characters to prevent ANSI injection", () => {
  const state = initialState({ cols: 80, rows: 24 });
  const evilTask = {
    id: "evil",
    runId: "r1",
    title: "malicious\x1b[2J\x1b[?25h Title",
    state: "running",
  };
  const s = {
    ...state,
    selectedRunId: "r1",
    runs: [{ id: "r1", state: "running", createdAt: Date.now(), updatedAt: Date.now(), taskCount: 1, completed: 0, running: 1, failed: 0, queued: 0 }],
    tasks: [evilTask],
  };

  const out = render(s);
  assert.ok(!out.includes("\x1b[2J"), "ANSI escape codes from user strings must be stripped");
});
