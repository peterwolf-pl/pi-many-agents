import type { AgentTask, ProtocolMessage, RunOptions, RunResult } from "../types.ts";
import { parsePlan } from "../core/plan.ts";

export const IPC_PROTOCOL_VERSION = 1 as const;

export type ClientCommandType = "run" | "abort" | "status";

export interface IpcRunRequest {
  version?: number;
  type: "run";
  requestId: string;
  tasks: AgentTask[];
  options?: RunOptions;
}

export interface IpcAbortRequest {
  version?: number;
  type: "abort";
  requestId?: string;
}

export interface IpcStatusRequest {
  version?: number;
  type: "status";
  requestId?: string;
}

export type IpcClientRequest = IpcRunRequest | IpcAbortRequest | IpcStatusRequest;

export type IpcResponseType = "ready" | "event" | "result" | "error";

export interface IpcResponse {
  version: number;
  type: IpcResponseType;
  requestId?: string;
  payload?: unknown;
}

export class JsonLineDecoder {
  private buffer = "";
  private readonly maxBytes: number;

  constructor(maxBytes = 10 * 1024 * 1024) {
    this.maxBytes = maxBytes;
  }

  push(chunk: Buffer | string): string[] {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    this.buffer += text;
    if (this.buffer.length > this.maxBytes) {
      this.buffer = "";
      throw new Error(`IPC line buffer exceeded ${this.maxBytes} bytes`);
    }
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line) lines.push(line);
    }
    return lines;
  }

  flush(): string[] {
    const remaining = this.buffer.trim();
    this.buffer = "";
    return remaining ? [remaining] : [];
  }
}

export function parseClientRequest(line: string): IpcClientRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("IPC request must be an object");
  }

  const msg = parsed as Record<string, unknown>;
  const type = msg.type;

  if (type === "status") {
    return {
      version: typeof msg.version === "number" ? msg.version : IPC_PROTOCOL_VERSION,
      type: "status",
      requestId: typeof msg.requestId === "string" ? msg.requestId : undefined,
    };
  }

  if (type === "abort") {
    return {
      version: typeof msg.version === "number" ? msg.version : IPC_PROTOCOL_VERSION,
      type: "abort",
      requestId: typeof msg.requestId === "string" ? msg.requestId : undefined,
    };
  }

  if (type === "run") {
    const requestId = typeof msg.requestId === "string" && msg.requestId.trim() ? msg.requestId.trim() : `req-${Date.now()}`;
    if (!("tasks" in msg) || !Array.isArray(msg.tasks)) {
      throw new Error("run request must include a tasks array");
    }
    const parsedPlan = parsePlan({ tasks: msg.tasks, provider: (msg.options as RunOptions)?.provider });
    return {
      version: typeof msg.version === "number" ? msg.version : IPC_PROTOCOL_VERSION,
      type: "run",
      requestId,
      tasks: parsedPlan.tasks,
      options: (msg.options as RunOptions) ?? {},
    };
  }

  throw new Error(`Unknown IPC request type: ${String(type)}`);
}

export function createIpcResponse(
  type: IpcResponseType,
  requestId?: string,
  payload?: unknown
): IpcResponse {
  return {
    version: IPC_PROTOCOL_VERSION,
    type,
    requestId,
    payload,
  };
}

export function encodeIpcMessage(msg: unknown): string {
  return `${JSON.stringify(msg)}\n`;
}
