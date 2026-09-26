# Many Agents Prompt Reference

## Current executable plan contract

`parsePlan` recognizes these top-level execution fields:

- `stage`
- `notes`
- `provider`
- `concurrency`
- `maxRetries`
- `tasks`

Unknown top-level fields are ignored by the runner. They may be useful as documentation, but any requirement a worker must obey must also appear inside its task.

## Task contract

Required:

- `id`
- `title`
- `objective`

Supported task types:

- `inspect`
- `code`
- `test`
- `research`
- `review`
- `shell`
- `other`

Useful optional fields:

- `priority`
- `dependencies`
- `workspace`
- `context`
- `relevantFiles`
- `writeScope`
- `constraints`
- `expectedOutput`
- `modelPolicy.provider`
- `modelPolicy.model`
- `modelPolicy.reasoning`
- `modelPolicy.maxTokens`
- `modelPolicy.timeoutMs`
- `permissions.read/write/shell/network/git`

Task IDs must be unique. Every dependency must exist. The dependency graph must be acyclic.

## Recommended stage shape

1. Audit current implementation.
2. Run independent research in parallel when useful.
3. Write failing tests for new behavior.
4. Implement the minimum production change.
5. Integrate or review cross-cutting changes.
6. Update documentation.
7. Run one complete verification task.

Dependency reports are automatically included in successor context, so prefer dependencies over copying long findings into later task definitions.

## Write-scope rules

Parallel read-only work is cheap and safe.

Parallel write work is safe only when scopes are disjoint. Example:

- worker A: `src/providers`
- worker B: `docs`

Unsafe parallel pair:

- worker A: `src/dashboard`
- worker B: `src/dashboard/render.ts`

Serialize the unsafe pair.

## Provider details

### Pi adapter

Use for repository inspection, coding, tests, filesystem, shell, and git. `modelPolicy.provider` can select a provider/profile inside Pi when supported by the Pi installation.

### Ollama Qwen4

Current adapter capabilities: text chat and token reporting. No tools, filesystem, shell, or code-edit operations.

### Docker Model Runner Mistral

Current adapter capabilities: text chat and token reporting. No tools, filesystem, shell, or code-edit operations.

### Important routing limitation

The current orchestrator chooses adapter using run-level `provider` or `defaultProvider`. A task's `modelPolicy.provider` does not switch the orchestrator adapter.

If a workflow truly needs separate Pi, Qwen4, and Mistral adapter runs, split it into separate runs until per-task adapter routing is implemented.

## Task-writing standard

A good task states:

- exact action
- exact relevant files
- allowed write scope
- constraints
- concrete expected output
- dependency requirements
- smallest adequate reasoning level
- only required permissions

Avoid omnibus tasks that mix unrelated subsystems. Also avoid excessive fragmentation that causes workers to modify the same files.

## Runnable example

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
      "objective": "Run all project quality gates and report fresh results.",
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

## Final validation

Before saving a plan:

- JSON parses.
- IDs are unique.
- All dependencies exist.
- DAG has no cycles.
- Critical requirements are inside tasks.
- Reasoning is minimal but sufficient.
- Provider/tool capabilities match the task.
- Parallel write scopes do not overlap.
- Read-only work cannot write.
- Behavior changes use RED tests before implementation.
- Final verification uses fresh command output.
- The prompt does not claim unsupported routing behavior.
