import { renderTaskPacket } from "../core/task.ts";
import { wrapTextReport } from "../protocol/report.ts";
import type { AgentTask, ProviderCapabilities, WorkerConfig, WorkerHandle } from "../types.ts";
import type { AgentProvider, ProviderRunResult } from "./types.ts";

export interface DockerMistralOptions {
  name?: string;
  baseUrl?: string;
  model?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

const DEFAULTS = {
  name: "mistral",
  baseUrl: "http://127.0.0.1:12434/engines/v1",
  model: "ai/mistral",
};

export function modelMatches(modelId: string, target: string): boolean {
  if (modelId === target) return true;
  const cleanId = modelId.replace(/^docker\.io\//, "").replace(/:latest$/, "");
  const cleanTarget = target.replace(/^docker\.io\//, "").replace(/:latest$/, "");
  return cleanId === cleanTarget;
}

export class DockerMistralProvider implements AgentProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly signal?: AbortSignal;
  private readonly fetchImpl: typeof fetch;
  private readonly activeAbortControllers = new Map<string, AbortController>();

  constructor(options: DockerMistralOptions = {}) {
    this.name = options.name ?? DEFAULTS.name;
    this.baseUrl = options.baseUrl ?? DEFAULTS.baseUrl;
    this.model = options.model ?? DEFAULTS.model;
    this.signal = options.signal;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async available(forModel?: string): Promise<boolean> {
    const targetModel = forModel ?? this.model;
    const models = await this.listModels();
    return models.some((m) => modelMatches(m, targetModel));
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
    return { id: config.id, provider: this.name, model: config.model || this.model, startedAt: Date.now() };
  }

  async execute(worker: WorkerHandle, task: AgentTask): Promise<ProviderRunResult> {
    const started = Date.now();
    const effectiveModel = task.modelPolicy.model ?? worker.model ?? this.model;

    if (!(await this.available(effectiveModel))) {
      return this.failed(worker, task, started, `Docker Model Runner model '${effectiveModel}' is not available`);
    }

    const workerAc = new AbortController();
    this.activeAbortControllers.set(worker.id, workerAc);

    try {
      const signals = [this.signal, workerAc.signal, AbortSignal.timeout(task.modelPolicy.timeoutMs ?? 120_000)].filter(
        (s): s is AbortSignal => Boolean(s)
      );

      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: effectiveModel,
          messages: [{ role: "user", content: renderTaskPacket(task) }],
          stream: false,
        }),
        signal: AbortSignal.any(signals),
      });

      if (!response.ok) {
        return this.failed(worker, task, started, `Docker Model Runner HTTP ${response.status}`);
      }

      let body: {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      try {
        body = (await response.json()) as typeof body;
      } catch {
        return this.failed(worker, task, started, "invalid JSON from Docker Model Runner /chat/completions");
      }

      const content = body.choices?.[0]?.message?.content;
      const inputTokens = typeof body.usage?.prompt_tokens === "number" ? body.usage.prompt_tokens : undefined;
      const outputTokens = typeof body.usage?.completion_tokens === "number" ? body.usage.completion_tokens : undefined;

      const report = wrapTextReport({
        taskId: task.id,
        workerId: worker.id,
        text: content ?? "",
        durationMs: Date.now() - started,
        status: content ? "completed" : "failed",
        error: content ? undefined : "empty Docker Model Runner response",
        usage: inputTokens !== undefined || outputTokens !== undefined ? { inputTokens, outputTokens } : undefined,
      });

      return {
        report,
        process: { stdout: "", stderr: "", events: [], exitCode: 0, signal: null, timedOut: false, cancelled: false },
        handle: { ...worker, model: effectiveModel },
      };
    } catch (err) {
      const isCancelled = Boolean(workerAc.signal.aborted || this.signal?.aborted);
      return {
        report: wrapTextReport({
          taskId: task.id,
          workerId: worker.id,
          text: "",
          durationMs: Date.now() - started,
          status: isCancelled ? "partial" : "failed",
          error: isCancelled ? "cancelled" : (err as Error).message,
        }),
        process: { stdout: "", stderr: "", events: [], exitCode: 1, signal: null, timedOut: false, cancelled: isCancelled },
        handle: { ...worker, model: effectiveModel },
      };
    } finally {
      this.activeAbortControllers.delete(worker.id);
    }
  }

  async cancel(worker: WorkerHandle): Promise<void> {
    this.activeAbortControllers.get(worker.id)?.abort();
  }

  private async listModels(): Promise<string[]> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/models`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return [];
      const body = (await response.json()) as { data?: Array<{ id?: string }> };
      return (body.data ?? []).map((m) => m.id ?? "").filter(Boolean);
    } catch {
      return [];
    }
  }

  private failed(worker: WorkerHandle, task: AgentTask, started: number, error: string): ProviderRunResult {
    return {
      report: wrapTextReport({
        taskId: task.id,
        workerId: worker.id,
        text: "",
        durationMs: Date.now() - started,
        status: "failed",
        error,
      }),
      process: { stdout: "", stderr: "", events: [], exitCode: 1, signal: null, timedOut: false, cancelled: false },
      handle: worker,
    };
  }
}
