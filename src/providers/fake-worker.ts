import { createMessage, encodeMessage } from "../protocol/messages.ts";
import type { AgentTask } from "../types.ts";

const raw = process.argv[2];
if (!raw) {
  process.stderr.write("missing task payload\n");
  process.exit(2);
}
const input = JSON.parse(raw) as { workerId: string; task: AgentTask; behavior?: string };
const { workerId, task } = input;
const behavior = input.behavior ?? task.context ?? "ok";
const started = Date.now();

function emit(type: Parameters<typeof createMessage>[0], payload: Record<string, unknown> = {}): void {
  process.stdout.write(encodeMessage(createMessage(type, workerId, payload, task.id)));
}

emit("worker.started", { pid: process.pid });
emit("worker.ready");
emit("task.started", { title: task.title });

if (behavior === "malformed") {
  process.stdout.write("this is not json\n");
  process.exit(0);
}
if (behavior === "crash") {
  process.stderr.write("worker crashed\n");
  process.exit(1);
}
if (behavior === "hang") {
  setInterval(() => undefined, 1000);
} else {
  const delay = Number(task.modelPolicy.maxTokens ?? 30);
  await new Promise((resolve) => setTimeout(resolve, Number.isFinite(delay) ? delay : 30));
  const failed = behavior === "fail";
  const report = {
    taskId: task.id,
    workerId,
    status: failed ? "failed" : "completed",
    summary: failed ? `Failed: ${task.title}` : `Completed: ${task.title}`,
    findings: [`${task.type}: ${task.objective}`],
    durationMs: Date.now() - started,
    error: failed ? "deterministic failure" : undefined,
  };
  emit(failed ? "task.failed" : "task.completed");
  emit("report.created", report);
  process.exit(failed ? 1 : 0);
}
