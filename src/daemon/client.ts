import { spawn, type ChildProcess } from "node:child_process";
import { connect, type Socket } from "node:net";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SOCKET_PATH } from "./server.ts";

export interface ConnectOrStartDaemonOptions {
  cwd: string;
  socketPath?: string;
  connectTimeoutMs?: number;
  startupTimeoutMs?: number;
  spawnImpl?: typeof spawn;
}

export interface DaemonConnection {
  socket: Socket;
  socketPath: string;
  started: boolean;
}

export function resolveDaemonSocket(cwd: string, socketPath = DEFAULT_SOCKET_PATH): string {
  return isAbsolute(socketPath) ? socketPath : resolve(cwd, socketPath);
}

export function isDaemonUnavailableError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ECONNREFUSED" || code === "EINVAL" || code === "EADDRINUSE";
}

export function connectDaemon(socketPath: string, timeoutMs = 1500): Promise<Socket> {
  return new Promise((resolveSocket, reject) => {
    const socket = connect(socketPath);
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("error", onError);
      if (error) {
        socket.destroy();
        reject(error);
      } else {
        resolveSocket(socket);
      }
    };

    const onConnect = () => finish();
    const onError = (error: Error) => finish(error);
    const timer = setTimeout(() => {
      const error = new Error(`Connection to daemon at ${socketPath} timed out after ${timeoutMs}ms`);
      (error as NodeJS.ErrnoException).code = "ETIMEDOUT";
      finish(error);
    }, timeoutMs);

    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

export function startDaemonDetached(cwd: string, spawnImpl: typeof spawn = spawn): ChildProcess {
  const cliEntry = fileURLToPath(new URL("../cli/main.ts", import.meta.url));
  const child = spawnImpl(
    process.execPath,
    ["--experimental-strip-types", cliEntry, "daemon"],
    {
      cwd,
      detached: true,
      stdio: "ignore",
      env: process.env,
    }
  );
  child.unref();
  return child;
}

export async function connectOrStartDaemon(options: ConnectOrStartDaemonOptions): Promise<DaemonConnection> {
  const socketPath = resolveDaemonSocket(options.cwd, options.socketPath);
  const connectTimeoutMs = options.connectTimeoutMs ?? 1200;

  try {
    const socket = await connectDaemon(socketPath, connectTimeoutMs);
    return { socket, socketPath, started: false };
  } catch (error) {
    if (!isDaemonUnavailableError(error)) throw error;
  }

  const child = startDaemonDetached(options.cwd, options.spawnImpl ?? spawn);
  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });

  const startupTimeoutMs = options.startupTimeoutMs ?? 5000;
  const deadline = Date.now() + startupTimeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (spawnError) {
      throw new Error(`Failed to start pi-many-agents daemon: ${spawnError.message}`);
    }

    try {
      const socket = await connectDaemon(socketPath, Math.min(connectTimeoutMs, 500));
      return { socket, socketPath, started: true };
    } catch (error) {
      lastError = error;
      if (!isDaemonUnavailableError(error) && (error as NodeJS.ErrnoException | undefined)?.code !== "ETIMEDOUT") {
        throw error;
      }
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }

  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`Daemon did not become ready at ${socketPath} within ${startupTimeoutMs}ms${detail}`);
}
