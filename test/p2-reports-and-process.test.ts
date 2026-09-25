import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonReport, wrapTextReport, isAgentReport } from "../src/protocol/report.ts";
import { ProcessManager } from "../src/process/process-manager.ts";

test("P2: extractJsonReport correctly parses report with nested changes and braces in strings", () => {
  const llmOutput = `
Here is my analysis of the system.
I made several modifications to {nested} components.

\`\`\`json
{
  "status": "completed",
  "summary": "Completed update with {braces in string}",
  "findings": ["finding A", "finding B"],
  "changes": {
    "files": ["src/core/task.ts", "test/p2.test.ts"],
    "description": "fixed report parser with {nested} braces"
  },
  "artifacts": ["dist/bundle.js"]
}
\`\`\`

Hope this helps!
`;

  const report = extractJsonReport(llmOutput);
  assert.ok(report, "Should extract report");
  assert.equal(report.status, "completed");
  assert.equal(report.summary, "Completed update with {braces in string}");
  assert.deepEqual(report.findings, ["finding A", "finding B"]);
  assert.deepEqual(report.changes, {
    files: ["src/core/task.ts", "test/p2.test.ts"],
    description: "fixed report parser with {nested} braces",
  });
  assert.deepEqual(report.artifacts, ["dist/bundle.js"]);
});

test("P2: process error never allows completed status in wrapTextReport", () => {
  const fakeCompletedOutput = JSON.stringify({
    status: "completed",
    summary: "Everything succeeded!",
    findings: ["All good"],
  });

  const wrapped = wrapTextReport({
    taskId: "task-1",
    workerId: "worker-1",
    text: fakeCompletedOutput,
    durationMs: 100,
    status: "failed",
    error: "Process crashed with exit code 1",
  });

  assert.notEqual(wrapped.status, "completed", "Status must not be completed when error is present");
  assert.equal(wrapped.status, "failed");
  assert.equal(wrapped.error, "Process crashed with exit code 1");
  assert.equal(wrapped.taskId, "task-1");
  assert.equal(wrapped.workerId, "worker-1");
});

test("P2: wrapTextReport handles text without structured report with clear warning", () => {
  const wrapped = wrapTextReport({
    taskId: "task-2",
    workerId: "worker-2",
    text: "Random unstructured output from worker",
    durationMs: 50,
  });

  assert.equal(wrapped.status, "partial");
  assert.ok(wrapped.warnings && wrapped.warnings.length > 0);
  assert.match(wrapped.warnings[0], /not a structured report/);
});

test("P2: ProcessManager enforces max buffer limit", async () => {
  const pm = new ProcessManager({ maxBufferBytes: 1024 }); // 1 KB limit
  const res = await pm.run({
    command: "node",
    args: ["-e", "process.stdout.write('A'.repeat(2048))"],
    timeoutMs: 2000,
  });

  assert.ok(res.timedOut || res.cancelled || res.exitCode !== 0 || res.stderr.includes("buffer limit") || res.stdout.length <= 1024);
});
