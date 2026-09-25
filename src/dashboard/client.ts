import { connect, type Socket } from "node:net";
import { JsonLineDecoder, encodeIpcMessage, type IpcResponse } from "../protocol/ipc.ts";
import type { DashboardSnapshot, RunDetails, ProviderStatus } from "../daemon/store.ts";

export interface DashboardClientOptions {
  socketPath: string;
  connectTimeoutMs?: number;
  reconnectBaseMs?: number;
  maxReconnectMs?: number;
}

export type DashboardEvent =
  | { type: "snapshot"; payload: DashboardSnapshot }
  | { type: "details"; runId: string; payload: RunDetails }
  | { type: "providers"; payload: { providers: ProviderStatus[] } }
  | { type: "event"; requestId?: string; payload: unknown }
  | { type: "error"; error: string; requestId?: string }
  | { type: "connected" }
  | { type: "disconnected" };

export class DashboardIpcClient {
  private socket: Socket | null = null;
  private decoder = new JsonLineDecoder();
  private requestId = 0;
  private pending = new Map<string, (resp: IpcResponse) => void>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoff = 0;
  private connected = false;

  private options: DashboardClientOptions;
  private listeners: Set<(ev: DashboardEvent) => void> = new Set();

  constructor(options: DashboardClientOptions, onEvent?: (ev: DashboardEvent) => void) {
    this.options = options;
    if (onEvent) {
      this.listeners.add(onEvent);
    }
  }

  addListener(listener: (ev: DashboardEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitEvent(ev: DashboardEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(ev);
      } catch {}
    }
  }

  async connect(): Promise<void> {
    if (this.socket) return;
    const timeout = this.options.connectTimeoutMs ?? 1500;
    return new Promise((resolve, reject) => {
      const sock = connect(this.options.socketPath);
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          sock.destroy();
          reject(new Error("connect timeout"));
        }
      }, timeout);

      sock.once("connect", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.socket = sock;
        this.connected = true;
        this.backoff = 0;
        this.setupSocket(sock);
        this.emitEvent({ type: "connected" });
        resolve();
      });

      sock.once("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private setupSocket(sock: Socket): void {
    sock.on("data", (data) => {
      try {
        const lines = this.decoder.push(data);
        for (const line of lines) {
          this.handleLine(line);
        }
      } catch (e) {
        this.emitEvent({ type: "error", error: (e as Error).message });
      }
    });

    sock.on("close", () => {
      this.connected = false;
      this.socket = null;
      this.emitEvent({ type: "disconnected" });
      this.scheduleReconnect();
    });

    sock.on("error", (err) => {
      this.emitEvent({ type: "error", error: err.message });
    });
  }

  private handleLine(line: string): void {
    let resp: IpcResponse;
    try {
      resp = JSON.parse(line) as IpcResponse;
    } catch {
      return;
    }
    if (resp.requestId && this.pending.has(resp.requestId)) {
      const cb = this.pending.get(resp.requestId)!;
      this.pending.delete(resp.requestId);
      cb(resp);
      return;
    }
    if (resp.type === "event") {
      this.emitEvent({ type: "event", requestId: resp.requestId, payload: resp.payload });
    } else if (resp.type === "error") {
      this.emitEvent({ type: "error", error: String((resp.payload as any)?.error ?? "unknown"), requestId: resp.requestId });
    } else if (resp.type === "result" && resp.payload) {
      // could be snapshot etc, but handled via request cb
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const base = this.options.reconnectBaseMs ?? 1000;
    const max = this.options.maxReconnectMs ?? 10000;
    const delay = Math.min(base * Math.pow(2, this.backoff), max);
    this.backoff = Math.min(this.backoff + 1, 5);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // will schedule again on fail
        this.scheduleReconnect();
      });
    }, delay);
  }

  async request<T = unknown>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (!this.socket || !this.connected) throw new Error("not connected");
    const rid = `dash-${++this.requestId}`;
    const req = { version: 1, type, requestId: rid, ...payload };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(new Error("request timeout"));
      }, 5000);
      this.pending.set(rid, (resp) => {
        clearTimeout(timer);
        if (resp.type === "error") {
          reject(new Error(String((resp.payload as any)?.error ?? "ipc error")));
        } else {
          resolve(resp.payload as T);
        }
      });
      try {
        this.socket!.write(encodeIpcMessage(req));
      } catch (e) {
        this.pending.delete(rid);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  async getSnapshot(): Promise<DashboardSnapshot> {
    return this.request<DashboardSnapshot>("dashboard.snapshot");
  }

  async getRunDetails(runId: string): Promise<RunDetails> {
    return this.request<RunDetails>("run.details", { runId });
  }

  async getProviders(): Promise<{ providers: ProviderStatus[] }> {
    return this.request("providers.status");
  }

  async runPlan(tasks: unknown[], options?: unknown, requestId?: string): Promise<unknown> {
    return this.request("run", { tasks, options, requestId });
  }

  async abortRun(requestId?: string): Promise<unknown> {
    return this.request("abort", { requestId });
  }

  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }
}
