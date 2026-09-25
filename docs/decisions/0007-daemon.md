# ADR 0007: CLI daemon, Unix socket attach, and store

Status: accepted

The run loop leaves the Pi interactive session. In Stage 3, `pi-many-agents` supports two execution modes:

1. One-shot runner: `pi-many-agents run --plan <file>` executes directly in the CLI process and writes results to stdout and telemetry.
2. CLI daemon: `pi-many-agents daemon` runs a long-lived local process owning the run loop, `TaskQueue`, `WorkerManager`, `EventBus`, and a SQLite store (`.pi-many-agents/state.db` in WAL mode).

The `/many` extension connects as a thin client over a local Unix domain socket (`.pi-many-agents/daemon.sock`). It sends run requests, receives streaming progress events, and formats compact reports.

On Pi `session_shutdown`, the extension sends an abort envelope. The daemon propagates the signal, cancelling in-flight workers via `WorkerManager.cancelAll()` and escalating process group signals from SIGTERM to SIGKILL. No orphan processes remain.
