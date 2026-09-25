import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import test from "node:test";
import {
  connectOrStartDaemon,
  isDaemonUnavailableError,
  resolveDaemonSocket,
} from "../src/daemon/client.ts";

test("daemon client resolves relative socket paths against workspace cwd", () => {
  assert.equal(
    resolveDaemonSocket("/tmp/project"),
    "/tmp/project/.pi-many-agents/daemon.sock"
  );
  assert.equal(
    resolveDaemonSocket("/tmp/project", "/tmp/custom.sock"),
    "/tmp/custom.sock"
  );
});

test("daemon client recognizes missing and refused Unix sockets as autostart conditions", () => {
  for (const code of ["ENOENT", "ECONNREFUSED"]) {
    const error = Object.assign(new Error(code), { code });
    assert.equal(isDaemonUnavailableError(error), true);
  }
  assert.equal(isDaemonUnavailableError(Object.assign(new Error("denied"), { code: "EACCES" })), false);
});

test("connectOrStartDaemon starts once when socket is initially unavailable", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-many-daemon-client-"));
  const socketPath = join(cwd, ".pi-many-agents", "daemon.sock");
  let server: Server | undefined;
  let spawnCalls = 0;

  const fakeSpawn = ((..._args: Parameters<typeof spawn>) => {
    spawnCalls += 1;
    const child = new EventEmitter() as ReturnType<typeof spawn>;
    child.unref = (() => child) as ReturnType<typeof spawn>["unref"];

    void (async () => {
      await mkdir(join(cwd, ".pi-many-agents"), { recursive: true });
      server = createServer();
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(socketPath, () => resolve());
      });
    })();

    return child;
  }) as typeof spawn;

  try {
    const connection = await connectOrStartDaemon({
      cwd,
      spawnImpl: fakeSpawn,
      connectTimeoutMs: 100,
      startupTimeoutMs: 2000,
    });

    assert.equal(connection.started, true);
    assert.equal(connection.socketPath, socketPath);
    assert.equal(spawnCalls, 1);
    connection.socket.destroy();
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    await rm(cwd, { recursive: true, force: true });
  }
});
