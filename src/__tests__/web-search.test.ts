import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolExecutionOptions } from "ai";
import { READ_ONLY_TOOLS } from "../lib/tools/registry";
import { useChatStore } from "../stores/chat";
import { browserFetch } from "../lib/browser-fetch";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../lib/browser-fetch", () => ({
  browserFetch: vi.fn(),
  validateBrowserUrl: vi.fn(() => ({ ok: true, url: new URL("https://example.com/") })),
}));

describe("web_search tool", () => {
  beforeEach(() => {
    // Reset search counts and store states
    const store = useChatStore.getState();
    store.searchBackend = "searxng";
    store.webSearchCount = 0;
    store.researchMode = false;
    store.resetCitationSources();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("caps the fourth normal web search without making a network request", async () => {
    const store = useChatStore.getState();
    store.webSearchCount = 3;

    const tool = READ_ONLY_TOOLS.web_search;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
    const result = await tool.execute!({ query: "test query" }, {} as any) as string;
    expect(result).toContain("Maximum web searches (3) already used this turn");
  });

  it("allows webSearchCount limit to be bypassed in research mode", async () => {
    const store = useChatStore.getState();
    store.webSearchCount = 2;
    store.researchMode = true;

    const mockResponse = {
      results: [
        {
          title: "Example Title",
          url: "https://example.com/target",
          content: "Example Snippet content here...",
        }
      ]
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    globalThis.fetch = fetchMock;

    const tool = READ_ONLY_TOOLS.web_search;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
    const result = await tool.execute!({ query: "test query" }, {} as any) as string;
    expect(result).not.toContain("Maximum web searches");
    expect(result).toContain("https://example.com/target");
    expect(result).toContain("Example Title");
    expect(result).toContain("Example Snippet content here...");
  });

  it("allows internal Deep Research searches after the normal per-turn cap", async () => {
    const store = useChatStore.getState();
    store.webSearchCount = 3;
    store.researchMode = false;

    const mockResponse = {
      results: [
        {
          title: "Example Title",
          url: "https://example.com/target",
          content: "Example Snippet content here...",
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    globalThis.fetch = fetchMock;

    const tool = READ_ONLY_TOOLS.web_search;
    const execute = tool.execute;
    if (!execute) throw new Error("web_search tool is missing execute");
    const options: ToolExecutionOptions = {
      toolCallId: "test",
      messages: [],
      experimental_context: { deepResearch: true },
    };
    const result = await execute(
      { query: "deep research query" },
      options,
    ) as string;

    expect(result).not.toContain("Maximum web searches");
    expect(result).toContain("https://example.com/target");
    expect(result).toContain("Example Title");
    expect(store.webSearchCount).toBe(3);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("parses SearXNG JSON metasearch results correctly", async () => {
    const mockResponse = {
      results: [
        {
          title: "Google search",
          url: "https://google.com/foo",
          content: "Google is a popular search engine..."
        },
        {
          title: "Direct Link",
          url: "https://example.org",
          content: "Direct snippet example"
        }
      ]
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    globalThis.fetch = fetchMock;

    const tool = READ_ONLY_TOOLS.web_search;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
    const result = await tool.execute!({ query: "test query", maxResults: 2 }, {} as any) as string;
    
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/search?q=test%20query&format=json"
    );

    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(2);
    // Chat-mode searches are annotated with a `cite` marker. A failed page
    // read leaves the original backend snippet as usable evidence.
    expect(parsed[0]).toMatchObject({
      cite: "[1]",
      title: "Google search",
      url: "https://google.com/foo",
      snippet: "Google is a popular search engine...",
      content: "Google is a popular search engine...",
      fetched: false,
      source: "snippet",
    });
    expect(parsed[1]).toMatchObject({
      cite: "[2]",
      title: "Direct Link",
      url: "https://example.org",
      snippet: "Direct snippet example",
      content: "Direct snippet example",
      fetched: false,
      source: "snippet",
    });
  });

  it("handles non-ok SearXNG responses gracefully", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    globalThis.fetch = fetchMock;

    const tool = READ_ONLY_TOOLS.web_search;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
    const result = await tool.execute!({ query: "test query" }, {} as any) as string;

    expect(result).toContain("SearXNG search error: 500");
  });

  it("scrapes a URL with Firecrawl when configured", async () => {
    const store = useChatStore.getState();
    store.firecrawlApiKey = "fc-test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          markdown: "# Example\n\nClean page body",
          metadata: { title: "Example Page", sourceURL: "https://example.com/page" },
        },
      }),
    });
    globalThis.fetch = fetchMock;

    const result = (await READ_ONLY_TOOLS.scrape_url.execute!(
      { url: "https://example.com/page" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
      {} as any,
    )) as string;

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.firecrawl.dev/v2/scrape",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer fc-test" }),
      }),
    );
    expect(result).toContain("Example Page");
    expect(result).toContain("Clean page body");
  });

  it("falls back to the built-in reader when Firecrawl fails", async () => {
    const store = useChatStore.getState();
    store.firecrawlApiKey = "fc-test";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "service unavailable",
    });
    vi.mocked(browserFetch).mockResolvedValue({
      url: "https://example.com/page",
      status: 200,
      contentType: "text/html",
      bytes: 12,
      truncated: false,
      content: "Browser body",
    });

    const result = await READ_ONLY_TOOLS.scrape_url.execute!(
      { url: "https://example.com/page" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
      {} as any,
    ) as string;

    expect(browserFetch).toHaveBeenCalledWith(expect.objectContaining({ url: "https://example.com/page" }));
    expect(result).toContain("Browser body");
  });
});
