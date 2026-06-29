import { describe, expect, it } from "vitest";
import { contextWindowFromOllamaShow, normalizeProviderModels } from "../lib/model-detection";

describe("model detection", () => {
  it("normalizes LM Studio and OpenAI-compatible model lists with direct context fields", () => {
    const models = normalizeProviderModels("lmstudio", {
      data: [
        { id: "local-model", max_context_length: 131_072 },
        { id: "loaded-model", loaded_context_length: "32768" },
      ],
    });

    expect(models).toEqual([
      { id: "local-model", name: "local-model", contextWindow: 131_072 },
      { id: "loaded-model", name: "loaded-model", contextWindow: 32_768 },
    ]);
  });

  it("pulls nested provider metadata from OpenAI-compatible responses", () => {
    const models = normalizeProviderModels("custom-openai", {
      models: [
        {
          id: "hosted-model",
          display_name: "Hosted Model",
          metadata: { max_input_tokens: "200000" },
          capabilities: { vision: true },
        },
      ],
    });

    expect(models).toEqual([
      { id: "hosted-model", name: "Hosted Model", contextWindow: 200_000, vision: true },
    ]);
  });

  it("falls back to known context heuristics when providers omit metadata", () => {
    const models = normalizeProviderModels("ollama", {
      data: [{ id: "llama3.2:latest" }, { id: "unknown-local-model" }],
    });

    expect(models[0]).toMatchObject({ id: "llama3.2:latest", contextWindow: 128_000 });
    expect(models[1]).toEqual({ id: "unknown-local-model", name: "unknown-local-model" });
  });

  it("detects Ollama context from model_info and parameter strings", () => {
    expect(
      contextWindowFromOllamaShow({
        model_info: { "qwen2.context_length": 262_144 },
      }),
    ).toBe(262_144);

    expect(
      contextWindowFromOllamaShow({
        parameters: "temperature 0.7\nnum_ctx 65536",
      }),
    ).toBe(65_536);
  });

  it("infers common local vision models from provider capabilities or ids", () => {
    expect(
      normalizeProviderModels("ollama", {
        data: [{ id: "qwen2.5-vl:7b" }, { id: "text-model", modalities: ["text", "image"] }],
      }),
    ).toEqual([
      { id: "qwen2.5-vl:7b", name: "qwen2.5-vl:7b", contextWindow: 128_000, vision: true },
      { id: "text-model", name: "text-model", vision: true },
    ]);
  });

  it("normalizes ClinePass recommended-models payloads into live subscription models", () => {
    expect(
      normalizeProviderModels("cline-pass", {
        clinePass: [
          { id: "cline-pass/qwen3.7-max", name: "cline-pass/qwen3.7-max" },
          { id: "cline-pass/minimax-m3", name: "MiniMax-M3", capabilities: ["images", "reasoning"] },
        ],
      }),
    ).toEqual([
      { id: "cline-pass/qwen3.7-max", name: "Qwen 3.7 Max", contextWindow: 262_144, reasoning: true },
      { id: "cline-pass/minimax-m3", name: "MiniMax M3", contextWindow: 524_288, vision: true, reasoning: true },
    ]);
  });
});
