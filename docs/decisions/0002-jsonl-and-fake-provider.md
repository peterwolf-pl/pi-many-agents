# ADR 0002: JSONL protocol and fake provider

Status: accepted

Parent/worker control messages are versioned JSONL. Pi's own JSON mode is translated inside `PiProvider`; the scheduler does not parse Pi events.

Tests and `pi-many-agents demo` use `FakeProvider`, a Node child that emits the protocol. The suite does not call paid APIs.

Default config provider and `/many` are `fake` so a fresh checkout cannot accidentally spend tokens. Set a plan's `provider` to `pi` only when a human accepts model cost.
