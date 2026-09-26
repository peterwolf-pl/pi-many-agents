import { readFile } from "node:fs/promises";
import type { ReasoningLevel, TaskType } from "../types.ts";

export interface RoutingRule {
  types: TaskType[];
  reasoning: ReasoningLevel;
}

export interface OllamaConfig {
  baseUrl: string;
  model?: string;
}

export interface DockerMistralConfig {
  baseUrl: string;
  model: string;
}

export interface ManyAgentsConfig {
  maxConcurrentWorkers: number;
  defaultProvider: string;
  defaultModel: string;
  defaultTimeoutMs: number;
  telemetryPath: string;
  piBinary: string;
  maxRetries: number;
  unhealthyAfterFailures: number;
  routing: RoutingRule[];
  ollama: OllamaConfig;
  mistral: DockerMistralConfig;
}

export const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
  baseUrl: "http://127.0.0.1:11434",
};

export const DEFAULT_MISTRAL_CONFIG: DockerMistralConfig = {
  baseUrl: "http://127.0.0.1:12434/engines/v1",
  model: "ai/mistral",
};

export const DEFAULT_CONFIG: ManyAgentsConfig = {
  maxConcurrentWorkers: 2,
  defaultProvider: "pi",
  defaultModel: "claude-sonnet-4-6",
  defaultTimeoutMs: 120_000,
  telemetryPath: ".pi-many-agents/telemetry.jsonl",
  piBinary: "pi",
  maxRetries: 1,
  unhealthyAfterFailures: 3,
  routing: [
    { types: ["shell", "inspect"], reasoning: "none" },
    { types: ["test", "review", "research"], reasoning: "low" },
    { types: ["code"], reasoning: "medium" },
    { types: ["other"], reasoning: "medium" },
  ],
  ollama: DEFAULT_OLLAMA_CONFIG,
  mistral: DEFAULT_MISTRAL_CONFIG,
};

export async function loadConfig(path = ".pi-many-agents.json"): Promise<ManyAgentsConfig> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<ManyAgentsConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      routing: raw.routing ?? DEFAULT_CONFIG.routing,
      ollama: {
        ...DEFAULT_OLLAMA_CONFIG,
        ...raw.ollama,
      },
      mistral: {
        ...DEFAULT_MISTRAL_CONFIG,
        ...raw.mistral,
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ...DEFAULT_CONFIG,
        routing: [...DEFAULT_CONFIG.routing],
        ollama: { ...DEFAULT_OLLAMA_CONFIG },
        mistral: { ...DEFAULT_MISTRAL_CONFIG },
      };
    }
    throw error;
  }
}
