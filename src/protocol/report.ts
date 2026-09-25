import type { AgentReport, ReportStatus } from "../types.ts";

const STATUSES = new Set<ReportStatus>(["completed", "failed", "partial"]);

export function isAgentReport(value: unknown): value is AgentReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<AgentReport>;
  return (
    typeof report.taskId === "string" &&
    typeof report.workerId === "string" &&
    typeof report.status === "string" &&
    STATUSES.has(report.status) &&
    typeof report.summary === "string" &&
    Array.isArray(report.findings) &&
    typeof report.durationMs === "number"
  );
}

export function parseReportPayload(payload: unknown): AgentReport {
  if (!isAgentReport(payload)) {
    throw new Error("malformed worker report");
  }
  return payload;
}

export function extractJsonReport(text: string): AgentReport | undefined {
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.lastIndexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return isAgentReport(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function wrapTextReport(input: {
  taskId: string;
  workerId: string;
  text: string;
  durationMs: number;
  status?: ReportStatus;
  error?: string;
  usage?: AgentReport["usage"];
}): AgentReport {
  const extracted = extractJsonReport(input.text);
  if (extracted) {
    return { ...extracted, taskId: input.taskId, workerId: input.workerId, durationMs: input.durationMs, usage: extracted.usage ?? input.usage };
  }
  const summary = input.text.trim().slice(0, 2000) || input.error || "Worker produced no report.";
  return {
    taskId: input.taskId,
    workerId: input.workerId,
    status: input.status ?? (input.error ? "failed" : "partial"),
    summary,
    findings: summary ? [summary.slice(0, 500)] : [],
    warnings: input.error ? [input.error] : ["Worker output was not a structured report; wrapped as summary."],
    usage: input.usage,
    durationMs: input.durationMs,
    error: input.error,
  };
}
