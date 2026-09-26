# Skill verification notes

## Baseline failures observed before the skill

The existing prompt-writing workflow exposed four concrete failure modes:

1. Important design requirements can be placed only in extra top-level JSON fields even though `parsePlan` ignores those fields during execution.
2. `modelPolicy.provider` can be mistaken for the orchestrator adapter selector.
3. Local Qwen4/Mistral tasks can be assigned repository work even though those adapters have no filesystem, shell, or tool access.
4. A single plan can be described as mixing Pi, Qwen4, and Mistral per task even though adapter selection is currently run-level.

The skill explicitly addresses all four.

## Static verification performed

Checked against the current branch implementation:

- `src/core/plan.ts`
- `src/core/task.ts`
- `src/routing/rules.ts`
- `src/config/config.ts`
- `src/providers/catalog.ts`

A separate subagent pressure-test facility is not available in this chat runtime, so agent behavioral RED/GREEN pressure testing remains pending. The skill must not be described as behaviorally validated until that test is run.
