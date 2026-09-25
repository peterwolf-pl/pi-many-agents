# Roadmap

## Stage 0 — done

Discovery of Pi 0.87.1 extension and print/JSON CLI. Docs and ADRs.

## Stage 1 — bootstrap (this version)

Parallel workers, one real provider adapter (Pi subprocess) plus a fake provider, structured reports, telemetry, `/many`, tests. Stop here for feature work.

## Stage 2 — done

Deterministic additions on top of Stage 1:

- task deduplication by objective fingerprint
- markdown decomposition into a dependency graph
- priority already selects ready work; graph exposes roots and leaves
- retries for retryable failures (`maxRetries`, default 1)
- task cancellation via `cancelTask`
- provider health after repeated failures
- concurrency remains `maxConcurrentWorkers`
- verified with real Pi workers via `plans/stage-next.json`

## Stage 3 — in progress

Next vertical slice (ADR 0007, 0008, 0009):

- Git worktree isolation under `worktrees/<taskId>` for `type: "code"` tasks with single-writer path-prefix locks
- CLI daemon and thin `/many` extension attach over local Unix socket with SQLite persistence
- Local L0 advisor (Ollama `gemma4:latest`) for classify, compress, near-dup assist with strict skip-on-unavailable and no paid fallback
- Pi profile providers catalog remains verified against `pi --list-models`

## Later

Cost router, token optimization, terminal dashboard / tmux control center, human-approved self-improvement.
