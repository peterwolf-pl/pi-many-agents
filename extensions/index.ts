import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { createTask } from "../src/core/task.ts";
import { createOrchestrator, loadConfig } from "../src/index.ts";
import type { AgentTask } from "../src/types.ts";

let active: AbortController | undefined;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("many", {
    description: "Run isolated pi-many-agents workers from a plan JSON path",
    handler: async (args, ctx) => {
      const planPath = args.trim();
      if (!planPath) {
        ctx.ui.notify("Usage: /many plans/stage-2.json", "warning");
        return;
      }
      active?.abort();
      active = new AbortController();
      const config = await loadConfig();
      const raw = JSON.parse(await readFile(planPath, "utf8")) as {
        tasks: Array<Partial<AgentTask> & Pick<AgentTask, "id" | "title" | "objective">>;
        provider?: string;
      };
      const tasks = raw.tasks.map((task) => createTask({ ...task, workspace: task.workspace ?? ctx.cwd }));
      const orchestrator = createOrchestrator(config, active.signal);
      if (ctx.hasUI) ctx.ui.setStatus("many", "pi-many-agents running");
      let result;
      try {
        result = await orchestrator.run(tasks, {
          provider: raw.provider ?? "fake",
          signal: active.signal,
          workspace: ctx.cwd,
        });
      } catch (error) {
        if (ctx.hasUI) ctx.ui.setStatus("many", undefined);
        ctx.ui.notify(error instanceof Error ? error.message : "pi-many-agents failed", "error");
        return;
      }
      if (ctx.hasUI) ctx.ui.setStatus("many", undefined);
      const compact = result.reports.map((report) => {
        const findings = report.findings.slice(0, 3).map((item) => `- ${item}`).join("\n");
        return `#${report.taskId} ${report.status}: ${report.summary}${findings ? `\n${findings}` : ""}`;
      }).join("\n");
      ctx.ui.notify(`pi-many-agents finished ${result.reports.length} tasks`, "info");
      pi.sendMessage({
        customType: "pi-many-agents",
        content: `Worker reports:\n${compact}`,
        display: true,
      });
    },
  });

  pi.on("session_shutdown", async () => {
    active?.abort();
    active = undefined;
  });
}
