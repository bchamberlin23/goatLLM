import { describe, expect, it } from "vitest";

import { findCutPoint, findValidCutPoints } from "../lib/compaction/cut-point";

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

describe("cut point helpers", () => {
  it("allows cuts at user, assistant, system, and compaction summary messages", () => {
    const messages = [
      msg("s", "system", "system", 1),
      msg("u", "user", "user", 2),
      msg("a", "assistant", "assistant", 3),
    ];

    expect(findValidCutPoints(messages, 0, messages.length - 1)).toEqual([0, 1, 2]);
  });

  it("keeps an assistant message and its completed tool results together", () => {
    const messages = [
      msg("u1", "user", "do it", 1),
      msg("a1", "assistant", "tool used", 2, {
        toolCalls: [
          {
            toolCallId: "tool-1",
            toolName: "read_file",
            input: { path: "src/App.tsx" },
            output: "file body",
            state: "done",
          },
        ],
      }),
      msg("u2", "user", "next", 3),
    ];

    const result = findCutPoint(messages, 0, messages.length - 1, 10);

    expect(result.firstKeptIndex).not.toBe(1);
    expect(messages[result.firstKeptIndex].id).toBe("u2");
  });

  it("detects a split turn and returns the turn start index", () => {
    const large = "x".repeat(800);
    const messages = [
      msg("u1", "user", "start", 1),
      msg("a1", "assistant", large, 2),
      msg("a2", "assistant", large, 3),
    ];

    const result = findCutPoint(messages, 0, messages.length - 1, 120);

    expect(result.isSplitTurn).toBe(true);
    expect(result.turnStartIndex).toBe(0);
    expect(result.turnPrefixEndIndex).toBeLessThan(result.firstKeptIndex);
  });

  it("snaps before a pinned message that straddles the budget boundary", () => {
    const messages = [
      msg("u1", "user", "old", 1),
      msg("pin", "assistant", "pinned " + "x".repeat(700), 2, { pinned: true }),
      msg("u2", "user", "recent", 3),
    ];

    const result = findCutPoint(messages, 0, messages.length - 1, 60);

    expect(messages[result.firstKeptIndex].id).toBe("pin");
  });
});
