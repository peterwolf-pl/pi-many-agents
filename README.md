# pi-many-agents

Bootstrap orchestrator for running isolated worker agents from a primary [Pi](https://github.com/earendil-works/pi) session. Pi core is not modified.

```bash
node --experimental-strip-types --test test/*.test.ts
node --experimental-strip-types src/cli/main.ts demo
pi --extension ./extensions/index.ts
# then: /many plans/stage-2.json
```

Stage 1 stops at parallel workers, structured reports, and a fake provider so the suite needs no paid API. `PiProvider` shells out to `pi --print --mode json` when you opt in.

See `docs/architecture.md`, `docs/pi-integration.md`, and `plans/stage-2.json`.
