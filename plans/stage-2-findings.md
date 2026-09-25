# Stage 2 findings

Applied in this repository. Pi core was not modified.

1. ProcessManager treated `child.killed` as proof the process was gone, so the SIGKILL escalation never ran after SIGTERM. Kill now signals the process group and escalates only while the child is still alive. `cleanup()` waits for exit.
2. `modelPolicy.provider` was used as the orchestrator provider name. It is now only the Pi CLI model provider (`ExecutionPlan.modelProvider`). The runtime provider stays `fake` or `pi`.
3. `PiProvider.available()` trusted a bare `pi` name. It now runs `pi --version`.
4. An unavailable provider emitted `worker.failed` without `report.created`.
5. `/many` left the status widget set when the run threw, and it omitted findings. The parent conversation is still not copied into task packets.
6. Retries and health from the earlier Stage 2 pass stay. Timeouts are not retried.

Not done: worktrees, extra providers, LLM decomposition, dashboard.
