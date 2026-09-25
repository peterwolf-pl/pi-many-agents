import { spawnSync } from "node:child_process";
import type { ManyAgentsConfig } from "../config/config.ts";
import type { AgentTask, ProviderCapabilities, WorkerConfig, WorkerHandle } from "../types.ts";
import { PiProvider } from "./pi.ts";
import type { AgentProvider, ProviderRunResult } from "./types.ts";

export interface PiWorkerProfile {
  name: string;
  piProvider: string;
  model: string;
  models: string[];
  source: string;
}

const ANTIGRAVITY_CLAUDE_AND_GPT = ["claude-opus-4-6", "claude-sonnet-4-6", "gpt-oss-120b"];
const ANTIGRAVITY_ACCOUNT_MODELS = [
  "claude-opus-4-6",
  "claude-opus-4-6-thinking",
  "claude-sonnet-4-6",
  "gpt-oss-120b",
  "gpt-oss-120b-medium",
];

function account(name: string, models: string[]): PiWorkerProfile {
  return {
    name,
    piProvider: name,
    model: "gemini-3.8-flash",
    models: ["gemini-3.8-flash", ...models],
    source: "pi --list-models",
  };
}

function alias(name: string, piProvider: string, model: string): PiWorkerProfile {
  return { name, piProvider, model, models: [model], source: "pi --list-models" };
}

/** Profiles checked with `pi --list-models` on this machine. Antigravity has no model id named codex; its GPT model is gpt-oss-120b. */
export const PI_WORKER_PROFILES: PiWorkerProfile[] = [
  account("antigravity", ANTIGRAVITY_CLAUDE_AND_GPT),
  account("google-antigravity-2", ANTIGRAVITY_ACCOUNT_MODELS),
  account("google-antigravity-3", ANTIGRAVITY_ACCOUNT_MODELS),
  account("google-antigravity-4", ANTIGRAVITY_ACCOUNT_MODELS),
  { name: "xai", piProvider: "xai", model: "grok-4.7", models: ["grok-4.7"], source: "pi --list-models" },
  {
    name: "openai-codex",
    piProvider: "openai-codex",
    model: "gpt-5.5",
    models: ["gpt-5.5", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-6-sol", "gpt-6-luna"],
    source: "pi --list-models",
  },
  alias("gpt-5.6-sol", "openai-codex", "gpt-5.6-sol"),
  alias("gpt-5.6-luna", "openai-codex", "gpt-5.6-luna"),
  alias("gpt-6-sol", "openai-codex", "gpt-6-sol"),
  alias("gpt-6-luna", "openai-codex", "gpt-6-luna"),
  alias("antigravity-claude-opus", "antigravity", "claude-opus-4-6"),
  alias("antigravity-claude-sonnet", "antigravity", "claude-sonnet-4-6"),
  alias("antigravity-gpt-oss", "antigravity", "gpt-oss-120b"),
  alias("google-antigravity-2-claude-opus", "google-antigravity-2", "claude-opus-4-6"),
  alias("google-antigravity-2-claude-sonnet", "google-antigravity-2", "claude-sonnet-4-6"),
  alias("google-antigravity-2-gpt-oss", "google-antigravity-2", "gpt-oss-120b"),
  alias("google-antigravity-3-claude-opus", "google-antigravity-3", "claude-opus-4-6"),
  alias("google-antigravity-3-claude-sonnet", "google-antigravity-3", "claude-sonnet-4-6"),
  alias("google-antigravity-3-gpt-oss", "google-antigravity-3", "gpt-oss-120b"),
  alias("google-antigravity-4-claude-opus", "google-antigravity-4", "claude-opus-4-6"),
  alias("google-antigravity-4-claude-sonnet", "google-antigravity-4", "claude-sonnet-4-6"),
  alias("google-antigravity-4-gpt-oss", "google-antigravity-4", "gpt-oss-120b"),
];

export function listPiProviders(binary: string): string[] {
  const result = spawnSync(binary, ["--list-models"], { encoding: "utf8" });
  if (result.status !== 0) return [];
  const names = new Set<string>();
  for (const line of result.stdout.split("\n")) {
    const name = line.trim().split(/\s+/)[0];
    if (!name || name === "provider") continue;
    names.add(name);
  }
  return [...names];
}

export class PiProfileProvider implements AgentProvider {
  readonly name: string;
  private readonly model: string;
  private readonly inner: PiProvider;
  private readonly listed: () => string[];

  private readonly piProvider: string;
  private readonly models: string[];

  constructor(profile: PiWorkerProfile, config: Pick<ManyAgentsConfig, "piBinary">, listed: () => string[], signal?: AbortSignal) {
    this.name = profile.name;
    this.model = profile.model;
    this.models = profile.models;
    this.piProvider = profile.piProvider;
    this.listed = listed;
    this.inner = new PiProvider(config, signal);
  }

  async available(): Promise<boolean> {
    return (await this.inner.available()) && this.listed().includes(this.piProvider);
  }

  capabilities(): ProviderCapabilities {
    return { ...this.inner.capabilities(), models: this.models };
  }

  spawn(config: WorkerConfig): Promise<WorkerHandle> {
    return this.inner.spawn({ ...config, provider: this.name, model: config.model || this.model });
  }

  execute(worker: WorkerHandle, task: AgentTask): Promise<ProviderRunResult> {
    return this.inner.execute(worker, {
      ...task,
      modelPolicy: {
        ...task.modelPolicy,
        provider: this.piProvider,
        model: task.modelPolicy.model ?? this.model,
      },
    });
  }

  cancel(worker: WorkerHandle): Promise<void> {
    return this.inner.cancel(worker);
  }
}
