---
name: writing-many-agents-prompts
description: Use when creating or updating JSON execution plans, staged implementation prompts, task graphs, or worker instructions for pi-many-agents.
---

# Writing Many Agents Prompts

## Core principle

Write an executable DAG, not a prose wish list. Ground the plan in the current repository contract before assigning workers, models, reasoning, permissions, or providers.

## Workflow

1. Read `src/core/plan.ts`, `src/core/task.ts`, `src/routing/rules.ts`, `src/config/config.ts`, `src/providers/catalog.ts`, plus files relevant to the requested stage.
2. Map the work into independent read-only discovery, RED tests, implementation, review/integration, and final verification.
3. Put every worker-critical requirement inside that task's `objective`, `context`, `constraints`, or `expectedOutput`. Extra top-level fields may be ignored by `parsePlan`.
4. Parallelize only tasks with no dependency and no overlapping write scope.
5. Use the lowest reliable reasoning level.
6. Validate JSON, task IDs, dependencies, provider capabilities, permissions, write scopes, and quality gates before committing.

## Reasoning

| Task | Default |
| --- | --- |
| shell, mechanical inspect | `none` |
| normal test/review/research | `low` |
| subtle test/design/review | `medium` |
| normal code | `medium` |
| risky cross-cutting code | `high` |

Do not spend reasoning on file listing, command execution, formatting, or deterministic checks.

## Provider constraints

`modelPolicy.provider` selects the provider inside the Pi adapter. It does not select the orchestrator adapter.

The current runtime selects the orchestrator adapter at run level through run/CLI `provider` or `defaultProvider`. Do not promise mixed Pi/Qwen4/Mistral adapter routing per task unless runtime support has been added.

Current Ollama Qwen4 and Docker Mistral adapters are text-only. They cannot inspect files, edit code, run shell commands, or use git. Use them only when all required source material is supplied in `context`.

## Permissions and isolation

Grant minimum permissions. Research is read-only. Tests and code get write/shell only when needed. Network and git are opt-in.

Parallel writers need precise, non-overlapping `writeScope`. If scopes overlap, serialize them with dependencies.

## Verification

The final task depends on all required work and runs fresh project gates, normally:

`npm test`, `npm run typecheck`, `npm run lint`, `npm run demo`.

Require raw failures and `NOT VERIFIED` for checks that cannot run. Never allow fabricated PASS.

For the exact supported JSON fields, task shape, decomposition rules, pitfalls, and a runnable example, read `REFERENCE.md`.
