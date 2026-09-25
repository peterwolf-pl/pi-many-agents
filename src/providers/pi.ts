import { spawnSync } from "node:child_process";
import type { ManyAgentsConfig } from "../config/config.ts";
import { ProcessManager } from "../process/process-manager.ts";
import { wrapTextReport } from "../protocol/report.ts";
import { renderTaskPacket } from "../core/task.ts";
import type { AgentTask, ProviderCapabilities, ReasoningLevel, Usage, WorkerConfig, WorkerHandle } from "../types.ts";
import type { AgentProvider, ProviderRunResult } from "./types.ts";

const THINKING: Record<ReasoningLevel, string> = {
  none: "off",
  low: "low",
  medium: "medium",
  high: "high",
};

export class PiProvider implements AgentProvider {
  readonly name = "pi";
  private readonly processes = new ProcessManager();

  private readonly config: Pick<ManyAgentsConfig, "piBinary">;
  private readonly signal?: AbortSignal;

  constructor(config: Pick<ManyAgentsConfig, "piBinary">, signal?: AbortSignal) {
    this.config = config;
    this.signal = signal;
  }

  async available(): Promise<boolean> {
    const result = spawnSync(this.config.piBinary, ["--version"], { stdio: "ignore" });
    return result.status === 0;
  }

  capabilities(): ProviderCapabilities {
    return {
      coding: true,
      toolUse: true,
      filesystem: true,
      shell: true,
      reasoningLevels: ["none", "low", "medium", "high"],
      tokenUsageReporting: true,
    };
  }

  async spawn(config: WorkerConfig): Promise<WorkerHandle> {
    return { id: config.id, provider: this.name, model: config.model, startedAt: Date.now() };
  }

  async execute(worker: WorkerHandle, task: AgentTask): Promise<ProviderRunResult> {
    const started = Date.now();
    const tools = [
      task.permissions.read ? "read,grep,find,ls" : "",
      task.permissions.write ? "edit,write" : "",
      task.permissions.shell ? "bash" : "",
    ].filter(Boolean);
    const args = [
      "--print",
      "--mode",
      "json",
      "--no-session",
      "--no-extensions",
      "--thinking",
      THINKING[task.modelPolicy.reasoning],
    ];
    if (tools.length) args.push("--tools", tools.join(","));
    else args.push("--no-tools");
    if (task.modelPolicy.provider && task.modelPolicy.provider !== "pi" && task.modelPolicy.provider !== "fake") {
      args.push("--provider", task.modelPolicy.provider);
    }
    if (task.modelPolicy.model) args.push("--model", task.modelPolicy.model);
    args.push("--", renderTaskPacket(task));
    const managed = await this.processes.run({
      command: this.config.piBinary,
      args,
      cwd: task.workspace,
      timeoutMs: task.modelPolicy.timeoutMs ?? 120_000,
      signal: this.signal,
    });
    const text = assistantText(managed.stdout);
    const usage = usageFromJsonl(managed.stdout);
    const error = managed.timedOut
      ? "timeout"
      : managed.cancelled
        ? "cancelled"
        : managed.exitCode === 0
          ? undefined
          : managed.stderr.trim() || `pi exited ${managed.exitCode}`;
    const report = wrapTextReport({
      taskId: task.id,
      workerId: worker.id,
      text,
      durationMs: Date.now() - started,
      status: error ? (managed.cancelled ? "partial" : "failed") : "completed",
      error,
      usage,
    });
    return { report, process: managed, handle: { ...worker, pid: managed.pid } };
  }

  async cancel(): Promise<void> {
    await this.processes.cleanup();
  }
}

function assistantText(stdout: string): string {
  const parts: string[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } };
      if (event.type === "message_end" && event.message?.role === "assistant") {
        parts.push(contentToText(event.message.content));
      }
    } catch {
      // Pi diagnostics must not break report collection.
    }
  }
  return parts.filter(Boolean).join("\n");
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const record = block as { type?: string; text?: string };
      return record.type === "text" && record.text ? record.text : "";
    })
    .filter(Boolean)
    .join("");
}

function usageFromJsonl(stdout: string): Usage | undefined {
  let usage: Usage | undefined;
  for (const line of stdout.split("\n")) {
    if (!line.includes("usage")) continue;
    try {
      const event = JSON.parse(line) as { usage?: { input?: number; output?: number; cacheRead?: number; cost?: number } };
      if (!event.usage) continue;
      usage = {
        inputTokens: event.usage.input,
        outputTokens: event.usage.output,
        cachedTokens: event.usage.cacheRead,
        estimatedCost: event.usage.cost,
      };
    } catch {
      // ignore
    }
  }
  return usage;
}
