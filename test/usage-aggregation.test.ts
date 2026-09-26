import test from "node:test";
import assert from "node:assert/strict";
import type { AgentReport } from "../src/types.ts";
import { aggregateUsage } from "../src/daemon/store.ts";

test("Usage aggregation: calculates input, output, and totalTokens = input + output", () => {
  const reports: AgentReport[] = [
    {
      taskId: "t1",
      workerId: "w1",
      status: "completed",
      summary: "ok",
      findings: [],
      durationMs: 100,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 20,
      },
    },
    {
      taskId: "t2",
      workerId: "w2",
      status: "completed",
      summary: "ok",
      findings: [],
      durationMs: 200,
      usage: {
        inputTokens: 200,
        outputTokens: 80,
        cachedTokens: 10,
      },
    },
  ];

  const result = aggregateUsage(reports);

  assert.equal(result.inputTokens, 300);
  assert.equal(result.outputTokens, 130);
  assert.equal(result.totalTokens, 430, "totalTokens must equal inputTokens + outputTokens");
  assert.equal(result.cachedTokens, 30, "cachedTokens must be auxiliary and not added again to totalTokens");
  assert.equal(result.reportsWithUsage, 2);
  assert.equal(result.reportsTotal, 2);
  assert.equal(result.costKnown, false);
  assert.equal(result.estimatedCost, undefined);
});

test("Usage aggregation: handles missing usage without false zeros", () => {
  const reports: AgentReport[] = [
    {
      taskId: "t1",
      workerId: "w1",
      status: "completed",
      summary: "ok",
      findings: [],
      durationMs: 100,
      // no usage
    },
    {
      taskId: "t2",
      workerId: "w2",
      status: "completed",
      summary: "ok",
      findings: [],
      durationMs: 100,
      usage: {
        inputTokens: 50,
        outputTokens: 25,
      },
    },
  ];

  const result = aggregateUsage(reports);
  assert.equal(result.inputTokens, 50);
  assert.equal(result.outputTokens, 25);
  assert.equal(result.totalTokens, 75);
  assert.equal(result.reportsWithUsage, 1);
  assert.equal(result.reportsTotal, 2);
});

test("Usage aggregation: sums estimatedCost only when reported and tracks costKnown", () => {
  const reports: AgentReport[] = [
    {
      taskId: "t1",
      workerId: "w1",
      status: "completed",
      summary: "ok",
      findings: [],
      durationMs: 100,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        estimatedCost: 0.005,
      },
    },
    {
      taskId: "t2",
      workerId: "w2",
      status: "completed",
      summary: "ok",
      findings: [],
      durationMs: 100,
      usage: {
        inputTokens: 50,
        outputTokens: 20,
        // no estimatedCost
      },
    },
  ];

  const result = aggregateUsage(reports);
  assert.equal(result.costKnown, true);
  assert.ok(Math.abs((result.estimatedCost ?? 0) - 0.005) < 0.0001);
});

test("Usage aggregation: empty reports returns zero totals with costKnown false", () => {
  const result = aggregateUsage([]);
  assert.equal(result.inputTokens, 0);
  assert.equal(result.outputTokens, 0);
  assert.equal(result.totalTokens, 0);
  assert.equal(result.cachedTokens, 0);
  assert.equal(result.estimatedCost, undefined);
  assert.equal(result.costKnown, false);
  assert.equal(result.reportsWithUsage, 0);
  assert.equal(result.reportsTotal, 0);
});
