/**
 * Model factory — the single source of truth for creating a LanguageModel
 * instance from an LlmConfig. Extracted from llm.ts and agentLoop.ts so
 * that adding a new provider never requires touching two files.
 *
 * Previously identical copies of `createModel` lived in both files. When
 * you add a provider (e.g. Google Gemini), update this function in one
 * place and both the parent stream (streamChat) and subagent loop
 * (agentLoop) pick it up.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { getFetch, initFetch } from "./fetch-adapter";
import type { LlmConfig } from "./llm-types";

export async function createModel(config: LlmConfig): Promise<LanguageModel> {
  await initFetch();
  const customFetch = getFetch() ?? globalThis.fetch.bind(globalThis);

  const baseURL = config.baseUrl ?? "http://localhost:1234/v1";

  if (config.provider === "anthropic") {
    const anthropic = createAnthropic({
      apiKey: config.apiKey ?? "",
      fetch: customFetch,
    });
    return anthropic.languageModel(config.modelId);
  }

  if (
    config.provider === "opencode-go" ||
    config.provider === "opencode-go-free" ||
    config.provider === "groq" ||
    config.provider === "deepseek" ||
    config.provider === "openrouter" ||
    config.provider === "ollama" ||
    config.provider === "lmstudio"
  ) {
    const compat = createOpenAICompatible({
      name: config.provider,
      baseURL,
      apiKey: config.apiKey ?? "not-needed",
      fetch: customFetch,
    });
    return compat.languageModel(config.modelId);
  }

  const openai = createOpenAI({
    apiKey: config.apiKey ?? "",
    fetch: customFetch,
  });
  return openai.languageModel(config.modelId);
}
