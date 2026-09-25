export const PROTOCOL_VERSION = 1 as const;

export type TaskType = "inspect" | "code" | "test" | "research" | "review" | "shell" | "other";

export type ReasoningLevel = "none" | "low" | "medium" | "high";

export type WorkerState =
  | "idle"
  | "starting"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type ReportStatus = "completed" | "failed" | "partial";

export interface ModelPolicy {
  provider?: string;
  model?: string;
  reasoning: ReasoningLevel;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface TaskPermissions {
  read: boolean;
  write: boolean;
  shell: boolean;
  network?: boolean;
  git?: boolean;
}

export interface AgentTask {
  id: string;
  title: string;
  objective: string;
  type: TaskType;
  priority: number;
  dependencies: string[];
  workspace?: string;
  context?: string;
  relevantFiles?: string[];
  constraints?: string[];
  expectedOutput?: string;
  modelPolicy: ModelPolicy;
  permissions: TaskPermissions;
}

export interface SuggestedTask {
  title: string;
  objective: string;
  type?: TaskType;
  dependencies?: string[];
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  estimatedCost?: number;
}

export interface AgentReport {
  taskId: string;
  workerId: string;
  status: ReportStatus;
  summary: string;
  findings: string[];
  changes?: { files: string[]; description: string };
  artifacts?: string[];
  warnings?: string[];
  recommendedNextTasks?: SuggestedTask[];
  usage?: Usage;
  durationMs: number;
  error?: string;
}

export interface ExecutionPlan {
  provider: string;
  modelProvider?: string;
  model: string;
  reasoning: ReasoningLevel;
  timeoutMs: number;
  tokenBudget?: number;
}

export type ProtocolEventType =
  | "worker.started"
  | "worker.ready"
  | "worker.failed"
  | "task.started"
  | "task.progress"
  | "task.completed"
  | "task.failed"
  | "task.cancelled"
  | "report.created";

export interface ProtocolMessage {
  version: number;
  type: ProtocolEventType;
  workerId: string;
  taskId?: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface ProviderCapabilities {
  coding: boolean;
  toolUse: boolean;
  filesystem: boolean;
  shell: boolean;
  reasoningLevels: ReasoningLevel[];
  contextWindow?: number;
  tokenUsageReporting: boolean;
  models?: string[];
}

export interface WorkerConfig {
  id: string;
  provider: string;
  model: string;
  workspace?: string;
  timeoutMs: number;
}

export interface WorkerHandle {
  id: string;
  provider: string;
  model: string;
  pid?: number;
  startedAt: number;
}

export interface Worker {
  id: string;
  provider: string;
  model: string;
  state: WorkerState;
  taskId?: string;
  startedAt?: number;
  pid?: number;
  run(task: AgentTask): Promise<AgentReport>;
  cancel(): Promise<void>;
}

export interface RunOptions {
  maxConcurrentWorkers?: number;
  maxRetries?: number;
  provider?: string;
  telemetryPath?: string;
  workspace?: string;
  signal?: AbortSignal;
  dedupe?: boolean;
}

export interface RunResult {
  reports: AgentReport[];
  events: ProtocolMessage[];
  statusText: string;
}
