# ADR 0003: Stage 2 controls stay deterministic

Status: accepted

Retries, deduplication, decomposition, health, and cancellation are ordinary code. No extra model call classifies or splits work in this stage.

Retry skips timeout, cancellation, malformed output, and unavailable providers so a hung worker is not launched again by default. Decomposition splits markdown headings; it does not infer a hidden graph from prose.
