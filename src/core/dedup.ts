import type { AgentTask } from "../types.ts";
import { assertAcyclic, TaskValidationError } from "./task.ts";

export function taskFingerprint(task: AgentTask): string {
  const files = [...(task.relevantFiles ?? [])].sort().join(",");
  const constraints = [...(task.constraints ?? [])].sort().join(",");
  const perms = [
    task.permissions.read ? "r" : "",
    task.permissions.write ? "w" : "",
    task.permissions.shell ? "s" : "",
    task.permissions.network ? "n" : "",
    task.permissions.git ? "g" : "",
  ].join("");

  return [
    task.type,
    task.objective.trim().toLowerCase(),
    task.workspace ?? "",
    task.context ?? "",
    task.modelPolicy.model ?? "",
    task.modelPolicy.reasoning ?? "",
    perms,
    files,
    constraints,
  ].join("|");
}

function checkCycles(tasks: AgentTask[]): void {
  const ids = new Set(tasks.map((t) => t.id));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new TaskValidationError(`dependency cycle at ${id}`);
    visiting.add(id);
    const task = byId.get(id);
    if (task) {
      for (const dep of task.dependencies) {
        if (ids.has(dep)) {
          visit(dep);
        }
      }
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const task of tasks) visit(task.id);
}

export function dedupeTasks(tasks: AgentTask[]): {
  tasks: AgentTask[];
  dropped: Array<{ id: string; kept: string }>;
  aliases: Map<string, string>;
} {
  checkCycles(tasks);

  const kept = new Map<string, AgentTask>();
  const dropped: Array<{ id: string; kept: string }> = [];
  const aliases = new Map<string, string>();

  // Sort by priority descending, then id for deterministic ordering
  const sorted = [...tasks].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  for (const task of sorted) {
    const key = taskFingerprint(task);
    const existing = kept.get(key);
    if (!existing) {
      kept.set(key, { ...task, dependencies: [...task.dependencies] });
      continue;
    }
    // Merge dependencies
    existing.dependencies = [...new Set([...existing.dependencies, ...task.dependencies])];
    dropped.push({ id: task.id, kept: existing.id });
    aliases.set(task.id, existing.id);
  }

  // Rewrite dependencies in kept tasks using aliases
  const resultTasks: AgentTask[] = [];
  for (const task of kept.values()) {
    const rewrittenDeps = new Set<string>();
    for (const dep of task.dependencies) {
      let target = dep;
      while (aliases.has(target)) {
        target = aliases.get(target)!;
      }
      if (target !== task.id) {
        rewrittenDeps.add(target);
      }
    }
    resultTasks.push({
      ...task,
      dependencies: [...rewrittenDeps],
    });
  }

  checkCycles(resultTasks);

  return { tasks: resultTasks, dropped, aliases };
}
