import { loadConfig, type ManyAgentsConfig } from "./config/config.ts";
import { Orchestrator } from "./core/orchestrator.ts";
import { FakeProvider } from "./providers/fake.ts";
import { PiProvider } from "./providers/pi.ts";
import { listPiProviders, PI_WORKER_PROFILES, PiProfileProvider } from "./providers/catalog.ts";
import { DockerMistralProvider } from "./providers/docker-mistral.ts";
import { OllamaProvider } from "./providers/ollama.ts";
import type { AgentTask, RunOptions, RunResult } from "./types.ts";

export * from "./types.ts";
export { loadConfig, DEFAULT_CONFIG } from "./config/config.ts";
export { createTask, renderTaskPacket } from "./core/task.ts";
export { dedupeTasks } from "./core/dedup.ts";
export { decomposeMarkdown } from "./core/decompose.ts";
export { dependencyGraph } from "./core/graph.ts";
export { Orchestrator } from "./core/orchestrator.ts";
export { routeTask } from "./routing/rules.ts";

export function createOrchestrator(config: ManyAgentsConfig, signal?: AbortSignal): Orchestrator {
  const orchestrator = new Orchestrator(config);
  orchestrator.registerProvider(new FakeProvider(signal));
  orchestrator.registerProvider(
    new DockerMistralProvider({
      baseUrl: config.mistral?.baseUrl,
      model: config.mistral?.model,
      signal,
    })
  );
  orchestrator.registerProvider(
    new OllamaProvider({
      name: "qwen4",
      baseUrl: config.ollama?.baseUrl,
      model: config.ollama?.model,
      signal,
    })
  );
  orchestrator.registerProvider(
    new OllamaProvider({
      name: "gemma4",
      baseUrl: config.ollama?.baseUrl,
      model: "gemma4:latest",
      signal,
    })
  );
  orchestrator.registerProvider(new PiProvider(config, signal));
  let listed: string[] | undefined;
  const providers = () => (listed ??= listPiProviders(config.piBinary));
  for (const profile of PI_WORKER_PROFILES) {
    orchestrator.registerProvider(new PiProfileProvider(profile, config, providers, signal));
  }
  return orchestrator;
}

export async function runTasks(tasks: AgentTask[], options: RunOptions = {}): Promise<RunResult> {
  const config = await loadConfig();
  const orchestrator = createOrchestrator(config, options.signal);
  return orchestrator.run(tasks, options);
}
