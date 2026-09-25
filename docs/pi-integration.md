# Pi integration

Verified against Pi `0.87.1` at `/opt/homebrew/bin/pi` (`@earendil-works/pi-coding-agent`).

Pi core is not modified.

## Extension

- Entry: `extensions/index.ts`
- Package manifest: `package.json` `pi.extensions`
- Load: `pi --extension ./extensions/index.ts` or project package discovery
- Command: `pi.registerCommand("many", ...)` → `/many <plan.json>`
- Factory does not spawn processes (Pi loads extensions without a session)
- Workers start only inside the command handler
- Cleanup: `session_shutdown` aborts the active `AbortController`
- `/many` defaults to the fake provider. A plan may set `"provider": "pi"` to spawn real Pi workers.
- Results return via `ctx.ui.notify` and `pi.sendMessage` (compact reports only)
- Status: `ctx.ui.setStatus` when `ctx.hasUI`

Types come from `@earendil-works/pi-coding-agent` `ExtensionAPI` (peer, optional). Pi loads the extension with jiti.

## Worker process

Verified CLI flags (`pi --help`, `docs/cli.md`, `docs/json.md`):

- `pi --print --mode json --no-session --no-extensions`
- `--thinking off|low|medium|high` mapped from reasoning `none|low|medium|high`
- `--tools` / `--no-tools` from task permissions
- `--provider` / `--model` only when the task sets them
- Prompt passed after `--`

JSON mode stdout is JSONL. The Pi adapter reads `message_end` assistant text and optional `usage`. It does not inject parent session history.

`--approve` is intentionally not passed. Project trust for worker tool use is left to the operator.

## Not used

RPC mode, tmux panes, SDK `createAgentSession`, and custom providers are unused in Stage 1. Isolated behind `PiProvider` if added later.
