import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import type { AgentTask, ProtocolMessage, RunResult } from "../src/types.ts";
import { createTask } from "../src/core/task.ts";
import { encodeMessage } from "../src/protocol/messages.ts";

const SOCKET_PATH = ".pi-many-agents/daemon.sock";

let activeSocket: Socket | undefined;
let activeAbort: AbortController | undefined;

function attachDaemon(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = connect(SOCKET_PATH, () => resolve(sock));
    sock.on("error", reject);
  });
}

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
        const raw = JSON.parse(await readFile(planPath, "utf8")) as {
          tasks: Array<Partial<AgentTask> & Pick<AgentTask, "id" | "title" | "objective">>;
          provider?: string;
        };
        const tasks = raw.tasks.map((task) => createTask({ ...task, workspace: task.workspace ?? ctx.cwd }));
        const socket = await attachDaemon();
        activeSocket = socket;
        if (ctx.hasUI) ctx.ui.setStatus("many", "pi-many-agents attached");

        const reports: RunResult["reports"] = [];
        let finished = false;

        const send = (obj: unknown) => {
          socket.write(JSON.stringify(obj) + "\n");
        };

        const onData = (data: Buffer) => {
          const lines = data.toString().split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const msg = JSON.parse(line);
              if (msg.type === "event" && msg.payload) {
                const ev = msg.payload as ProtocolMessage;
                if (ev.type === "report.created") {
                  // reports come via result too
                }
              } else if (msg.type === "result" && msg.payload) {
                const res = msg.payload as RunResult;
                reports.push(...res.reports);
                finished = true;
              } else if (msg.type === "error") {
                ctx.ui.notify(String(msg.payload?.error ?? "daemon error"), "error");
                finished = true;
              }
            } catch {
              // ignore parse
            }
          }
        };

        socket.on("data", onData);

        send({
          type: "run",
          tasks,
          options: { provider: raw.provider ?? "fake", workspace: ctx.cwd, signal: undefined },
          requestId: `many-${Date.now()}`,
        });

        // wait for result or abort
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (finished || activeAbort?.signal.aborted) {
              clearInterval(check);
              resolve();
            }
          }, 100);
          activeAbort?.signal.addEventListener("abort", () => {
            send({ type: "abort" });
            clearInterval(check);
            resolve();
          }, { once: true });
        });

        socket.off("data", onData);
        if (ctx.hasUI) ctx.ui.setStatus("many", undefined);

        const compact = reports.map((report) => {
          const findings = report.findings?.slice(0, 3).map((item) => `- ${item}`).join("\n") ?? "";
          return `#${report.taskId} ${report.status}: ${report.summary}${findings ? `\n${findings}` : ""}`;
        }).join("\n");
        ctx.ui.notify(`pi-many-agents finished ${reports.length} tasks`, "info");
        pi.sendMessage({
          customType: "pi-many-agents",
          content: `Worker reports:\n${compact}`,
          display: true,
        });
      } catch (error) {
        if (ctx.hasUI) ctx.ui.setStatus("many", undefined);
        ctx.ui.notify(error instanceof Error ? error.message : "pi-many-agents attach failed", "error");
      }
    },
  });

  pi.on("session_shutdown", async () => {
    if (activeSocket && !activeSocket.destroyed) {
      try {
        activeSocket.write(JSON.stringify({ type: "abort" }) + "\n");
      } catch {
        // ignore
      }
      activeSocket.destroy();
    }
    activeAbort?.abort();
    activeSocket = undefined;
    activeAbort = undefined;
  });
}
