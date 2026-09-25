import { readFile } from "node:fs/promises";
import type { ReasoningLevel, TaskType } from "../types.ts";

export interface RoutingRule {
  types: TaskType[];
  reasoning: ReasoningLevel;
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
}

export const DEFAULT_CONFIG: ManyAgentsConfig = {
  maxConcurrentWorkers: 2,
  defaultProvider: "fake",
  defaultModel: "fake-deterministic",
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
};

export async function loadConfig(path = ".pi-many-agents.json"): Promise<ManyAgentsConfig> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<ManyAgentsConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      routing: raw.routing ?? DEFAULT_CONFIG.routing,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_CONFIG, routing: [...DEFAULT_CONFIG.routing] };
    throw error;
  }
}
