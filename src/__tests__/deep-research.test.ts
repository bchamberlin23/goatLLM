import { describe, it, expect, vi, beforeEach } from "vitest";
import { runDeepResearch, parseJsonArray, parseJsonObject } from "../lib/deep-research";

// Mocking dependencies
vi.mock("ai", () => {
  return {
    generateText: vi.fn(),
  };
});

vi.mock("../lib/model-factory", () => {
  return {
    createModel: vi.fn().mockResolvedValue({} as any),
  };
});

vi.mock("../lib/tools/registry", () => {
  return {
    READ_ONLY_TOOLS: {
      web_search: {
        execute: vi.fn().mockResolvedValue(
          JSON.stringify([
            { url: "https://example.com/apple-news", title: "Apple Earnings 2023" },
          ])
        ),
      },
    },
  };
});

vi.mock("../lib/browser-fetch", () => {
  return {
    browserFetch: vi.fn().mockResolvedValue({
      url: "https://example.com/apple-news",
      content: "Apple reported strong financial results for 2023, with total revenue of $383 billion.",
    }),
  };
});

describe("Deep Research JSON Helpers", () => {
  it("parses JSON arrays correctly including fallback parsing", () => {
    const valid = '["apple", "pear"]';
    expect(parseJsonArray(valid)).toEqual(["apple", "pear"]);

    const wrapped = '```json\n["apple", "pear"]\n```';
    expect(parseJsonArray(wrapped)).toEqual(["apple", "pear"]);

    const invalid = 'Some text ["apple", "pear"] other text';
    expect(parseJsonArray(invalid)).toEqual(["apple", "pear"]);
  });

  it("parses JSON objects correctly including fallback parsing", () => {
    const valid = '{"key": "value"}';
    expect(parseJsonObject(valid)).toEqual({ key: "value" });

    const wrapped = '```json\n{"key": "value"}\n```';
    expect(parseJsonObject(wrapped)).toEqual({ key: "value" });

    const fallback = 'Random prefix {"key": "value"} random suffix';
    expect(parseJsonObject(fallback)).toEqual({ key: "value" });
  });
});

describe("runDeepResearch Orchestrator", () => {
  const dummyConfig = {
    provider: "openai" as const,
    modelId: "gpt-4",
    apiKey: "mock-api-key",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the full research flow successfully", async () => {
    const { generateText } = await import("ai");

    // We will set up responses for each call to generateText sequentially
    let callIndex = 0;
    const mockResponses = [
      // 1. Planning Response
      JSON.stringify({
        sub_questions: ["What was Apple's 2023 revenue?"],
        key_topics: ["finance"],
        success_criteria: "Clear revenue figure.",
      }),
      // 2. Classification Response
      "general",
      // 3. Query Generation Response
      JSON.stringify(["apple revenue 2023"]),
      // 4. Extractor Response (LLM extraction of the fetched page)
      JSON.stringify({
        rational: "Mentions revenue",
        evidence: "revenue of $383 billion",
        summary: "Apple's 2023 revenue was $383 billion.",
      }),
      // 5. Synthesis Response
      "Evolving report: Apple 2023 revenue was $383 billion.",
      // 6. Stop Decision Response (Round 2 stop check)
      "YES - We have the exact revenue figure.",
      // 7. Final Report Response (First attempt: returns brief summary)
      "This is a brief report showing Apple's 2023 revenue was $383 billion.",
      // 8. Expanded Report Response (since first was < 400 words)
      "## Apple 2023 Financial Performance\n\nApple Inc. reported total revenue of $383 billion in fiscal year 2023. This is based on financial news reports [Apple Earnings](https://example.com/apple-news).\n\n### Conclusion\n\nApple remains financially highly successful.",
    ];

    vi.mocked(generateText).mockImplementation(async () => {
      const responseText = mockResponses[callIndex] || "Fallback response text";
      callIndex++;
      return {
        text: responseText,
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 10 },
      } as any;
    });

    const progressEvents: any[] = [];
    const onProgress = (p: any) => {
      progressEvents.push(p);
    };

    const finalReport = await runDeepResearch(
      "What was Apple's 2023 revenue?",
      dummyConfig,
      onProgress,
      undefined,
      2 // maxRounds = 2 to match mock responses
    );

    // Verify progress phases were hit
    expect(progressEvents.some((e) => e.phase === "planning")).toBe(true);
    expect(progressEvents.some((e) => e.phase === "searching")).toBe(true);
    expect(progressEvents.some((e) => e.phase === "reading")).toBe(true);
    expect(progressEvents.some((e) => e.phase === "analyzing")).toBe(true);
    expect(progressEvents.some((e) => e.phase === "writing")).toBe(true);

    // Verify the final report content
    expect(finalReport).toContain("Apple 2023 Financial Performance");
    expect(finalReport).toContain("revenue of $383 billion");
    expect(finalReport).toContain("Duration");
    expect(finalReport).toContain("https://example.com/apple-news");

    // Verify correct number of LLM calls
    expect(generateText).toHaveBeenCalledTimes(8);
  });

  it("respects abort signals during loop execution", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockImplementation(async (options: any) => {
      if (options?.abortSignal?.aborted) {
        throw new DOMException("The user aborted a request.", "AbortError");
      }
      return {
        text: "Draft text...",
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 10 },
      } as any;
    });

    const abortController = new AbortController();
    abortController.abort(); // Pre-abort it

    const progressEvents: any[] = [];
    const onProgress = (p: any) => {
      progressEvents.push(p);
    };

    const finalReport = await runDeepResearch(
      "Test aborted research",
      dummyConfig,
      onProgress,
      abortController.signal,
      2
    );

    // Should fail/abort and fall back to the error message
    expect(finalReport).toContain("Failed to generate research report.");
  });
});
