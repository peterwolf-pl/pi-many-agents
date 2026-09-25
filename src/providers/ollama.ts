import { renderTaskPacket } from "../core/task.ts";
import { wrapTextReport } from "../protocol/report.ts";
import type { AgentTask, ProviderCapabilities, WorkerConfig, WorkerHandle } from "../types.ts";
import type { AgentProvider, ProviderRunResult } from "./types.ts";

export interface OllamaProviderOptions {
  name: string;
  model?: string;
  baseUrl?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export class OllamaProvider implements AgentProvider {
  readonly name: string;
  private readonly configuredModel?: string;
  private readonly baseUrl: string;
  private readonly signal?: AbortSignal;
  private readonly fetchImpl: typeof fetch;
  private readonly activeAbortControllers = new Map<string, AbortController>();

  constructor(options: OllamaProviderOptions) {
    this.name = options.name;
    this.configuredModel = options.model;
    this.baseUrl = options.baseUrl ?? "http://127.0.0.1:11434";
    this.signal = options.signal;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async resolveModel(targetModel?: string): Promise<string | undefined> {
    if (targetModel && targetModel.trim()) return targetModel.trim();
    if (this.configuredModel && this.configuredModel.trim()) return this.configuredModel.trim();

    // Dynamic discovery in tags
    const tags = await this.tags();
    // Look for exact or prefix matching this.name (e.g. qwen4, qwen4:latest, qwen4:7b)
    const match = tags.find((tag) => tag === this.name || tag.startsWith(`${this.name}:`));
    return match;
  }

  async available(forModel?: string): Promise<boolean> {
    const modelToTest = await this.resolveModel(forModel);
    if (!modelToTest) return false;

    const tags = await this.tags();
    const listed = tags.includes(modelToTest) || tags.some((t) => t.startsWith(`${modelToTest}:`));
    if (!listed) return false;

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: modelToTest }),
        signal: AbortSignal.timeout(2000),
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
      models: this.configuredModel ? [this.configuredModel] : [],
    };
  }

  async spawn(config: WorkerConfig): Promise<WorkerHandle> {
    const effective = (await this.resolveModel(config.model)) ?? config.model ?? this.configuredModel ?? this.name;
    return { id: config.id, provider: this.name, model: effective, startedAt: Date.now() };
  }

  async execute(worker: WorkerHandle, task: AgentTask): Promise<ProviderRunResult> {
    const started = Date.now();
    const effectiveModel = await this.resolveModel(task.modelPolicy.model ?? worker.model);
    if (!effectiveModel || !(await this.available(effectiveModel))) {
      const missingName = effectiveModel ?? task.modelPolicy.model ?? worker.model ?? this.name;
      return this.failed(worker, task, started, `ollama model '${missingName}' is not available`);
    }

    const workerAc = new AbortController();
    this.activeAbortControllers.set(worker.id, workerAc);

    try {
      const signals = [this.signal, workerAc.signal, AbortSignal.timeout(task.modelPolicy.timeoutMs ?? 120_000)].filter(
        (item): item is AbortSignal => Boolean(item)
      );
      const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: effectiveModel,
          stream: false,
          messages: [{ role: "user", content: renderTaskPacket(task) }],
        }),
        signal: AbortSignal.any(signals),
      });

      if (!response.ok) return this.failed(worker, task, started, `ollama HTTP ${response.status}`);

      let body: {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      try {
        body = (await response.json()) as typeof body;
      } catch {
        return this.failed(worker, task, started, "invalid JSON from ollama /api/chat");
      }

      const inputTokens = typeof body.prompt_eval_count === "number" ? body.prompt_eval_count : undefined;
      const outputTokens = typeof body.eval_count === "number" ? body.eval_count : undefined;

      return {
        report: wrapTextReport({
          taskId: task.id,
          workerId: worker.id,
          text: body.message?.content ?? "",
          durationMs: Date.now() - started,
          status: body.message?.content ? "completed" : "failed",
          error: body.message?.content ? undefined : "empty ollama response",
          usage: inputTokens !== undefined || outputTokens !== undefined ? { inputTokens, outputTokens } : undefined,
        }),
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

  private async tags(): Promise<string[]> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (!response.ok) return [];
      const body = (await response.json()) as { models?: Array<{ name?: string }> };
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
