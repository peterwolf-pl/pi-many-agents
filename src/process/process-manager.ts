import { spawn, type ChildProcess } from "node:child_process";
import { parseMessageLine } from "../protocol/messages.ts";
import type { ProtocolMessage } from "../types.ts";

export interface ManagedProcess {
  pid?: number;
  stdout: string;
  stderr: string;
  events: ProtocolMessage[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
}

export interface SpawnSpec {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export class ProcessManager {
  private readonly children = new Set<ChildProcess>();

  async run(spec: SpawnSpec): Promise<ManagedProcess> {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    this.children.add(child);
    const result: ManagedProcess = {
      pid: child.pid,
      stdout: "",
      stderr: "",
      events: [],
      exitCode: null,
      signal: null,
      timedOut: false,
      cancelled: false,
    };
    let buffer = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      result.stdout += chunk;
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const message = parseMessageLine(line);
        if (message) result.events.push(message);
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      result.stderr += chunk;
    });

    const timer = setTimeout(() => {
      result.timedOut = true;
      this.kill(child);
    }, spec.timeoutMs);
    const onAbort = () => {
      result.cancelled = true;
      this.kill(child);
    };
    spec.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          result.exitCode = code;
          result.signal = signal;
          resolve();
        });
      });
    } finally {
      clearTimeout(timer);
      spec.signal?.removeEventListener("abort", onAbort);
      this.children.delete(child);
      if (buffer.trim()) {
        const message = parseMessageLine(buffer);
        if (message) result.events.push(message);
      }
    }
    return result;
  }

  signal(child: ChildProcess, signal: NodeJS.Signals): void {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        process.kill(child.pid, signal);
      } catch {
        // already gone
      }
    }
  }

  kill(child: ChildProcess): void {
    this.signal(child, "SIGTERM");
    const timer = setTimeout(() => {
      if (child.exitCode === null) this.signal(child, "SIGKILL");
    }, 500);
    timer.unref();
  }

  async cleanup(): Promise<void> {
    const pending = [...this.children];
    for (const child of pending) this.kill(child);
    await Promise.all(pending.map((child) => child.exitCode !== null ? undefined : new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    })));
    for (const child of pending) this.children.delete(child);
  }
}
