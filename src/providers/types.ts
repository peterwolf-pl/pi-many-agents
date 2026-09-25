import type { AgentReport, AgentTask, ProviderCapabilities, WorkerConfig, WorkerHandle } from "../types.ts";
import type { ManagedProcess } from "../process/process-manager.ts";

export interface ProviderRunResult {
  report: AgentReport;
  process: ManagedProcess;
  handle: WorkerHandle;
}

export interface AgentProvider {
  name: string;
  available(): Promise<boolean>;
  capabilities(): ProviderCapabilities;
  spawn(config: WorkerConfig): Promise<WorkerHandle>;
  execute(worker: WorkerHandle, task: AgentTask): Promise<ProviderRunResult>;
  cancel(worker: WorkerHandle): Promise<void>;
}
