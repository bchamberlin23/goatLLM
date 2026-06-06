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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
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
      scrape_url: {
        execute: vi.fn().mockResolvedValue(
          "[Web scrape: Apple Earnings 2023]\nURL: https://example.com/apple-news\n\nApple reported strong financial results for 2023, with total revenue of $383 billion."
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

  it("ignores echoed example arrays and returns the real query array", () => {
    const echoed =
      'Example: ["query one", "query two", "query three"]\n' +
      '["impact of AI on jobs", "AI automation statistics 2026"]';

    expect(parseJsonArray(echoed)).toEqual([
      "impact of AI on jobs",
      "AI automation statistics 2026",
    ]);
  });

  it("repairs truncated real arrays without harvesting prompt examples", () => {
    const echoedTruncated =
      'Example: ["query one", "query two"]\n' +
      '["real query a", "real query b';

    expect(parseJsonArray(echoedTruncated)).toEqual(["real query a"]);
  });
});

describe("runDeepResearch Orchestrator", () => {
  const dummyConfig = {
    provider: "openai" as const,
    modelId: "gpt-4",
    apiKey: "mock-api-key",
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { READ_ONLY_TOOLS } = await import("../lib/tools/registry");
    const { browserFetch } = await import("../lib/browser-fetch");
    vi.mocked(READ_ONLY_TOOLS.web_search.execute!).mockResolvedValue(
      JSON.stringify([
        { url: "https://example.com/apple-news", title: "Apple Earnings 2023" },
      ])
    );
    vi.mocked(READ_ONLY_TOOLS.scrape_url.execute!).mockResolvedValue(
      "[Web scrape: Apple Earnings 2023]\nURL: https://example.com/apple-news\n\nApple reported strong financial results for 2023, with total revenue of $383 billion."
    );
    vi.mocked(browserFetch).mockResolvedValue({
      url: "https://example.com/apple-news",
      status: 200,
      contentType: "text/plain",
      bytes: 88,
      truncated: false,
      content: "Apple reported strong financial results for 2023, with total revenue of $383 billion.",
    });
  });

  it("runs the full research flow successfully", async () => {
    const { generateText } = await import("ai");
    const { READ_ONLY_TOOLS } = await import("../lib/tools/registry");

    // We will set up responses for each call to generateText sequentially
    let callIndex = 0;
    const mockResponses = [
      // 1. Planning Response
      JSON.stringify({
        title: "Apple 2023 Revenue",
        steps: ["What was Apple's 2023 revenue?"],
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
      } as any;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
    const progressEvents: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
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
    expect(finalReport).toContain("https://example.com/apple-news");
    expect(READ_ONLY_TOOLS.scrape_url.execute).toHaveBeenCalledWith(
      { url: "https://example.com/apple-news", maxChars: 15000 },
      expect.anything(),
    );

    // Verify correct number of LLM calls
    expect(generateText).toHaveBeenCalledTimes(8);
  });

  it("reads discovered URLs through scrape_url", async () => {
    const { generateText } = await import("ai");
    const { READ_ONLY_TOOLS } = await import("../lib/tools/registry");

    const mockResponses = [
      JSON.stringify({
        title: "Apple 2023 Revenue",
        steps: ["What was Apple's 2023 revenue?"],
      }),
      "general",
      JSON.stringify(["apple revenue 2023"]),
      JSON.stringify({
        rational: "Mentions revenue",
        evidence: "revenue of $383 billion",
        summary: "Apple's 2023 revenue was $383 billion.",
      }),
      "Evolving report: Apple 2023 revenue was $383 billion.",
      "YES - We have the exact revenue figure.",
      "## Apple Revenue\n\nApple revenue was $383 billion.",
    ];
    let callIndex = 0;
    vi.mocked(generateText).mockImplementation(async () => {
      const text = mockResponses[callIndex] ?? mockResponses[mockResponses.length - 1];
      callIndex++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
      return { text } as any;
    });

    await runDeepResearch("What was Apple's 2023 revenue?", dummyConfig, () => {}, undefined, 1);

    expect(READ_ONLY_TOOLS.scrape_url.execute).toHaveBeenCalledWith(
      { url: "https://example.com/apple-news", maxChars: 15000 },
      expect.anything(),
    );
  });

  it("respects abort signals during loop execution", async () => {
    const { generateText } = await import("ai");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
    vi.mocked(generateText).mockImplementation(async (options: any) => {
      if (options?.abortSignal?.aborted) {
        throw new DOMException("The user aborted a request.", "AbortError");
      }
      return {
        text: "Draft text...",
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 10 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
      } as any;
    });

    const abortController = new AbortController();
    abortController.abort(); // Pre-abort it

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
    const progressEvents: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
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
    expect(finalReport).toContain("Failed to generate Deep Research report.");
  });

  it("limits concurrent extraction work", async () => {
    const { generateText } = await import("ai");
    const { browserFetch } = await import("../lib/browser-fetch");
    const { READ_ONLY_TOOLS } = await import("../lib/tools/registry");

    vi.mocked(READ_ONLY_TOOLS.web_search.execute!).mockResolvedValue(
      JSON.stringify(
        Array.from({ length: 6 }, (_, i) => ({
          url: `https://example.com/source-${i}`,
          title: `Source ${i}`,
        })),
      ),
    );

    let activeFetches = 0;
    let maxActiveFetches = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
    vi.mocked(browserFetch).mockImplementation(async ({ url }: any) => {
      activeFetches++;
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeFetches--;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
      return { url, content: "useful source content" } as any;
    });

    const responses = [
      JSON.stringify({ title: "Question", steps: ["one"] }),
      "general",
      JSON.stringify(["query one", "query two"]),
      ...Array.from({ length: 6 }, () => JSON.stringify({
        rational: "relevant",
        evidence: "evidence",
        summary: "summary",
      })),
      "Evolving report",
      "Final detailed report with enough evidence.",
      "Expanded final detailed report with enough evidence.",
    ];
    let callIndex = 0;
    vi.mocked(generateText).mockImplementation(async () => ({
      text: responses[callIndex++] || "fallback",
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
    }) as any);

    await runDeepResearch("Question?", dummyConfig, () => {}, undefined, 1, 300, {
      extractionConcurrency: 2,
      maxUrlsPerRound: 3,
    });

    expect(maxActiveFetches).toBeLessThanOrEqual(2);
  });

  it("surfaces actionable errors when search returns no findings for repeated rounds", async () => {
    const { generateText } = await import("ai");
    const { READ_ONLY_TOOLS } = await import("../lib/tools/registry");

    vi.mocked(READ_ONLY_TOOLS.web_search.execute!).mockResolvedValue("[]");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
    vi.mocked(generateText).mockImplementation(async ({ maxOutputTokens }: any) => ({
      text: maxOutputTokens === 20
        ? "general"
        : maxOutputTokens === 1024
          ? JSON.stringify({ title: "Question", steps: ["one"] })
          : JSON.stringify(["empty query"]),
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
    }) as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
    const events: any[] = [];
    const finalReport = await runDeepResearch("Question?", dummyConfig, (p) => events.push(p), undefined, 4, 300, {
      minRounds: 1,
      maxEmptyRounds: 2,
    });

    expect(finalReport).toContain("Search unavailable");
    expect(finalReport).toContain("no new URLs");
    expect(events.some((e) => e.phase === "error" && /search/i.test(e.message))).toBe(true);
  });

  it("returns gathered findings when synthesis and final writing fail", async () => {
    const { generateText } = await import("ai");

    let callIndex = 0;
    vi.mocked(generateText).mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
        return { text: JSON.stringify({ title: "Question", steps: ["one"] }) } as any;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
      if (callIndex === 2) return { text: "general" } as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
      if (callIndex === 3) return { text: JSON.stringify(["apple revenue 2023"]) } as any;
      if (callIndex === 4) {
        return {
          text: JSON.stringify({
            rational: "relevant",
            evidence: "Apple revenue evidence",
            summary: "Apple revenue summary",
          }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
        } as any;
      }
      throw new Error("LLM unavailable");
    });

    const finalReport = await runDeepResearch("What was Apple's 2023 revenue?", dummyConfig, () => {}, undefined, 1);

    expect(finalReport).toContain("Automatic synthesis did not complete");
    expect(finalReport).toContain("Apple revenue summary");
  });

  it("emits structured progress metadata for sources and findings", async () => {
    const { generateText } = await import("ai");
    let callIndex = 0;
    const mockResponses = [
      JSON.stringify({ title: "Question", steps: ["one"] }),
      "general",
      JSON.stringify(["apple revenue 2023"]),
      JSON.stringify({ rational: "relevant", evidence: "evidence", summary: "summary" }),
      "Evolving report",
      "Final report",
      "Expanded final report",
    ];
    vi.mocked(generateText).mockImplementation(async () => ({
      text: mockResponses[callIndex++] || "fallback",
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
    }) as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
    const events: any[] = [];
    await runDeepResearch("Question?", dummyConfig, (p) => events.push(p), undefined, 1);

    expect(events.some((e) => e.phase === "reading" && e.current_source?.url)).toBe(true);
    expect(events.some((e) => e.phase === "reading" && e.total_findings === 1)).toBe(true);
  });
});
