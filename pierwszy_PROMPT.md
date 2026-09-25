
# PROJECT: pi-many-agents

You are building the initial bootstrap version of `pi-many-agents`.

`pi-many-agents` is an orchestration extension for Pi that allows one primary Pi session to coordinate multiple independent AI agents and LLM-powered tools in parallel.

The long-term goal is to support agents based on Pi, Codex, ChatGPT/OpenAI, Gemini, Google Antigravity, Grok/xAI, Grok Build, local models, and other providers.

However, DO NOT attempt to build the entire system now.

Your task is to build the smallest reliable bootstrap version that can later be used to develop `pi-many-agents` using `pi-many-agents` itself.

The project must reach a self-hosting milestone as quickly as possible.

---

# 1. PRIMARY ARCHITECTURAL RULE

Never modify Pi core.

`pi-many-agents` must remain an external extension/orchestration layer.

Use only mechanisms that Pi officially or practically exposes, such as:

- extension APIs
- hooks
- commands
- subprocesses
- CLI invocation
- stdin/stdout
- JSONL
- IPC
- files
- sockets
- tmux/zellij panes if appropriate

Before implementing any Pi-specific integration:

1. Inspect the installed Pi version.
2. Inspect its extension mechanism.
3. Inspect available APIs/types/examples.
4. Verify how extensions register commands and receive events.
5. Verify how independent Pi processes can be started.
6. Do not invent APIs.
7. Document every Pi integration point used.

If an integration capability cannot be verified, isolate it behind an adapter.

---

# 2. BOOTSTRAP GOAL

The first usable version must support this workflow:

```text
User
  |
  v
Primary Pi
  |
  v
pi-many-agents
  |
  +-----------------------+
  |                       |
  v                       v
Worker A                Worker B
  |                       |
  v                       v
task                    task
  |                       |
  +-----------+-----------+
              |
              v
       structured reports
              |
              v
         Primary Pi
```

The primary Pi session remains the user-facing agent.

Workers perform isolated tasks.

Workers must NOT continuously stream their entire context back to the parent.

They return compact structured reports.

---

# 3. MOST IMPORTANT MILESTONE

We want to reach the following command or equivalent functionality:

```text
/many
```

or:

```text
pi-many-agents run
```

The orchestrator should then be able to execute something conceptually equivalent to:

```text
Task A:
Inspect repository architecture.

Task B:
Inspect tests and identify missing coverage.

Task C:
Research how a specific module works.
```

A, B and C should execute concurrently when they have no dependency on each other.

When finished:

```text
Worker A -> report
Worker B -> report
Worker C -> report
```

The orchestrator collects the reports and makes them available to the primary Pi session.

This capability is the bootstrap milestone.

Once it works reliably, later development stages can use this mechanism.

---

# 4. DEVELOPMENT PHILOSOPHY

Optimize for:

1. low orchestration overhead
2. low token consumption
3. parallel execution
4. provider independence
5. observability
6. recoverability
7. simple architecture
8. deterministic behavior where possible

Avoid premature complexity.

Do not build a distributed system when local subprocesses are sufficient.

Do not use an LLM for operations that normal software can perform.

Examples:

DO NOT ask an LLM to:

- list files
- calculate token totals
- check whether a process exists
- parse JSON
- inspect git status
- detect process exit
- calculate task duration
- maintain queues

Use normal code for these operations.

LLMs should only be used when semantic reasoning is required.

---

# 5. STAGE 0 - DISCOVERY AND REPOSITORY BOOTSTRAP

This stage must be completed first.

Inspect the environment.

Determine:

- Pi version
- Pi installation location
- Pi extension architecture
- extension examples
- available lifecycle hooks
- command registration
- process spawning capabilities
- model selection mechanisms
- reasoning configuration mechanisms
- session handling
- configuration storage
- event handling

Create:

```text
docs/
  architecture.md
  pi-integration.md
  protocol.md
  roadmap.md
  decisions/
```

Create an Architecture Decision Record whenever an important architectural decision is made.

Do not modify Pi source.

Create a completely separate repository/package for:

```text
pi-many-agents
```

---

# 6. STAGE 1 - MINIMUM SELF-HOSTING ORCHESTRATOR

This is the most important implementation stage.

Build only the functionality required to make the system capable of helping build its own next version.

Required components:

```text
Orchestrator
Task
TaskQueue
Worker
WorkerManager
ProviderAdapter
ProcessManager
ReportCollector
EventBus
Config
Logger
```

Suggested logical structure:

```text
src/
  core/
    orchestrator
    scheduler
    task
    worker-manager

  providers/
    provider
    pi

  process/
    process-manager

  protocol/
    messages
    report

  config/

  telemetry/

  cli/

  extension/
```

Adapt this structure if the Pi extension architecture requires a different layout.

---

# 7. TASK MODEL

Create an explicit task representation.

Example:

```ts
interface AgentTask {
  id: string

  title: string
  objective: string

  type:
    | "inspect"
    | "code"
    | "test"
    | "research"
    | "review"
    | "shell"
    | "other"

  priority: number

  dependencies: string[]

  workspace?: string

  modelPolicy: {
    provider?: string
    model?: string

    reasoning:
      | "none"
      | "low"
      | "medium"
      | "high"

    maxTokens?: number
    timeoutMs?: number
  }

  permissions: {
    read: boolean
    write: boolean
    shell: boolean
  }
}
```

The exact schema may change, but tasks must always be explicit objects.

Do not make orchestration depend on parsing arbitrary natural-language logs.

---

# 8. WORKER MODEL

Each worker represents one independently executing agent.

Example state:

```ts
type WorkerState =
  | "idle"
  | "starting"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
```

Each worker should expose:

```ts
interface Worker {
  id: string
  provider: string
  model: string
  state: WorkerState

  taskId?: string

  startedAt?: number

  run(task: AgentTask): Promise<AgentReport>

  cancel(): Promise<void>
}
```

Do not tightly couple workers to Pi.

---

# 9. PROVIDER ABSTRACTION

Create a generic provider interface immediately.

Example:

```ts
interface AgentProvider {
  name: string

  available(): Promise<boolean>

  capabilities(): ProviderCapabilities

  spawn(config: WorkerConfig): Promise<WorkerHandle>

  execute(
    worker: WorkerHandle,
    task: AgentTask
  ): Promise<AgentReport>

  cancel(worker: WorkerHandle): Promise<void>
}
```

Stage 1 only needs ONE working provider.

Prefer Pi itself as the first provider if technically possible.

Do not implement Gemini, Codex, Grok and other providers yet.

Their future support must be possible without modifying the orchestrator.

---

# 10. PARENT-WORKER PROTOCOL

Use structured communication.

Prefer JSONL for the bootstrap version unless Pi architecture provides a clearly superior mechanism.

Example event:

```json
{
  "version": 1,
  "type": "task.completed",
  "workerId": "worker-2",
  "taskId": "task-17",
  "timestamp": 1780000000,
  "payload": {}
}
```

Required event types:

```text
worker.started
worker.ready
worker.failed

task.started
task.progress
task.completed
task.failed
task.cancelled

report.created
```

Messages must contain a protocol version.

Design for forward compatibility.

---

# 11. STRUCTURED AGENT REPORT

Workers must not return their entire conversation.

Return a compact report.

Example:

```ts
interface AgentReport {
  taskId: string
  workerId: string

  status:
    | "completed"
    | "failed"
    | "partial"

  summary: string

  findings: string[]

  changes?: {
    files: string[]
    description: string
  }

  artifacts?: string[]

  warnings?: string[]

  recommendedNextTasks?: SuggestedTask[]

  usage?: {
    inputTokens?: number
    outputTokens?: number
    cachedTokens?: number
    estimatedCost?: number
  }

  durationMs: number
}
```

The report is the primary communication mechanism between workers and the main agent.

---

# 12. CONTEXT ISOLATION

Do NOT send the entire primary Pi conversation to every worker.

Create a Task Packet.

Example:

```text
TASK PACKET

Objective:
...

Relevant files:
...

Relevant context:
...

Constraints:
...

Expected output:
...

Permissions:
read-only

Reasoning:
low
```

Only include information required for the worker's task.

This principle is fundamental to future token savings.

---

# 13. PARALLEL EXECUTION

Stage 1 must support real parallel execution.

Example:

```text
Task A ────────┐
Task B ────────┼──> ReportCollector
Task C ────────┘
```

Implement:

```text
maxConcurrentWorkers
```

Default:

```text
2
```

Make it configurable.

Tasks with unresolved dependencies must wait.

Independent tasks may execute concurrently.

Do not implement an advanced scheduler yet.

A simple dependency-aware queue is sufficient.

---

# 14. SIMPLE ROUTING FOR BOOTSTRAP

Do NOT use another expensive LLM as the router in Stage 1.

Use deterministic rules.

Example:

```text
shell
file inspection
grep
git status
simple extraction
    ->
reasoning = none

repository analysis
review
classification
    ->
reasoning = low

implementation
debugging
architecture
    ->
reasoning = medium

complex architecture
difficult debugging
cross-system reasoning
    ->
reasoning = high
```

These mappings must be configurable.

The scheduler should produce:

```ts
ExecutionPlan {
  provider
  model
  reasoning
  timeout
  tokenBudget
}
```

---

# 15. COST PRINCIPLE

Every task should have the cheapest reasonable execution path.

Future routing strategy:

```text
normal software
    ↓
local model
    ↓
cheap cloud model
    ↓
strong cloud model
    ↓
strong model + high reasoning
```

Escalate only when required.

Do not implement the complete escalation system in Stage 1.

Design interfaces that make it possible later.

---

# 16. PROCESS MANAGEMENT

The orchestrator must know:

```text
PID
worker ID
task ID
start time
state
exit code
timeout
```

Implement:

- process startup
- stdout capture
- stderr capture
- timeout
- cancellation
- cleanup
- unexpected process death handling

No zombie processes.

A crashed worker must not crash the primary Pi process.

---

# 17. TELEMETRY

From the beginning record structured events.

Store locally.

For each task capture at least:

```text
taskId
workerId
provider
model
reasoning
start
end
duration
status
input tokens if available
output tokens if available
estimated cost if available
```

Do not build a database unless necessary.

JSONL files are acceptable for Stage 1.

---

# 18. TERMINAL UI FOR STAGE 1

Do NOT build the final dashboard yet.

Create a minimal status view.

It should show something similar to:

```text
pi-many-agents

Workers: 3
Running: 2
Queued: 1

#12  RUNNING   inspect repo
#13  RUNNING   inspect tests
#14  QUEUED    architecture review
```

Keep the primary Pi UI untouched.

The final multi-column terminal interface comes later.

---

# 19. TESTS REQUIRED BEFORE SELF-HOSTING

Implement tests for:

- task creation
- dependency handling
- concurrent execution
- worker completion
- worker failure
- timeout
- cancellation
- malformed worker output
- report parsing
- process cleanup
- max concurrency
- provider failure

Create at least one integration test that launches multiple fake workers.

Do not require paid APIs for the test suite.

Create a deterministic fake provider.

---

# 20. SELF-HOSTING ACCEPTANCE TEST

Stage 1 is complete only when `pi-many-agents` can execute at least three tasks where at least two execute concurrently.

Example:

```text
Task A:
Analyze scheduler implementation.

Task B:
Analyze provider abstraction.

Task C:
Analyze existing tests and propose missing tests.
```

The system must:

1. create tasks
2. start workers
3. run at least A and B concurrently
4. monitor processes
5. collect structured reports
6. survive one worker failure
7. return results to the primary orchestrator
8. record telemetry

At this point STOP feature development.

We have reached the bootstrap milestone.

---

# 21. STAGE 2 - DOGFOODING

Stage 2 must be developed using the Stage 1 `pi-many-agents` implementation whenever possible.

Use multiple workers to inspect and improve the project itself.

Example decomposition:

```text
Agent A
review scheduler

Agent B
review provider architecture

Agent C
review tests

Agent D
review token/context architecture
```

The primary agent integrates their findings.

Add:

- automatic task decomposition
- better dependency graph
- priorities
- retries
- task cancellation
- worker health
- concurrency control
- task deduplication

Do not start Stage 2 during the initial bootstrap implementation.

---

# 22. STAGE 3 - MULTI-PROVIDER

Use pi-many-agents to develop provider adapters in parallel.

Separate agents can work on:

```text
Pi adapter
Codex adapter
OpenAI adapter
Gemini adapter
Grok/xAI adapter
local model adapter
generic CLI adapter
```

Each adapter must implement the same capability interface.

Providers must advertise capabilities instead of the scheduler hardcoding assumptions.

Example:

```ts
ProviderCapabilities {
  coding: boolean
  toolUse: boolean
  filesystem: boolean
  shell: boolean
  reasoningLevels: string[]
  contextWindow?: number
  tokenUsageReporting: boolean
}
```

Verify provider capabilities before implementing them.

Never fabricate CLI flags or APIs.

---

# 23. STAGE 4 - INTELLIGENT ROUTER

Add routing based on:

```text
task type
complexity
risk
required tools
context size
estimated cost
model capability
historical performance
latency
```

Routing pipeline:

```text
task
 ↓
classify
 ↓
estimate complexity
 ↓
estimate risk
 ↓
find compatible providers
 ↓
estimate cost
 ↓
choose cheapest adequate option
 ↓
execute
 ↓
evaluate
 ↓
escalate if necessary
```

Support:

```text
none
low
medium
high
```

reasoning levels when the provider supports them.

Do not assume every provider exposes the same reasoning controls.

---

# 24. STAGE 5 - LOCAL SUPERVISOR

Introduce a local model.

Its roles may include:

```text
task classification
triage
report compression
context summarization
duplicate detection
simple review
routing suggestions
process observation
failure classification
```

The local model should NOT control operating-system processes directly when deterministic software can do it more reliably.

The orchestrator remains authoritative.

The local model advises.

---

# 25. STAGE 6 - TOKEN OPTIMIZATION

Implement:

- Task Packets
- context filtering
- report compression
- diff-based context
- file relevance detection
- caching
- reusable summaries
- artifact references
- context fingerprints

Measure:

```text
tokens without many-agents
vs
tokens with many-agents
```

Optimization must be based on telemetry rather than assumptions.

---

# 26. STAGE 7 - PARALLEL CODING

Add isolated workspaces.

Prefer Git worktrees or equivalent isolation.

Concept:

```text
main repository

worktrees/
  task-101/
  task-102/
  task-103/
```

Each coding worker receives its own workspace.

Never allow several coding agents to modify the same working tree concurrently unless explicitly requested.

Workers return:

```text
commit
diff
changed files
tests
warnings
```

The orchestrator decides whether changes should be merged.

---

# 27. STAGE 8 - TERMINAL CONTROL CENTER

Build the final terminal UX.

Target:

```text
┌─────────────────────────────┬──────────────────────┬──────────────────────┐
│                             │ AGENTS               │ TASKS                │
│                             │                      │                      │
│        PRIMARY PI           │ A1 RUNNING           │ #31 coding           │
│                             │ A2 IDLE              │ #32 review           │
│                             │ A3 RUNNING           │ #33 inspect          │
│                             │                      │                      │
│                             │ TOKENS / COST        │ EVENTS               │
│                             │                      │                      │
└─────────────────────────────┴──────────────────────┴──────────────────────┘
```

Primary Pi must remain native.

Do not reimplement the Pi interface.

Use terminal multiplexing or external panes around Pi.

Responsive behavior:

```text
wide terminal
    -> 3 columns

medium terminal
    -> 2 columns

small terminal
    -> Pi + switchable dashboard
```

Investigate tmux, zellij and native TUI approaches before choosing.

---

# 28. STAGE 9 - SELF-IMPROVEMENT

The system may analyze its own telemetry.

It may identify:

```text
expensive routing
slow agents
frequent retries
bad prompts
unnecessary context
poor model selection
weak task decomposition
```

It may generate proposed improvements.

But:

```text
observe
 ↓
analyze
 ↓
propose
 ↓
test
 ↓
benchmark
 ↓
human approval
 ↓
apply
```

Never:

```text
observe -> autonomously modify production system
```

Self-improvement must operate only inside the `pi-many-agents` repository.

Never modify Pi core.

---

# 29. IMPORTANT SAFETY RULES

Default worker permissions should be minimal.

Support:

```text
read-only
workspace-write
shell
network
git
```

Dangerous operations require explicit permission.

Never expose secrets unnecessarily to workers.

A worker should receive only credentials required by its provider.

Do not place API keys inside prompts.

---

# 30. ENGINEERING RULES

Prefer:

- simple code
- typed interfaces
- dependency injection
- provider isolation
- structured events
- deterministic tests
- explicit state machines
- append-only telemetry
- small modules

Avoid:

- giant orchestrator classes
- provider-specific logic inside scheduler
- regex parsing of arbitrary LLM prose
- global mutable state
- hidden side effects
- unnecessary frameworks
- premature databases
- premature distributed architecture

---

# 31. WHAT YOU MUST IMPLEMENT NOW

Implement ONLY:

## Stage 0
Discovery and architecture validation.

## Stage 1
Minimum self-hosting orchestrator.

Do not implement Stages 2-9 yet.

However, design Stage 1 interfaces so they do not block those future stages.

---

# 32. IMPLEMENTATION PROCESS

Work incrementally.

Before writing significant code:

1. inspect repository/environment
2. inspect Pi integration mechanisms
3. write findings
4. propose architecture
5. identify uncertain assumptions
6. resolve assumptions from actual code/docs when possible

Then implement.

After each meaningful change:

```text
typecheck
lint
tests
```

Do not silently ignore failing tests.

---

# 33. REQUIRED OUTPUT

At the end provide:

## Implemented

What actually works.

## Architecture

Major components and why they exist.

## Pi integration

Exactly how pi-many-agents communicates with Pi.

## Files changed

Important files created or modified.

## Tests

Tests executed and their results.

## Bootstrap demonstration

Show that multiple workers can execute concurrently.

## Known limitations

What is intentionally missing.

## Stage 2 task graph

Most importantly, generate a machine-readable plan for Stage 2.

Create:

```text
plans/stage-2.json
```

It should contain independent and dependent tasks that the newly created `pi-many-agents` can execute.

Example concept:

```json
{
  "stage": 2,
  "tasks": [
    {
      "id": "scheduler-review",
      "objective": "Review scheduler architecture",
      "dependencies": [],
      "recommendedReasoning": "medium"
    },
    {
      "id": "provider-review",
      "objective": "Review provider abstraction",
      "dependencies": [],
      "recommendedReasoning": "medium"
    },
    {
      "id": "test-review",
      "objective": "Find missing test coverage",
      "dependencies": [],
      "recommendedReasoning": "low"
    }
  ]
}
```

The actual Stage 2 plan should be substantially more complete.

This file becomes the first workload executed by pi-many-agents against its own repository.

---

# 34. DEFINITION OF SUCCESS

The bootstrap implementation succeeds when:

```text
Primary Pi
   |
   v
pi-many-agents
   |
   +-> worker
   +-> worker
   +-> worker
   |
   v
structured reports
   |
   v
Primary Pi
```

works reliably.

The first version does NOT need to be intelligent.

It needs to be:

```text
simple
observable
parallel
provider-independent
testable
cheap
extensible
```

The intelligence comes later.

The key milestone is:

> pi-many-agents becomes capable of coordinating agents that continue development of pi-many-agents.

Once that milestone is verified, stop and prepare Stage 2 for execution through the new orchestrator.
