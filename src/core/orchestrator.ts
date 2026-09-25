import type { ManyAgentsConfig } from "../config/config.ts";
import { EventBus } from "../telemetry/event-bus.ts";
import { JsonlLogger } from "../telemetry/logger.ts";
import { renderStatus, type StatusRow } from "../telemetry/status.ts";
import { createMessage } from "../protocol/messages.ts";
import { routeTask } from "../routing/rules.ts";
import type { AgentProvider } from "../providers/types.ts";
import type { AgentReport, AgentTask, ProtocolMessage, RunOptions, RunResult } from "../types.ts";
import { assertAcyclic } from "./task.ts";
import { dedupeTasks } from "./dedup.ts";
import { WorkerHealth } from "./health.ts";
import { TaskQueue } from "./scheduler.ts";
import { WorkerManager } from "./worker-manager.ts";
import { validateRunOptions } from "./plan.ts";

export class Orchestrator {
  readonly bus = new EventBus();
  private readonly providers = new Map<string, AgentProvider>();

  private readonly config: ManyAgentsConfig;
  private manager?: WorkerManager;
  private readonly cancelledTasks = new Set<string>();

  constructor(config: ManyAgentsConfig) {
    this.config = config;
  }

  async cancelTask(taskId: string): Promise<void> {
    this.cancelledTasks.add(taskId);
    await this.manager?.cancelTask(taskId);
  }

  registerProvider(provider: AgentProvider): void {
    this.providers.set(provider.name, provider);
  }

  async run(tasks: AgentTask[], options: RunOptions = {}): Promise<RunResult> {
    validateRunOptions(options);
    this.cancelledTasks.clear();
    const prepared = options.dedupe === false ? { tasks, dropped: [] } : dedupeTasks(tasks);
    assertAcyclic(prepared.tasks);
    const maxConcurrent = options.maxConcurrentWorkers ?? this.config.maxConcurrentWorkers;
    const maxRetries = options.maxRetries ?? this.config.maxRetries;
    const logger = new JsonlLogger(options.telemetryPath ?? this.config.telemetryPath);
    const queue = new TaskQueue(prepared.tasks);
    const manager = new WorkerManager(this.providers);
    this.manager = manager;
    const health = new WorkerHealth(this.config.unhealthyAfterFailures);
    const reports: AgentReport[] = [];
    const events: ProtocolMessage[] = [];
    const rows = new Map<string, StatusRow>(prepared.tasks.map((task) => [task.id, { id: task.id, state: "queued", title: task.title }]));
    for (const dropped of prepared.dropped) {
      const report = failedReport(dropped.id, "orchestrator", `duplicate of ${dropped.kept}`);
      report.status = "partial";
      reports.push(report);
      rows.set(dropped.id, { id: dropped.id, state: "cancelled", title: dropped.id });
      await logger.write(createMessage("task.cancelled", "orchestrator", { reason: "duplicate", kept: dropped.kept }, dropped.id));
    }
    let stop = Boolean(options.signal?.aborted);
    const onAbort = () => {
      stop = true;
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const publish = async (message: ProtocolMessage): Promise<void> => {
      events.push(message);
      this.bus.publish(message);
      await logger.write(message);
    };

    const inflight = new Set<Promise<void>>();
    const launch = (task: AgentTask): void => {
      const plan = routeTask(task, this.config);
      const providerName = options.provider ?? plan.provider;
      const job = (async () => {
        try {
          const provider = this.providers.get(providerName);
          if (!provider) {
            const report = failedReport(task.id, "orchestrator", `unknown provider: ${providerName}`);
            reports.push(report);
            queue.mark(task.id, "failed");
            rows.set(task.id, { id: task.id, state: "failed", title: task.title });
            await publish(createMessage("worker.failed", "orchestrator", { error: report.error }, task.id));
            await publish(createMessage("report.created", "orchestrator", { ...report }, task.id));
            return;
          }

          let isAvailable = false;
          try {
            isAvailable = await provider.available();
          } catch (availErr) {
            const report = failedReport(task.id, providerName, `provider available check threw: ${(availErr as Error).message}`);
            reports.push(report);
            queue.mark(task.id, "failed");
            rows.set(task.id, { id: task.id, state: "failed", title: task.title });
            await publish(createMessage("worker.failed", providerName, { error: report.error }, task.id));
            await publish(createMessage("report.created", providerName, { ...report }, task.id));
            return;
          }

          if (!isAvailable) {
            const report = failedReport(task.id, providerName, `provider unavailable: ${providerName}`);
            reports.push(report);
            queue.mark(task.id, "failed");
            rows.set(task.id, { id: task.id, state: "failed", title: task.title });
            await publish(createMessage("worker.failed", providerName, { error: report.error }, task.id));
            await publish(createMessage("report.created", providerName, { ...report }, task.id));
            return;
          }
          if (!health.healthy(providerName)) {
            const report = failedReport(task.id, providerName, `provider unhealthy: ${providerName}`);
            reports.push(report);
            queue.mark(task.id, "failed");
            rows.set(task.id, { id: task.id, state: "failed", title: task.title });
            await publish(createMessage("worker.failed", providerName, { error: report.error, health: health.snapshot() }, task.id));
            return;
          }
          const worker = manager.create(providerName, plan.model);
          rows.set(task.id, { id: task.id, state: "running", title: task.title });
          health.record(providerName, "started");
          await publish(createMessage("worker.started", worker.id, { provider: providerName, model: plan.model, pid: worker.pid }, task.id));
          await publish(createMessage("task.started", worker.id, { plan }, task.id));
          let report = failedReport(task.id, worker.id, "worker did not run");
          const attempts = Math.max(0, maxRetries) + 1;
          for (let attempt = 1; attempt <= attempts; attempt += 1) {
            if (this.cancelledTasks.has(task.id) || stop) {
              report = failedReport(task.id, worker.id, "cancelled");
              report.status = "partial";
              worker.state = "cancelled";
              break;
            }
            report = await worker.run({ ...task, modelPolicy: { ...task.modelPolicy, model: plan.model, reasoning: plan.reasoning, timeoutMs: plan.timeoutMs } });
            if (!retryable(report) || attempt === attempts) break;
            await publish(createMessage("task.progress", worker.id, { attempt, retry: true, error: report.error }, task.id));
          }
          health.record(providerName, report.status === "failed" ? "failed" : worker.state === "cancelled" ? "cancelled" : "completed");
          reports.push(report);
          const terminal = report.status === "failed" ? "failed" : worker.state === "cancelled" ? "cancelled" : "completed";
          queue.mark(task.id, terminal === "cancelled" ? "cancelled" : terminal === "failed" ? "failed" : "completed");
          rows.set(task.id, { id: task.id, state: worker.state, title: task.title });
          await publish(createMessage(terminal === "failed" ? "task.failed" : terminal === "cancelled" ? "task.cancelled" : "task.completed", worker.id, {}, task.id));
          await publish(createMessage("report.created", worker.id, { ...report }, task.id));
          await logger.write({
            kind: "task.telemetry",
            taskId: task.id,
            workerId: worker.id,
            provider: providerName,
            model: plan.model,
            reasoning: plan.reasoning,
            start: worker.startedAt,
            end: Date.now(),
            duration: report.durationMs,
            status: report.status,
            inputTokens: report.usage?.inputTokens,
            outputTokens: report.usage?.outputTokens,
            estimatedCost: report.usage?.estimatedCost,
            pid: worker.pid,
          });
        } catch (jobErr) {
          const report = failedReport(task.id, providerName, `task execution error: ${(jobErr as Error).message}`);
          reports.push(report);
          queue.mark(task.id, "failed");
          rows.set(task.id, { id: task.id, state: "failed", title: task.title });
          await publish(createMessage("task.failed", "orchestrator", { error: report.error }, task.id));
          await publish(createMessage("report.created", "orchestrator", { ...report }, task.id));
        }
      })().finally(() => {
        inflight.delete(job);
      });
      inflight.add(job);
    };

    try {
      while (!stop && (queue.pendingCount() > 0 || inflight.size > 0)) {
        for (const task of queue.queued()) {
          if (this.cancelledTasks.has(task.id)) queue.mark(task.id, "cancelled");
        }
        const slots = Math.max(0, maxConcurrent - inflight.size);
        for (const task of queue.takeReady(slots)) launch(task);
        if (inflight.size === 0) {
          queue.refresh();
          if (queue.pendingCount() === 0) break;
        }
        if (inflight.size === 0) break;
        await Promise.race(inflight);
      }
      for (const entry of queue.entries()) {
        if (reports.some((report) => report.taskId === entry.id)) continue;
        if (entry.phase !== "failed" && entry.phase !== "cancelled") continue;
        const task = prepared.tasks.find((item) => item.id === entry.id);
        const report = failedReport(entry.id, "orchestrator", "blocked by failed dependency");
        reports.push(report);
        rows.set(entry.id, { id: entry.id, state: "failed", title: task?.title ?? entry.id });
        await publish(createMessage("task.failed", "orchestrator", { reason: "dependency" }, entry.id));
        await publish(createMessage("report.created", "orchestrator", { ...report }, entry.id));
      }
      if (stop) {
        await manager.cancelAll();
        await Promise.allSettled(inflight);
        for (const task of queue.queued()) {
          queue.mark(task.id, "cancelled");
          rows.set(task.id, { id: task.id, state: "cancelled", title: task.title });
          const report = failedReport(task.id, "orchestrator", "cancelled");
          report.status = "partial";
          reports.push(report);
          await publish(createMessage("task.cancelled", "orchestrator", {}, task.id));
        }
      }
      for (const task of prepared.tasks) {
        if (!reports.some((report) => report.taskId === task.id)) {
          const report = failedReport(task.id, "orchestrator", stop ? "cancelled" : "unresolved");
          if (stop) report.status = "partial";
          reports.push(report);
          rows.set(task.id, { id: task.id, state: stop ? "cancelled" : "failed", title: task.title });
        }
      }
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      await manager.cancelAll();
      this.manager = undefined;
    }

    const running = [...rows.values()].filter((row) => row.state === "running").length;
    const queued = [...rows.values()].filter((row) => row.state === "queued").length;
    return {
      reports,
      events,
      statusText: `${renderStatus({ workers: manager.workers.length, running, queued, rows: [...rows.values()] })}\n\nHealth:\n${health.snapshot().map((item) => `${item.provider} failed=${item.failed} healthy=${item.healthy}`).join("\n")}`,
    };
  }
}

function retryable(report: AgentReport): boolean {
  if (report.status !== "failed") return false;
  const error = report.error ?? "";
  return !/timeout|cancelled|malformed|unknown provider|unavailable|unhealthy/.test(error);
}

function failedReport(taskId: string, workerId: string, error: string): AgentReport {
  return {
    taskId,
    workerId,
    status: "failed",
    summary: error,
    findings: [],
    warnings: [error],
    durationMs: 0,
    error,
  };
}
