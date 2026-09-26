import test from "node:test";
import assert from "node:assert/strict";
import { createOrchestrator, loadConfig } from "../src/index.ts";
import { createTask } from "../src/core/task.ts";

test("P4: orchestrator registers qwen4 and mistral providers from configuration", async () => {
  const config = await loadConfig();
  const orchestrator = createOrchestrator(config);

  const taskMistral = createTask({
    id: "tm",
    title: "tm",
    objective: "obj mistral",
    type: "inspect",
  });

  const resMistral = await orchestrator.run([taskMistral], {
    provider: "mistral",
  });

  assert.equal(resMistral.reports.length, 1);
  assert.notEqual(resMistral.reports[0].error, "unknown provider: mistral");
});

test("P4: qwen4 missing tag fails explicitly without switching provider", async () => {
  const config = await loadConfig();
  const orchestrator = createOrchestrator(config);

  const taskQwen = createTask({
    id: "tq",
    title: "tq",
    objective: "obj qwen",
    type: "inspect",
  });

  const resQwen = await orchestrator.run([taskQwen], {
    provider: "qwen4",
  });

  assert.equal(resQwen.reports.length, 1);
  assert.equal(resQwen.reports[0].status, "failed");
  assert.match(resQwen.reports[0].error ?? "", /unavailable/);
});
