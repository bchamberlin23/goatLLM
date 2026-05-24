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
  /** Whether this model can read images natively (vision/multimodal).
   *  Used by the send pipeline to warn when the user attaches an image
   *  to a text-only model and offer OCR fallback. */
  vision?: boolean;
}

/**
 * Built-in providers shipped with the app. These show up in the picker
 * automatically — no Settings round-trip required — and are typically
 * authenticated with a bundled credential resolved at call time (see
 * src/stores/chat.ts → getActiveLlmConfig).
 *
 * Currently this seeds the OpenCode Go Free tier so a user can chat
 * immediately after install. The credential itself lives in
 * src/lib/zen-credentials.ts (XOR-folded, not in plain text).
 */
export function getBuiltInProviders(): ProviderConfig[] {
  return [
    {
      id: "opencode-go-free",
      name: "Free Models",
      // Free endpoint: drop the `/go` segment used by the paid catalog.
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: null,
      models: [
        {
          id: "deepseek-v4-flash-free",
          name: "DeepSeek V4 Flash (Free)",
          contextWindow: 200_000,
        },
      ],
    },
  ];
}
