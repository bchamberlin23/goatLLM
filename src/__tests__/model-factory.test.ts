import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  languageModel: vi.fn(),
  compatibleProvider: vi.fn(),
  wrapLanguageModel: vi.fn(({ model }) => ({ wrapped: model })),
  extractReasoningMiddleware: vi.fn((options) => ({ options })),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mocks.compatibleProvider,
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(),
}));

vi.mock("ai", () => ({
  wrapLanguageModel: mocks.wrapLanguageModel,
  extractReasoningMiddleware: mocks.extractReasoningMiddleware,
}));

vi.mock("../lib/fetch-adapter", () => ({
  initFetch: vi.fn(),
  getFetch: vi.fn(() => undefined),
}));

vi.mock("../lib/openai-codex-subscription", () => ({
  isOpenAICodexSubscriptionProvider: vi.fn(() => false),
}));

import { createModel } from "../lib/model-factory";

describe("createModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.compatibleProvider.mockReturnValue({ languageModel: mocks.languageModel });
    mocks.languageModel.mockReturnValue({ modelId: "minimax-m3" });
  });

  it("extracts MiniMax M-series think tags into reasoning stream events", async () => {
    await createModel({
      provider: "opencode-go",
      modelId: "minimax-m3",
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
    });

    expect(mocks.extractReasoningMiddleware).toHaveBeenCalledWith({
      tagName: "think",
      startWithReasoning: false,
    });
    expect(mocks.wrapLanguageModel).toHaveBeenCalledWith({
      model: { modelId: "minimax-m3" },
      middleware: { options: { tagName: "think", startWithReasoning: false } },
    });
  });

  it("does not wrap unrelated OpenAI-compatible models", async () => {
    await createModel({
      provider: "opencode-go",
      modelId: "qwen3.7-max",
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
    });

    expect(mocks.wrapLanguageModel).not.toHaveBeenCalled();
  });

  it("routes ClinePass through the OpenAI-compatible client", async () => {
    await createModel({
      provider: "cline-pass",
      modelId: "cline-pass/glm-5.2",
      apiKey: "cline-token",
      baseUrl: "https://api.cline.bot/api/v1",
    });

    expect(mocks.compatibleProvider).toHaveBeenCalledWith(expect.objectContaining({
      name: "cline-pass",
      baseURL: "https://api.cline.bot/api/v1",
      apiKey: "cline-token",
    }));
    expect(mocks.languageModel).toHaveBeenCalledWith("cline-pass/glm-5.2");
  });
});
