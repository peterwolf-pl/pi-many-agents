import type { AgentReport, ReportStatus, Usage } from "../types.ts";

const STATUSES = new Set<ReportStatus>(["completed", "failed", "partial"]);

export interface ReportCandidate {
  status: ReportStatus;
  summary: string;
  findings: string[];
  changes?: { files: string[]; description: string };
  artifacts?: string[];
  warnings?: string[];
  recommendedNextTasks?: AgentReport["recommendedNextTasks"];
  usage?: Usage;
}

export function isReportCandidate(value: unknown): value is ReportCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReportCandidate>;
  if (typeof candidate.status !== "string" || !STATUSES.has(candidate.status as ReportStatus)) {
    return false;
  }
  if (typeof candidate.summary !== "string") return false;
  if (!Array.isArray(candidate.findings) || !candidate.findings.every((f) => typeof f === "string")) {
    return false;
  }
  if (candidate.changes !== undefined) {
    if (
      !candidate.changes ||
      typeof candidate.changes !== "object" ||
      !Array.isArray(candidate.changes.files) ||
      !candidate.changes.files.every((f) => typeof f === "string") ||
      typeof candidate.changes.description !== "string"
    ) {
      return false;
    }
  }
  if (candidate.artifacts !== undefined) {
    if (!Array.isArray(candidate.artifacts) || !candidate.artifacts.every((a) => typeof a === "string")) {
      return false;
    }
  }
  return true;
}

export function isAgentReport(value: unknown): value is AgentReport {
  if (!isReportCandidate(value)) return false;
  const report = value as Partial<AgentReport>;
  return (
    typeof report.taskId === "string" &&
    typeof report.workerId === "string" &&
    typeof report.durationMs === "number" &&
    Number.isFinite(report.durationMs)
  );
}

export function parseReportPayload(payload: unknown): AgentReport {
  if (!isAgentReport(payload)) {
    throw new Error("malformed worker report");
  }
  return payload;
}

function findBalancedObjects(text: string): unknown[] {
  const results: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (char === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          const candidate = text.slice(start, i + 1);
          try {
            results.push(JSON.parse(candidate));
          } catch {
            // not valid JSON, ignore
          }
          start = -1;
        }
      }
    }
  }
  return results;
}

export function extractJsonReport(text: string): ReportCandidate | undefined {
  const candidates: unknown[] = [];

  // 1. Scan fenced code blocks
  const fencedMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fencedMatches) {
    const inner = match[1].trim();
    try {
      candidates.push(JSON.parse(inner));
    } catch {
      candidates.push(...findBalancedObjects(inner));
    }
  }

  // 2. Scan balanced objects in raw text
  candidates.push(...findBalancedObjects(text));

  // Find all valid report candidates and pick the last one
  const validReports = candidates.filter(isReportCandidate);
  if (validReports.length === 0) return undefined;
  return validReports[validReports.length - 1];
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
  const hasProcessError = Boolean(input.error || (input.status && input.status !== "completed"));
  const finalStatus: ReportStatus = hasProcessError
    ? (input.status === "partial" ? "partial" : "failed")
    : (extracted?.status ?? input.status ?? "partial");

  if (extracted) {
    const warnings = [...(extracted.warnings ?? [])];
    if (hasProcessError && extracted.status === "completed") {
      warnings.push(`Worker reported 'completed' but process encountered error: ${input.error ?? "non-zero exit"}`);
    }
    return {
      ...extracted,
      taskId: input.taskId,
      workerId: input.workerId,
      status: finalStatus,
      durationMs: input.durationMs,
      usage: extracted.usage ?? input.usage,
      error: input.error ?? (finalStatus === "failed" ? "execution failed" : undefined),
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  const summary = input.text.trim().slice(0, 2000) || input.error || "Worker produced no report.";
  return {
    taskId: input.taskId,
    workerId: input.workerId,
    status: finalStatus,
    summary,
    findings: summary ? [summary.slice(0, 500)] : [],
    warnings: input.error ? [input.error] : ["Worker output was not a structured report; wrapped as summary."],
    usage: input.usage,
    durationMs: input.durationMs,
    error: input.error,
  };
}
