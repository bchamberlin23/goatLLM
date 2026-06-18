import { describe, expect, it } from "vitest";

import { compactMessages } from "../lib/context-manager";

import type { CompactionEntry } from "../lib/compaction/types";
import type { Message } from "../stores/chat";

function msg(id: string, role: Message["role"], content: string, createdAt: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    conversationId: "conv-1",
    role,
    content,
    createdAt,
    ...overrides,
  };
}

describe("cumulative compaction file tracking", () => {
  it("stores files from the previous compaction plus newly touched files", () => {
    const previous: CompactionEntry = {
      id: "cmp-a",
      conversationId: "conv-1",
      firstKeptId: "old-kept",
      summary: "## Goal\nPrevious work",
      readFiles: ["src/Existing.tsx"],
      modifiedFiles: ["src/Changed.ts"],
      tokensBefore: 10_000,
      source: "auto",
      isSplitTurn: false,
      promptVersion: "initial",
      createdAt: 1,
      mode: "agent",
    };
    const messages: Message[] = [
      msg("u1", "user", "inspect and edit", 10),
      msg("a1", "assistant", "done " + "x".repeat(2_000), 11, {
        toolCalls: [
          {
            toolCallId: "read-1",
            toolName: "read_file",
            input: { path: "src/New.tsx" },
            output: "body",
            state: "done",
          },
          {
            toolCallId: "write-1",
            toolName: "edit_file",
            input: { path: "src/New.tsx" },
            output: "ok",
            state: "done",
          },
        ],
      }),
      msg("u2", "user", "continue", 12),
    ];

    const result = compactMessages(messages, 300, {
      previousEntry: previous,
      conversationId: "conv-1",
      mode: "agent",
      source: "auto",
      tokensBefore: 10_500,
    });

    expect(result.compactionEntry?.readFiles).toEqual(["src/Existing.tsx", "src/New.tsx"]);
    expect(result.compactionEntry?.modifiedFiles).toEqual(["src/Changed.ts", "src/New.tsx"]);
    expect(result.compactionEntry?.summary).toContain("src/New.tsx");
    expect(result.compactionEntry?.summary).not.toContain("src/Existing.tsx\nsrc/Existing.tsx");
  });
});
