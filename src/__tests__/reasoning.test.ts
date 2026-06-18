import { describe, expect, it } from "vitest";

import {
  THINKING_LEVELS,
  getReasoningLevelOptions,
  normalizeReasoningEffort,
  resolveReasoningRequest,
} from "../lib/reasoning";

import type { LlmConfig } from "../lib/llm-types";
import type { ModelConfig, ProviderConfig } from "../lib/providers";

describe("Pi-style reasoning normalization", () => {
  it("hides reasoning levels when a model does not opt in", () => {
    const model: ModelConfig = { id: "plain", name: "Plain", contextWindow: 128_000 };
    expect(getReasoningLevelOptions({ model })).toEqual([]);
    expect(resolveReasoningRequest({ config: baseConfig("openai", "plain"), model })).toEqual({
      level: "off",
      providerOptions: undefined,
      codexReasoning: undefined,
    });
  });

  it("uses Pi thinkingLevelMap to hide unsupported levels and clamp selections", () => {
    const model: ModelConfig = {
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      contextWindow: 1_000_000,
      reasoning: true,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: null,
        medium: null,
        high: "high",
        xhigh: "max",
      },
    };

    expect(getReasoningLevelOptions({ model }).map((o) => o.level)).toEqual(["high", "xhigh"]);
    expect(normalizeReasoningEffort("low", { model })).toBe("high");
    expect(resolveReasoningRequest({ config: baseConfig("opencode-go", model.id, "xhigh"), model })).toEqual({
      level: "xhigh",
      providerOptions: {
        "opencode-go": { reasoningEffort: "max" },
      },
      codexReasoning: undefined,
    });
  });

  it("maps Anthropic reasoning levels to token budgets", () => {
    const model: ModelConfig = {
      id: "claude-sonnet-4-20250514",
      name: "Claude Sonnet 4",
      contextWindow: 200_000,
      reasoning: true,
      thinkingBudgets: {
        minimal: 1024,
        low: 4096,
        medium: 10_240,
        high: 32_768,
      },
    };

    expect(resolveReasoningRequest({ config: baseConfig("anthropic", model.id, "medium"), model })).toEqual({
      level: "medium",
      providerOptions: {
        anthropic: { thinking: { type: "enabled", budgetTokens: 10_240 } },
      },
      codexReasoning: undefined,
    });
  });

  it("uses provider compatibility flags to avoid sending unsupported reasoning fields", () => {
    const model: ModelConfig = {
      id: "gpt-oss:20b",
      name: "GPT OSS 20B",
      contextWindow: 128_000,
      reasoning: true,
    };
    const provider: ProviderConfig = {
      id: "ollama",
      name: "Ollama",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ollama",
      models: [model],
      compat: { supportsReasoningEffort: false },
    };

    expect(resolveReasoningRequest({ config: baseConfig("ollama", model.id, "high"), model, provider })).toEqual({
      level: "high",
      providerOptions: undefined,
      codexReasoning: undefined,
    });
  });

  it("supports OpenRouter's reasoning object shape", () => {
    const model: ModelConfig = {
      id: "deepseek/deepseek-r1",
      name: "DeepSeek R1",
      contextWindow: 64_000,
      reasoning: true,
    };

    expect(resolveReasoningRequest({ config: baseConfig("openrouter", model.id, "high"), model })).toEqual({
      level: "high",
      providerOptions: {
        openrouter: { reasoning: { effort: "high" } },
      },
      codexReasoning: undefined,
    });
  });

  it("keeps the canonical Pi level order stable", () => {
    expect(THINKING_LEVELS).toEqual(["off", "minimal", "low", "medium", "high", "xhigh"]);
  });
});

function baseConfig(provider: string, modelId: string, reasoningEffort?: string): LlmConfig {
  return {
    provider,
    modelId,
    apiKey: "test",
    baseUrl: "https://example.test/v1",
    reasoningEffort,
  };
}
