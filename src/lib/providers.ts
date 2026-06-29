/**
 * Provider config types. Cloud providers are configured via the Settings
 * modal (API keys + per-provider enabled-models list); local providers
 * (LM Studio, Ollama) are baked into the chat store.
 *
 * The data for which models each provider exposes lives in
 * `model-registry.ts` — this file keeps the *type* surface (ProviderConfig,
 * ModelConfig) so other modules can import it without pulling in the
 * registry's data, and re-exports the registry helpers for back-compat.
 */

import {
  getBuiltInProviders as registryGetBuiltInProviders,
  getCloudProviders as registryGetCloudProviders,
  getCuratedModels as registryGetCuratedModels,
  getProviderBaseUrl as registryGetProviderBaseUrl,
  getProviderDiscoveryUrl as registryGetProviderDiscoveryUrl,
  getProviderInfo as registryGetProviderInfo,
  providerSupportsDiscovery as registryProviderSupportsDiscovery,
  mergeDiscoveredModels as registryMergeDiscoveredModels,
  type ProviderInfo,
} from "./model-registry";

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  models: ModelConfig[];
  compat?: ProviderCompat;
}

export interface ModelConfig {
  id: string;
  name: string;
  contextWindow: number;
  /** Whether this model can read images natively (vision/multimodal).
   *  Used by the send pipeline to warn when the user attaches an image
   *  to a text-only model and offer OCR fallback. */
  vision?: boolean;
  /** Whether this model supports provider-controlled extended reasoning. */
  reasoning?: boolean;
  /** Optional Pi-style per-level map. null means unsupported; string is sent provider-side. */
  thinkingLevelMap?: ThinkingLevelMap;
  /** Optional token budgets for providers such as Anthropic. */
  thinkingBudgets?: ThinkingBudgets;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;
export type ThinkingBudgets = Partial<Record<Exclude<ThinkingLevel, "off">, number>>;

export interface ProviderCompat {
  /** Set false for OpenAI-compatible proxies/local servers that reject reasoning_effort. */
  supportsReasoningEffort?: boolean;
  /** Override the provider payload shape when provider id is not enough. */
  reasoningApi?: "openai" | "openrouter" | "anthropic" | "qwen" | "none";
}

/**
 * Built-in providers shipped with the app. These show up in the picker
 * automatically — no Settings round-trip required — and are typically
 * authenticated with a bundled credential resolved at call time (see
 * src/stores/chat.ts → getActiveLlmConfig).
 *
 * The data lives in `model-registry.ts`; this function re-exports it
 * in the shape the rest of the app already uses so call sites don't
 * need to migrate.
 */
export function getBuiltInProviders(): ProviderConfig[] {
  return registryGetBuiltInProviders();
}

/**
 * Re-export of the cloud provider catalog. Used by ProvidersTab.tsx
 * to render the Settings cards and by the chat store when populating
 * the picker for a configured cloud provider.
 */
export function getCloudProviders() {
  return registryGetCloudProviders();
}

/**
 * Curated model list for a provider. Returns an empty array for
 * providers not in the registry (local providers, custom).
 */
export function getCuratedModels(providerId: string): ModelConfig[] {
  return registryGetCuratedModels(providerId);
}

/**
 * Default base URL for a provider, if curated. Undefined for custom
 * / local providers where the user picks the URL.
 */
export function getProviderBaseUrl(providerId: string): string | undefined {
  return registryGetProviderBaseUrl(providerId);
}

/**
 * Optional provider-specific model discovery URL. Most OpenAI-compatible
 * providers use `${baseUrl}/models`; ClinePass publishes its subscription
 * model list through Cline's recommended-models endpoint.
 */
export function getProviderDiscoveryUrl(providerId: string): string | undefined {
  return registryGetProviderDiscoveryUrl(providerId);
}

/**
 * Full provider record (id, name, baseUrl, models, supportsDiscovery).
 */
export function getProviderInfo(providerId: string): ProviderInfo | undefined {
  return registryGetProviderInfo(providerId);
}

/**
 * True if the provider exposes an OpenAI-compatible /v1/models endpoint
 * the user can hit on demand to augment the curated list. Today:
 * OpenRouter, Groq, OpenCode Go.
 */
export function providerSupportsDiscovery(providerId: string): boolean {
  return registryProviderSupportsDiscovery(providerId);
}

/**
 * Combine the curated catalog with /v1/models discovery results. The
 * curated list wins on conflict; discovered entries are appended in
 * the order the provider returned them. The `discovered` side accepts
 * a wider shape than `ModelConfig` because the runtime result of
 * `normalizeProviderModels` may leave `contextWindow` undefined.
 */
export function mergeDiscoveredModels(
  curated: ModelConfig[],
  discovered: Array<{
    id: string;
    name: string;
    contextWindow?: number;
    vision?: boolean;
    reasoning?: boolean;
    thinkingLevelMap?: ThinkingLevelMap;
    thinkingBudgets?: ThinkingBudgets;
  }>,
): ModelConfig[] {
  return registryMergeDiscoveredModels(curated, discovered);
}
