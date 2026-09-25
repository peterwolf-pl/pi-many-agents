import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import type { AgentTask, AgentReport } from "../types.ts";

export class WorktreeManager {
  private readonly map = new Map<string, string>(); // taskId -> rel worktree path
  private readonly repoRoot: string;

  constructor(repoRoot: string = process.cwd()) {
    this.repoRoot = repoRoot;
  }

  isCodeWriteTask(task: AgentTask): boolean {
    return task.type === "code" && !!task.permissions?.write;
  }

  async createWorktree(taskId: string): Promise<string> {
    if (this.map.has(taskId)) {
      return this.map.get(taskId)!;
    }
    const branch = `task-${taskId}`;
    const rel = `worktrees/${taskId}`;
    const abs = path.resolve(this.repoRoot, rel);
    if (existsSync(this.repoRoot)) {
      mkdirSync(path.dirname(abs), { recursive: true });
      try {
        execFileSync(
          "git",
          ["worktree", "add", "-b", branch, abs],
          { cwd: this.repoRoot, stdio: ["ignore", "pipe", "pipe"] }
        );
      } catch (err: any) {
        if (err?.status === 128 && /already exists/.test(String(err.stderr || err))) {
          // reuse existing
        } else {
          throw err;
        }
      }
    }
    this.map.set(taskId, rel);
    return rel;
  }

  getWorktreePath(taskId: string): string | undefined {
    return this.map.get(taskId);
  }

  getAbsolutePath(taskId: string): string | undefined {
    const rel = this.map.get(taskId);
    return rel ? path.resolve(this.repoRoot, rel) : undefined;
  }

  async removeWorktree(taskId: string): Promise<void> {
    const rel = this.map.get(taskId);
    if (!rel) return;
    const abs = path.resolve(this.repoRoot, rel);
    const branch = `task-${taskId}`;
    try {
      execFileSync("git", ["worktree", "remove", "--force", abs], {
        cwd: this.repoRoot,
        stdio: "ignore",
      });
    } catch {
      // ignore
    }
    try {
      execFileSync("git", ["branch", "-D", branch], {
        cwd: this.repoRoot,
        stdio: "ignore",
      });
    } catch {
      // ignore
    }
    try {
      rmSync(abs, { recursive: true, force: true });
    } catch {
      // ignore
    }
    this.map.delete(taskId);
  }

  /**
   * Ensure AgentReport.changes.files are relative to the worktree root (not absolute FS paths).
   */
  normalizeReport(report: AgentReport, taskId?: string): AgentReport {
    if (!report.changes?.files?.length) return report;
    const wt = taskId ? this.getWorktreePath(taskId) : undefined;
    const rootForRel = wt ? path.resolve(this.repoRoot, wt) : this.repoRoot;
    const files = report.changes.files.map((f) => {
      if (path.isAbsolute(f)) {
        return path.relative(rootForRel, f) || f;
      }
      // already relative? keep, but ensure no leading ./
      return f.replace(/^\.\//, "");
    });
    return {
      ...report,
      changes: { ...report.changes, files },
    };
  }

  cleanupAll(): void {
    for (const taskId of [...this.map.keys()]) {
      // fire and forget, sync ok for cleanup
      this.removeWorktree(taskId).catch(() => {});
    }
  }
}
