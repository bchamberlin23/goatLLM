import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/firecrawl", () => ({
  scrapeUrl: vi.fn(),
}));

import { scrapeUrl } from "../lib/firecrawl";
import { READ_ONLY_TOOLS } from "../lib/tools/registry";
import { useChatStore } from "../stores/chat";
import type { ToolExecutionOptions } from "ai";

const toolExecutionOptions: ToolExecutionOptions = {
  toolCallId: "web-search-evidence-test",
  messages: [],
};

function executeWebSearch(input: { query: string; maxResults?: number }) {
  const execute = READ_ONLY_TOOLS.web_search.execute;
  if (!execute) throw new Error("web_search execute handler is unavailable");
  return execute(input, toolExecutionOptions);
}

describe("model-invoked web search evidence", () => {
  beforeEach(() => {
    const store = useChatStore.getState();
    store.searchBackend = "searxng";
    store.firecrawlApiKey = "";
    store.webSearchCount = 0;
    store.researchMode = false;
    store.resetCitationSources();
    vi.clearAllMocks();
  });

  it("returns deduplicated page evidence with bounded concurrent scraping", async () => {
    const active = { count: 0, max: 0 };
    vi.mocked(scrapeUrl).mockImplementation(async (url) => {
      active.count++;
      active.max = Math.max(active.max, active.count);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active.count--;
      return {
        url,
        title: `Read ${url}`,
        content: `Evidence from ${url}`,
        source: "browser_fetch",
      };
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        results: [
          { title: "First result", url: "https://example.com/one", content: "First snippet" },
          { title: "Duplicate result", url: "https://example.com/one", content: "Duplicate snippet" },
          { title: "Second result", url: "https://example.com/two", content: "Second snippet" },
          { title: "Third result", url: "https://example.com/three", content: "Third snippet" },
          { title: "Fourth result", url: "https://example.com/four", content: "Fourth snippet" },
        ],
      }),
    });

    const output = await executeWebSearch(
      { query: "fresh information", maxResults: 5 },
    ) as string;

    const evidence = JSON.parse(output);
    expect(vi.mocked(scrapeUrl)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(scrapeUrl)).toHaveBeenNthCalledWith(
      1,
      "https://example.com/one",
      expect.objectContaining({ maxChars: 6000 }),
    );
    expect(active.max).toBeGreaterThan(1);
    expect(active.max).toBeLessThanOrEqual(3);
    expect(evidence).toEqual([
      expect.objectContaining({
        cite: "[1]",
        title: "Read https://example.com/one",
        url: "https://example.com/one",
        snippet: "First snippet",
        content: "Evidence from https://example.com/one",
        fetched: true,
        source: "browser_fetch",
      }),
      expect.objectContaining({ url: "https://example.com/two", cite: "[2]", fetched: true }),
      expect.objectContaining({ url: "https://example.com/three", cite: "[3]", fetched: true }),
    ]);
  });

  it("keeps the search snippet when a selected page cannot be scraped", async () => {
    vi.mocked(scrapeUrl).mockRejectedValue(new Error("reader unavailable"));
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        results: [
          { title: "Result", url: "https://example.com/source", content: "Search snippet survives" },
        ],
      }),
    });

    const output = await executeWebSearch(
      { query: "source fallback" },
    ) as string;

    expect(JSON.parse(output)).toEqual([
      expect.objectContaining({
        cite: "[1]",
        url: "https://example.com/source",
        snippet: "Search snippet survives",
        content: "Search snippet survives",
        fetched: false,
        source: "snippet",
      }),
    ]);
  });
});
