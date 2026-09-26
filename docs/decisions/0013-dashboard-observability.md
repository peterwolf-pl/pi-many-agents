# 0013: Dashboard Observability and Token Accounting

Date: 2026-09-26
Status: proposed
Deciders: pi-many-agents

## Context

Stage 5 added a terminal dashboard with runs, tasks, providers, events and admin actions. The runtime already captures token usage in `AgentReport.usage` for Pi, Ollama and Docker Model Runner, but the dashboard does not expose that information.

The older pi-orchestrator dashboard has useful product patterns: a control-room hierarchy, visible model/thinking state, token counters, a live activity feed and correct alternate-screen terminal lifecycle. Its provider-specific quota and account model does not fit pi-many-agents and will not be copied.

## Decision

Keep the dashboard as a thin daemon IPC client.

Add provider-neutral observability derived from existing persisted reports and execution events:

- global token totals
- per-run token totals
- per-provider/model token totals
- estimated cost only when the provider reports it
- runtime provider/model/reasoning in task views
- report duration and retry information where available
- run progress and active worker counts

Do not add a separate usage table while these values can be derived deterministically from existing report JSON and events.

## Usage semantics

`totalTokens = inputTokens + outputTokens`.

`cachedTokens` is displayed separately and is not added a second time to `totalTokens`.

Missing usage on a task is rendered as unknown, not zero.

Costs are never synthesized from a hardcoded price table. `estimatedCost` is summed only from reports that supply it. The dashboard also exposes coverage so a partial cost is not presented as a complete run cost.

## Runtime identity

Task input policy is only a fallback. The dashboard should prefer runtime metadata emitted by:

1. `task.started.payload.plan`
2. `worker.started`
3. persisted `AgentReport`
4. original `AgentTask.modelPolicy`

This makes model and reasoning labels reflect what actually ran after routing.

## TUI design

The screen becomes a compact control room:

- Header: daemon state, PID, active runs/workers, global usage and refresh time
- Runs: state, progress, elapsed time and usage
- Tasks/Workers: state, provider, model, reasoning, tokens, duration and attempts
- Usage: selected-run or global totals plus provider/model breakdown
- Providers: registration/reachability and token-reporting capability
- Live Activity: scrollable event stream

The renderer keeps an 80x24 compact layout and a richer 140x40 two-column layout.

## Terminal lifecycle

Interactive mode enters the alternate screen and hides the cursor. Every normal exit, Ctrl-C path and handled failure restores the cursor and the normal buffer.

Untrusted task titles, report text and event text are sanitized before rendering. Width calculations must use visible terminal width when ANSI styling is present.

## Consequences

- No Pi core changes.
- No direct dashboard reads from active SQLite.
- No provider-specific account quota scraping.
- No fake token cost estimation.
- Existing Stage 5 admin actions and reconnect behavior remain.
- Older reports without usage remain readable.
- Snapshot computation does slightly more aggregation work but avoids another persistence schema.
