import type { AgentTask } from "../types.ts";

export type TaskPhase = "blocked" | "ready" | "running" | "completed" | "failed" | "cancelled";

export class TaskQueue {
  private readonly tasks: AgentTask[];
  private readonly phase = new Map<string, TaskPhase>();

  constructor(tasks: AgentTask[]) {
    this.tasks = [...tasks].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    for (const task of this.tasks) this.phase.set(task.id, "blocked");
    this.refresh();
  }

  refresh(): void {
    for (const task of this.tasks) {
      const current = this.phase.get(task.id);
      if (current !== "blocked" && current !== "ready") continue;
      const deps = task.dependencies.map((id) => this.phase.get(id));
      if (deps.some((phase) => phase === "failed" || phase === "cancelled")) {
        this.phase.set(task.id, "failed");
        continue;
      }
      this.phase.set(task.id, deps.every((phase) => phase === "completed") ? "ready" : "blocked");
    }
  }

  takeReady(limit: number): AgentTask[] {
    this.refresh();
    const ready = this.tasks.filter((task) => this.phase.get(task.id) === "ready").slice(0, limit);
    for (const task of ready) this.phase.set(task.id, "running");
    return ready;
  }

  mark(id: string, phase: Extract<TaskPhase, "completed" | "failed" | "cancelled">): void {
    this.phase.set(id, phase);
    this.refresh();
  }

  queued(): AgentTask[] {
    this.refresh();
    return this.tasks.filter((task) => {
      const phase = this.phase.get(task.id);
      return phase === "ready" || phase === "blocked";
    });
  }

  phaseOf(id: string): TaskPhase | undefined {
    return this.phase.get(id);
  }

  pendingCount(): number {
    return [...this.phase.values()].filter((phase) => phase === "blocked" || phase === "ready" || phase === "running").length;
  }

  entries(): Array<{ id: string; phase: TaskPhase }> {
    return [...this.phase.entries()].map(([id, phase]) => ({ id, phase }));
  }
}
