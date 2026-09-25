import assert from "node:assert/strict";
import test from "node:test";
import { L0Advisor } from "../src/l0/advisor.ts";
import { JsonlLogger } from "../src/telemetry/logger.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("L0Advisor falls back to deterministic classify when ollama unavailable", async () => {
  const advisor = new L0Advisor({
    fetchImpl: (async () => new Response("not found", { status: 404 })) as typeof fetch,
  });
  const type = await advisor.classify("Write unit tests for the new parser");
  assert.equal(type, "test");
});

test("L0Advisor uses deterministic compress when unavailable", async () => {
  const advisor = new L0Advisor({
    fetchImpl: (async () => new Response("not found", { status: 404 })) as typeof fetch,
  });
  const long = "This is a very long summary. ".repeat(20);
  const compressed = await advisor.compressSummary(long);
  assert.ok(compressed.length <= 283);
  assert.ok(compressed.endsWith("..."));
});

test("L0Advisor recommendReasoning falls back and logs skip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "l0-test-"));
  const logPath = join(dir, "telemetry.jsonl");
  const logger = new JsonlLogger(logPath);
  const advisor = new L0Advisor({
    logger,
    fetchImpl: (async () => { throw new Error("connection refused"); }) as typeof fetch,
  });
  const level = await advisor.recommendReasoning("Complex multi-file architecture refactor needed", "low");
  assert.equal(level, "medium");
  await rm(dir, { recursive: true, force: true });
});

test("L0Advisor classify deterministic rules for code and review", async () => {
  const advisor = new L0Advisor({
    fetchImpl: (async () => new Response("not found", { status: 404 })) as typeof fetch,
  });
  assert.equal(await advisor.classify("Fix the bug in login flow"), "code");
  assert.equal(await advisor.classify("Perform security audit of API"), "review");
});
