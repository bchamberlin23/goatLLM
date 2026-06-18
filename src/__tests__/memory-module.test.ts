import { describe, it, expect, vi, beforeEach } from "vitest";
import { addMemory, listMemories, deleteMemory, searchMemories, updateMemory } from "../lib/memory";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../lib/semantic-index", () => ({
  embedQuery: vi.fn(async () => [0.1, 0.2, 0.3]),
}));

describe("Memory Manager Client Functions", () => {
  let invoke: ReturnType<typeof vi.fn>;
  let embedQuery: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    localStorage.clear();
    const apiMod = await import("@tauri-apps/api/core");
    invoke = apiMod.invoke as unknown as ReturnType<typeof vi.fn>;
    invoke.mockReset();

    const semanticMod = await import("../lib/semantic-index");
    embedQuery = semanticMod.embedQuery as unknown as ReturnType<typeof vi.fn>;
    embedQuery.mockReset();
  });

  it("addMemory generates embeddings via embedQuery and calls memory_insert", async () => {
    embedQuery.mockResolvedValue([0.1, 0.2, 0.3]);
    invoke.mockResolvedValue(undefined);

    await addMemory("I prefer Python", "preference");

    expect(embedQuery).toHaveBeenCalledWith("I prefer Python", {
      url: "http://localhost:11434",
      model: "nomic-embed-text",
    });

    expect(invoke).toHaveBeenCalledWith("memory_insert", expect.objectContaining({
      text: "I prefer Python",
      category: "preference",
      embedding: [0.1, 0.2, 0.3],
      model: "nomic-embed-text",
    }));
  });

  it("addMemory falls back to text-only if embedding generation fails", async () => {
    embedQuery.mockRejectedValue(new Error("Ollama offline"));
    invoke.mockResolvedValue(undefined);

    await addMemory("I prefer Python", "preference");

    expect(invoke).toHaveBeenCalledWith("memory_insert", expect.objectContaining({
      text: "I prefer Python",
      category: "preference",
      embedding: null,
      model: null,
    }));
  });

  it("listMemories calls memory_list Tauri command", async () => {
    const mockList = [
      { id: "1", text: "Test", category: "fact", uses: 0, created_at: 100 }
    ];
    invoke.mockResolvedValue(mockList);

    const result = await listMemories("fact");

    expect(invoke).toHaveBeenCalledWith("memory_list", { category: "fact" });
    expect(result).toEqual(mockList);
  });

  it("deleteMemory calls memory_delete Tauri command", async () => {
    invoke.mockResolvedValue(undefined);

    await deleteMemory("mem-123");

    expect(invoke).toHaveBeenCalledWith("memory_delete", { id: "mem-123" });
  });

  it("updateMemory regenerates embeddings and sends editable metadata", async () => {
    embedQuery.mockResolvedValue([0.2, 0.3, 0.4]);
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "memory_list") return [
        { id: "mem-123", text: "Old", category: "fact", scope: "global", uses: 0, created_at: 100 },
      ];
      return undefined;
    });

    await updateMemory("mem-123", {
      text: "This project uses pnpm",
      category: "project",
      scope: "project",
      workspacePath: "/repo",
    });

    expect(invoke).toHaveBeenCalledWith("memory_update", expect.objectContaining({
      id: "mem-123",
      text: "This project uses pnpm",
      category: "project",
      scope: "project",
      workspacePath: "/repo",
      embedding: [0.2, 0.3, 0.4],
      model: "nomic-embed-text",
    }));
  });

  it("searchMemories attempts semantic search first and returns results", async () => {
    embedQuery.mockResolvedValue([0.1, 0.2, 0.3]);
    const mockHits = [
      { id: "1", text: "Match", category: "fact", uses: 1, created_at: 100, score: 0.9 }
    ];
    invoke.mockResolvedValue(mockHits);

    const hits = await searchMemories("test query");

    expect(embedQuery).toHaveBeenCalledWith("test query", {
      url: "http://localhost:11434",
      model: "nomic-embed-text",
    });
    expect(invoke).toHaveBeenCalledWith("memory_search", {
      queryEmbedding: [0.1, 0.2, 0.3],
      limit: 8,
    });
    expect(hits).toEqual(mockHits);
  });

  it("searchMemories falls back to substring text search if semantic search fails", async () => {
    embedQuery.mockRejectedValue(new Error("Ollama offline"));
    const mockTextHits = [
      { id: "1", text: "Text Match", category: "fact", uses: 1, created_at: 100, score: 1.0 }
    ];
    invoke.mockResolvedValue(mockTextHits);

    const hits = await searchMemories("test query");

    expect(invoke).toHaveBeenCalledWith("memory_search_text", {
      query: "test query",
      limit: 8,
    });
    expect(hits).toEqual(mockTextHits);
  });

  it("searchMemories falls back to substring text search if semantic search returns no hits", async () => {
    embedQuery.mockResolvedValue([0.1, 0.2, 0.3]);
    // semantic returns empty
    invoke.mockImplementation(async (cmd) => {
      if (cmd === "memory_search") return [];
      if (cmd === "memory_search_text") {
        return [
          { id: "1", text: "Text Match", category: "fact", uses: 1, created_at: 100, score: 1.0 }
        ];
      }
      return [];
    });

    const hits = await searchMemories("test query");

    expect(invoke).toHaveBeenCalledWith("memory_search", {
      queryEmbedding: [0.1, 0.2, 0.3],
      limit: 8,
    });
    expect(invoke).toHaveBeenCalledWith("memory_search_text", {
      query: "test query",
      limit: 8,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe("Text Match");
  });
});
