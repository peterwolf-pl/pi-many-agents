# Protocol

Version: `1`

Transport: JSONL on worker stdout, one object per line. Unknown lines are ignored by the process manager except when building a Pi text report.

```json
{"version":1,"type":"task.completed","workerId":"worker-2","taskId":"task-17","timestamp":1780000000,"payload":{}}
```

Event types:

- `worker.started`
- `worker.ready`
- `worker.failed`
- `task.started`
- `task.progress`
- `task.completed`
- `task.failed`
- `task.cancelled`
- `report.created`

`report.created` payload must be an `AgentReport`. Missing or invalid reports become `failed` or `partial` with an explicit warning. Orchestration never depends on free-form prose.

Forward compatibility: consumers ignore unknown `type` values and unknown payload fields. `version` must match for a line to be a protocol message.
