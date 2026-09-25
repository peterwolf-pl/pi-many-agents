import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import type { AgentTask, AgentReport } from "../types.ts";

export interface WorktreeInfo {
  taskId: string;
  runId: string;
  branch: string;
  baseCommit: string;
  relPath: string;
  absPath: string;
}

export class WorktreeManager {
  private readonly map = new Map<string, WorktreeInfo>(); // taskId -> WorktreeInfo
  private readonly repoRoot: string;

  constructor(repoRoot: string = process.cwd()) {
    this.repoRoot = path.resolve(repoRoot);
  }

  isWriteTask(task: AgentTask): boolean {
    return Boolean(task.permissions?.write);
  }

  // Deprecated backward-compatible helper
  isCodeWriteTask(task: AgentTask): boolean {
    return this.isWriteTask(task);
  }

  private sanitizeTaskId(taskId: string): string {
    const trimmed = taskId.trim();
    if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
      throw new Error(`Invalid or dangerous task id: '${taskId}'`);
    }
    const clean = trimmed.replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!clean) {
      throw new Error(`Invalid or dangerous task id: '${taskId}'`);
    }
    return clean;
  }

  async createWorktree(taskId: string, runId?: string): Promise<string> {
    if (this.map.has(taskId)) {
      return this.map.get(taskId)!.relPath;
    }

    const safeTaskId = this.sanitizeTaskId(taskId);
    const safeRunId = runId ? runId.replace(/[^a-zA-Z0-9_-]/g, "_") : "";
    const branch = safeRunId ? `many/${safeRunId}/${safeTaskId}` : `task-${safeTaskId}`;
    const rel = safeRunId ? path.join("worktrees", safeRunId, safeTaskId) : path.join("worktrees", safeTaskId);
    const abs = path.resolve(this.repoRoot, rel);

    // Verify no traversal outside repoRoot
    const relFromRoot = path.relative(this.repoRoot, abs);
    if (relFromRoot.startsWith("..") || path.isAbsolute(relFromRoot)) {
      throw new Error(`Worktree path traversal attempt rejected: ${taskId}`);
    }

    let baseCommit = "HEAD";
    try {
      baseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: this.repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch {
      // Not a git repo or no commits yet
    }

    if (existsSync(this.repoRoot)) {
      mkdirSync(path.dirname(abs), { recursive: true });
      try {
        execFileSync(
          "git",
          ["worktree", "add", "-b", branch, abs, "HEAD"],
          { cwd: this.repoRoot, stdio: ["ignore", "pipe", "pipe"] }
        );
      } catch (err: unknown) {
        const errorText = String((err as { stderr?: string })?.stderr || err);
        if (errorText.includes("already exists") || errorText.includes("already checked out")) {
          // Check if directory exists and is a worktree
          if (!existsSync(abs)) {
            // Branch exists from prior run, checkout without -b
            execFileSync(
              "git",
              ["worktree", "add", abs, branch],
              { cwd: this.repoRoot, stdio: ["ignore", "pipe", "pipe"] }
            );
          }
        } else {
          throw err;
        }
      }
    }

    const info: WorktreeInfo = {
      taskId,
      runId,
      branch,
      baseCommit,
      relPath: rel,
      absPath: abs,
    };
    this.map.set(taskId, info);
    return rel;
  }

  getWorktreeInfo(taskId: string): WorktreeInfo | undefined {
    return this.map.get(taskId);
  }

  getWorktreePath(taskId: string): string | undefined {
    return this.map.get(taskId)?.relPath;
  }

  getAbsolutePath(taskId: string): string | undefined {
    return this.map.get(taskId)?.absPath;
  }

  async removeWorktree(taskId: string, force = false): Promise<void> {
    const info = this.map.get(taskId);
    if (!info) return;

    if (!force && existsSync(info.absPath)) {
      // Check if worktree has uncommitted modifications
      try {
        const status = execFileSync("git", ["status", "--porcelain"], {
          cwd: info.absPath,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim();
        if (status.length > 0) {
          // Worktree has user/worker changes! Do not delete!
          return;
        }
      } catch {
        // ignore
      }
    }

    try {
      execFileSync("git", ["worktree", "remove", info.absPath], {
        cwd: this.repoRoot,
        stdio: "ignore",
      });
    } catch {
      // ignore
    }

    this.map.delete(taskId);
  }

  /**
   * Ensure AgentReport.changes.files are strictly relative to the worktree root
   * and do not escape root.
   */
  normalizeReport(report: AgentReport, taskId?: string): AgentReport {
    if (!report.changes?.files?.length) return report;
    const wt = taskId ? this.getWorktreePath(taskId) : undefined;
    const rootForRel = wt ? path.resolve(this.repoRoot, wt) : this.repoRoot;

    const files: string[] = [];
    for (const f of report.changes.files) {
      const resolved = path.isAbsolute(f) ? path.resolve(f) : path.resolve(rootForRel, f);
      const relative = path.relative(rootForRel, resolved);
      // Reject any path that attempts to escape worktree root
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        continue;
      }
      files.push(relative.replace(/^\.\//, ""));
    }

    const info = taskId ? this.getWorktreeInfo(taskId) : undefined;
    const artifacts = [...(report.artifacts ?? [])];
    if (info) {
      artifacts.push(`branch:${info.branch}`, `worktree:${info.relPath}`, `baseCommit:${info.baseCommit}`);
    }

    return {
      ...report,
      changes: { ...report.changes, files },
      artifacts: artifacts.length > 0 ? artifacts : undefined,
    };
  }

  cleanupAll(): void {
    for (const taskId of [...this.map.keys()]) {
      this.removeWorktree(taskId, false).catch(() => {});
    }
  }
}
