import { describe, expect, it } from "vitest";
import {
  getBuiltInProviders,
  getCloudProviders,
  getCuratedModels,
  getProviderBaseUrl,
  getProviderInfo,
  providerSupportsDiscovery,
  mergeDiscoveredModels,
} from "../lib/model-registry";
import { ZEN_FREE_PROVIDER_ID } from "../lib/zen-credentials";
import { OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID } from "../lib/openai-codex-subscription";

describe("model registry", () => {
  describe("getBuiltInProviders", () => {
    it("returns the bundled free OpenCode Go tier as a built-in", () => {
      const builtins = getBuiltInProviders();
      // User-facing requirement: the free tier must keep working as a
      // first-class built-in (no settings round-trip required).
      expect(builtins.find((p) => p.id === ZEN_FREE_PROVIDER_ID)).toBeDefined();
      expect(builtins.find((p) => p.id === ZEN_FREE_PROVIDER_ID)?.apiKey).toBeNull();
    });

    it("returns OpenAI Codex subscription as a separate no-key built-in", () => {
      const builtins = getBuiltInProviders();
      const codex = builtins.find((p) => p.id === OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID);
      expect(codex?.name).toBe("OpenAI Codex");
      expect(codex?.apiKey).toBeNull();
      expect(codex?.baseUrl).toBe("https://chatgpt.com/backend-api");
      expect(codex?.models.map((m) => m.id)).toContain("gpt-5.5");
    });

    it("returns a fresh array on each call so mutations don't leak", () => {
      const a = getBuiltInProviders();
      const b = getBuiltInProviders();
      expect(a).not.toBe(b);
      a[0].models.push({ id: "leaked", name: "Leaked", contextWindow: 1 });
      expect(b[0].models.find((m) => m.id === "leaked")).toBeUndefined();
    });

    it("keeps free-tier context windows lower than the paid catalog", () => {
      // The bundled credential unlocks a slimmer subset of the OpenCode
      // Go paid catalog. DeepSeek V4 Flash in particular is 200K on the
      // free tier but 1M on the paid tier. If this test ever fails it
      // means the bundled credential was upgraded — re-check the actual
      // free tier limits at opencode.ai/zen and update accordingly.
      const free = getBuiltInProviders().find((p) => p.id === "opencode-go-free");
      const flash = free?.models.find((m) => m.id === "deepseek-v4-flash-free");
      expect(flash?.contextWindow).toBe(200_000);
    });
  });

  describe("getCloudProviders", () => {
    it("includes all curated cloud providers from the registry", () => {
      const clouds = getCloudProviders();
      const ids = clouds.map((p) => p.id);
      // The settings UI iterates this list — missing providers means a
      // user can't configure them.
      expect(ids).toContain("openai");
      expect(ids).toContain("anthropic");
      expect(ids).toContain("deepseek");
      expect(ids).toContain("mimo");
      expect(ids).toContain("openrouter");
      expect(ids).toContain("opencode-go");
      expect(ids).toContain("groq");
    });

    it("flags both OpenCode Go catalogs plus OpenRouter and Groq as supporting /v1/models discovery", () => {
      // Mirrors pi-ai's "supports custom /v1/models" pattern: only
      // providers whose catalog we want to merge at runtime opt in.
      // Adding a new discovery-capable provider means flipping this
      // flag in the registry.
      expect(providerSupportsDiscovery("openrouter")).toBe(true);
      expect(providerSupportsDiscovery("groq")).toBe(true);
      expect(providerSupportsDiscovery("opencode-go")).toBe(true);
      expect(providerSupportsDiscovery("opencode-go-free")).toBe(true);
    });

    it("does not flag Anthropic or OpenAI for /v1/models discovery", () => {
      // These providers either don't expose /v1/models or we don't
      // want to hit it (model lists change frequently and curated
      // metadata is the authoritative source).
      expect(providerSupportsDiscovery("anthropic")).toBe(false);
      expect(providerSupportsDiscovery("openai")).toBe(false);
      expect(providerSupportsDiscovery("deepseek")).toBe(false);
      expect(providerSupportsDiscovery("mimo")).toBe(false);
    });
  });

  describe("getCuratedModels", () => {
    it("returns the curated catalog for a known provider", () => {
      const openai = getCuratedModels("openai");
      expect(openai.length).toBeGreaterThan(0);
      expect(openai.find((m) => m.id === "gpt-4o")?.contextWindow).toBe(128_000);
      expect(openai.find((m) => m.id === "gpt-4o")?.vision).toBe(true);
    });

    it("returns an empty array for unknown providers", () => {
      // Local and custom providers don't have a curated catalog —
      // empty array (not undefined) keeps call sites simple.
      expect(getCuratedModels("ollama")).toEqual([]);
      expect(getCuratedModels("nonexistent-provider")).toEqual([]);
    });

    it("returns vision metadata for vision-capable models", () => {
      // The /v1/models response rarely carries a vision flag, so the
      // curated list is the authoritative source. If a model gains or
      // loses vision, the registry has to be updated alongside the
      // upstream docs.
      const claude = getCuratedModels("anthropic");
      expect(claude.find((m) => m.id.includes("sonnet-4"))?.vision).toBe(true);
    });
  });

  describe("getProviderInfo", () => {
    it("returns the full record for known providers", () => {
      const info = getProviderInfo("openai");
      expect(info?.id).toBe("openai");
      expect(info?.baseUrl).toBe("https://api.openai.com/v1");
      expect(info?.models.length).toBeGreaterThan(0);
    });

    it("returns undefined for unknown providers", () => {
      expect(getProviderInfo("custom-foo")).toBeUndefined();
    });
  });

  describe("getProviderBaseUrl", () => {
    it("returns the curated base URL for known cloud providers", () => {
      expect(getProviderBaseUrl("openai")).toBe("https://api.openai.com/v1");
      expect(getProviderBaseUrl("anthropic")).toBe("https://api.anthropic.com");
      expect(getProviderBaseUrl("groq")).toBe("https://api.groq.com/openai/v1");
    });

    it("returns undefined for unknown providers (caller falls back to config)", () => {
      expect(getProviderBaseUrl("ollama")).toBeUndefined();
      expect(getProviderBaseUrl("custom-bar")).toBeUndefined();
    });
  });

  describe("mergeDiscoveredModels", () => {
    it("returns the curated list unchanged when discovery returned nothing", () => {
      const curated = [
        { id: "gpt-4o", name: "GPT-4o", contextWindow: 128_000, vision: true },
        { id: "gpt-4o-mini", name: "GPT-4o Mini", contextWindow: 128_000, vision: true },
      ];
      expect(mergeDiscoveredModels(curated, [])).toBe(curated);
    });

    it("appends discovered models that aren't in the curated list", () => {
      const curated = [{ id: "a", name: "A", contextWindow: 1 }];
      const discovered = [
        { id: "b", name: "B", contextWindow: 2 },
        { id: "c", name: "C", contextWindow: 3 },
      ];
      const merged = mergeDiscoveredModels(curated, discovered);
      expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
    });

    it("lets the curated entry win on conflict (registry is authoritative)", () => {
      // Pi-ai uses the same precedence: registry metadata wins because
      // /v1/models usually only carries an id.
      const curated = [
        { id: "shared", name: "Curated Name", contextWindow: 200_000, vision: true },
      ];
      const discovered = [
        { id: "shared", name: "Discovered Name", contextWindow: 999_999 },
        { id: "new", name: "New", contextWindow: 1000 },
      ];
      const merged = mergeDiscoveredModels(curated, discovered);
      const shared = merged.find((m) => m.id === "shared")!;
      expect(shared.name).toBe("Curated Name");
      expect(shared.contextWindow).toBe(200_000);
      expect(merged.map((m) => m.id)).toEqual(["shared", "new"]);
    });

    it("preserves the provider's order for discovered entries", () => {
      // OpenRouter etc. return models in a meaningful order (often
      // newest first or curated first). Don't reshuffle.
      const curated = [{ id: "anchor", name: "A", contextWindow: 1 }];
      const discovered = [
        { id: "z", name: "Z", contextWindow: 1 },
        { id: "y", name: "Y", contextWindow: 1 },
        { id: "x", name: "X", contextWindow: 1 },
      ];
      expect(mergeDiscoveredModels(curated, discovered).map((m) => m.id)).toEqual([
        "anchor",
        "z",
        "y",
        "x",
      ]);
    });

    it("coerces missing contextWindow to 0 (the 'unknown' sentinel)", () => {
      // The runtime /v1/models response rarely includes context length;
      // 0 is the existing sentinel that the ContextMeter renders as "—".
      const merged = mergeDiscoveredModels(
        [],
        [{ id: "noctx", name: "NoCtx" }],
      );
      expect(merged[0].contextWindow).toBe(0);
    });

    it("preserves the vision flag from discovered entries when curated has none", () => {
      const merged = mergeDiscoveredModels(
        [],
        [{ id: "vlm", name: "VLM", contextWindow: 1000, vision: true }],
      );
      expect(merged[0].vision).toBe(true);
    });
  });
});
