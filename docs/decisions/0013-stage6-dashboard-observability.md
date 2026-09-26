# ADR 0013: Stage 6 Dashboard Observability, Control Room, and Token Accounting

Status: accepted

## Context
Stage 5 introduced the initial Terminal Dashboard and admin controls. Stage 6 elevates the dashboard into a full observability control room:
1. Tracking token consumption (inputTokens, outputTokens, cachedTokens, totalTokens = input + output).
2. Estimated cost accounting without guessing or hardcoded pricing models (only reporting cost when models or adapters provide it).
3. Runtime model, reasoning, and provider visibility in tasks and panels.
4. Alternate screen buffer (`\x1b[?1049h` / `\x1b[?1049l`) and cursor lifecycle.
5. Live activity event stream with scrollable viewport.
6. Scope toggle between selected-run usage and global session usage.

## Decisions

### 1. Pure IPC Observability Architecture
- The dashboard remains a thin client connecting exclusively over Unix domain socket IPC (`.pi-many-agents/daemon.sock`).
- It never opens or reads the SQLite database directly while the daemon is running.
- The daemon calculates usage summaries deterministically from existing `AgentReport.usage` fields stored in reports and live events.

### 2. Token & Cost Accounting Semantics
- `totalTokens` is defined strictly as `inputTokens + outputTokens`.
- `cachedTokens` is an auxiliary metric reported separately and never added a second time to `totalTokens`.
- `estimatedCost` is tracked only when providers report it, accompanied by coverage (`costKnown` and `reportsWithUsage / reportsTotal`).
- Tasks without usage data display `--` rather than false zeros.

### 3. Terminal Safety & Alternate Screen
- On startup, the dashboard enters the alternate screen buffer (`\x1b[?1049h`) and hides the cursor (`\x1b[?25l`).
- On any exit, signal (`SIGINT`, `SIGTERM`), or error, the cursor and normal screen buffer are restored (`\x1b[?25h\x1b[?1049l`).
- All untrusted titles, event messages, and errors are sanitized against ANSI escape codes and control characters before formatting, preventing terminal escape injection.
- Padding and truncation measure visible character width (`stripAnsi(str).length`), preserving box alignments.

### 4. Control Room Layout & Keymap
- Responsive: compact vertical layout for 80x24, 2-column control room for 140x40+, graceful degradation for tiny terminals (< 50 cols).
- Keymap additions:
  - `u`: toggle usage scope between selected run and global session totals.
  - `[` / `]`: scroll live activity feed up and down.
  - Existing admin actions (`n`, `a`, `x`, `r`, `q`) preserved.
