# Architecture

`pi-many-agents` is an external orchestration package. It does not modify Pi core.

```text
Primary Pi  -- /many or CLI -->  Orchestrator
                                  |-- TaskQueue (dependency-aware, max concurrency)
                                  |-- WorkerManager
                                  |-- ProviderRegistry
                                  |     |-- fake (tests, demo)
                                  |     `-- pi (subprocess: pi --print --mode json)
                                  |-- ProcessManager
                                  |-- ReportCollector (protocol JSONL + AgentReport)
                                  `-- EventBus + JSONL telemetry
```

Workers receive a Task Packet, not the parent conversation. They return an `AgentReport`. The parent session only sees compact reports.

Stage 1 scheduling is deterministic. Routing maps task type to a reasoning floor. No LLM router.

Future providers implement `AgentProvider` and register without scheduler changes.
