import path from "node:path";

export class PathLockManager {
  private readonly owners = new Map<string, string>(); // normPrefix -> taskId
  private readonly waiters: Array<{
    taskId: string;
    prefixes: string[];
    signal?: AbortSignal;
    resolve: () => void;
    reject: (e: Error) => void;
  }> = [];

  private normalize(p: string): string {
    const raw = (p || "").trim();
    if (!raw || raw === "/" || raw === ".") return "/";
    // Normalize path removing redundant slashes and resolving . and ..
    const clean = path.posix.normalize(raw.replace(/\\/g, "/"));
    let res = clean.startsWith("/") ? clean : "/" + clean;
    if (!res.endsWith("/")) res += "/";
    return res;
  }

  private overlaps(a: string, b: string): boolean {
    return a.startsWith(b) || b.startsWith(a);
  }

  async acquire(taskId: string, prefixes: string[] = [], signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new Error("Lock acquisition aborted");
    }

    const norms = prefixes.length ? prefixes.map((p) => this.normalize(p)) : ["/"];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal?.aborted) {
        throw new Error("Lock acquisition aborted");
      }

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
        const waiter = {
          taskId,
          prefixes: norms,
          signal,
          resolve: () => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          },
          reject: (err: Error) => {
            signal?.removeEventListener("abort", onAbort);
            reject(err);
          },
        };

        const onAbort = () => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) this.waiters.splice(idx, 1);
          signal?.removeEventListener("abort", onAbort);
          reject(new Error("Lock acquisition aborted"));
        };

        if (signal) {
          signal.addEventListener("abort", onAbort, { once: true });
        }

        this.waiters.push(waiter);
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

    // Wake compatible waiters
    const remaining: typeof this.waiters = [];
    for (const w of this.waiters) {
      if (w.signal?.aborted) continue;
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
