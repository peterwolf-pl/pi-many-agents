import { spawn } from "node:child_process";
import { renderTaskPacket } from "../core/task.ts";
import { wrapTextReport } from "../protocol/report.ts";
import type { AgentTask, ProviderCapabilities, WorkerConfig, WorkerHandle } from "../types.ts";
import type { AgentProvider, ProviderRunResult } from "./types.ts";

export interface DockerMistralOptions {
  baseUrl?: string;
  model?: string;
  container?: string;
  image?: string;
  hostPort?: number;
  dockerBin?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

const DEFAULTS = {
  baseUrl: "http://127.0.0.1:11435",
  model: "mistral",
  container: "pi-many-mistral",
  image: "ollama/ollama",
  hostPort: 11435,
  dockerBin: "docker",
};

export class DockerMistralProvider implements AgentProvider {
  readonly name = "mistral";
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly container: string;
  private readonly image: string;
  private readonly hostPort: number;
  private readonly dockerBin: string;
  private readonly signal?: AbortSignal;
  private readonly fetchImpl: typeof fetch;
  private readonly activeAbortControllers = new Map<string, AbortController>();

  constructor(options: DockerMistralOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULTS.baseUrl;
    this.model = options.model ?? DEFAULTS.model;
    this.container = options.container ?? DEFAULTS.container;
    this.image = options.image ?? DEFAULTS.image;
    this.hostPort = options.hostPort ?? DEFAULTS.hostPort;
    this.dockerBin = options.dockerBin ?? DEFAULTS.dockerBin;
    this.signal = options.signal;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async available(): Promise<boolean> {
    const tags = await this.tags();
    return tags.includes(this.model) || tags.some((name) => name.startsWith(`${this.model}:`));
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
    const workerAc = new AbortController();
    this.activeAbortControllers.set(worker.id, workerAc);

    try {
      await this.ensure();
      const signals = [this.signal, workerAc.signal, AbortSignal.timeout(task.modelPolicy.timeoutMs ?? 120_000)].filter(
        (s): s is AbortSignal => Boolean(s)
      );
      const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: task.modelPolicy.model ?? this.model,
          stream: false,
          messages: [{ role: "user", content: renderTaskPacket(task) }],
        }),
        signal: AbortSignal.any(signals),
      });
      if (!response.ok) {
        const error = `mistral docker HTTP ${response.status}`;
        return this.failed(worker, task, started, error);
      }
      const body = (await response.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const report = wrapTextReport({
        taskId: task.id,
        workerId: worker.id,
        text: body.message?.content ?? "",
        durationMs: Date.now() - started,
        status: body.message?.content ? "completed" : "failed",
        error: body.message?.content ? undefined : "empty mistral response",
        usage: { inputTokens: body.prompt_eval_count, outputTokens: body.eval_count },
      });
      return { report, process: emptyProcess(), handle: worker };
    } catch (err) {
      const isCancelled = workerAc.signal.aborted || this.signal?.aborted;
      return {
        report: wrapTextReport({
          taskId: task.id,
          workerId: worker.id,
          text: "",
          durationMs: Date.now() - started,
          status: isCancelled ? "partial" : "failed",
          error: isCancelled ? "cancelled" : (err as Error).message,
        }),
        process: emptyProcess(),
        handle: worker,
      };
    } finally {
      this.activeAbortControllers.delete(worker.id);
    }
  }

  async cancel(worker: WorkerHandle): Promise<void> {
    this.activeAbortControllers.get(worker.id)?.abort();
  }

  private async ensure(): Promise<void> {
    if (await this.available()) return;
    await this.docker(["start", this.container]).catch(() => this.docker([
      "run", "-d", "--name", this.container,
      "-p", `${this.hostPort}:11434`,
      "-v", `${this.container}:/root/.ollama`,
      this.image,
    ]));
    await this.waitForTags();
    if (!(await this.available())) {
      await this.docker(["exec", this.container, "ollama", "pull", this.model]);
    }
    if (!(await this.available())) throw new Error(`mistral model ${this.model} is not available in ${this.container}`);
  }

  private async waitForTags(): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if ((await this.tags()).length >= 0 && await this.reachable()) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private async reachable(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(1000) });
      return response.ok;
    } catch {
      return false;
    }
  }

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

  private docker(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.dockerBin, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `docker ${args[0]} exited ${code}`)));
    });
  }

  private failed(worker: WorkerHandle, task: AgentTask, started: number, error: string): ProviderRunResult {
    return {
      report: wrapTextReport({ taskId: task.id, workerId: worker.id, text: "", durationMs: Date.now() - started, status: "failed", error }),
      process: emptyProcess(),
      handle: worker,
    };
  }
}

function emptyProcess(): ProviderRunResult["process"] {
  return { stdout: "", stderr: "", events: [], exitCode: 0, signal: null, timedOut: false, cancelled: false };
}
