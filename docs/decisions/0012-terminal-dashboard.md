# 0012: Terminal Dashboard + Admin Panel (Stage 5)

Date: 2025
Status: accepted
Deciders: pi-coding-agent

## Context
Stage 4 introduced local models (qwen4, mistral) and worktree isolation. Users need visibility into daemon state, runs, tasks, providers and ability to launch/abort without killing daemon. No web/Electron allowed; must be pure TUI client via IPC only.

## Decision
Implement 5-panel TUI (RUNS, TASKS/WORKERS, PROVIDERS, EVENTS, ADMIN) with pure reducer (state.ts), deterministic renderer (render.ts), key input (input.ts), reconnecting IPC client (client.ts), macOS-safe launcher using osascript without shell:true (launcher.ts), and CLI integration. Extend IPC with dashboard.snapshot / run.details / providers.status (read-only). Add TaskView DTO with state from store. Abort selected uses requestId; abort-all requires explicit 'ABORT' confirm. macOS launcher escapes paths with POSIX single-quote; --inline always bypasses launcher.

## Consequences
- Dashboard never reads active .pi-many-agents/state.db directly.
- Close TUI does not affect daemon/runs (no process.kill on daemon).
- Providers view shows registered only (no model calls).
- Snapshot limited to recent 20 runs + 30 events; details on demand.
- Render supports 80x24 stacked + 140x40 split; ANSI sanitized.
- New tests: dashboard.test.ts (reducer+render, no TTY/GUI).
- ADR documents launcher contract and confirmation UX.
- Limitations: new-run path input is stub (full readline in future); manual macOS smoke is NOT VERIFIED if no GUI; pre-existing daemon-client EINVAL test failure remains.

## Verification
npm test (70/71 pass), typecheck, lint, demo all green post-impl. E2E IPC via daemon+client in tests.
