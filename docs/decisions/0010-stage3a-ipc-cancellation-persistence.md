# ADR 0010: Stage 3A IPC Protocol, Isolated Cancellation, Persistence, and Worktree Execution

Status: accepted

## Context
An audit of Stage 3 identified multiple critical reliability issues:
1. Extension IPC was incompatible with worker protocol parsing, dropping messages and hanging.
2. Cancelling one worker killed processes for all workers sharing the provider.
3. Unstructured or malformed outputs could be falsely marked "completed" even if the process failed or timed out.
4. SQLite store had single-task keys without `runId`, causing overwrites across runs.
5. WorktreeManager and PathLockManager were unhooked from the actual runner loop.

## Decisions

### 1. Versioned IPC Protocol & Line Framing
- IPC messages between the extension/client and daemon use a dedicated versioned protocol (`src/protocol/ipc.ts`), separate from the worker telemetry protocol.
- Both sides use `JsonLineDecoder` to assemble fragmented TCP/Unix socket chunks and multi-byte UTF-8 streams safely with buffer length limits.
- Daemon ensures single-instance ownership of the socket path with connection probing, safely clearing only stale sockets.

### 2. Isolated Worker Cancellation & Resilience
- Every worker maintains an individual `AbortController` and process handle.
- Cancelling task A sends an abort signal only to task A's process or HTTP request without terminating parallel task B.
- ProcessManager never calls `process.kill(0, ...)`; it targets only its own child process group.
- Pre-aborted runs terminate before launching any child process.
- Daemon shutdown awaits active runs to settle before closing the store and socket.

### 3. Report Extraction & Process Priority
- The report extractor parses balanced JSON objects and fenced code blocks, correctly handling nested objects and strings containing braces.
- Non-zero exit codes, timeouts, and cancellations strictly override any LLM claim of `"completed"`, preventing false successes.
- Diagnostics and changes are retained, with warnings appended.

### 4. Run Identity & SQLite Schema Migrations
- Schema updated with composite primary keys `(run_id, task_id)` for tasks and reports.
- All tasks and events are stored with `run_id`.
- On daemon restart, interrupted runs in state `'running'` are automatically updated to `'aborted'` and their pending tasks to `'cancelled'`.

### 5. Worktree & Path Lock Isolation
- Write-permission tasks acquire path locks via `PathLockManager` (with lock acquisition cancellation support) and run in dedicated Git worktrees created by `WorktreeManager`.
- Tasks with uncommitted worktree changes are never forcibly deleted on cleanup.
- Reports normalize paths strictly relative to the worktree root, rejecting directory traversal attempts.
