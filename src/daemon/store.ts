import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentReport, AgentTask, ProtocolMessage } from "../types.ts";

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  estimatedCost?: number;
  costKnown: boolean;
  reportsWithUsage: number;
  reportsTotal: number;
}

export interface ProviderUsageSummary {
  provider: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  estimatedCost?: number;
  reportsWithUsage: number;
  reportsTotal: number;
}

export interface TaskUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
}

export interface RunSummary {
  id: string;
  state: string;
  createdAt: number;
  updatedAt: number;
  taskCount: number;
  completed: number;
  running: number;
  failed: number;
  queued: number;
  usage?: UsageSummary;
  elapsedMs?: number;
  activeWorkers?: number;
}

export interface TaskView {
  id: string;
  title: string;
  state: string;
  runId?: string;
  provider?: string;
  model?: string;
  reasoning?: string;
  durationMs?: number;
  attempts?: number;
  usage?: TaskUsage;
  error?: string;
}

export interface ProviderStatus {
  name: string;
  model: string;
  status: "available" | "unavailable" | "unknown" | "registered";
  reachable?: boolean;
}

export interface DashboardSnapshot {
  daemon: { running: boolean; pid?: number; lastRefresh: number };
  runs: RunSummary[];
  activeRunCount: number;
  taskCounts: StoreStatus["tasks"];
  providers: ProviderStatus[];
  recentEvents: ProtocolMessage[];
  tasks?: TaskView[];
  usage: UsageSummary;
  providerUsage: ProviderUsageSummary[];
}

export interface RunDetails {
  run: RunRecord | undefined;
  tasks: TaskView[];
  reports: AgentReport[];
  events: ProtocolMessage[];
  usage?: UsageSummary;
}

export interface RunRecord {
  id: string;
  state: "running" | "completed" | "failed" | "aborted";
  createdAt: number;
  updatedAt: number;
  metadata?: string;
}

export interface StoreStatus {
  runs: { total: number; active: number };
  tasks: { queued: number; running: number; completed: number; failed: number; cancelled: number };
}

export function aggregateUsage(reports: AgentReport[]): UsageSummary {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let estimatedCost: number | undefined;
  let costKnown = false;
  let reportsWithUsage = 0;

  for (const r of reports) {
    if (r.usage) {
      const hasTokens =
        typeof r.usage.inputTokens === "number" || typeof r.usage.outputTokens === "number";
      if (hasTokens) {
        reportsWithUsage++;
        inputTokens += r.usage.inputTokens ?? 0;
        outputTokens += r.usage.outputTokens ?? 0;
        cachedTokens += r.usage.cachedTokens ?? 0;
      }
      if (typeof r.usage.estimatedCost === "number") {
        costKnown = true;
        estimatedCost = (estimatedCost ?? 0) + r.usage.estimatedCost;
      }
    }
  }

  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost,
    costKnown,
    reportsWithUsage,
    reportsTotal: reports.length,
  };
}

export function aggregateProviderUsage(reports: AgentReport[], tasks: TaskView[]): ProviderUsageSummary[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const groups = new Map<
    string,
    {
      provider: string;
      model?: string;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      estimatedCost?: number;
      reportsWithUsage: number;
      reportsTotal: number;
    }
  >();

  for (const r of reports) {
    const t = taskMap.get(r.taskId);
    const provider = t?.provider ?? "unknown";
    const model = t?.model;
    const key = `${provider}:${model ?? ""}`;

    let g = groups.get(key);
    if (!g) {
      g = {
        provider,
        model,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reportsWithUsage: 0,
        reportsTotal: 0,
      };
      groups.set(key, g);
    }

    g.reportsTotal++;
    if (r.usage) {
      const hasTokens =
        typeof r.usage.inputTokens === "number" || typeof r.usage.outputTokens === "number";
      if (hasTokens) {
        g.reportsWithUsage++;
        g.inputTokens += r.usage.inputTokens ?? 0;
        g.outputTokens += r.usage.outputTokens ?? 0;
        g.cachedTokens += r.usage.cachedTokens ?? 0;
      }
      if (typeof r.usage.estimatedCost === "number") {
        g.estimatedCost = (g.estimatedCost ?? 0) + r.usage.estimatedCost;
      }
    }
  }

  return [...groups.values()].map((g) => ({
    ...g,
    totalTokens: g.inputTokens + g.outputTokens,
  }));
}

export interface Store {
  createRun(runId: string, metadata?: Record<string, unknown>): void;
  updateRunState(runId: string, state: RunRecord["state"]): void;
  getRun(runId: string): RunRecord | undefined;
  listRuns(): RunRecord[];
  getRunSummaries(): RunSummary[];

  upsertTask(runId: string, task: AgentTask, state?: string): void;
  updateTaskState(runId: string, taskId: string, state: string): void;
  getTask(runId: string, id: string): AgentTask | undefined;
  listTasks(runId?: string): AgentTask[];
  listTaskViews(runId?: string): TaskView[];

  saveReport(runId: string, report: AgentReport): void;
  getReport(runId: string, taskId: string): AgentReport | undefined;
  listReports(runId?: string): AgentReport[];

  appendEvent(message: ProtocolMessage, runId?: string): void;
  listEvents(runId?: string, limit?: number): ProtocolMessage[];

  getStatus(): StoreStatus;
  close(): void;
}

interface RunRow {
  id: string;
  state: "running" | "completed" | "failed" | "aborted";
  created_at: number;
  updated_at: number;
  metadata: string | null;
}

interface TaskRow {
  run_id: string;
  id: string;
  state: string;
  json: string;
}

interface ReportRow {
  run_id: string;
  task_id: string;
  status: string;
  json: string;
}

interface EventRow {
  id: number;
  run_id: string | null;
  json: string;
}

export class SqliteStore implements Store {
  private db: DatabaseSync;
  private closed = false;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      );
    `);

    const taskCols = this.db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    if (taskCols.length > 0 && !taskCols.some((col) => col.name === "run_id")) {
      this.db.exec(`
        ALTER TABLE tasks RENAME TO old_tasks;
        CREATE TABLE tasks (
          run_id TEXT NOT NULL,
          id TEXT NOT NULL,
          state TEXT NOT NULL,
          json TEXT NOT NULL,
          PRIMARY KEY (run_id, id)
        );
        INSERT INTO tasks (run_id, id, state, json)
          SELECT 'legacy-run', id, 'completed', json FROM old_tasks;
        DROP TABLE old_tasks;
      `);
    } else {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          run_id TEXT NOT NULL,
          id TEXT NOT NULL,
          state TEXT NOT NULL,
          json TEXT NOT NULL,
          PRIMARY KEY (run_id, id)
        );
      `);
    }

    const reportCols = this.db.prepare("PRAGMA table_info(reports)").all() as Array<{ name: string }>;
    if (reportCols.length > 0 && !reportCols.some((col) => col.name === "run_id")) {
      this.db.exec(`
        ALTER TABLE reports RENAME TO old_reports;
        CREATE TABLE reports (
          run_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          status TEXT NOT NULL,
          json TEXT NOT NULL,
          PRIMARY KEY (run_id, task_id)
        );
        INSERT INTO reports (run_id, task_id, status, json)
          SELECT 'legacy-run', task_id, 'completed', json FROM old_reports;
        DROP TABLE old_reports;
      `);
    } else {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS reports (
          run_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          status TEXT NOT NULL,
          json TEXT NOT NULL,
          PRIMARY KEY (run_id, task_id)
        );
      `);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT,
        json TEXT NOT NULL
      );
    `);

    this.db.exec(`
      UPDATE runs SET state = 'aborted', updated_at = unixepoch() * 1000 WHERE state = 'running';
      UPDATE tasks SET state = 'cancelled' WHERE state IN ('queued', 'running') AND run_id IN (
        SELECT id FROM runs WHERE state = 'aborted'
      );
    `);
  }

  createRun(runId: string, metadata?: Record<string, unknown>): void {
    if (this.closed) return;
    const now = Date.now();
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO runs (id, state, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?)"
    );
    stmt.run(runId, "running", now, now, metadata ? JSON.stringify(metadata) : null);
  }

  updateRunState(runId: string, state: RunRecord["state"]): void {
    if (this.closed) return;
    const now = Date.now();
    const stmt = this.db.prepare("UPDATE runs SET state = ?, updated_at = ? WHERE id = ?");
    stmt.run(state, now, runId);
  }

  getRun(runId: string): RunRecord | undefined {
    if (this.closed) return undefined;
    const stmt = this.db.prepare("SELECT * FROM runs WHERE id = ?");
    const row = stmt.get(runId) as RunRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata ?? undefined,
    };
  }

  listRuns(): RunRecord[] {
    if (this.closed) return [];
    const stmt = this.db.prepare("SELECT * FROM runs ORDER BY created_at DESC");
    const rows = stmt.all() as unknown as RunRow[];
    return rows.map((r) => ({
      id: r.id,
      state: r.state,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      metadata: r.metadata ?? undefined,
    }));
  }

  getRunSummaries(): RunSummary[] {
    if (this.closed) return [];
    const runs = this.listRuns();
    return runs.map((r) => {
      const taskRows = this.db.prepare("SELECT state, COUNT(*) as c FROM tasks WHERE run_id = ? GROUP BY state").all(r.id) as Array<{ state: string; c: number }>;
      const counts: Record<string, number> = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
      let total = 0;
      for (const row of taskRows) {
        counts[row.state] = row.c;
        total += row.c;
      }

      const runReports = this.listReports(r.id);
      const usage = aggregateUsage(runReports);
      const elapsedMs = r.state === "running" ? Date.now() - r.createdAt : Math.max(0, r.updatedAt - r.createdAt);

      return {
        id: r.id,
        state: r.state,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        taskCount: total,
        completed: counts.completed ?? 0,
        running: counts.running ?? 0,
        failed: (counts.failed ?? 0) + (counts.cancelled ?? 0),
        queued: counts.queued ?? 0,
        usage,
        elapsedMs,
        activeWorkers: counts.running ?? 0,
      };
    });
  }

  upsertTask(runId: string, task: AgentTask, state = "queued"): void {
    if (this.closed) return;
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO tasks (run_id, id, state, json) VALUES (?, ?, ?, ?)"
    );
    stmt.run(runId, task.id, state, JSON.stringify(task));
  }

  updateTaskState(runId: string, taskId: string, state: string): void {
    if (this.closed) return;
    const stmt = this.db.prepare("UPDATE tasks SET state = ? WHERE run_id = ? AND id = ?");
    stmt.run(state, runId, taskId);
  }

  getTask(runId: string, id: string): AgentTask | undefined {
    if (this.closed) return undefined;
    const stmt = this.db.prepare("SELECT json FROM tasks WHERE run_id = ? AND id = ?");
    const row = stmt.get(runId, id) as TaskRow | undefined;
    return row ? (JSON.parse(row.json) as AgentTask) : undefined;
  }

  listTasks(runId?: string): AgentTask[] {
    if (this.closed) return [];
    if (runId) {
      const stmt = this.db.prepare("SELECT json FROM tasks WHERE run_id = ? ORDER BY id");
      const rows = stmt.all(runId) as unknown as TaskRow[];
      return rows.map((r) => JSON.parse(r.json) as AgentTask);
    }
    const stmt = this.db.prepare("SELECT json FROM tasks ORDER BY id");
    const rows = stmt.all() as unknown as TaskRow[];
    return rows.map((r) => JSON.parse(r.json) as AgentTask);
  }

  listTaskViews(runId?: string): TaskView[] {
    if (this.closed) return [];
    let rows: TaskRow[];
    if (runId) {
      const stmt = this.db.prepare(
        "SELECT run_id, id, state, json FROM tasks WHERE run_id = ? ORDER BY id"
      );
      rows = stmt.all(runId) as unknown as TaskRow[];
    } else {
      const stmt = this.db.prepare("SELECT run_id, id, state, json FROM tasks ORDER BY id");
      rows = stmt.all() as unknown as TaskRow[];
    }

    // Load reports and events to enrich TaskView
    const reports = this.listReports(runId);
    const reportMap = new Map(reports.map((rep) => [rep.taskId, rep]));

    // Query events to extract runtime plan & attempt counts
    const events = this.listEvents(runId, 500);
    const planMap = new Map<string, { provider?: string; model?: string; reasoning?: string }>();
    const attemptsMap = new Map<string, number>();

    for (const ev of events) {
      if (ev.taskId) {
        if (ev.type === "task.started" && ev.payload?.plan) {
          const plan = ev.payload.plan as { provider?: string; model?: string; reasoning?: string };
          planMap.set(ev.taskId, { provider: plan.provider, model: plan.model, reasoning: plan.reasoning });
        }
        if (ev.type === "task.progress" && (ev.payload?.attempt as number)) {
          attemptsMap.set(ev.taskId, Math.max(attemptsMap.get(ev.taskId) ?? 1, ev.payload.attempt as number));
        }
      }
    }

    return rows.map((r) => {
      let task: Partial<AgentTask> = {};
      try {
        task = JSON.parse(r.json);
      } catch {}
      const mp = task.modelPolicy ?? {};
      const rep = reportMap.get(r.id);
      const runtimePlan = planMap.get(r.id);

      const taskUsage: TaskUsage | undefined = rep?.usage
        ? {
            inputTokens: rep.usage.inputTokens,
            outputTokens: rep.usage.outputTokens,
            cachedTokens: rep.usage.cachedTokens,
            totalTokens: (rep.usage.inputTokens ?? 0) + (rep.usage.outputTokens ?? 0),
            estimatedCost: rep.usage.estimatedCost,
          }
        : undefined;

      return {
        id: r.id,
        title: task.title ?? r.id,
        state: r.state,
        runId: r.run_id,
        provider: runtimePlan?.provider ?? mp.provider,
        model: runtimePlan?.model ?? mp.model,
        reasoning: runtimePlan?.reasoning ?? mp.reasoning,
        durationMs: rep?.durationMs,
        attempts: attemptsMap.get(r.id) ?? (r.state === "completed" || r.state === "failed" ? 1 : undefined),
        usage: taskUsage,
        error: rep?.error,
      };
    });
  }

  saveReport(runId: string, report: AgentReport): void {
    if (this.closed) return;
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO reports (run_id, task_id, status, json) VALUES (?, ?, ?, ?)"
    );
    stmt.run(runId, report.taskId, report.status, JSON.stringify(report));
  }

  getReport(runId: string, taskId: string): AgentReport | undefined {
    if (this.closed) return undefined;
    const stmt = this.db.prepare("SELECT json FROM reports WHERE run_id = ? AND task_id = ?");
    const row = stmt.get(runId, taskId) as ReportRow | undefined;
    return row ? (JSON.parse(row.json) as AgentReport) : undefined;
  }

  listReports(runId?: string): AgentReport[] {
    if (this.closed) return [];
    if (runId) {
      const stmt = this.db.prepare("SELECT json FROM reports WHERE run_id = ? ORDER BY task_id");
      const rows = stmt.all(runId) as unknown as ReportRow[];
      return rows.map((r) => JSON.parse(r.json) as AgentReport);
    }
    const stmt = this.db.prepare("SELECT json FROM reports ORDER BY task_id");
    const rows = stmt.all() as unknown as ReportRow[];
    return rows.map((r) => JSON.parse(r.json) as AgentReport);
  }

  appendEvent(message: ProtocolMessage, runId?: string): void {
    if (this.closed) return;
    const stmt = this.db.prepare("INSERT INTO events (run_id, json) VALUES (?, ?)");
    stmt.run(runId ?? null, JSON.stringify(message));
  }

  listEvents(runId?: string, limit = 1000): ProtocolMessage[] {
    if (this.closed) return [];
    if (runId) {
      const stmt = this.db.prepare("SELECT json FROM events WHERE run_id = ? ORDER BY id DESC LIMIT ?");
      const rows = stmt.all(runId, limit) as unknown as EventRow[];
      return rows.map((r) => JSON.parse(r.json) as ProtocolMessage).reverse();
    }
    const stmt = this.db.prepare("SELECT json FROM events ORDER BY id DESC LIMIT ?");
    const rows = stmt.all(limit) as unknown as EventRow[];
    return rows.map((r) => JSON.parse(r.json) as ProtocolMessage).reverse();
  }

  getStatus(): StoreStatus {
    if (this.closed) {
      return {
        runs: { total: 0, active: 0 },
        tasks: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 },
      };
    }

    const runsTotal = (this.db.prepare("SELECT COUNT(*) as c FROM runs").get() as { c: number }).c;
    const runsActive = (
      this.db.prepare("SELECT COUNT(*) as c FROM runs WHERE state = 'running'").get() as { c: number }
    ).c;

    const taskCounts = this.db.prepare("SELECT state, COUNT(*) as c FROM tasks GROUP BY state").all() as Array<{
      state: string;
      c: number;
    }>;

    const counts: Record<string, number> = { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const row of taskCounts) {
      counts[row.state] = row.c;
    }

    return {
      runs: { total: runsTotal, active: runsActive },
      tasks: {
        queued: counts.queued ?? 0,
        running: counts.running ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        cancelled: counts.cancelled ?? 0,
      },
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

export function createStore(dbPath: string): Store {
  return new SqliteStore(dbPath);
}
