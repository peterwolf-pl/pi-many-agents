import { readFile } from "node:fs/promises";
import { decomposeMarkdown } from "../core/decompose.ts";
import { dependencyGraph } from "../core/graph.ts";
import { createTask } from "../core/task.ts";
import { parsePlan, validateRunOptions } from "../core/plan.ts";
import { runTasks } from "../index.ts";
import type { AgentTask } from "../types.ts";
import { startDaemon } from "../daemon/server.ts";
import { launchDashboard } from "../dashboard/launcher.ts";
import { DashboardIpcClient } from "../dashboard/client.ts";
import { DashboardApp } from "../dashboard/app.ts";
import { resolveDaemonSocket } from "../daemon/client.ts";
import { DEFAULT_SOCKET_PATH } from "../daemon/server.ts";

async function main(): Promise<void> {
  const [command = "help", ...rest] = process.argv.slice(2);
  if (command === "help" || command === "--help") {
    process.stdout.write(`pi-many-agents run --plan <file> [--provider pi|qwen4|mistral|...] [--concurrency N] [--retries N]
pi-many-agents doctor
pi-many-agents decompose <markdown> [--integrate]
pi-many-agents graph --plan <file>
pi-many-agents demo
pi-many-agents daemon
pi-many-agents dashboard [--inline] [--new-window]
`);
    return;
  }
  if (command === "doctor") {
    await runDoctor();
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
  if (command === "dashboard") {
    const inline = rest.includes("--inline");
    const newWindow = rest.includes("--new-window");
    const launch = launchDashboard({ cwd: process.cwd(), inline, newWindow });
    if (launch.launched) {
      process.stdout.write(`${launch.message ?? "launched"}\n`);
      return;
    }
    if (launch.message) process.stderr.write(`${launch.message}\n`);
    // inline mode
    const socketPath = resolveDaemonSocket(process.cwd());
    const client = new DashboardIpcClient({ socketPath }, (ev) => {
      if (ev.type === "error") process.stderr.write(`[dash] ${ev.error}\n`);
    });
    const app = new DashboardApp({ client, inline: true, onExit: () => process.exit(0) });
    await app.start();
    // app runs until q
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
    const plan = parsePlan(await readFile(planPath, "utf8"));
    process.stdout.write(`${JSON.stringify(dependencyGraph(plan.tasks), null, 2)}\n`);
    return;
  }
  if (command !== "run") throw new Error(`unknown command: ${command}`);
  const planFlag = rest.indexOf("--plan");
  const planPath = planFlag >= 0 ? rest[planFlag + 1] : undefined;
  if (!planPath) throw new Error("--plan is required");
  const providerFlag = rest.indexOf("--provider");
  const concurrencyFlag = rest.indexOf("--concurrency");
  const plan = parsePlan(await readFile(planPath, "utf8"));
  const provider = (providerFlag >= 0 ? rest[providerFlag + 1] : undefined) ?? plan.provider;
  const maxConcurrentWorkers = concurrencyFlag >= 0 ? Number(rest[concurrencyFlag + 1]) : plan.concurrency;
  const maxRetries = rest.includes("--retries") ? Number(rest[rest.indexOf("--retries") + 1]) : plan.maxRetries;

  validateRunOptions({ maxConcurrentWorkers, maxRetries });

  const result = await runTasks(plan.tasks, {
    provider,
    maxConcurrentWorkers,
    maxRetries,
  });
  process.stdout.write(`${result.statusText}\n`);
  process.stdout.write(`${JSON.stringify({ reports: result.reports }, null, 2)}\n`);
  if (result.reports.some((report) => report.status === "failed")) process.exitCode = 1;
}

async function runDemo(): Promise<void> {
  const { loadConfig } = await import("../config/config.ts");
  const config = await loadConfig();
  const tasks = [
    createTask({ id: "A", title: "analyze scheduler", objective: "Analyze scheduler implementation.", type: "inspect", priority: 1, modelPolicy: { reasoning: "low", maxTokens: 40 }, permissions: { read: true, write: false, shell: false } }),
    createTask({ id: "B", title: "analyze provider", objective: "Analyze provider abstraction.", type: "review", priority: 1, modelPolicy: { reasoning: "low", maxTokens: 40 }, permissions: { read: true, write: false, shell: false } }),
    createTask({ id: "C", title: "propose tests", objective: "Analyze tests and propose missing coverage.", type: "test", priority: 0, dependencies: ["A"], modelPolicy: { reasoning: "low", maxTokens: 20 }, permissions: { read: true, write: false, shell: false } }),
  ];
  const result = await runTasks(tasks, { provider: config.defaultProvider, maxConcurrentWorkers: 2, telemetryPath: ".pi-many-agents/demo-telemetry.jsonl" });
  process.stdout.write(`${result.statusText}\n`);
  process.stdout.write(`${JSON.stringify(result.reports.map((report) => ({ taskId: report.taskId, status: report.status, summary: report.summary })), null, 2)}\n`);
}

async function runDoctor(): Promise<void> {
  const { loadConfig } = await import("../config/config.ts");
  const { DockerMistralProvider } = await import("../providers/docker-mistral.ts");
  const { OllamaProvider } = await import("../providers/ollama.ts");
  const { PiProvider } = await import("../providers/pi.ts");

  const config = await loadConfig();

  const pi = new PiProvider(config);
  const qwen4 = new OllamaProvider({ name: "qwen4", baseUrl: config.ollama?.baseUrl, model: config.ollama?.model });
  const mistral = new DockerMistralProvider({ baseUrl: config.mistral?.baseUrl, model: config.mistral?.model });

  process.stdout.write("pi-many-agents doctor\n\n");

  const piAvail = await pi.available();
  process.stdout.write(`- pi (cli): ${piAvail ? "AVAILABLE" : "UNAVAILABLE"}\n`);

  const qwen4Model = (await qwen4.resolveModel()) ?? "not configured";
  const qwen4Avail = await qwen4.available();
  process.stdout.write(`- qwen4 (ollama ${config.ollama.baseUrl}): ${qwen4Avail ? `AVAILABLE (${qwen4Model})` : `NOT AVAILABLE (${qwen4Model})`}\n`);

  const mistralAvail = await mistral.available();
  process.stdout.write(`- mistral (docker ${config.mistral.baseUrl}): ${mistralAvail ? `AVAILABLE (${config.mistral.model})` : `NOT AVAILABLE (${config.mistral.model})`}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
