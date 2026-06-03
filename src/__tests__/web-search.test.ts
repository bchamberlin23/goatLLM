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
    vi.restoreAllMocks();
  });

  it("handles webSearchCount limit in non-research mode", async () => {
    const store = useChatStore.getState();
    store.webSearchCount = 2;

    const tool = READ_ONLY_TOOLS.web_search;
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
    const result = await tool.execute!({ query: "test query", maxResults: 2 }, {} as any) as string;
    
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/search?q=test%20query&format=json"
    );

    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      title: "Google search",
      url: "https://google.com/foo",
      content: "Google is a popular search engine..."
    });
    expect(parsed[1]).toEqual({
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
    const result = await tool.execute!({ query: "test query" }, {} as any) as string;

    expect(result).toContain("SearXNG search error: 500");
  });
});
