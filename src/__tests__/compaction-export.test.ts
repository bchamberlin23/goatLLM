import { describe, expect, it } from "vitest";

import { exportAsJson, exportAsMarkdown } from "../lib/export";

import type { Conversation, Message } from "../stores/chat";

const conv: Conversation = {
  id: "conv-1",
  title: "Compacted export",
  lastMessagePreview: "Latest",
  lastMessageAt: 20,
  createdAt: 1,
  modelId: "openai:gpt-4.1",
  systemPrompt: "",
};

describe("compaction exports", () => {
  it("renders synthetic compaction summaries as transcript entries, not assistant/user messages", () => {
    const messages: Message[] = [
      {
        id: "cmp-1",
        conversationId: "conv-1",
        role: "compactionSummary",
        content: "## Goal\nSummarized older context.",
        createdAt: 10,
        compaction: {
          entryId: "cmp-1",
          summarizedCount: 12,
          tokensBefore: 42_000,
          firstKeptId: "m2",
        },
      },
      {
        id: "m2",
        conversationId: "conv-1",
        role: "user",
        content: "Continue",
        createdAt: 20,
      },
    ];

    const markdown = exportAsMarkdown(conv, messages);
    const json = JSON.parse(exportAsJson(conv, messages));

    expect(markdown).toContain("**Compaction summary**");
    expect(markdown).toContain("12 earlier messages");
    expect(markdown).not.toContain("**Assistant**");
    expect(json.messages[0].role).toBe("compaction_summary");
    expect(json.messages[0].compaction.tokensBefore).toBe(42_000);
  });
});
