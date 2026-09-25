import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import type { Socket } from "node:net";
import type { RunResult } from "../src/types.ts";
import { parsePlan } from "../src/core/plan.ts";
import { connectOrStartDaemon } from "../src/daemon/client.ts";
import {
  JsonLineDecoder,
  encodeIpcMessage,
  type IpcResponse,
} from "../src/protocol/ipc.ts";

let activeSocket: Socket | undefined;
let activeAbort: AbortController | undefined;
let activeRequestId: string | undefined;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("many", {
    description: "Run isolated pi-many-agents workers from a plan JSON path (via daemon)",
    handler: async (args, ctx) => {
      const planPath = args.trim();
      if (!planPath) {
        ctx.ui.notify("Usage: /many plans/stage-2.json", "warning");
        return;
      }

      activeAbort?.abort();
      activeAbort = new AbortController();
      activeSocket?.destroy();

      try {
        const fileContent = await readFile(planPath, "utf8");
        const parsedPlan = parsePlan(fileContent);

        // Adjust workspace to cwd for each task if not explicitly set
        const tasks = parsedPlan.tasks.map((task) => ({
          ...task,
          workspace: task.workspace ?? ctx.cwd,
        }));

        if (ctx.hasUI) ctx.ui.setStatus("many", "pi-many-agents connecting");
        const daemon = await connectOrStartDaemon({ cwd: ctx.cwd });
        const socket = daemon.socket;
        activeSocket = socket;
        if (ctx.hasUI) {
          ctx.ui.setStatus("many", daemon.started ? "pi-many-agents daemon started" : "pi-many-agents attached");
        }

        const requestId = `many-${Date.now()}`;
        activeRequestId = requestId;

        const decoder = new JsonLineDecoder();

        const result = await new Promise<RunResult>((resolve, reject) => {
          const onData = (chunk: Buffer) => {
            try {
              const lines = decoder.push(chunk);
              for (const line of lines) {
                const msg = JSON.parse(line) as IpcResponse;
                if (msg.requestId && msg.requestId !== requestId) continue;
                if (msg.type === "result" && msg.payload) {
                  cleanup();
                  resolve(msg.payload as RunResult);
                  return;
                }
                if (msg.type === "error") {
                  cleanup();
                  const errPayload = msg.payload as { error?: string } | undefined;
                  reject(new Error(errPayload?.error ?? "daemon error"));
                  return;
                }
              }
            } catch (err) {
              cleanup();
              reject(err);
            }
          };

          const onClose = () => {
            cleanup();
            reject(new Error("Daemon socket closed unexpectedly"));
          };

          const onError = (err: Error) => {
            cleanup();
            reject(err);
          };

          const onAbort = () => {
            try {
              socket.write(encodeIpcMessage({ type: "abort", requestId }));
            } catch {
              // ignore
            }
            cleanup();
            reject(new Error("Execution cancelled by user"));
          };

          const cleanup = () => {
            socket.off("data", onData);
            socket.off("close", onClose);
            socket.off("error", onError);
            activeAbort?.signal.removeEventListener("abort", onAbort);
          };

          socket.on("data", onData);
          socket.on("close", onClose);
          socket.on("error", onError);
          activeAbort?.signal.addEventListener("abort", onAbort, { once: true });

          // Send run command
          socket.write(
            encodeIpcMessage({
              type: "run",
              requestId,
              tasks,
              options: {
                provider: parsedPlan.provider ?? "fake",
                workspace: ctx.cwd,
                maxConcurrentWorkers: parsedPlan.concurrency,
                maxRetries: parsedPlan.maxRetries,
              },
            })
          );
        });

        if (ctx.hasUI) ctx.ui.setStatus("many", undefined);

        const compact = result.reports
          .map((report) => {
            const findings = report.findings?.slice(0, 3).map((item) => `- ${item}`).join("\n") ?? "";
            return `#${report.taskId} ${report.status}: ${report.summary}${findings ? `\n${findings}` : ""}`;
          })
          .join("\n");

        ctx.ui.notify(`pi-many-agents finished ${result.reports.length} tasks`, "info");
        pi.sendMessage({
          customType: "pi-many-agents",
          content: `Worker reports:\n${compact}`,
          display: true,
        });
      } catch (error) {
        if (ctx.hasUI) ctx.ui.setStatus("many", undefined);
        ctx.ui.notify(error instanceof Error ? error.message : "pi-many-agents execution failed", "error");
      } finally {
        activeSocket?.destroy();
        activeSocket = undefined;
        activeAbort = undefined;
        activeRequestId = undefined;
      }
    },
  });

  pi.on("session_shutdown", async () => {
    if (activeSocket && !activeSocket.destroyed) {
      try {
        if (activeRequestId) {
          activeSocket.write(encodeIpcMessage({ type: "abort", requestId: activeRequestId }));
        }
      } catch {
        // ignore
      }
      activeSocket.destroy();
    }
    activeAbort?.abort();
    activeSocket = undefined;
    activeAbort = undefined;
    activeRequestId = undefined;
  });
}
