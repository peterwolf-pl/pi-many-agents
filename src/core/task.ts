import type { AgentTask, ReasoningLevel, TaskPermissions, TaskType } from "../types.ts";

export class TaskValidationError extends Error {}

const TYPES = new Set<TaskType>(["inspect", "code", "test", "research", "review", "shell", "other"]);
const REASONING = new Set<ReasoningLevel>(["none", "low", "medium", "high"]);

export function createTask(input: Partial<AgentTask> & Pick<AgentTask, "id" | "title" | "objective">): AgentTask {
  const type = input.type ?? "other";
  if (!TYPES.has(type)) throw new TaskValidationError(`invalid task type: ${String(type)}`);
  const reasoning = input.modelPolicy?.reasoning;
  if (reasoning !== undefined && !REASONING.has(reasoning)) {
    throw new TaskValidationError(`invalid reasoning: ${String(reasoning)}`);
  }
  if (!input.id || !input.id.trim() || !input.title || !input.title.trim() || !input.objective || !input.objective.trim()) {
    throw new TaskValidationError("task id, title, and objective are required");
  }
  if (input.priority !== undefined && (!Number.isFinite(input.priority) || Number.isNaN(input.priority))) {
    throw new TaskValidationError(`invalid priority: ${String(input.priority)}`);
  }
  if (input.modelPolicy?.timeoutMs !== undefined && (typeof input.modelPolicy.timeoutMs !== "number" || input.modelPolicy.timeoutMs <= 0 || !Number.isFinite(input.modelPolicy.timeoutMs))) {
    throw new TaskValidationError(`invalid timeoutMs: ${String(input.modelPolicy.timeoutMs)}`);
  }
  if (input.modelPolicy?.maxTokens !== undefined && (typeof input.modelPolicy.maxTokens !== "number" || input.modelPolicy.maxTokens <= 0 || !Number.isFinite(input.modelPolicy.maxTokens))) {
    throw new TaskValidationError(`invalid maxTokens: ${String(input.modelPolicy.maxTokens)}`);
  }
  const permissions: TaskPermissions = {
    read: input.permissions?.read ?? true,
    write: input.permissions?.write ?? false,
    shell: input.permissions?.shell ?? false,
    network: input.permissions?.network ?? false,
    git: input.permissions?.git ?? false,
  };
  return {
    id: input.id,
    title: input.title,
    objective: input.objective,
    type,
    priority: input.priority ?? 0,
    dependencies: [...(input.dependencies ?? [])],
    workspace: input.workspace,
    context: input.context,
    relevantFiles: input.relevantFiles ? [...input.relevantFiles] : undefined,
    constraints: input.constraints ? [...input.constraints] : undefined,
    expectedOutput: input.expectedOutput,
    modelPolicy: {
      provider: input.modelPolicy?.provider,
      model: input.modelPolicy?.model,
      reasoning,
      maxTokens: input.modelPolicy?.maxTokens,
      timeoutMs: input.modelPolicy?.timeoutMs,
    },
    permissions,
  };
}

export function assertAcyclic(tasks: AgentTask[]): void {
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) throw new TaskValidationError("duplicate task id");
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new TaskValidationError(`dependency cycle at ${id}`);
    visiting.add(id);
    const task = byId.get(id);
    if (!task) throw new TaskValidationError(`unknown dependency ${id}`);
    for (const dep of task.dependencies) {
      if (!ids.has(dep)) throw new TaskValidationError(`task ${id} depends on missing ${dep}`);
      visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}

export function renderTaskPacket(task: AgentTask): string {
  const permissions = [
    task.permissions.read ? "read" : undefined,
    task.permissions.write ? "workspace-write" : undefined,
    task.permissions.shell ? "shell" : undefined,
    task.permissions.network ? "network" : undefined,
    task.permissions.git ? "git" : undefined,
  ].filter(Boolean);
  return [
    "TASK PACKET",
    "",
    `Task: ${task.id}`,
    `Title: ${task.title}`,
    `Type: ${task.type}`,
    "",
    "Objective:",
    task.objective,
    "",
    "Relevant files:",
    task.relevantFiles?.join("\n") || "(none)",
    "",
    "Relevant context:",
    task.context || "(none)",
    "",
    "Constraints:",
    task.constraints?.map((item) => `- ${item}`).join("\n") || "- Do not modify Pi core.",
    "",
    "Expected output:",
    task.expectedOutput || "A compact structured report with summary and findings.",
    "",
    `Permissions: ${permissions.join(", ") || "none"}`,
    `Reasoning: ${task.modelPolicy.reasoning ?? "low"}`,
    "",
    "End your final answer with a json fenced AgentReport containing status, summary, and findings.",
    "Do not include secrets or the parent conversation.",
  ].join("\n");
}
