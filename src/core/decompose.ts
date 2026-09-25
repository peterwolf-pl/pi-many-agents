import { createTask } from "./task.ts";
import type { AgentTask, ReasoningLevel, TaskType } from "../types.ts";

export interface DecomposeOptions {
  type?: TaskType;
  reasoning?: ReasoningLevel;
  priority?: number;
  addIntegrateTask?: boolean;
}

const HEADING = /^(#{2,3})\s+(.+)$/;
const BULLET = /^[-*]\s+(.+)$/;

export function decomposeMarkdown(markdown: string, options: DecomposeOptions = {}): AgentTask[] {
  const chunks: Array<{ title: string; body: string }> = [];
  let current: { title: string; body: string[] } | undefined;
  for (const line of markdown.split("\n")) {
    const heading = line.match(HEADING);
    if (heading) {
      if (current) chunks.push({ title: current.title, body: current.body.join("\n").trim() });
      current = { title: heading[2].trim(), body: [] };
      continue;
    }
    if (!current) {
      const bullet = line.match(BULLET);
      if (bullet) chunks.push({ title: bullet[1].trim(), body: bullet[1].trim() });
      continue;
    }
    current.body.push(line);
  }
  if (current) chunks.push({ title: current.title, body: current.body.join("\n").trim() });
  const tasks = chunks.map((chunk, index) =>
    createTask({
      id: `task-${index + 1}`,
      title: chunk.title.slice(0, 80),
      objective: chunk.body || chunk.title,
      type: options.type ?? "review",
      priority: options.priority ?? 0,
      modelPolicy: { reasoning: options.reasoning ?? "low" },
      permissions: { read: true, write: false, shell: false },
    }),
  );
  if (options.addIntegrateTask && tasks.length > 1) {
    tasks.push(
      createTask({
        id: "integrate",
        title: "Integrate findings",
        objective: "Combine the worker reports into one ordered change list. Do not modify Pi core.",
        type: "other",
        priority: 1,
        dependencies: tasks.map((task) => task.id),
        modelPolicy: { reasoning: "medium" },
        permissions: { read: true, write: false, shell: false },
      }),
    );
  }
  return tasks;
}
