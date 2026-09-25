import type { AgentTask, RunOptions } from "../types.ts";
import { assertAcyclic, createTask, TaskValidationError } from "./task.ts";

export interface ParsedPlan {
  stage?: number | string;
  notes?: string;
  provider?: string;
  concurrency?: number;
  maxRetries?: number;
  tasks: AgentTask[];
}

export function parsePlan(input: string | unknown): ParsedPlan {
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (err) {
      throw new TaskValidationError(`Invalid plan JSON: ${(err as Error).message}`);
    }
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TaskValidationError("Plan must be a valid JSON object");
  }

  const doc = raw as Record<string, unknown>;

  if (!("tasks" in doc) || !Array.isArray(doc.tasks)) {
    throw new TaskValidationError("Plan must contain a tasks array");
  }

  if (doc.concurrency !== undefined) {
    if (typeof doc.concurrency !== "number" || !Number.isInteger(doc.concurrency) || doc.concurrency < 1) {
      throw new TaskValidationError(`concurrency must be an integer >= 1, received ${doc.concurrency}`);
    }
  }

  if (doc.maxRetries !== undefined) {
    if (typeof doc.maxRetries !== "number" || !Number.isInteger(doc.maxRetries) || doc.maxRetries < 0) {
      throw new TaskValidationError(`maxRetries must be an integer >= 0, received ${doc.maxRetries}`);
    }
  }

  if (doc.provider !== undefined && (typeof doc.provider !== "string" || !doc.provider.trim())) {
    throw new TaskValidationError("provider must be a non-empty string when provided");
  }

  const tasks = doc.tasks.map((taskRaw, index) => {
    if (!taskRaw || typeof taskRaw !== "object") {
      throw new TaskValidationError(`Task at index ${index} must be an object`);
    }
    const t = taskRaw as Partial<AgentTask> & Pick<AgentTask, "id" | "title" | "objective">;
    return createTask(t);
  });

  assertAcyclic(tasks);

  return {
    stage: typeof doc.stage === "number" || typeof doc.stage === "string" ? doc.stage : undefined,
    notes: typeof doc.notes === "string" ? doc.notes : undefined,
    provider: typeof doc.provider === "string" && doc.provider.trim() ? doc.provider.trim() : undefined,
    concurrency: typeof doc.concurrency === "number" ? doc.concurrency : undefined,
    maxRetries: typeof doc.maxRetries === "number" ? doc.maxRetries : undefined,
    tasks,
  };
}

export function validateRunOptions(options: RunOptions): void {
  if (options.maxConcurrentWorkers !== undefined) {
    if (
      typeof options.maxConcurrentWorkers !== "number" ||
      !Number.isInteger(options.maxConcurrentWorkers) ||
      options.maxConcurrentWorkers < 1
    ) {
      throw new TaskValidationError(
        `maxConcurrentWorkers must be an integer >= 1, received ${options.maxConcurrentWorkers}`
      );
    }
  }

  if (options.maxRetries !== undefined) {
    if (
      typeof options.maxRetries !== "number" ||
      !Number.isInteger(options.maxRetries) ||
      options.maxRetries < 0
    ) {
      throw new TaskValidationError(`maxRetries must be an integer >= 0, received ${options.maxRetries}`);
    }
  }
}
