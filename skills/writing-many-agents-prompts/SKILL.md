---
name: writing-many-agents-prompts
description: Use when creating or updating JSON execution plans, staged implementation prompts, task graphs, or worker instructions for pi-many-agents.
---

# Writing Many Agents Prompts

## Core principle

Write an executable task graph, not a prose wish list. Ground every plan in the current `pi-many-agents` parser, routing rules, provider capabilities, repository state, and project tests.

## Before writing

Read the current versions of:

- `src/core/plan.ts`
- `src/core/task.ts`
- `src/routing/rules.ts`
- `src/config/config.ts`
- `src/providers/catalog.ts`
- the files and ADRs relevant to the requested stage

Do not rely on an older prompt when the runtime contract has changed.

## Plan contract

A directly runnable plan is a JSON object centered on:

`stage`, `notes`, `provider`, `concurrency`, `maxRetries`, and `tasks`.

The runner currently ignores unknown top-level fields. Therefore, any requirement a worker must obey belongs inside the task's `objective`, `context`, `constraints`, or `expectedOutput`. Top-level design notes may document the plan, but must not be the only copy of an execution requirement.

Each task needs unique `id`, `title`, and `objective`. Use only supported task types: `inspect`, `code`, `test`, `research`, `review`, `shell`, `other`.

Dependencies must form an acyclic graph.

## Decomposition

Shape a stage as:

1. Independent read-only inspection or research tasks.
2. RED test tasks for new behavior.
3. Implementation tasks depending on those tests.
4. Review or integration tasks after implementation.
5. One final verification task depending on all required work.

Parallelize tasks only when they do not need each other's result and their write scopes cannot conflict. If two tasks may modify the same files or directories, sequence them with dependencies.

Dependency reports are automatically passed to successor tasks, so use dependencies instead of duplicating long findings.

## Reasoning budget

| Work | Default |
| --- | --- |
| shell, mechanical inspection | `none` |
| normal test, review, research | `low` |
| subtle test/design/review | `medium` |
| normal implementation | `medium` |
| cross-cutting architecture or risky implementation | `high` |

Use the lowest level that can reliably complete the task. Routing may raise a requested level to the configured minimum.

Do not assign high reasoning to file listing, command execution, formatting, deterministic checks, or simple documentation edits.

## Provider rules

`modelPolicy.provider` is the provider passed inside the Pi adapter. It is not the orchestrator adapter selector.

The current runtime selects the orchestrator adapter at run level through CLI/run `provider` or `defaultProvider`. Do not claim that one plan can independently route one task to `qwen4`, another to `mistral`, and another to `pi` unless the runtime has first gained per-task adapter routing.

Ollama Qwen4 and Docker Mistral are text-only adapters in the current implementation. They do not have repository read, filesystem, shell, or coding tools. Use them only when every required source fact is supplied in `context`. Repository inspection, code editing, tests, git operations, and tool-driven work require a capable Pi adapter.

## Permissions

Grant only what the task needs:

- inspection/research: read only
- tests: write + shell when tests are being authored/executed
- implementation: write, shell, and git only when required
- network: false unless external access is essential
- git: false unless the task must create commits

For parallel write tasks, set precise, non-overlapping `writeScope`.

## Task quality

Each task should answer:

- What exact action must the worker perform?
- Which files matter?
- What may it change?
- What must it not change?
- What concrete output proves completion?
- Which predecessor result does it require?
- What model/reasoning/tools are actually necessary?

Prefer several bounded tasks over one giant task, but do not split work so finely that multiple workers fight over the same files.

## Verification task

The last task must run the repository's real quality gates and report raw results. For this project that normally includes:

`npm test`, `npm run typecheck`, `npm run lint`, and `npm run demo`.

Never instruct a worker to report PASS without fresh command output. If a manual or environment-specific check cannot run, require `NOT VERIFIED` for that check instead of simulated success.

## Minimal example

```json
{
  "stage": "Stage N",
  "provider": "pi",
  "concurrency": 3,
  "maxRetries": 1,
  "tasks": [
    {
      "id": "audit",
      "title": "Audit current implementation",
      "objective": "Inspect the current implementation and identify the smallest required change.",
      "type": "inspect",
      "priority": 2,
      "dependencies": [],
      "relevantFiles": ["src/example.ts"],
      "expectedOutput": "Concrete findings with exact files and interfaces.",
      "modelPolicy": { "reasoning": "none", "timeoutMs": 120000 },
      "permissions": { "read": true, "write": false, "shell": false, "network": false, "git": false }
    },
    {
      "id": "red-tests",
      "title": "Write failing tests",
      "objective": "Add tests for the required behavior and verify they fail for the expected missing behavior.",
      "type": "test",
      "priority": 3,
      "dependencies": ["audit"],
      "writeScope": ["test"],
      "constraints": ["Do not implement production code in this task."],
      "expectedOutput": "Failing tests with the observed RED output.",
      "modelPolicy": { "reasoning": "low", "timeoutMs": 180000 },
      "permissions": { "read": true, "write": true, "shell": true, "network": false, "git": true }
    },
    {
      "id": "implement",
      "title": "Implement the behavior",
      "objective": "Implement the minimum production change required to make the new tests pass.",
      "type": "code",
      "priority": 4,
      "dependencies": ["red-tests"],
      "writeScope": ["src"],
      "expectedOutput": "GREEN targeted tests and a concise change report.",
      "modelPolicy": { "reasoning": "medium", "timeoutMs": 300000 },
      "permissions": { "read": true, "write": true, "shell": true, "network": false, "git": true }
    },
    {
      "id": "verify",
      "title": "Verify complete stage",
      "objective": "Run all project quality gates and report the fresh results.",
      "type": "test",
      "priority": 5,
      "dependencies": ["implement"],
      "constraints": ["Report failures verbatim. Never fabricate PASS."],
      "expectedOutput": "Final verification report with every command and result.",
      "modelPolicy": { "reasoning": "none", "timeoutMs": 600000 },
      "permissions": { "read": true, "write": false, "shell": true, "network": false, "git": false }
    }
  ]
}
```

## Final checklist

Before returning or committing a prompt:

- JSON parses.
- Every dependency exists and the graph is acyclic.
- Task IDs are unique.
- Every worker-critical requirement is inside the relevant task.
- Provider and tool capabilities match the task.
- Reasoning is not higher than needed.
- Parallel write scopes do not overlap.
- Read-only tasks cannot write.
- Implementation follows RED tests when behavior changes.
- The final verification task has fresh quality gates.
- The plan does not promise routing or provider behavior the current runtime does not support.
