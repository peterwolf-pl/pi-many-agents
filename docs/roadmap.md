# Roadmap

## Stage 0 — done

Discovery of Pi 0.87.1 extension and print/JSON CLI. Docs and ADRs.

## Stage 1 — bootstrap (this version)

Parallel workers, one real provider adapter (Pi subprocess) plus a fake provider, structured reports, telemetry, `/many`, tests. Stop here for feature work.

## Stage 2 — in progress

Deterministic additions on top of Stage 1:

- task deduplication by objective fingerprint
- markdown decomposition into a dependency graph
- priority already selects ready work; graph exposes roots and leaves
- retries for retryable failures (`maxRetries`, default 1)
- task cancellation via `cancelTask`
- provider health after repeated failures
- concurrency remains `maxConcurrentWorkers`

`plans/stage-2.json` was executed with the fake provider, so those reports are not semantic reviews. Do not treat them as findings.

## Stage 3 — partial

Pi profile providers copied from `pi-orchestrator` worker spawn and checked with `pi --list-models`: `antigravity`, `google-antigravity-2`, `google-antigravity-3`, `google-antigravity-4`, `xai`, `openai-codex`. They still run `pi --print --mode json`. No separate Codex, Grok, or Gemini binaries were verified, so none were invented.

## Later

Cost router, local supervisor, token optimization, git worktrees, terminal control center, human-approved self-improvement.
