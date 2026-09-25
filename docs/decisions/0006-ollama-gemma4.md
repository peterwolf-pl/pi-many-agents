# ADR 0006: Gemma 4 uses the host Ollama already running

Status: accepted

`GET http://127.0.0.1:11434/api/tags` listed `gemma4:latest`. That server is the installed Ollama app, not Docker. Provider name `gemma4` calls `POST /api/chat` with `stream: false` and does not pull or start a container.

`available()` also requires `POST /api/show` to succeed. On this machine the manifest exists, but the 9.6 GB blob is missing, `ollama show` returns not found, and `/api/chat` returns `does not support chat`. The provider stays unavailable until the model is pulled again.

Docker Mistral stays unavailable until disk space and the Docker engine recover.
