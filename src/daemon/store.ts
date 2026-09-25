import { DatabaseSync } from "node:sqlite";
import type { AgentReport, AgentTask, ProtocolMessage } from "../types.ts";

export interface Store {
  upsertTask(task: AgentTask): void;
  getTask(id: string): AgentTask | undefined;
  listTasks(): AgentTask[];
  saveReport(report: AgentReport): void;
  listReports(): AgentReport[];
  appendEvent(message: ProtocolMessage): void;
  listEvents(limit?: number): ProtocolMessage[];
  close(): void;
}

interface TaskRow {
  id: string;
  json: string;
}

interface ReportRow {
  task_id: string;
  json: string;
}

interface EventRow {
  id: number;
  json: string;
}

export class SqliteStore implements Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reports (
        task_id TEXT PRIMARY KEY,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        json TEXT NOT NULL
      );
    `);
  }

  upsertTask(task: AgentTask): void {
    const stmt = this.db.prepare("INSERT OR REPLACE INTO tasks (id, json) VALUES (?, ?)");
    stmt.run(task.id, JSON.stringify(task));
  }

  getTask(id: string): AgentTask | undefined {
    const stmt = this.db.prepare("SELECT json FROM tasks WHERE id = ?");
    const row = stmt.get(id) as TaskRow | undefined;
    return row ? JSON.parse(row.json) as AgentTask : undefined;
  }

  listTasks(): AgentTask[] {
    const stmt = this.db.prepare("SELECT json FROM tasks ORDER BY id");
    const rows = stmt.all() as unknown as TaskRow[];
    return rows.map((r) => JSON.parse(r.json) as AgentTask);
  }

  saveReport(report: AgentReport): void {
    const stmt = this.db.prepare("INSERT OR REPLACE INTO reports (task_id, json) VALUES (?, ?)");
    stmt.run(report.taskId, JSON.stringify(report));
  }

  listReports(): AgentReport[] {
    const stmt = this.db.prepare("SELECT json FROM reports ORDER BY task_id");
    const rows = stmt.all() as unknown as ReportRow[];
    return rows.map((r) => JSON.parse(r.json) as AgentReport);
  }

  appendEvent(message: ProtocolMessage): void {
    const stmt = this.db.prepare("INSERT INTO events (json) VALUES (?)");
    stmt.run(JSON.stringify(message));
  }

  listEvents(limit = 1000): ProtocolMessage[] {
    const stmt = this.db.prepare("SELECT json FROM events ORDER BY id DESC LIMIT ?");
    const rows = stmt.all(limit) as unknown as EventRow[];
    return rows.map((r) => JSON.parse(r.json) as ProtocolMessage).reverse();
  }

  close(): void {
    this.db.close();
  }
}

export function createStore(dbPath: string): Store {
  return new SqliteStore(dbPath);
}
