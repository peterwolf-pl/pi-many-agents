import { fileURLToPath } from "node:url";
import { ProcessManager } from "../process/process-manager.ts";
import { parseReportPayload, wrapTextReport } from "../protocol/report.ts";
import type { AgentTask, ProviderCapabilities, WorkerConfig, WorkerHandle } from "../types.ts";
import type { AgentProvider, ProviderRunResult } from "./types.ts";

export class FakeProvider implements AgentProvider {
  readonly name = "fake";
  private readonly processes = new ProcessManager();
  private seq = 0;

  private readonly signal?: AbortSignal;

  constructor(signal?: AbortSignal) {
    this.signal = signal;
  }

  async available(): Promise<boolean> {
    return true;
  }

  capabilities(): ProviderCapabilities {
    return {
      coding: false,
      toolUse: false,
      filesystem: false,
      shell: false,
      reasoningLevels: ["none", "low", "medium", "high"],
      tokenUsageReporting: false,
    };
  }

  async spawn(config: WorkerConfig): Promise<WorkerHandle> {
    return { id: config.id, provider: this.name, model: config.model, startedAt: Date.now() };
  }

  async execute(worker: WorkerHandle, task: AgentTask): Promise<ProviderRunResult> {
    const script = fileURLToPath(new URL("./fake-worker.ts", import.meta.url));
    const started = Date.now();
    const managed = await this.processes.run({
      command: process.execPath,
      args: ["--experimental-strip-types", script, JSON.stringify({ workerId: worker.id, task, behavior: task.context })],
      cwd: task.workspace,
      timeoutMs: task.modelPolicy.timeoutMs ?? 5_000,
      signal: this.signal,
    });
    worker.pid = managed.pid;
    const reportEvent = [...managed.events].reverse().find((event) => event.type === "report.created");
    let report;
    try {
      report = reportEvent ? parseReportPayload(reportEvent.payload) : undefined;
    } catch {
      report = wrapTextReport({
        taskId: task.id,
        workerId: worker.id,
        text: managed.stdout,
        durationMs: Date.now() - started,
        error: "malformed worker output",
        status: "failed",
      });
    }
    if (!report) {
      const error = managed.timedOut
        ? "timeout"
        : managed.cancelled
          ? "cancelled"
          : managed.exitCode === 0
            ? "malformed worker output"
            : managed.stderr.trim() || `exit ${managed.exitCode}`;
      report = wrapTextReport({
        taskId: task.id,
        workerId: worker.id,
        text: "",
        durationMs: Date.now() - started,
        status: managed.cancelled ? "partial" : "failed",
        error,
      });
    }
    return { report, process: managed, handle: { ...worker, pid: managed.pid } };
  }

  async cancel(): Promise<void> {
    await this.processes.cleanup();
  }

  nextId(): string {
    this.seq += 1;
    return `worker-${this.seq}`;
  }
}
