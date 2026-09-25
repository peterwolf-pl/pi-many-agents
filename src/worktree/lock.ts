import { setTimeout as sleep } from "node:timers/promises";

export class PathLockManager {
  private readonly owners = new Map<string, string>(); // normPrefix -> taskId
  private readonly waiters: Array<{
    taskId: string;
    prefixes: string[];
    resolve: () => void;
    reject: (e: Error) => void;
  }> = [];

  private normalize(p: string): string {
    let s = (p || "").trim();
    if (!s) s = "/";
    if (!s.endsWith("/")) s += "/";
    if (!s.startsWith("/")) s = "/" + s;
    return s;
  }

  private overlaps(a: string, b: string): boolean {
    return a.startsWith(b) || b.startsWith(a);
  }

  async acquire(taskId: string, prefixes: string[] = []): Promise<void> {
    const norms = prefixes.length ? prefixes.map((p) => this.normalize(p)) : ["/"];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let conflictOwner: string | undefined;
      for (const [locked, owner] of this.owners.entries()) {
        if (owner === taskId) continue;
        if (norms.some((n) => this.overlaps(n, locked))) {
          conflictOwner = owner;
          break;
        }
      }
      if (!conflictOwner) {
        for (const n of norms) {
          this.owners.set(n, taskId);
        }
        return;
      }
      await new Promise<void>((resolve, reject) => {
        this.waiters.push({ taskId, prefixes: norms, resolve, reject });
      });
    }
  }

  release(taskId: string): void {
    const released: string[] = [];
    for (const [p, owner] of this.owners.entries()) {
      if (owner === taskId) {
        this.owners.delete(p);
        released.push(p);
      }
    }
    if (released.length === 0) return;

    // wake compatible waiters (FIFO-ish)
    const remaining: typeof this.waiters = [];
    for (const w of this.waiters) {
      let stillConflict = false;
      for (const [locked, owner] of this.owners.entries()) {
        if (owner !== w.taskId && w.prefixes.some((p) => this.overlaps(p, locked))) {
          stillConflict = true;
          break;
        }
      }
      if (stillConflict) {
        remaining.push(w);
      } else {
        for (const n of w.prefixes) this.owners.set(n, w.taskId);
        w.resolve();
      }
    }
    this.waiters.length = 0;
    this.waiters.push(...remaining);
  }

  getOwner(prefix: string): string | undefined {
    const n = this.normalize(prefix);
    for (const [locked, owner] of this.owners.entries()) {
      if (this.overlaps(n, locked)) return owner;
    }
    return undefined;
  }

  isLocked(prefix: string): boolean {
    return !!this.getOwner(prefix);
  }

  activeCount(): number {
    return new Set(this.owners.values()).size;
  }
}
