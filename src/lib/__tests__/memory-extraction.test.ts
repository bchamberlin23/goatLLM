import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMORY_EXTRACTION_SETTINGS,
  buildMemoryProvenance,
  dedupeMemoryCandidates,
  extractMemoryCandidates,
  normalizeMemoryText,
  sanitizeMemoryExtractionSettings,
} from "../memory-extraction";
import type { Memory } from "../memory";

const existing = (text: string, scope: Memory["scope"] = "global"): Memory => ({
  id: `mem-${text}`,
  text,
  category: "preference",
  uses: 0,
  created_at: 1,
  scope,
});

describe("memory-extraction", () => {
  it("defaults automatic extraction to off and sanitizes scope toggles", () => {
    expect(DEFAULT_MEMORY_EXTRACTION_SETTINGS.enabled).toBe(false);

    expect(sanitizeMemoryExtractionSettings({
      enabled: true,
      globalScope: false,
      projectScope: true,
      maxCandidatesPerTurn: 99,
    })).toMatchObject({
      enabled: true,
      globalScope: false,
      projectScope: true,
      maxCandidatesPerTurn: 8,
    });
  });

  it("extracts explicit durable global preferences conservatively", () => {
    const candidates = extractMemoryCandidates({
      userText: "Please remember that I prefer TypeScript examples over Python.",
      assistantText: "Got it.",
      workspacePath: "/repo",
      settings: { ...DEFAULT_MEMORY_EXTRACTION_SETTINGS, enabled: true },
      conversationId: "conv-1",
      sourceMessageIds: ["user-1", "assistant-1"],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      text: "I prefer TypeScript examples over Python.",
      category: "preference",
      scope: "global",
      sourceConversationId: "conv-1",
      sourceMessageIds: ["user-1", "assistant-1"],
    });
  });

  it("extracts project-scoped facts when project language is explicit", () => {
    const candidates = extractMemoryCandidates({
      userText: "For this project, we use pnpm and Vite for local development.",
      assistantText: "",
      workspacePath: "/Users/bench/Desktop/goatLLM",
      settings: { ...DEFAULT_MEMORY_EXTRACTION_SETTINGS, enabled: true },
      conversationId: "conv-1",
      sourceMessageIds: ["user-1"],
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        text: "This project uses pnpm and Vite for local development.",
        category: "project",
        scope: "project",
        workspacePath: "/Users/bench/Desktop/goatLLM",
      }),
    ]);
  });

  it("skips uncertain or assistant-only statements", () => {
    expect(extractMemoryCandidates({
      userText: "Maybe I will switch to Bun later.",
      assistantText: "You prefer Bun.",
      workspacePath: "/repo",
      settings: { ...DEFAULT_MEMORY_EXTRACTION_SETTINGS, enabled: true },
      conversationId: "conv-1",
      sourceMessageIds: [],
    })).toEqual([]);
  });

  it("dedupes exact and near-contained memories", () => {
    const candidates = extractMemoryCandidates({
      userText: "Remember that I prefer TypeScript examples.",
      assistantText: "",
      workspacePath: null,
      settings: { ...DEFAULT_MEMORY_EXTRACTION_SETTINGS, enabled: true },
      conversationId: "conv-1",
      sourceMessageIds: [],
    });

    expect(normalizeMemoryText("I prefer TypeScript examples.")).toBe("i prefer typescript examples");
    expect(dedupeMemoryCandidates(candidates, [
      existing("I prefer TypeScript examples"),
    ])).toEqual([]);
  });

  it("builds compact provenance labels", () => {
    expect(buildMemoryProvenance({
      scope: "project",
      workspacePath: "/Users/bench/Desktop/goatLLM",
      sourceConversationId: "conv-1",
      sourceMessageIds: ["m1", "m2"],
    })).toBe("Project goatLLM · conv-1 · 2 messages");
  });
});
