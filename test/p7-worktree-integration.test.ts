import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { WorktreeManager } from "../src/worktree/manager.ts";
import { PathLockManager } from "../src/worktree/lock.ts";

test("P7: malicious taskId with path traversal is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-wt-trap-"));
  try {
    const wm = new WorktreeManager(dir);
    await assert.rejects(
      () => wm.createWorktree("../../../evil"),
      /Invalid or dangerous task id/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("P7: normalizeReport rejects paths escaping root", () => {
  const wm = new WorktreeManager("/repo");
  const report = {
    taskId: "t1",
    workerId: "w1",
    status: "completed" as const,
    summary: "done",
    findings: [],
    changes: {
      files: ["/repo/file1.ts", "../../../etc/passwd", "src/good.ts"],
      description: "changes",
    },
    durationMs: 10,
  };

  const normalized = wm.normalizeReport(report);
  assert.ok(normalized.changes);
  assert.ok(!normalized.changes.files.includes("../../../etc/passwd"), "Should filter out path traversal");
  assert.ok(normalized.changes.files.includes("file1.ts"));
  assert.ok(normalized.changes.files.includes("src/good.ts"));
});

test("P7: abort waiting for lock rejects acquire", async () => {
  const locks = new PathLockManager();
  await locks.acquire("holder", ["src/"]);

  const ac = new AbortController();
  const acquirePromise = locks.acquire("waiter", ["src/core/"], ac.signal);

  setTimeout(() => ac.abort(), 20);

  await assert.rejects(
    () => acquirePromise,
    /Lock acquisition aborted/
  );

  locks.release("holder");
  assert.equal(locks.activeCount(), 0);
});

test("P7: non-empty worktree is not forcibly deleted by safe removeWorktree", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-git-repo-"));
  try {
    // initialize a real git repo
    execFileSync("git", ["init", "-b", "main"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "Tester"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(dir, "README.md"), "# Repo\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    const wm = new WorktreeManager(dir);
    const rel = await wm.createWorktree("dirty-task", "run-1");
    const abs = join(dir, rel);

    // Modify a file in the worktree
    writeFileSync(join(abs, "work.txt"), "important work in progress");

    // Attempt removeWorktree without force
    await wm.removeWorktree("dirty-task", false);

    // Verify worktree was preserved!
    const { existsSync } = await import("node:fs");
    assert.ok(existsSync(join(abs, "work.txt")), "Uncommitted changes must be preserved");

    // Clean up
    execFileSync("git", ["worktree", "remove", "--force", abs], { cwd: dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
