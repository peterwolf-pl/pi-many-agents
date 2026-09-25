import type { ManyAgentsConfig } from "../config/config.ts";
import type { AgentTask, ExecutionPlan, ReasoningLevel } from "../types.ts";

const ORDER: ReasoningLevel[] = ["none", "low", "medium", "high"];

export function routeTask(task: AgentTask, config: ManyAgentsConfig): ExecutionPlan {
  const matched = config.routing.find((rule) => rule.types.includes(task.type));
  const requested = task.modelPolicy.reasoning;
  const baseline = matched?.reasoning ?? "low";
  const reasoning = ORDER.indexOf(requested) >= ORDER.indexOf(baseline) ? requested : baseline;
  return {
    provider: config.defaultProvider,
    modelProvider: task.modelPolicy.provider,
    model: task.modelPolicy.model ?? config.defaultModel,
    reasoning,
    timeoutMs: task.modelPolicy.timeoutMs ?? config.defaultTimeoutMs,
    tokenBudget: task.modelPolicy.maxTokens,
  };
}
