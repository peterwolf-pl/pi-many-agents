import type { ReasoningLevel, TaskType } from "../types.ts";
import { JsonlLogger } from "../telemetry/logger.ts";
import { OllamaProvider } from "../providers/ollama.ts";

export interface L0AdvisorOptions {
  logger?: JsonlLogger;
  fetchImpl?: typeof fetch;
}

const TYPES: TaskType[] = ["inspect", "code", "test", "research", "review", "shell", "other"];
const REASONING_LEVELS: ReasoningLevel[] = ["none", "low", "medium", "high"];

export class L0Advisor {
  private readonly provider: OllamaProvider;
  private readonly logger?: JsonlLogger;
  private readonly fetchImpl: typeof fetch;

  constructor(options: L0AdvisorOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.provider = new OllamaProvider({
      name: "l0-gemma4",
      model: "gemma4:latest",
      fetchImpl: this.fetchImpl,
    });
    this.logger = options.logger;
  }

  private async emitSkipped(reason: string): Promise<void> {
    if (this.logger) {
      await this.logger.write({ kind: "l0.skipped", reason, timestamp: Date.now() });
    }
  }

  private deterministicClassify(objective: string): TaskType {
    const lower = objective.toLowerCase();
    if (lower.includes("test") || lower.includes("spec") || lower.includes("verify")) return "test";
    if (lower.includes("review") || lower.includes("inspect") || lower.includes("audit")) return "review";
    if (lower.includes("research") || lower.includes("investigate") || lower.includes("analyze")) return "research";
    if (lower.includes("fix") || lower.includes("implement") || lower.includes("code") || lower.includes("edit")) return "code";
    if (lower.includes("shell") || lower.includes("command") || lower.includes("run ")) return "shell";
    return "other";
  }

  private deterministicCompress(text: string): string {
    if (text.length <= 280) return text;
    const sentences = text.split(/[.!?]\s+/).filter(Boolean);
    let out = "";
    for (const s of sentences) {
      if ((out + s).length > 277) break;
      out += s + ". ";
    }
    return (out || text.slice(0, 277)).trim() + (text.length > 280 ? "..." : "");
  }

  private deterministicRecommend(objective: string, current: ReasoningLevel): ReasoningLevel {
    const lower = objective.toLowerCase();
    const hasComplex = lower.includes("complex") || lower.includes("architecture") || lower.includes("refactor") || lower.includes("multiple");
    const idx = REASONING_LEVELS.indexOf(current);
    if (hasComplex && idx < 3) return REASONING_LEVELS[Math.min(3, idx + 1)];
    if ((lower.includes("simple") || lower.includes("trivial")) && idx > 0) return REASONING_LEVELS[idx - 1];
    return current;
  }

  async classify(objective: string): Promise<TaskType> {
    if (!(await this.provider.available())) {
      await this.emitSkipped("ollama_unavailable");
      return this.deterministicClassify(objective);
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      const response = await this.fetchImpl("http://127.0.0.1:11434/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: "gemma4:latest",
          stream: false,
          messages: [{
            role: "user",
            content: `Classify this task objective into exactly one of: inspect, code, test, research, review, shell, other.\nObjective: ${objective}\nRespond with ONLY the single word type.`,
          }],
        }),
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`http ${response.status}`);
      const body = await response.json() as { message?: { content?: string } };
      const raw = (body.message?.content ?? "").trim().toLowerCase();
      const match = TYPES.find((t) => raw.includes(t));
      if (match) return match;
      await this.emitSkipped("parse_failed");
      return this.deterministicClassify(objective);
    } catch (err) {
      await this.emitSkipped(err instanceof Error && err.name === "AbortError" ? "timeout" : "query_failed");
      return this.deterministicClassify(objective);
    }
  }

  async compressSummary(text: string): Promise<string> {
    if (!(await this.provider.available())) {
      await this.emitSkipped("ollama_unavailable");
      return this.deterministicCompress(text);
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      const response = await this.fetchImpl("http://127.0.0.1:11434/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: "gemma4:latest",
          stream: false,
          messages: [{
            role: "user",
            content: `Compress the following summary to under 280 chars, preserve key facts:\n${text}`,
          }],
        }),
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`http ${response.status}`);
      const body = await response.json() as { message?: { content?: string } };
      const compressed = (body.message?.content ?? "").trim();
      if (compressed && compressed.length <= 320) return compressed;
      await this.emitSkipped("compress_invalid");
      return this.deterministicCompress(text);
    } catch (err) {
      await this.emitSkipped(err instanceof Error && err.name === "AbortError" ? "timeout" : "query_failed");
      return this.deterministicCompress(text);
    }
  }

  async recommendReasoning(objective: string, current: ReasoningLevel): Promise<ReasoningLevel> {
    if (!(await this.provider.available())) {
      await this.emitSkipped("ollama_unavailable");
      return this.deterministicRecommend(objective, current);
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      const response = await this.fetchImpl("http://127.0.0.1:11434/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: "gemma4:latest",
          stream: false,
          messages: [{
            role: "user",
            content: `Given objective, recommend reasoning level none|low|medium|high. Current: ${current}\nObjective: ${objective}\nRespond with ONLY the level word.`,
          }],
        }),
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`http ${response.status}`);
      const body = await response.json() as { message?: { content?: string } };
      const raw = (body.message?.content ?? "").trim().toLowerCase();
      const match = REASONING_LEVELS.find((l) => raw.includes(l));
      if (match) return match;
      await this.emitSkipped("parse_failed");
      return this.deterministicRecommend(objective, current);
    } catch (err) {
      await this.emitSkipped(err instanceof Error && err.name === "AbortError" ? "timeout" : "query_failed");
      return this.deterministicRecommend(objective, current);
    }
  }
}
