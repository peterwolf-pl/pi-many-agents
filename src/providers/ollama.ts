import { renderTaskPacket } from "../core/task.ts";
import { wrapTextReport } from "../protocol/report.ts";
import type { AgentTask, ProviderCapabilities, WorkerConfig, WorkerHandle } from "../types.ts";
import type { AgentProvider, ProviderRunResult } from "./types.ts";

export interface OllamaProviderOptions {
  name: string;
  model: string;
  baseUrl?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export class OllamaProvider implements AgentProvider {
  readonly name: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly signal?: AbortSignal;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaProviderOptions) {
    this.name = options.name;
    this.model = options.model;
    this.baseUrl = options.baseUrl ?? "http://127.0.0.1:11434";
    this.signal = options.signal;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async available(): Promise<boolean> {
    const tags = await this.tags();
    const listed = tags.includes(this.model) || tags.some((name) => name.startsWith(`${this.model}:`) || this.model.startsWith(`${name}:`));
    if (!listed) return false;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model }),
        signal: AbortSignal.timeout(1500),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  capabilities(): ProviderCapabilities {
    return {
      coding: false,
      toolUse: false,
      filesystem: false,
      shell: false,
      reasoningLevels: ["none", "low"],
      tokenUsageReporting: true,
      models: [this.model],
    };
  }

  async spawn(config: WorkerConfig): Promise<WorkerHandle> {
    return { id: config.id, provider: this.name, model: this.model, startedAt: Date.now() };
  }

  async execute(worker: WorkerHandle, task: AgentTask): Promise<ProviderRunResult> {
    const started = Date.now();
    if (!(await this.available())) {
      return this.failed(worker, task, started, `ollama model ${this.model} is not loaded`);
    }
    const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: task.modelPolicy.model ?? this.model,
        stream: false,
        messages: [{ role: "user", content: renderTaskPacket(task) }],
      }),
      signal: AbortSignal.any([this.signal, AbortSignal.timeout(task.modelPolicy.timeoutMs ?? 120_000)].filter((item): item is AbortSignal => Boolean(item))),
    });
    if (!response.ok) return this.failed(worker, task, started, `ollama HTTP ${response.status}`);
    const body = await response.json() as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    return {
      report: wrapTextReport({
        taskId: task.id,
        workerId: worker.id,
        text: body.message?.content ?? "",
        durationMs: Date.now() - started,
        status: body.message?.content ? "completed" : "failed",
        error: body.message?.content ? undefined : "empty ollama response",
        usage: { inputTokens: body.prompt_eval_count, outputTokens: body.eval_count },
      }),
      process: { stdout: "", stderr: "", events: [], exitCode: 0, signal: null, timedOut: false, cancelled: false },
      handle: worker,
    };
  }

  async cancel(): Promise<void> {}

  private async tags(): Promise<string[]> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return [];
      const body = await response.json() as { models?: Array<{ name?: string }> };
      return (body.models ?? []).map((model) => model.name ?? "").filter(Boolean);
    } catch {
      return [];
    }
  }

  private failed(worker: WorkerHandle, task: AgentTask, started: number, error: string): ProviderRunResult {
    return {
      report: wrapTextReport({ taskId: task.id, workerId: worker.id, text: "", durationMs: Date.now() - started, status: "failed", error }),
      process: { stdout: "", stderr: "", events: [], exitCode: 1, signal: null, timedOut: false, cancelled: false },
      handle: worker,
    };
  }
}
