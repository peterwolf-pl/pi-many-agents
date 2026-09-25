import type { AgentProvider } from "./types.ts";

export type { AgentProvider, ProviderRunResult } from "./types.ts";

export class ProviderRegistry {
  private readonly providers = new Map<string, AgentProvider>();

  register(provider: AgentProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): AgentProvider {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`unknown provider: ${name}`);
    return provider;
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }
}
