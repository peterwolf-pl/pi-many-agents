import { createServer, type Server, type Socket } from "node:net";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { createOrchestrator, loadConfig } from "../index.ts";
import type { AgentTask, ProtocolMessage, RunOptions, RunResult } from "../types.ts";
import { createStore, type Store } from "./store.ts";
import { encodeMessage, parseMessageLine } from "../protocol/messages.ts";

const SOCKET_PATH = ".pi-many-agents/daemon.sock";
const DB_PATH = ".pi-many-agents/state.db";
const PID_PATH = ".pi-many-agents/daemon.pid";

interface DaemonMessage {
  type: "run" | "abort" | "status";
  tasks?: AgentTask[];
  options?: RunOptions;
  requestId?: string;
}

interface DaemonResponse {
  type: "event" | "result" | "error" | "ready";
  requestId?: string;
  payload?: unknown;
}

export class DaemonServer {
  private server?: Server;
  private store: Store;
  private clients = new Set<Socket>();
  private abortController = new AbortController();
  private running = false;

  constructor() {
    this.store = createStore(DB_PATH);
  }

  async start(): Promise<void> {
    await mkdir(dirname(SOCKET_PATH), { recursive: true });
    try {
      await rm(SOCKET_PATH);
    } catch {
      // ignore if not exists
    }

    this.server = createServer((socket) => this.handleClient(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(SOCKET_PATH, () => {
        this.server!.removeListener("error", reject);
        resolve();
      });
    });

    // write pid
    const { writeFile } = await import("node:fs/promises");
    await writeFile(PID_PATH, String(process.pid));

    this.setupSignalHandlers();
    this.running = true;
    console.error(`[daemon] listening on ${SOCKET_PATH}`);
  }

  private setupSignalHandlers(): void {
    const escalate = async (signal: string) => {
      console.error(`[daemon] received ${signal}, escalating`);
      this.abortController.abort();
      // cancel workers if possible via manager, but here we use signal
      if (signal === "SIGTERM") {
        setTimeout(() => {
          console.error("[daemon] escalating to SIGKILL");
          process.kill(0, "SIGKILL"); // process group
        }, 2000);
      }
      await this.shutdown();
    };

    process.on("SIGTERM", () => escalate("SIGTERM"));
    process.on("SIGINT", () => escalate("SIGINT"));
    process.on("SIGHUP", () => escalate("SIGHUP"));
  }

  private handleClient(socket: Socket): void {
    this.clients.add(socket);
    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString();
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        this.handleMessage(socket, line);
      }
    });

    socket.on("close", () => {
      this.clients.delete(socket);
    });

    socket.on("error", () => {
      this.clients.delete(socket);
    });

    // send ready
    this.send(socket, { type: "ready" });
  }

  private async handleMessage(socket: Socket, line: string): Promise<void> {
    const msg = parseMessageLine(line) as unknown as DaemonMessage | undefined;
    if (!msg || typeof msg !== "object") {
      this.send(socket, { type: "error", payload: { error: "invalid message" } });
      return;
    }

    if (msg.type === "run" && msg.tasks) {
      const requestId = msg.requestId ?? `req-${Date.now()}`;
      try {
        const config = await loadConfig();
        const orchestrator = createOrchestrator(config, this.abortController.signal);
        // attach bus to forward events
        const unsubscribe = orchestrator.bus.onEvent((event: ProtocolMessage) => {
          this.store.appendEvent(event);
          this.broadcast({ type: "event", requestId, payload: event });
        });
        const result: RunResult = await orchestrator.run(msg.tasks, {
          ...msg.options,
          signal: this.abortController.signal,
        });
        unsubscribe?.();
        for (const report of result.reports) {
          this.store.saveReport(report);
        }
        this.send(socket, { type: "result", requestId, payload: result });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.send(socket, { type: "error", requestId, payload: { error } });
      }
    } else if (msg.type === "abort") {
      this.abortController.abort();
      this.send(socket, { type: "event", payload: { aborted: true } });
    } else if (msg.type === "status") {
      this.send(socket, { type: "result", payload: { running: this.running, tasks: this.store.listTasks().length } });
    }
  }

  private send(socket: Socket, resp: DaemonResponse): void {
    try {
      socket.write(JSON.stringify(resp) + "\n");
    } catch {
      // ignore
    }
  }

  private broadcast(resp: DaemonResponse): void {
    for (const client of this.clients) {
      this.send(client, resp);
    }
  }

  async shutdown(): Promise<void> {
    this.running = false;
    this.abortController.abort();
    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();
    if (this.server) {
      await new Promise<void>((r) => this.server!.close(() => r()));
    }
    this.store.close();
    try {
      await rm(SOCKET_PATH);
      await rm(PID_PATH);
    } catch {
      // ignore
    }
  }
}

export async function startDaemon(): Promise<void> {
  const daemon = new DaemonServer();
  await daemon.start();
  // keep alive
  await new Promise(() => {});
}
