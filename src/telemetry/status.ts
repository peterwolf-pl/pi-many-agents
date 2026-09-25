import type { AgentTask, WorkerState } from "../types.ts";

export interface StatusRow {
  id: string;
  state: WorkerState | "queued";
  title: string;
}

export function renderStatus(input: { workers: number; running: number; queued: number; rows: StatusRow[] }): string {
  const lines = [
    "pi-many-agents",
    "",
    `Workers: ${input.workers}`,
    `Running: ${input.running}`,
    `Queued: ${input.queued}`,
    "",
  ];
  for (const row of input.rows) {
    lines.push(`${row.id.padEnd(12)} ${row.state.toUpperCase().padEnd(10)} ${row.title}`);
  }
  return lines.join("\n");
}

export function queuedRow(task: AgentTask): StatusRow {
  return { id: task.id, state: "queued", title: task.title };
}
