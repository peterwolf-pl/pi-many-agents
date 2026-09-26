import { createServer, createConnection, type Server, type Socket } from "node:net";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { createOrchestrator, loadConfig } from "../index.ts";
import type { ManyAgentsConfig } from "../config/config.ts";
import type { AgentTask, ProtocolMessage, RunOptions, RunResult } from "../types.ts";
import {
  createStore,
  type Store,
  aggregateUsage,
  aggregateProviderUsage,
} from "./store.ts";
import type {
  RunRecord,
  RunSummary,
  TaskView,
  ProviderStatus,
  DashboardSnapshot,
  RunDetails,
} from "./store.ts";
import {
  JsonLineDecoder,
  parseClientRequest,
  createIpcResponse,
  encodeIpcMessage,
  type IpcClientRequest,
  type IpcResponse,
} from "../protocol/ipc.ts";

export const DEFAULT_SOCKET_PATH = ".pi-many-agents/daemon.sock";
export const DEFAULT_DB_PATH = ".pi-many-agents/state.db";
export const DEFAULT_PID_PATH = ".pi-many-agents/daemon.pid";

export interface DaemonOptions {
  socketPath?: string;
  dbPath?: string;
  pidPath?: string;
  config?: ManyAgentsConfig;
}

interface ActiveRun {
  abortController: AbortController;
  promise: Promise<void>;
}

export class DaemonServer {
  private server?: Server;
  private store: Store;
  private readonly clients = new Set<Socket>();
  private readonly clientDecoders = new Map<Socket, JsonLineDecoder>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly socketPath: string;
  private readonly dbPath: string;
  private readonly pidPath: string;
  private readonly customConfig?: ManyAgentsConfig;
  private running = false;
  private shuttingDown = false;

  constructor(options: DaemonOptions = {}) {
    this.socketPath = options.socketPath ?? DEFAULT_SOCKET_PATH;
    this.dbPath = options.dbPath ?? DEFAULT_DB_PATH;
    this.pidPath = options.pidPath ?? DEFAULT_PID_PATH;
    this.customConfig = options.config;
    this.store = createStore(this.dbPath);
  }

  async start(): Promise<void> {
    await mkdir(dirname(this.socketPath), { recursive: true });

    // Check if another daemon is already actively listening
    if (existsSync(this.socketPath)) {
      const isAlive = await this.probeSocket(this.socketPath);
      if (isAlive) {
        throw new Error(`Daemon is already running on ${this.socketPath}`);
      }
      try {
        await rm(this.socketPath);
      } catch {
        // stale socket removed
      }
    }

    this.server = createServer((socket) => this.handleClient(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.socketPath, () => {
        this.server!.removeListener("error", reject);
        resolve();
      });
    });

    await writeFile(this.pidPath, String(process.pid), "utf8");
    this.setupSignalHandlers();
    this.running = true;
    process.stderr.write(`[daemon] listening on ${this.socketPath} (pid ${process.pid})\n`);
  }

  private probeSocket(path: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const client = createConnection(path);
      client.once("connect", () => {
        client.destroy();
        resolve(true);
      });
      client.once("error", () => {
        resolve(false);
      });
      setTimeout(() => {
        client.destroy();
        resolve(false);
      }, 500);
    });
  }

  private setupSignalHandlers(): void {
    const onSignal = async (sig: string) => {
      if (this.shuttingDown) return;
      this.shuttingDown = true;
      try {
        await this.shutdown();
      } finally {
        process.exit(0);
      }
    };

    process.once("SIGTERM", () => onSignal("SIGTERM"));
    process.once("SIGINT", () => onSignal("SIGINT"));
    process.once("SIGHUP", () => onSignal("SIGHUP"));
  }

  private handleClient(socket: Socket): void {
    this.clients.add(socket);
    const decoder = new JsonLineDecoder();
    this.clientDecoders.set(socket, decoder);

    socket.on("data", (data) => {
      try {
        const lines = decoder.push(data);
        for (const line of lines) {
          this.handleClientLine(socket, line);
        }
      } catch (err) {
        this.send(socket, createIpcResponse("error", undefined, { error: (err as Error).message }));
      }
    });

    const cleanupSocket = () => {
      this.clients.delete(socket);
      this.clientDecoders.delete(socket);
    };

    socket.on("close", cleanupSocket);
    socket.on("error", cleanupSocket);

    // Send ready handshake
    this.send(socket, createIpcResponse("ready"));
  }

  private async handleClientLine(socket: Socket, line: string): Promise<void> {
    let req: IpcClientRequest;
    try {
      req = parseClientRequest(line);
    } catch (err) {
      this.send(socket, createIpcResponse("error", undefined, { error: (err as Error).message }));
      return;
    }

    if (req.type === "status") {
      const status = this.store.getStatus();
      this.send(
        socket,
        createIpcResponse("result", req.requestId, {
          running: this.running,
          activeRuns: this.activeRuns.size,
          ...status,
        })
      );
      return;
    }

    if (req.type === "dashboard.snapshot") {
      const snapshot = this.buildDashboardSnapshot();
      this.send(socket, createIpcResponse("result", req.requestId, snapshot));
      return;
    }

    if (req.type === "run.details") {
      const details = this.buildRunDetails(req.runId);
      this.send(socket, createIpcResponse("result", req.requestId, details));
      return;
    }

    if (req.type === "providers.status") {
      const providers = this.buildProvidersStatus();
      this.send(socket, createIpcResponse("result", req.requestId, { providers }));
      return;
    }

    if (req.type === "abort") {
      if (req.requestId) {
        const active = this.activeRuns.get(req.requestId);
        if (active) {
          active.abortController.abort();
          this.send(socket, createIpcResponse("event", req.requestId, { aborted: true }));
        } else {
          this.send(socket, createIpcResponse("error", req.requestId, { error: `run ${req.requestId} not found` }));
        }
      } else {
        // Abort all active runs
        for (const run of this.activeRuns.values()) {
          run.abortController.abort();
        }
        this.send(socket, createIpcResponse("event", undefined, { abortedAll: true }));
      }
      return;
    }

    if (req.type === "run") {
      const requestId = req.requestId;
      if (this.shuttingDown) {
        this.send(socket, createIpcResponse("error", requestId, { error: "Daemon is shutting down" }));
        return;
      }

      const abortController = new AbortController();
      let resolveRun!: () => void;
      const donePromise = new Promise<void>((r) => {
        resolveRun = r;
      });

      this.activeRuns.set(requestId, { abortController, promise: donePromise });

      try {
        // Record run in store
        this.store.createRun(requestId, { options: req.options, taskCount: req.tasks.length });
        for (const task of req.tasks) {
          this.store.upsertTask(requestId, task, "queued");
        }

        const config = this.customConfig ?? (await loadConfig());
        const orchestrator = createOrchestrator(config, abortController.signal);

        const unsubscribe = orchestrator.bus.onEvent((event: ProtocolMessage) => {
          this.store.appendEvent(event, requestId);
          if (event.taskId) {
            if (event.type === "task.started") {
              this.store.updateTaskState(requestId, event.taskId, "running");
            } else if (event.type === "task.completed") {
              this.store.updateTaskState(requestId, event.taskId, "completed");
            } else if (event.type === "task.failed") {
              this.store.updateTaskState(requestId, event.taskId, "failed");
            } else if (event.type === "task.cancelled") {
              this.store.updateTaskState(requestId, event.taskId, "cancelled");
            }
          }
          this.broadcast(createIpcResponse("event", requestId, event));
        });

        let result: RunResult;
        try {
          result = await orchestrator.run(req.tasks, {
            ...req.options,
            signal: abortController.signal,
          });
        } finally {
          unsubscribe?.();
        }

        for (const report of result.reports) {
          this.store.saveReport(requestId, report);
          const taskState = report.status === "completed" ? "completed" : report.status === "partial" ? "cancelled" : "failed";
          this.store.updateTaskState(requestId, report.taskId, taskState);
        }

        const runState = abortController.signal.aborted
          ? "aborted"
          : result.reports.some((r) => r.status === "failed")
          ? "failed"
          : "completed";
        this.store.updateRunState(requestId, runState);

        this.send(socket, createIpcResponse("result", requestId, result));
      } catch (err) {
        this.store.updateRunState(requestId, "failed");
        const error = err instanceof Error ? err.message : String(err);
        this.send(socket, createIpcResponse("error", requestId, { error }));
      } finally {
        this.activeRuns.delete(requestId);
        resolveRun();
      }
    }
  }

  private send(socket: Socket, resp: IpcResponse): void {
    if (socket.destroyed || !socket.writable) return;
    try {
      socket.write(encodeIpcMessage(resp));
    } catch {
      // ignore broken pipe
    }
  }

  private broadcast(resp: IpcResponse): void {
    for (const client of this.clients) {
      this.send(client, resp);
    }
  }

  private buildDashboardSnapshot(): DashboardSnapshot {
    const status = this.store.getStatus();
    const runsRaw = this.store.listRuns().slice(0, 20);
    const taskViews = this.store.listTaskViews();
    const recentEvents = this.store.listEvents(undefined, 30);

    const runs: RunSummary[] = runsRaw.map((r) => {
      const runTasks = taskViews.filter((t) => t.runId === r.id);
      const counts = { completed: 0, running: 0, failed: 0, queued: 0 };
      for (const t of runTasks) {
        if (t.state in counts) (counts as any)[t.state]++;
        else if (t.state === "cancelled") counts.failed++; // map
      }
      return {
        id: r.id,
        state: r.state,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        taskCount: runTasks.length,
        completed: counts.completed,
        running: counts.running,
        failed: counts.failed,
        queued: counts.queued,
      };
    });

    const allReports = this.store.listReports();
    const globalUsage = aggregateUsage(allReports);
    const providerUsage = aggregateProviderUsage(allReports, taskViews);

    return {
      daemon: {
        running: this.running,
        pid: process.pid,
        lastRefresh: Date.now(),
      },
      runs,
      activeRunCount: this.activeRuns.size,
      taskCounts: status.tasks,
      providers: this.buildProvidersStatus(),
      recentEvents,
      tasks: taskViews,
      usage: globalUsage,
      providerUsage,
    };
  }

  private buildRunDetails(runId: string): RunDetails {
    const run = this.store.getRun(runId);
    const tasks = this.store.listTaskViews(runId);
    const reports = this.store.listReports(runId);
    const events = this.store.listEvents(runId, 50);
    const usage = aggregateUsage(reports);
    return { run, tasks, reports, events, usage };
  }

  private buildProvidersStatus(): ProviderStatus[] {
    // Registered providers from config; no network calls or model exec
    return [
      { name: "pi", model: "pi", status: "registered" },
      { name: "qwen4", model: "qwen4", status: "registered" },
      { name: "mistral", model: "ai/mistral", status: "registered" },
    ];
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.running = false;

    // Abort all active runs and wait for them to finish
    for (const run of this.activeRuns.values()) {
      run.abortController.abort();
    }
    const runningPromises = [...this.activeRuns.values()].map((r) => r.promise);
    await Promise.allSettled(runningPromises);

    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();
    this.clientDecoders.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
    }

    this.store.close();

    try {
      if (existsSync(this.socketPath)) await rm(this.socketPath);
      if (existsSync(this.pidPath)) await rm(this.pidPath);
    } catch {
      // ignore
    }
  }
}

export async function startDaemon(options: DaemonOptions = {}): Promise<void> {
  const daemon = new DaemonServer(options);
  await daemon.start();
  // Keep alive
  await new Promise<void>(() => {});
}
