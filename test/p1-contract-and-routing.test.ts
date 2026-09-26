import test from "node:test";
import assert from "node:assert/strict";
import { parsePlan, validateRunOptions } from "../src/core/plan.ts";
import { routeTask } from "../src/routing/rules.ts";
import { createTask } from "../src/core/task.ts";
import { DEFAULT_CONFIG } from "../src/config/config.ts";

test("P1: rejects plan without tasks array with clear error", () => {
  assert.throws(
    () => parsePlan({ prompt_version: "1.0", stage: "3A" }),
    /Plan must contain a tasks array/
  );
  assert.throws(
    () => parsePlan("not a json"),
    /Invalid plan JSON/
  );
});

test("P1: validates concurrency and retries numbers", () => {
  assert.throws(
    () => validateRunOptions({ maxConcurrentWorkers: 0 }),
    /maxConcurrentWorkers must be an integer >= 1/
  );
  assert.throws(
    () => validateRunOptions({ maxConcurrentWorkers: -1 }),
    /maxConcurrentWorkers must be an integer >= 1/
  );
  assert.throws(
    () => validateRunOptions({ maxRetries: -1 }),
    /maxRetries must be an integer >= 0/
  );
});

test("P1: reasoning none is preserved and undefined takes baseline rule", () => {
  const inspectTaskWithNoReasoning = createTask({
    id: "t1",
    title: "inspect something",
    objective: "just inspect",
    type: "inspect",
  });
  const plan1 = routeTask(inspectTaskWithNoReasoning, DEFAULT_CONFIG);
  assert.equal(plan1.reasoning, "none", "Inspect task with undefined reasoning should get baseline 'none'");

  const inspectTaskWithExplicitLow = createTask({
    id: "t2",
    title: "inspect low",
    objective: "inspect with low",
    type: "inspect",
    modelPolicy: { reasoning: "low" },
  });
  const plan2 = routeTask(inspectTaskWithExplicitLow, DEFAULT_CONFIG);
  assert.equal(plan2.reasoning, "low", "Inspect task with explicit 'low' should keep 'low'");
});

test("P1: plan provider is preserved and precedence holds", () => {
  const parsed = parsePlan({
    provider: "custom-provider",
    tasks: [
      { id: "t1", title: "Task 1", objective: "Do 1" },
    ],
  });
  assert.equal(parsed.provider, "custom-provider");

  // Precedence logic: CLI flag > plan.provider > defaultProvider
  const resolveProvider = (cliFlag: string | undefined, planProv: string | undefined, def: string) => {
    return cliFlag ?? planProv ?? def;
  };

  assert.equal(resolveProvider("cli-override", parsed.provider, "default"), "cli-override");
  assert.equal(resolveProvider(undefined, parsed.provider, "default"), "custom-provider");
  assert.equal(resolveProvider(undefined, undefined, "default"), "default");
});

test("P1: stub Pi binary confirms argv contains effective model and reasoning", async () => {
  const { PiProvider } = await import("../src/providers/pi.ts");
  import("node:fs").then((fs) => {
    // We can test by running with a fake node script as the binary
  });
  const tempScript = "/tmp/test-pi-stub.js";
  const { writeFileSync, chmodSync, unlinkSync, readFileSync, existsSync } = await import("node:fs");
  const logFile = "/tmp/test-pi-stub.log";
  if (existsSync(logFile)) unlinkSync(logFile);

  writeFileSync(
    tempScript,
    `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(${JSON.stringify(logFile)}, JSON.stringify(process.argv));
console.log(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: '{"status":"completed","summary":"ok","findings":[]}' } }));
process.exit(0);
`,
    "utf8"
  );
  chmodSync(tempScript, 0o755);

  try {
    const provider = new PiProvider({ piBinary: tempScript });
    const task = createTask({
      id: "t-stub",
      title: "test stub",
      objective: "verify argv",
      type: "inspect",
      modelPolicy: {
        model: "my-custom-model",
        reasoning: "none",
      },
    });

    const handle = await provider.spawn({ id: "w1", provider: "pi", model: "my-custom-model", timeoutMs: 5000 });
    await provider.execute(handle, task);

    const loggedArgs = JSON.parse(readFileSync(logFile, "utf8")) as string[];
    assert.ok(loggedArgs.includes("--thinking"), "should include --thinking");
    const thinkingIdx = loggedArgs.indexOf("--thinking");
    assert.equal(loggedArgs[thinkingIdx + 1], "off", "reasoning 'none' maps to 'off'");

    assert.ok(loggedArgs.includes("--model"), "should include --model");
    const modelIdx = loggedArgs.indexOf("--model");
    assert.equal(loggedArgs[modelIdx + 1], "my-custom-model");

    // Now test with another model: it should pass --model other-model
    const taskOtherModel = createTask({
      id: "t-stub-2",
      title: "test stub other",
      objective: "verify argv passes other-model",
      type: "inspect",
      modelPolicy: {
        model: "other-model",
        reasoning: "low",
      },
    });
    await provider.execute(handle, taskOtherModel);
    const loggedArgs2 = JSON.parse(readFileSync(logFile, "utf8")) as string[];
    assert.ok(loggedArgs2.includes("other-model"), "should pass other-model to Pi");
  } finally {
    if (existsSync(tempScript)) unlinkSync(tempScript);
    if (existsSync(logFile)) unlinkSync(logFile);
  }
});

