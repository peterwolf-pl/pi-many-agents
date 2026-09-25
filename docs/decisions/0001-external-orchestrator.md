# ADR 0001: External orchestrator, no Pi core changes

Status: accepted

Pi 0.87.1 loads extensions in-process and can start independent workers with `pi --print --mode json`. The orchestrator is a separate package. Workers are child processes so a crash cannot take down the parent except by an unhandled exception in our own code, which the command handler must catch.

Subprocesses are enough. No sockets, tmux, or distributed queue in Stage 1.
