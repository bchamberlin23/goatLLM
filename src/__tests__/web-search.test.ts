import { describe, it, expect, vi, beforeEach } from "vitest";
import { READ_ONLY_TOOLS } from "../lib/tools/registry";
import { useChatStore } from "../stores/chat";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("web_search tool", () => {
  beforeEach(() => {
    // Reset search counts and store states
    const store = useChatStore.getState();
    store.searchBackend = "searxng";
    store.webSearchCount = 0;
    store.researchMode = false;
    store.resetCitationSources();
    vi.restoreAllMocks();
  });

  it("handles webSearchCount limit in non-research mode", async () => {
    const store = useChatStore.getState();
    store.webSearchCount = 2;

    const tool = READ_ONLY_TOOLS.web_search;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
    const result = await tool.execute!({ query: "test query" }, {} as any) as string;
    expect(result).toContain("Maximum web searches (2) already used this turn");
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
    // Chat-mode searches are annotated with a `cite` marker the model uses for
    // inline citations; the title/url/content payload is otherwise unchanged.
    expect(parsed[0]).toEqual({
      cite: "[1]",
      title: "Google search",
      url: "https://google.com/foo",
      content: "Google is a popular search engine..."
    });
    expect(parsed[1]).toEqual({
      cite: "[2]",
      title: "Direct Link",
      url: "https://example.org",
      content: "Direct snippet example"
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
});
