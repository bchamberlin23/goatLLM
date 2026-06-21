/**
 * Unified model registry — single source of truth for which models
 * goatLLM knows about per provider, and what we know about each model.
 *
 * Aligns with @earendil-works/pi-ai's `models.generated.js` pattern:
 * a curated, build-time catalog of every model the user can pick from,
 * with full metadata. Runtime model discovery (Ollama `/v1/models`,
 * OpenRouter `/v1/models`, etc.) is layered on top via
 * `discoverLocalModels` in the chat store and `mergeDiscoveredModels`
 * below.
 *
 * Resolution order (matches docs/providers.md and the order used in
 * `context-window.ts`):
 *   1. User-set `modelOverrides` per-model (chat store, persisted)
 *   2. Curated registry (this file)
 *   3. pi-ai MODELS registry (getModel from @earendil-works/pi-ai)
 *   4. Heuristic auto-detection (context-window.ts)
 *   5. Provider-level conservative default
 *   6. 0 — sentinel meaning "unknown" (ContextMeter renders as "—")
 *
 * Why a curated registry rather than hitting each provider's /v1/models
 * at startup:
 *   - pi-ai does it this way for the same reasons — model metadata
 *     (vision, reasoning, maxTokens, cost) isn't part of the OpenAI
 *     list response, so the runtime has nothing to render.
 *   - Avoids a network round-trip on every app launch.
 *   - Lets us show models before the user has typed an API key.
 *   - Surfaces fields the provider API doesn't expose (e.g. vision
 *     for models that report only an opaque `id`).
 *
 * The `supportsDiscovery: true` flag is the explicit opt-in for
 * providers whose /v1/models endpoint we *do* want to hit, on user
 * demand, to merge in models the curated list doesn't know about.
 */

import type { ModelConfig, ProviderCompat, ProviderConfig } from "./providers";
import {
  OPENAI_CODEX_SUBSCRIPTION_BASE_URL,
  OPENAI_CODEX_SUBSCRIPTION_MODELS,
  OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID,
  OPENAI_CODEX_SUBSCRIPTION_PROVIDER_NAME,
} from "./openai-codex-subscription";

// ── Provider metadata ────────────────────────────────────────────

/**
 * The full per-provider record kept in the registry. ProviderConfig
 * (lib/providers.ts) is the legacy shape; ProviderInfo adds the
 * `supportsDiscovery` flag and keeps the same field names so existing
 * call sites can migrate without churn.
 */
export interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  models: ModelConfig[];
  /**
   * If true, the provider exposes an OpenAI-compatible /v1/models
   * endpoint the user can hit on-demand to augment the curated list
   * with models the registry doesn't know about. Today: OpenRouter,
   * Groq, OpenCode Go. Local providers (Ollama, LM Studio) handle
   * this through `discoverLocalModels` in the chat store instead.
   */
  supportsDiscovery?: boolean;
  compat?: ProviderCompat;
}

// ── Built-in providers (no settings round-trip required) ────────

/**
 * Providers that appear in the picker without the user configuring
 * anything first. Currently the bundled OpenCode Go Free tier; the
 * user can hide it by adding their own OpenCode Go key (see
 * `chat.ts → getProviders`).
 */
const BUILTIN_PROVIDERS: ProviderInfo[] = [
  {
    id: "opencode-go-free",
    name: "Free Models",
    baseUrl: "https://opencode.ai/zen/v1",
    models: [
      { id: "big-pickle", name: "Big Pickle", contextWindow: 0 },
      {
        id: "deepseek-v4-flash-free",
        name: "DeepSeek V4 Flash Free",
        contextWindow: 200_000,
        reasoning: true,
      },
      {
        id: "mimo-v2.5-free",
        name: "MiMo V2.5 Free",
        contextWindow: 1_048_576,
      },
      { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free", contextWindow: 0 },
      { id: "north-mini-code-free", name: "North Mini Code Free", contextWindow: 0 },
    ],
  },
  {
    id: OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID,
    name: OPENAI_CODEX_SUBSCRIPTION_PROVIDER_NAME,
    baseUrl: OPENAI_CODEX_SUBSCRIPTION_BASE_URL,
    models: OPENAI_CODEX_SUBSCRIPTION_MODELS,
  },
];

// ── Curated cloud catalog ───────────────────────────────────────

/**
 * The list of cloud providers the user can configure in Settings,
 * plus the curated models each one exposes. The Settings UI builds
 * its `CLOUD_PROVIDERS` array from this list and the picker renders
 * the model list per provider when the user expands the card.
 *
 * Mirrors pi-ai's behavior of shipping a hardcoded catalog rather
 * than fetching one — the `/v1/models` endpoint of any of these
 * providers will return more models than we curate, but the curated
 * list is what we know metadata about (vision, reasoning, etc.).
 * For opt-in runtime discovery see `supportsDiscovery` below.
 */
const CLOUD_PROVIDERS: ProviderInfo[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "gpt-4o", name: "GPT-4o", contextWindow: 128_000, vision: true },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", contextWindow: 128_000, vision: true },
      { id: "gpt-4.1", name: "GPT-4.1", contextWindow: 1_000_000, vision: true },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    models: [
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        contextWindow: 200_000,
        vision: true,
        reasoning: true,
        thinkingBudgets: {
          minimal: 1024,
          low: 4096,
          medium: 8192,
          high: 16_384,
          xhigh: 32_768,
        },
      },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", contextWindow: 200_000, vision: true },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", contextWindow: 200_000, vision: true },
      { id: "claude-3-opus-20240229", name: "Claude 3 Opus", contextWindow: 200_000, vision: true },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: [
      { id: "deepseek-chat", name: "DeepSeek V3", contextWindow: 64_000 },
      { id: "deepseek-reasoner", name: "DeepSeek R1", contextWindow: 64_000, reasoning: true },
    ],
  },
  {
    id: "mimo",
    name: "MiMo",
    baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
    models: [
      { id: "mimo-v2.5", name: "MiMo V2.5", contextWindow: 1_000_000 },
      { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro", contextWindow: 1_048_576 },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    supportsDiscovery: true,
    compat: { reasoningApi: "openrouter" },
    models: [
      { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4", contextWindow: 200_000, vision: true },
      { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", contextWindow: 200_000, vision: true },
      { id: "openai/gpt-4o", name: "GPT-4o", contextWindow: 128_000, vision: true },
      { id: "google/gemini-2.5-pro-preview", name: "Gemini 2.5 Pro", contextWindow: 1_000_000, vision: true, reasoning: true },
      { id: "google/gemini-2.5-flash-preview", name: "Gemini 2.5 Flash", contextWindow: 1_000_000, vision: true, reasoning: true },
      { id: "deepseek/deepseek-r1", name: "DeepSeek R1", contextWindow: 64_000, reasoning: true },
      { id: "deepseek/deepseek-chat-v3", name: "DeepSeek V3", contextWindow: 64_000 },
      { id: "meta-llama/llama-4-maverick", name: "Llama 4 Maverick", contextWindow: 1_000_000, vision: true },
    ],
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    supportsDiscovery: true,
    models: [
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", contextWindow: 1_000_000, reasoning: true },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", contextWindow: 1_000_000, reasoning: true },
      { id: "glm-5", name: "GLM 5", contextWindow: 200_000 },
      { id: "glm-5.1", name: "GLM 5.1", contextWindow: 200_000 },
      { id: "kimi-k2.5", name: "Kimi K2.5", contextWindow: 262_144 },
      { id: "kimi-k2.6", name: "Kimi K2.6", contextWindow: 262_144 },
      { id: "mimo-v2.5", name: "MiMo V2.5", contextWindow: 1_000_000 },
      { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro", contextWindow: 1_048_576 },
      { id: "minimax-m2.5", name: "MiniMax M2.5", contextWindow: 204_800 },
      { id: "minimax-m2.7", name: "MiniMax M2.7", contextWindow: 204_800 },
      { id: "qwen3.5-plus", name: "Qwen 3.5 Plus", contextWindow: 262_144, reasoning: true },
      { id: "qwen3.6-plus", name: "Qwen 3.6 Plus", contextWindow: 262_144, reasoning: true },
      { id: "qwen3.7-max", name: "Qwen 3.7 Max", contextWindow: 262_144, reasoning: true },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    supportsDiscovery: true,
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", contextWindow: 128_000 },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", contextWindow: 32_768 },
      { id: "gemma2-9b-it", name: "Gemma 2 9B", contextWindow: 8_192 },
    ],
  },
];

// ── Public API ─────────────────────────────────────────────────

/**
 * Returns the built-in providers (currently just the bundled free
 * tier). Kept as a function rather than a constant so call sites
 * get a fresh array — mutation of the result must not leak back into
 * the registry.
 */
export function getBuiltInProviders(): ProviderConfig[] {
  return BUILTIN_PROVIDERS.map(toProviderConfig);
}

/**
 * Returns the curated cloud provider list, in the same shape used
 * for the Settings card list (`{id, name, baseUrl}`) so the picker
 * can render the cards without re-mapping.
 */
export function getCloudProviders(): Array<{
  id: string;
  name: string;
  baseUrl: string;
  supportsDiscovery: boolean;
}> {
  return CLOUD_PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    supportsDiscovery: p.supportsDiscovery ?? false,
  }));
}

/**
 * The curated model list for a given provider, or an empty array
 * when the provider isn't in the registry. Used by the chat store
 * when populating the picker for a configured cloud provider.
 */
export function getCuratedModels(providerId: string): ModelConfig[] {
  const info = findProviderInfo(providerId);
  return info ? [...info.models] : [];
}

/**
 * Full provider record (id, name, baseUrl, models, supportsDiscovery).
 * Returns undefined for unknown providers — call sites can fall back
 * to the user's configured baseUrl / name in that case.
 */
export function getProviderInfo(providerId: string): ProviderInfo | undefined {
  return findProviderInfo(providerId);
}

/**
 * Default base URL for a provider, if curated. Undefined for providers
 * we don't have a default for (e.g. custom local servers where the
 * user picks the URL).
 */
export function getProviderBaseUrl(providerId: string): string | undefined {
  return findProviderInfo(providerId)?.baseUrl;
}

/**
 * True if the user can hit this provider's /v1/models endpoint to
 * augment the curated list. Today: OpenRouter, Groq, OpenCode Go.
 * Local providers have their own `discoverLocalModels` path because
 * they need special handling (Ollama context fan-out, etc.).
 */
export function providerSupportsDiscovery(providerId: string): boolean {
  return findProviderInfo(providerId)?.supportsDiscovery ?? false;
}

// ── Internal helpers ───────────────────────────────────────────

function findProviderInfo(providerId: string): ProviderInfo | undefined {
  return (
    BUILTIN_PROVIDERS.find((p) => p.id === providerId) ??
    CLOUD_PROVIDERS.find((p) => p.id === providerId)
  );
}

function toProviderConfig(info: ProviderInfo): ProviderConfig {
  return {
    id: info.id,
    name: info.name,
    baseUrl: info.baseUrl,
    apiKey: null,
    models: info.models.map((m) => ({ ...m })),
    compat: info.compat ? { ...info.compat } : undefined,
  };
}

// ── Discovered-model merge ─────────────────────────────────────

/**
 * Combine the curated catalog with the result of hitting a provider's
 * /v1/models endpoint. The curated list wins on conflict — the
 * registry is the authoritative source for metadata (vision flag,
 * display name, context window) because the /v1/models response
 * usually only carries an id.
 *
 * Discovered models that aren't in the curated list are appended in
 * the order the provider returned them, with metadata synthesized
 * from the response (display_name → name, context_length → contextWindow)
 * via `normalizeProviderModels`.
 *
 * This is the same precedence pi-ai uses when a user adds
 * `models.json` overrides: registry metadata wins, new entries
 * are appended.
 *
 * `discovered` is accepted as a wider type than `ModelConfig`
 * because the runtime result of `normalizeProviderModels` allows
 * `contextWindow` to be undefined (the /v1/models response rarely
 * carries that field). We coerce back to the full `ModelConfig`
 * shape when emitting the merged list, treating missing
 * `contextWindow` as 0 (the existing "unknown" sentinel).
 */
export function mergeDiscoveredModels(
  curated: ModelConfig[],
  discovered: Array<{
    id: string;
    name: string;
    contextWindow?: number;
    vision?: boolean;
    reasoning?: boolean;
    thinkingLevelMap?: ModelConfig["thinkingLevelMap"];
    thinkingBudgets?: ModelConfig["thinkingBudgets"];
  }>,
): ModelConfig[] {
  if (discovered.length === 0) return curated;
  const curatedIds = new Set(curated.map((m) => m.id));
  const extras: ModelConfig[] = discovered
    .filter((m) => !curatedIds.has(m.id))
    .map((m) => ({
      id: m.id,
      name: m.name,
      contextWindow: m.contextWindow ?? 0,
      ...(m.vision !== undefined ? { vision: m.vision } : {}),
      ...(m.reasoning !== undefined ? { reasoning: m.reasoning } : {}),
      ...(m.thinkingLevelMap !== undefined ? { thinkingLevelMap: m.thinkingLevelMap } : {}),
      ...(m.thinkingBudgets !== undefined ? { thinkingBudgets: m.thinkingBudgets } : {}),
    }));
  return [...curated, ...extras];
}
