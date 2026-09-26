import test from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "../src/daemon/server.ts";
import { DEFAULT_CONFIG } from "../src/config/config.ts";
import { JsonLineDecoder, encodeIpcMessage, type IpcResponse } from "../src/protocol/ipc.ts";
import type { RunResult } from "../src/types.ts";

test("P4: fresh directory daemon start -> run pi stub -> result -> shutdown", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-daemon-test-"));
  const socketPath = join(dir, "daemon.sock");
  const dbPath = join(dir, "state.db");
  const pidPath = join(dir, "daemon.pid");
  const mockPiPath = join(process.cwd(), "test/fixtures/mock-pi.js");
  await writeFile(join(dir, ".pi-many-agents.json"), JSON.stringify({ piBinary: mockPiPath, defaultProvider: "pi" }));

  const server = new DaemonServer({
    socketPath,
    dbPath,
    pidPath,
    config: { ...DEFAULT_CONFIG, piBinary: mockPiPath, defaultProvider: "pi" },
  });
  await server.start();

  try {
    const socket = connect(socketPath);
    await new Promise((resolve) => socket.once("connect", resolve));

    const decoder = new JsonLineDecoder();
    const requestId = "req-1";

    const result = await new Promise<RunResult>((resolve, reject) => {
      socket.on("data", (chunk) => {
        for (const line of decoder.push(chunk)) {
          const msg = JSON.parse(line) as IpcResponse;
          if (msg.type === "result" && msg.requestId === requestId) {
            resolve(msg.payload as RunResult);
          } else if (msg.type === "error" && msg.requestId === requestId) {
            reject(new Error(JSON.stringify(msg.payload)));
          }
        }
      });

      // Send run in client format
      socket.write(
        encodeIpcMessage({
          type: "run",
          requestId,
          tasks: [
            {
              id: "t1",
              title: "daemon test task",
              objective: "run inside daemon",
              type: "inspect",
            },
          ],
          options: { provider: "pi" },
        })
      );
    });

    assert.equal(result.reports.length, 1);
    assert.equal(result.reports[0].taskId, "t1");
    assert.equal(result.reports[0].status, "completed");

    socket.destroy();
  } finally {
    await server.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test("P4: second daemon cannot hijack active socket", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-daemon-conflict-"));
  const socketPath = join(dir, "daemon.sock");
  const dbPath = join(dir, "state.db");
  const pidPath = join(dir, "daemon.pid");

  const server1 = new DaemonServer({ socketPath, dbPath, pidPath });
  await server1.start();

  const server2 = new DaemonServer({ socketPath, dbPath, pidPath });
  await assert.rejects(
    () => server2.start(),
    /Daemon is already running/
  );

  await server1.shutdown();
  await rm(dir, { recursive: true, force: true });
});

test("P4: split frames across chunks are decoded correctly", () => {
  const decoder = new JsonLineDecoder();
  const chunk1 = '{"type":"run","req';
  const chunk2 = 'uestId":"123"}\n{"type":"st';
  const chunk3 = 'atus"}\n';

  const lines1 = decoder.push(chunk1);
  assert.equal(lines1.length, 0);

  const lines2 = decoder.push(chunk2);
  assert.equal(lines2.length, 1);
  assert.equal(lines2[0], '{"type":"run","requestId":"123"}');

  const lines3 = decoder.push(chunk3);
  assert.equal(lines3.length, 1);
  assert.equal(lines3[0], '{"type":"status"}');
});

test("P4: abort run A then run B succeeds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-daemon-abort-"));
  const socketPath = join(dir, "daemon.sock");
  const dbPath = join(dir, "state.db");
  const pidPath = join(dir, "daemon.pid");
  const mockPiPath = join(process.cwd(), "test/fixtures/mock-pi.js");
  await writeFile(join(dir, ".pi-many-agents.json"), JSON.stringify({ piBinary: mockPiPath, defaultProvider: "pi" }));

  const server = new DaemonServer({
    socketPath,
    dbPath,
    pidPath,
    config: { ...DEFAULT_CONFIG, piBinary: mockPiPath, defaultProvider: "pi" },
  });
  await server.start();

  try {
    const socket = connect(socketPath);
    await new Promise((resolve) => socket.once("connect", resolve));

    const decoder = new JsonLineDecoder();
    const requestIdA = "req-A";
    const requestIdB = "req-B";

    // Run A has slow/hanging task
    const promiseA = new Promise<RunResult>((resolve) => {
      const handler = (chunk: Buffer) => {
        for (const line of decoder.push(chunk)) {
          const msg = JSON.parse(line) as IpcResponse;
          if (msg.requestId === requestIdA && msg.type === "result") {
            socket.off("data", handler);
            resolve(msg.payload as RunResult);
          }
        }
      };
      socket.on("data", handler);
    });

    socket.write(
      encodeIpcMessage({
        type: "run",
        requestId: requestIdA,
        tasks: [
          {
            id: "slow-A",
            title: "slow",
            objective: "slow",
            type: "inspect",
            context: "sleep:500",
          },
        ],
        options: { provider: "pi" },
      })
    );

    // Abort A
    setTimeout(() => {
      socket.write(encodeIpcMessage({ type: "abort", requestId: requestIdA }));
    }, 20);

    const resultA = await promiseA;
    assert.equal(resultA.reports[0].status, "partial");

    // Now run B should succeed
    const decoderB = new JsonLineDecoder();
    const resultB = await new Promise<RunResult>((resolve) => {
      socket.on("data", (chunk) => {
        for (const line of decoderB.push(chunk)) {
          const msg = JSON.parse(line) as IpcResponse;
          if (msg.requestId === requestIdB && msg.type === "result") {
            resolve(msg.payload as RunResult);
          }
        }
      });
      socket.write(
        encodeIpcMessage({
          type: "run",
          requestId: requestIdB,
          tasks: [
            {
              id: "fast-B",
              title: "fast",
              objective: "fast",
              type: "inspect",
            },
          ],
          options: { provider: "pi" },
        })
      );
    });

    assert.equal(resultB.reports[0].status, "completed");
    socket.destroy();
  } finally {
    await server.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});
