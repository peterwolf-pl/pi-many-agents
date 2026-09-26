import { fileURLToPath } from "node:url";
import { ProcessManager } from "../../src/process/process-manager.ts";
import { parseReportPayload, wrapTextReport } from "../../src/protocol/report.ts";
import type { AgentTask, ProviderCapabilities, WorkerConfig, WorkerHandle } from "../../src/types.ts";
import type { AgentProvider, ProviderRunResult } from "../../src/providers/types.ts";

export class MockProvider implements AgentProvider {
  readonly name: string;
  private readonly processes = new ProcessManager();
  private readonly activeAbortControllers = new Map<string, AbortController>();
  private seq = 0;
  private readonly signal?: AbortSignal;

  constructor(name = "mock", signal?: AbortSignal) {
    this.name = name;
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
    const script = fileURLToPath(new URL("./mock-worker.ts", import.meta.url));
    const started = Date.now();

    const workerAc = new AbortController();
    this.activeAbortControllers.set(worker.id, workerAc);

    const onGlobalAbort = () => workerAc.abort();
    this.signal?.addEventListener("abort", onGlobalAbort, { once: true });

    let managed;
    try {
      managed = await this.processes.run({
        command: process.execPath,
        args: ["--experimental-strip-types", script, JSON.stringify({ workerId: worker.id, task, behavior: task.context })],
        cwd: task.workspace,
        timeoutMs: task.modelPolicy.timeoutMs ?? 5_000,
        signal: workerAc.signal,
      });
    } finally {
      this.signal?.removeEventListener("abort", onGlobalAbort);
      this.activeAbortControllers.delete(worker.id);
    }

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

  async cancel(worker: WorkerHandle): Promise<void> {
    this.activeAbortControllers.get(worker.id)?.abort();
  }

  async cleanup(): Promise<void> {
    for (const ac of this.activeAbortControllers.values()) ac.abort();
    await this.processes.cleanup();
  }

  nextId(): string {
    this.seq += 1;
    return `worker-${this.seq}`;
  }
}
