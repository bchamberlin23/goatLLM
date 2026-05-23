/**
 * Provider config types. Cloud providers are configured via the Settings
 * modal (API keys + per-provider enabled-models list); local providers
 * (LM Studio, Ollama) are baked into the chat store.
 *
 * Historical note: there used to be a hard-coded built-in provider list
 * here; that responsibility has moved into the store. This file keeps the
 * shared types so future modules can import them without circular deps.
 */

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  models: ModelConfig[];
}

export interface ModelConfig {
  id: string;
  name: string;
  contextWindow: number;
}

/** No-op for legacy callers. The store owns built-in providers now. */
export function getBuiltInProviders(): ProviderConfig[] {
  return [];
}
