import { PROTOCOL_VERSION, type ProtocolEventType, type ProtocolMessage } from "../types.ts";

export function createMessage(
  type: ProtocolEventType,
  workerId: string,
  payload: Record<string, unknown> = {},
  taskId?: string,
  timestamp = Date.now(),
): ProtocolMessage {
  return { version: PROTOCOL_VERSION, type, workerId, taskId, timestamp, payload };
}

export function encodeMessage(message: ProtocolMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseMessageLine(line: string): ProtocolMessage | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<ProtocolMessage>;
  if (record.version !== PROTOCOL_VERSION || typeof record.type !== "string" || typeof record.workerId !== "string") {
    return undefined;
  }
  if (typeof record.timestamp !== "number" || !record.payload || typeof record.payload !== "object") return undefined;
  return record as ProtocolMessage;
}
