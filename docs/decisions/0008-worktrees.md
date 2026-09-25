# ADR 0008: Git worktrees and single-writer rule for code tasks

Status: accepted

Coding workers must not share a dirty tree or compete for edits on the same files.

1. Layout: only tasks with `type: "code"` and `permissions.write: true` receive a dedicated git worktree under `worktrees/<taskId>` with branch `task-<taskId>`.
2. Non-code tasks (`inspect`, `review`, `test`, `research`) execute in the main repository with `permissions.write: false`.
3. Single-writer rule: code tasks declare path prefixes (e.g. `src/core/`, `docs/`). The scheduler enforces mutual exclusion via `PathLockManager`. Conflicting tasks wait in the queue until the active writer completes.
4. Relative reporting: `AgentReport.changes.files` reports paths relative to the worktree root, never absolute machine paths.
5. No auto-merge: the orchestrator never runs `git merge` or `git cherry-pick`. Changes remain on the task branch for human review or dedicated verification tasks.
