import type { AgentProvider } from "../providers/types.ts";
import type { AgentReport, AgentTask, Worker, WorkerState } from "../types.ts";

export class ManagedWorker implements Worker {
  state: WorkerState = "idle";
  taskId?: string;
  startedAt?: number;
  pid?: number;
  private current?: { cancel: () => Promise<void> };

  readonly id: string;
  readonly provider: string;
  readonly model: string;
  private readonly backend: AgentProvider;

  constructor(id: string, provider: string, model: string, backend: AgentProvider) {
    this.id = id;
    this.provider = provider;
    this.model = model;
    this.backend = backend;
  }

  async run(task: AgentTask): Promise<AgentReport> {
    this.state = "starting";
    this.taskId = task.id;
    this.startedAt = Date.now();
    const handle = await this.backend.spawn({
      id: this.id,
      provider: this.provider,
      model: this.model,
      workspace: task.workspace,
      timeoutMs: task.modelPolicy.timeoutMs ?? 120_000,
    });
    this.state = "running";
    this.current = { cancel: () => this.backend.cancel(handle) };
    try {
      const result = await this.backend.execute(handle, task);
      this.pid = result.handle.pid;
      this.state = result.report.status === "failed" ? "failed" : result.process.cancelled ? "cancelled" : "completed";
      return result.report;
    } catch (error) {
      this.state = "failed";
      return {
        taskId: task.id,
        workerId: this.id,
        status: "failed",
        summary: error instanceof Error ? error.message : "provider failure",
        findings: [],
        warnings: ["provider failure"],
        durationMs: Date.now() - (this.startedAt ?? Date.now()),
        error: error instanceof Error ? error.message : "provider failure",
      };
    } finally {
      this.current = undefined;
    }
  }

  async cancel(): Promise<void> {
    this.state = "cancelled";
    await this.current?.cancel();
  }
}

export class WorkerManager {
  private seq = 0;
  readonly workers: ManagedWorker[] = [];

  private readonly providers: Map<string, AgentProvider>;

  constructor(providers: Map<string, AgentProvider>) {
    this.providers = providers;
  }

  create(providerName: string, model: string): ManagedWorker {
    const backend = this.providers.get(providerName);
    if (!backend) throw new Error(`unknown provider: ${providerName}`);
    this.seq += 1;
    const worker = new ManagedWorker(`worker-${this.seq}`, providerName, model, backend);
    this.workers.push(worker);
    return worker;
  }

  running(): ManagedWorker[] {
    return this.workers.filter((worker) => worker.state === "running" || worker.state === "starting");
  }

  async cancelAll(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.cancel()));
  }

  async cancelTask(taskId: string): Promise<void> {
    const running = this.workers.filter((worker) => worker.taskId === taskId && (worker.state === "running" || worker.state === "starting"));
    await Promise.all(running.map((worker) => worker.cancel()));
  }
}
