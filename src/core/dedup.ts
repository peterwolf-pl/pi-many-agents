import type { AgentTask } from "../types.ts";

export function taskFingerprint(task: AgentTask): string {
  const files = [...(task.relevantFiles ?? [])].sort().join(",");
  return [task.type, task.objective.trim().toLowerCase(), files].join("|");
}

export function dedupeTasks(tasks: AgentTask[]): { tasks: AgentTask[]; dropped: Array<{ id: string; kept: string }> } {
  const kept = new Map<string, AgentTask>();
  const dropped: Array<{ id: string; kept: string }> = [];
  for (const task of [...tasks].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    const key = taskFingerprint(task);
    const existing = kept.get(key);
    if (!existing) {
      kept.set(key, { ...task, dependencies: [...task.dependencies] });
      continue;
    }
    existing.dependencies = [...new Set([...existing.dependencies, ...task.dependencies])];
    dropped.push({ id: task.id, kept: existing.id });
  }
  return { tasks: [...kept.values()], dropped };
}
