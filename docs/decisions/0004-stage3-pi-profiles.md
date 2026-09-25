# ADR 0004: Stage 3 uses Pi provider profiles, not copied stream proxies

Status: accepted

`pi-orchestrator/src/provider.ts` registers a Pi model provider named `orchestrator` and proxies `pi-antigravity`. That is not a worker adapter. Copying it would pull a hardcoded sandbox URL and an in-process stream into this package.

Verified worker launch in `pi-orchestrator/src/worker-agent.ts` is:

```text
pi --provider <account> --model <id> --thinking <level> -p --no-session
```

`pi --list-models` on this machine lists `antigravity`, `google-antigravity-2`, `google-antigravity-3`, `google-antigravity-4`, `openai-codex`, and `xai`. Those names are registered as `PiProfileProvider`s. Models `grok-4.7` and `gpt-5.5` are present. Gemini and Claude on Antigravity are selected through those Pi providers, not separate CLIs.

Not copied: orchestrator stream registration, account secrets, and the knowledge-base claim that `openai-codex` has no Pi provider. No Grok Build, local-model, or generic non-Pi CLI adapter was present to verify.
