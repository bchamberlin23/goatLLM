/**
 * Authoritative context window lookup with auto-detection fallback.
 *
 * Resolution order:
 *   1. Explicit per-model overrides (the user's gear-icon setting).
 *   2. Provider/model-specific OVERRIDES table for known exceptions.
 *   3. The pi-ai generated MODELS registry — same catalog the upstream
 *      agent reads, regenerated from each provider's published listings.
 *   4. Auto-detection heuristic: parse model name for size hints and
 *      match known model families against published context windows.
 *   5. Provider-level conservative default.
 */

import { getModel } from "@earendil-works/pi-ai";

// ── Provider id mapping ──

/**
 * Map goatLLM-internal provider ids to pi-ai provider ids.
 * The bundled "free" tier serves opencode's catalog at a different URL.
 */
function toPiProviders(providerId: string): string[] {
  // Try the "opencode" provider first for free-tier models (the pi-ai
  // registry lists free models under "opencode", not "opencode-go").
  if (providerId === "opencode-go-free") return ["opencode", "opencode-go"];
  return [providerId];
}

/**
 * Strip suffixes goatLLM appends to model ids that pi-ai doesn't carry.
 * Currently only `-free` (used by the bundled free DeepSeek model).
 */
function toPiModelId(providerId: string, modelId: string): string {
  if (providerId === "opencode-go-free" && modelId.endsWith("-free")) {
    return modelId.slice(0, -"-free".length);
  }
  return modelId;
}

// ── Explicit overrides ──

/**
 * Per-model context window overrides for cases the registry doesn't
 * distinguish correctly. The bundled "free" tier of OpenCode Go serves
 * the same model ids as the paid catalog but with smaller context
 * windows; we patch the lookup here so the meter reflects the real limit.
 */
const OVERRIDES: Record<string, Record<string, number>> = {
  "opencode-go-free": {
    // Free tier caps DeepSeek V4 Flash at 200K, not the paid 1M.
    "deepseek-v4-flash-free": 200_000,
    "deepseek-v4-flash": 200_000,
  },
};

// ── Auto-detection heuristic ──

/**
 * Try to guess a model's context window from its name when nothing
 * authoritative is available. This matches size hints embedded in model
 * ids and known model family defaults.
 */
function autoDetectContextWindow(modelId: string, providerId: string): number {
  const name = modelId.toLowerCase();

  // ── 1. Explicit size hints in the model id ──

  const sizeHints: Array<[RegExp, number]> = [
    [/\b1m\b|\b1million\b|\b1000000\b|\b1048576\b/, 1_000_000],
    [/\b500k\b|\b500000\b/, 500_000],
    [/\b300k\b|\b300000\b/, 300_000],
    [/\b262k\b|\b262144\b|\b256k\b|\b256000\b/, 262_144],
    [/\b200k\b|\b200000\b|\b204800\b/, 200_000],
    [/\b128k\b|\b128000\b|\b131072\b/, 128_000],
    [/\b100k\b|\b100000\b/, 100_000],
    [/\b64k\b|\b64000\b|\b65536\b/, 64_000],
    [/\b32k\b|\b32000\b|\b32768\b/, 32_768],
    [/\b16k\b|\b16000\b|\b16384\b/, 16_384],
    [/\b8k\b|\b8000\b|\b8192\b/, 8_192],
    [/\b4k\b|\b4000\b|\b4096\b/, 4_096],
  ];
  for (const [re, tokens] of sizeHints) {
    if (re.test(name)) return tokens;
  }

  // ── 2. Known model families ──

  // Anthropic
  if (name.includes("claude")) {
    if (name.includes("opus-4")) return 200_000;
    if (name.includes("sonnet-4") || name.includes("haiku-4")) return 200_000;
    return 200_000; // All Claude models since 3.5 are 200K
  }

  // OpenAI
  if (name.includes("gpt-4.1")) return 1_000_000;
  if (name.includes("gpt-4o") || name.includes("gpt-4-turbo")) return 128_000;
  if (name.includes("gpt-4")) return 8_192;
  if (name.includes("gpt-3.5")) return 16_384;
  if (name.includes("o3") || name.includes("o4")) return 200_000;
  if (name.includes("o1")) return 200_000;

  // Google
  if (name.includes("gemini-2.5")) return 1_000_000;
  if (name.includes("gemini-2")) return 1_000_000;
  if (name.includes("gemini-1.5")) return 1_000_000;
  if (name.includes("gemini")) return 32_768;

  // Meta Llama (handles both "llama-3.2" and "llama3.2" formats)
  if (/\bllama[-.]?4\b/.test(name)) return 1_000_000;
  if (/\bllama[-.]?3(\.\d)?\b/.test(name)) return 128_000;
  if (/\bllama[-.]?2\b/.test(name)) return 4_096;

  // Mistral / Mixtral
  if (name.includes("mistral-large")) return 128_000;
  if (name.includes("mistral-nemo")) return 128_000;
  if (name.includes("mistral-small") || name.includes("ministral")) return 32_000;
  if (name.includes("mixtral")) return 32_768;
  if (name.includes("mistral")) return 32_000;
  if (name.includes("codestral")) return 32_768;

  // DeepSeek (direct API, not opencode-go)
  if (name.includes("deepseek-v4-flash-free")) return 200_000;
  if (name.includes("deepseek-v4")) return 1_000_000;
  if (name.includes("deepseek-r1") || name.includes("deepseek-chat")) return 64_000;

  // Groq-hosted models
  if (name.includes("llama-3.3")) return 128_000;
  if (name.includes("gemma2")) return 8_192;

  // Qwen
  if (name.includes("qwen3")) return 262_144;
  if (name.includes("qwen2.5") || name.includes("qwen2")) return 128_000;

  // Kimi
  if (name.includes("kimi-k2")) return 262_144;

  // GLM
  if (name.includes("glm-5")) return 200_000;
  if (name.includes("glm-4")) return 128_000;

  // MiniMax
  if (name.includes("minimax-m2")) return 204_800;

  // MiMo
  if (name.includes("mimo-v2")) return 1_048_576;

  // Command R
  if (name.includes("command-r")) return 128_000;

  // ── 3. Provider-level conservative defaults ──

  // Only apply when we have nothing else. These are deliberately low so
  // the meter errs on the side of warning too early rather than too late.
  const providerDefaults: Record<string, number> = {
    openai: 128_000,
    anthropic: 200_000,
    deepseek: 64_000,
    openrouter: 128_000,
    groq: 128_000,
    "opencode-go": 1_000_000,
    "opencode-go-free": 200_000,
  };
  return providerDefaults[providerId] ?? 0;
}

// ── Public API ──

/**
 * Resolve the context window in tokens for a `providerId:modelId` pair.
 *
 * Returns 0 only when absolutely nothing is known — not even a
 * provider-level default — so callers can surface "unknown" instead of
 * showing a confident-looking guess.
 */
export function getContextWindow(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
): number {
  if (!providerId || !modelId) return 0;

  // 1. Provider/model-specific overrides take absolute precedence.
  const override = OVERRIDES[providerId]?.[modelId];
  if (override) return override;

  // 2. pi-ai MODELS registry lookup.
  // getModel is typed against KnownProvider but at runtime it does a
  // Map lookup. We pass runtime provider strings (including local ones
  // like "ollama", "lmstudio") and getModel returns undefined for
  // unknown keys. We try multiple provider mappings for free models.
  const lookup = getModel as unknown as (
    provider: string,
    modelId: string,
  ) => { contextWindow?: number } | undefined;

  const piModelId = toPiModelId(providerId, modelId);
  for (const piProvider of toPiProviders(providerId)) {
    const direct = lookup(piProvider, piModelId);
    if (direct?.contextWindow) return direct.contextWindow;
  }

  // 3. OpenRouter fallback: split "vendor/model" and try the upstream
  //    provider's catalog directly.
  if (piModelId.includes("/")) {
    const [vendor, ...rest] = piModelId.split("/");
    for (const piProvider of toPiProviders(providerId)) {
      if (piProvider === "openrouter") {
        const upstream = lookup(vendor, rest.join("/"));
        if (upstream?.contextWindow) return upstream.contextWindow;
      }
    }
  }

  // 4. Auto-detection heuristic.
  const auto = autoDetectContextWindow(modelId, providerId);
  if (auto > 0) return auto;

  // 5. Nothing found. Caller decides fallback behavior.
  return 0;
}

/**
 * Same as `getContextWindow` but accepts the combined `providerId:modelId`
 * shape stored in the chat store's `selectedModelId`.
 */
export function getContextWindowFromCombinedId(
  combined: string | null | undefined,
): number {
  if (!combined) return 0;
  const idx = combined.indexOf(":");
  if (idx < 0) return 0;
  return getContextWindow(combined.slice(0, idx), combined.slice(idx + 1));
}

/**
 * Format a token count as a short human-readable string. 132_000 → "132K".
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}K`;
  }
  return n.toLocaleString();
}
