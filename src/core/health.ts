export interface WorkerHealthSnapshot {
  provider: string;
  started: number;
  completed: number;
  failed: number;
  cancelled: number;
  healthy: boolean;
}

export class WorkerHealth {
  private readonly stats = new Map<string, WorkerHealthSnapshot>();

  private readonly failureThreshold: number;

  constructor(failureThreshold = 3) {
    this.failureThreshold = failureThreshold;
  }

  record(provider: string, status: "completed" | "failed" | "cancelled" | "started"): void {
    const current = this.stats.get(provider) ?? {
      provider,
      started: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      healthy: true,
    };
    if (status === "started") current.started += 1;
    if (status === "completed") current.completed += 1;
    if (status === "failed") current.failed += 1;
    if (status === "cancelled") current.cancelled += 1;
    current.healthy = current.failed < this.failureThreshold;
    this.stats.set(provider, current);
  }

  healthy(provider: string): boolean {
    return this.stats.get(provider)?.healthy ?? true;
  }

  snapshot(): WorkerHealthSnapshot[] {
    return [...this.stats.values()];
  }
}
