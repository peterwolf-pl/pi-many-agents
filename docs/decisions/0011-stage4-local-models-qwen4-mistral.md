# ADR 0011: Local Models - Ollama Qwen4 and Docker Model Runner Mistral

Status: accepted

## Context
Stage 4 introduces local, zero-cost inference without cloud dependencies or paid API keys.
Previously:
- Mistral was implemented as an experimental script trying to spawn a nested `ollama/ollama` Docker container on port 11435 and pull models dynamically.
- Ollama was hardcoded to `gemma4:latest`.

## Decisions

### 1. Docker Model Runner (Mistral)
- `DockerMistralProvider` connects directly to Docker Model Runner's OpenAI-compatible endpoint at `http://127.0.0.1:12434/engines/v1`.
- Default model is `ai/mistral` (matching `docker.io/ai/mistral:latest`).
- Standard OpenAI-compatible endpoints:
  - `GET /models` to verify exact model presence before execution.
  - `POST /chat/completions` for non-streaming execution.
- Usage is mapped from `usage.prompt_tokens` and `usage.completion_tokens`.
- All legacy code attempting `docker run ollama/ollama`, port 11435 mapping, and `docker model pull` has been eliminated.

### 2. Host Ollama (Qwen4)
- `OllamaProvider` connects to the local Ollama instance on `http://127.0.0.1:11434`.
- Registered under the alias `qwen4`.
- Dynamic model resolution: if no model tag is configured, it inspects local `GET /api/tags` for tags matching `qwen4` (e.g. `qwen4:latest`, `qwen4:7b`).
- If no matching tag is found, the provider is marked unavailable. No automatic `ollama pull` and no fallback to cloud or unrelated model families.

### 3. Hard Safeguards
- Zero cloud fallback: an unavailable local model fails explicitly.
- Zero auto-pull: neither Ollama nor Docker pull models dynamically from the orchestrator.
- Capabilities remain text-only (`coding: false, toolUse: false, filesystem: false, shell: false`).
- Full per-worker cancellation using `AbortController` and timeout enforcement.
