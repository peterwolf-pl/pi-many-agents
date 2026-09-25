import assert from "node:assert/strict";
import { rmSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { PathLockManager } from "../src/worktree/lock.ts";
import { WorktreeManager } from "../src/worktree/manager.ts";
import type { AgentTask } from "../src/types.ts";

function makeTask(id: string, type: "code" | "inspect" = "code", write = true): AgentTask {
  return {
    id,
    title: `task-${id}`,
    objective: "test",
    type,
    priority: 1,
    dependencies: [],
    modelPolicy: { reasoning: "none", maxTokens: 10, timeoutMs: 1000 },
    permissions: { read: true, write, shell: false },
  };
}

test("PathLockManager: disjoint prefixes allow concurrent", async () => {
  const lock = new PathLockManager();
  await lock.acquire("t1", ["src/core/"]);
  await lock.acquire("t2", ["docs/"]);
  assert.equal(lock.getOwner("src/core/foo.ts"), "t1");
  assert.equal(lock.getOwner("docs/api.md"), "t2");
  assert.equal(lock.activeCount(), 2);
  lock.release("t1");
  lock.release("t2");
  assert.equal(lock.activeCount(), 0);
});

test("PathLockManager: overlapping prefixes block and wait", async () => {
  const lock = new PathLockManager();
  await lock.acquire("writer1", ["src/"]);
  let t2Acquired = false;
  const p = lock.acquire("writer2", ["src/core/"]).then(() => {
    t2Acquired = true;
  });
  // give microtask chance
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(t2Acquired, false);
  assert.equal(lock.getOwner("src/core/"), "writer1");
  lock.release("writer1");
  await p;
  assert.equal(t2Acquired, true);
  assert.equal(lock.getOwner("src/core/"), "writer2");
  lock.release("writer2");
});

test("PathLockManager: same task can re-acquire same prefix", async () => {
  const lock = new PathLockManager();
  await lock.acquire("t1", ["src/"]);
  await lock.acquire("t1", ["src/"]); // should not deadlock
  assert.equal(lock.getOwner("src/"), "t1");
  lock.release("t1");
  assert.equal(lock.isLocked("src/"), false);
});

test("PathLockManager: root / locks everything", async () => {
  const lock = new PathLockManager();
  await lock.acquire("admin", ["/"]);
  assert.ok(lock.isLocked("docs/"));
  lock.release("admin");
});

test("WorktreeManager: only code+write tasks get worktrees", () => {
  const wm = new WorktreeManager();
  assert.equal(wm.isCodeWriteTask(makeTask("c1", "code", true)), true);
  assert.equal(wm.isCodeWriteTask(makeTask("i1", "inspect", false)), false);
  assert.equal(wm.isCodeWriteTask(makeTask("c2", "code", false)), false);
});

test("WorktreeManager: createWorktree produces relative path and git refs", async () => {
  const wm = new WorktreeManager();
  const taskId = "test-wt-1";
  const rel = await wm.createWorktree(taskId);
  assert.equal(rel, `worktrees/${taskId}`);
  assert.equal(wm.getWorktreePath(taskId), rel);
  const abs = wm.getAbsolutePath(taskId)!;
  assert.ok(abs.endsWith(rel));
  // git worktree list should show it
  // cleanup
  await wm.removeWorktree(taskId);
  assert.equal(wm.getWorktreePath(taskId), undefined);
  // ensure no leftover dir
  if (existsSync(abs)) rmSync(abs, { recursive: true, force: true });
});

test("WorktreeManager: normalizeReport makes paths relative to worktree root", async () => {
  const wm = new WorktreeManager("/repo");
  const taskId = "t1";
  await wm.createWorktree(taskId);
  const report = {
    taskId,
    workerId: "w1",
    status: "completed" as const,
    summary: "ok",
    findings: [],
    changes: { files: ["/repo/worktrees/t1/src/foo.ts", "bar/baz.ts", "/abs/other"], description: "edits" },
    durationMs: 10,
  };
  const norm = wm.normalizeReport(report, taskId);
  assert.deepEqual(norm.changes?.files, ["src/foo.ts", "bar/baz.ts"]);
  await wm.removeWorktree(taskId);
});

test("WorktreeManager + Lock integration: code tasks would use distinct worktrees", async () => {
  const lock = new PathLockManager();
  const wm = new WorktreeManager();
  const t1 = makeTask("code-a");
  const t2 = makeTask("code-b");
  await lock.acquire(t1.id, ["src/"]);
  const p1 = wm.createWorktree(t1.id);
  // t2 conflicts on src/ so would wait in real scheduler
  await lock.acquire(t2.id, ["docs/"]); // disjoint ok
  const p2 = wm.createWorktree(t2.id);
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.notEqual(r1, r2);
  assert.ok(r1.startsWith("worktrees/"));
  assert.ok(r2.startsWith("worktrees/"));
  lock.release(t1.id);
  lock.release(t2.id);
  await wm.removeWorktree(t1.id);
  await wm.removeWorktree(t2.id);
});

test("cleanup does not throw on missing", async () => {
  const wm = new WorktreeManager();
  await wm.removeWorktree("nonexistent-xyz");
  assert.doesNotThrow(() => wm.cleanupAll());
});
