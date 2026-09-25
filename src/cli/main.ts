import { readFile } from "node:fs/promises";
import { decomposeMarkdown } from "../core/decompose.ts";
import { dependencyGraph } from "../core/graph.ts";
import { createTask } from "../core/task.ts";
import { runTasks } from "../index.ts";
import type { AgentTask } from "../types.ts";
import { startDaemon } from "../daemon/server.ts";

async function main(): Promise<void> {
  const [command = "help", ...rest] = process.argv.slice(2);
  if (command === "help" || command === "--help") {
    process.stdout.write(`pi-many-agents run --plan <file> [--provider fake|pi] [--concurrency N] [--retries N]
pi-many-agents decompose <markdown> [--integrate]
pi-many-agents graph --plan <file>
pi-many-agents demo
pi-many-agents daemon
`);
    return;
  }
  if (command === "demo") {
    await runDemo();
    return;
  }
  if (command === "daemon") {
    await startDaemon();
    return;
  }
  if (command === "decompose") {
    const text = await readFile(rest.find((arg) => !arg.startsWith("--")) ?? "", "utf8");
    process.stdout.write(`${JSON.stringify({ tasks: decomposeMarkdown(text, { addIntegrateTask: rest.includes("--integrate") }) }, null, 2)}\n`);
    return;
  }
  if (command === "graph") {
    const planFlag = rest.indexOf("--plan");
    const planPath = planFlag >= 0 ? rest[planFlag + 1] : undefined;
    if (!planPath) throw new Error("--plan is required");
    const raw = JSON.parse(await readFile(planPath, "utf8")) as { tasks: Array<Partial<AgentTask> & Pick<AgentTask, "id" | "title" | "objective">> };
    process.stdout.write(`${JSON.stringify(dependencyGraph(raw.tasks.map((task) => createTask(task))), null, 2)}\n`);
    return;
  }
  if (command !== "run") throw new Error(`unknown command: ${command}`);
  const planFlag = rest.indexOf("--plan");
  const planPath = planFlag >= 0 ? rest[planFlag + 1] : undefined;
  if (!planPath) throw new Error("--plan is required");
  const providerFlag = rest.indexOf("--provider");
  const concurrencyFlag = rest.indexOf("--concurrency");
  const raw = JSON.parse(await readFile(planPath, "utf8")) as { tasks: Array<Partial<AgentTask> & Pick<AgentTask, "id" | "title" | "objective">> };
  const tasks = raw.tasks.map((task) => createTask(task));
  const result = await runTasks(tasks, {
    provider: providerFlag >= 0 ? rest[providerFlag + 1] : "fake",
    maxConcurrentWorkers: concurrencyFlag >= 0 ? Number(rest[concurrencyFlag + 1]) : undefined,
    maxRetries: rest.includes("--retries") ? Number(rest[rest.indexOf("--retries") + 1]) : undefined,
  });
  process.stdout.write(`${result.statusText}\n`);
  process.stdout.write(`${JSON.stringify({ reports: result.reports }, null, 2)}\n`);
  if (result.reports.some((report) => report.status === "failed")) process.exitCode = 1;
}

async function runDemo(): Promise<void> {
  const tasks = [
    createTask({ id: "A", title: "analyze scheduler", objective: "Analyze scheduler implementation.", type: "inspect", priority: 1, modelPolicy: { reasoning: "low", maxTokens: 40 }, permissions: { read: true, write: false, shell: false } }),
    createTask({ id: "B", title: "analyze provider", objective: "Analyze provider abstraction.", type: "review", priority: 1, modelPolicy: { reasoning: "low", maxTokens: 40 }, permissions: { read: true, write: false, shell: false } }),
    createTask({ id: "C", title: "propose tests", objective: "Analyze tests and propose missing coverage.", type: "test", priority: 0, dependencies: ["A"], modelPolicy: { reasoning: "low", maxTokens: 20 }, permissions: { read: true, write: false, shell: false } }),
  ];
  const result = await runTasks(tasks, { provider: "fake", maxConcurrentWorkers: 2, telemetryPath: ".pi-many-agents/demo-telemetry.jsonl" });
  process.stdout.write(`${result.statusText}\n`);
  process.stdout.write(`${JSON.stringify(result.reports.map((report) => ({ taskId: report.taskId, status: report.status, summary: report.summary })), null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
