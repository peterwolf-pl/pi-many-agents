import { emitKeypressEvents } from "node:readline";
import { readFile } from "node:fs/promises";
import type { DashboardIpcClient } from "./client.ts";
import { initialState, dashboardReducer, type DashboardState, type DashboardAction } from "./state.ts";
import { render } from "./render.ts";
import { handleKey, type InputResult } from "./input.ts";
import type { DashboardSnapshot } from "../daemon/store.ts";
import { parsePlan, validateRunOptions } from "../core/plan.ts";
import { createTask } from "../core/task.ts";
import type { AgentTask } from "../types.ts";

export interface DashboardAppOptions {
  client: DashboardIpcClient;
  inline?: boolean;
  onExit?: () => void;
}

export class DashboardApp {
  private state: DashboardState;
  private running = false;
  private renderTimer: NodeJS.Timeout | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private stdin: NodeJS.ReadStream;
  private stdout: NodeJS.WriteStream;
  private keyHandler?: (str: string, key: any) => void;
  private lastRender = "";

  private options: DashboardAppOptions;
  constructor(options: DashboardAppOptions) {
    this.options = options;
    this.state = initialState({
      cols: (process.stdout as any).columns ?? 80,
      rows: (process.stdout as any).rows ?? 24,
    });
    this.stdin = process.stdin;
    this.stdout = process.stdout;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // raw mode
    if (this.stdin.isTTY) {
      this.stdin.setRawMode(true);
      emitKeypressEvents(this.stdin);
    }

    this.setupResize();
    this.setupInput();
    this.setupRenderLoop();

    const refreshDebounced = () => {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(async () => {
        if (!this.running) return;
        try {
          const snap = await this.options.client.getSnapshot();
          this.dispatch({ type: "SNAPSHOT", payload: snap });
        } catch {}
      }, 250);
    };

    // attach live event listener for updates without polling only
    this.options.client.addListener((ev) => {
      if (!this.running) return;
      if (ev.type === "event" && ev.payload) {
        this.dispatch({ type: "EVENT", payload: ev.payload });
        refreshDebounced();
      } else if (ev.type === "error") {
        this.dispatch({ type: "ERROR", error: ev.error });
      } else if (ev.type === "connected") {
        this.dispatch({ type: "RECONNECT", status: "online" });
        refreshDebounced();
      } else if (ev.type === "disconnected") {
        this.dispatch({ type: "RECONNECT", status: "offline" });
      }
    });

    // initial connect + snapshot
    try {
      await this.options.client.connect();
      const snap = await this.options.client.getSnapshot();
      this.dispatch({ type: "SNAPSHOT", payload: snap });
    } catch (e) {
      this.dispatch({ type: "ERROR", error: `connect: ${(e as Error).message}` });
      this.dispatch({ type: "RECONNECT", status: "offline" });
    }

    // periodic snapshot drift correction every 5s
    this.snapshotTimer = setInterval(async () => {
      if (!this.running) return;
      try {
        if (this.state.daemon.status !== "online") {
          await this.options.client.connect().catch(() => {});
        }
        const snap = await this.options.client.getSnapshot();
        this.dispatch({ type: "SNAPSHOT", payload: snap });
      } catch {
        this.dispatch({ type: "RECONNECT", status: "offline" });
      }
    }, 5000);

    // initial providers
    this.options.client
      .getProviders()
      .then((p) => this.dispatch({ type: "PROVIDERS", payload: p }))
      .catch(() => {});

    this.render();
  }

  private setupResize(): void {
    const onResize = () => {
      const cols = (this.stdout as any).columns ?? 80;
      const rows = (this.stdout as any).rows ?? 24;
      this.dispatch({ type: "RESIZE", cols, rows });
      this.render();
    };
    this.stdout.on("resize", onResize);
  }

  private setupInput(): void {
    this.keyHandler = (str: string, key: any) => {
      if (!this.running) return;
      const k = key?.name === "up" ? "\u001b[A" : key?.name === "down" ? "\u001b[B" : str ?? "";
      const result = handleKey(this.state, k || str);
      if (result.quit) {
        this.stop();
        return;
      }
      if (result.refresh) {
        this.options.client
          .getSnapshot()
          .then((s) => this.dispatch({ type: "SNAPSHOT", payload: s }))
          .catch((e) => this.dispatch({ type: "ERROR", error: e.message }));
        return;
      }
      if (result.action) {
        this.dispatch(result.action);
      }
      if (result.execute) {
        this.handleExecute(result.execute);
      }
    };
    this.stdin.on("keypress", this.keyHandler);
  }

  private async handleExecute(exec: NonNullable<InputResult["execute"]>): Promise<void> {
    if (exec.type === "abort") {
      try {
        await this.options.client.abortRun(exec.runId);
        this.dispatch({ type: "CLEAR_ERROR" });
        const snap = await this.options.client.getSnapshot();
        this.dispatch({ type: "SNAPSHOT", payload: snap });
      } catch (e) {
        this.dispatch({ type: "ERROR", error: `abort: ${(e as Error).message}` });
      }
    } else if (exec.type === "runPlan") {
      await this.handleNewRun(exec.planPath);
    } else if (exec.type === "details") {
      try {
        const det = await this.options.client.getRunDetails(exec.runId);
        this.dispatch({ type: "DETAILS", runId: exec.runId, payload: det });
      } catch (e) {
        this.dispatch({ type: "ERROR", error: `details: ${(e as Error).message}` });
      }
    }
  }

  private async handleNewRun(planPath?: string): Promise<void> {
    try {
      let tasks: AgentTask[];
      let provider: string | undefined = "fake";
      let maxConcurrentWorkers: number | undefined = 3;
      let maxRetries: number | undefined = 1;

      if (!planPath || planPath.trim() === "") {
        // Built-in demo plan
        tasks = [
          createTask({
            id: "A",
            title: "analyze scheduler",
            objective: "Analyze scheduler implementation.",
            type: "inspect",
            priority: 1,
            permissions: { read: true, write: false, shell: false },
          }),
          createTask({
            id: "B",
            title: "analyze provider",
            objective: "Analyze provider abstraction.",
            type: "review",
            priority: 1,
            permissions: { read: true, write: false, shell: false },
          }),
          createTask({
            id: "C",
            title: "propose tests",
            objective: "Analyze tests and propose missing coverage.",
            type: "test",
            priority: 0,
            dependencies: ["A"],
            permissions: { read: true, write: false, shell: false },
          }),
        ];
      } else {
        const content = await readFile(planPath.trim(), "utf8");
        const plan = parsePlan(content);
        provider = plan.provider;
        maxConcurrentWorkers = plan.concurrency;
        maxRetries = plan.maxRetries;
        validateRunOptions({ maxConcurrentWorkers, maxRetries });
        tasks = plan.tasks as AgentTask[];
      }

      await this.options.client.runPlan(tasks, { provider, maxConcurrentWorkers, maxRetries });
      this.dispatch({ type: "CLEAR_ERROR" });
      const snap = await this.options.client.getSnapshot();
      this.dispatch({ type: "SNAPSHOT", payload: snap });
    } catch (e) {
      this.dispatch({ type: "ERROR", error: `new-run: ${(e as Error).message}` });
      setTimeout(() => this.dispatch({ type: "CLEAR_ERROR" }), 3000);
    }
  }

  private dispatch(action: DashboardAction): void {
    this.state = dashboardReducer(this.state, action);
    this.render();
  }

  private setupRenderLoop(): void {
    this.renderTimer = setInterval(() => {
      if (this.running) this.render();
    }, 1000);
  }

  private render(): void {
    if (!this.running) return;
    const out = render(this.state);
    if (out !== this.lastRender) {
      process.stdout.write("\x1b[H\x1b[2J");
      process.stdout.write(out);
      this.lastRender = out;
    }
  }

  stop(): void {
    this.running = false;
    if (this.renderTimer) clearInterval(this.renderTimer);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.keyHandler) this.stdin.off("keypress", this.keyHandler);
    if (this.stdin.isTTY) {
      try {
        this.stdin.setRawMode(false);
      } catch {}
    }
    process.stdout.write("\x1b[?25h\n");
    this.options.client.close();
    if (this.options.onExit) this.options.onExit();
  }
}
