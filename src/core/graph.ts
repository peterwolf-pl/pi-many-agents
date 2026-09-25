import type { AgentTask } from "../types.ts";

export interface DependencyGraph {
  nodes: Array<{ id: string; title: string; priority: number; dependencies: string[] }>;
  edges: Array<{ from: string; to: string }>;
  roots: string[];
  leaves: string[];
}

export function dependencyGraph(tasks: AgentTask[]): DependencyGraph {
  const incoming = new Map(tasks.map((task) => [task.id, task.dependencies.length]));
  const outgoing = new Map(tasks.map((task) => [task.id, 0]));
  const edges = tasks.flatMap((task) =>
    task.dependencies.map((from) => {
      outgoing.set(from, (outgoing.get(from) ?? 0) + 1);
      return { from, to: task.id };
    }),
  );
  return {
    nodes: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      dependencies: [...task.dependencies],
    })),
    edges,
    roots: tasks.filter((task) => (incoming.get(task.id) ?? 0) === 0).map((task) => task.id),
    leaves: tasks.filter((task) => (outgoing.get(task.id) ?? 0) === 0).map((task) => task.id),
  };
}
