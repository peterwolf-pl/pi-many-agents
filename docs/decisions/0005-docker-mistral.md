# ADR 0005: Mistral runs in its own Ollama container

Status: accepted

Host Ollama is already listening on `127.0.0.1:11434` and only has `gemma4`. It is not Docker. The `mistral` provider uses the official `ollama/ollama` image as container `pi-many-mistral`, published on host port `11435`, volume `pi-many-mistral:/root/.ollama`.

Chat uses Ollama's documented `POST /api/chat` with `stream: false`. The provider does not call the host Ollama and does not invent a Mistral CLI. `available()` is true only after `/api/tags` lists `mistral`.
