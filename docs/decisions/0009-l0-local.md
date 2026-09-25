# ADR 0009: Local L0 advisor with strict no-paid-fallback

Status: accepted

A local Ollama instance running `gemma4:latest` serves as an L0 advisor when `available()` returns true.

1. Scope: advisory only. L0 assists with task classification, report and log compression, near-duplicate fingerprint heuristics, and reasoning escalation recommendations.
2. Authority: the orchestrator and deterministic rules remain authoritative. L0 never spawns child processes, invokes tools, or edits files.
3. No silent paid fallback: if Ollama is unreachable, returns HTTP errors, or times out (>1500 ms), the operation is skipped immediately and logged via `l0.skipped`. The system continues on deterministic baseline rules and never routes advisory calls to paid cloud models (Pi, Claude, GPT, Gemini).
