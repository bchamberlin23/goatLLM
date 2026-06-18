import { describe, expect, it } from "vitest";

import { estimateContextTokens } from "../lib/context-manager";

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

describe("estimateContextTokens", () => {
  it("uses the last assistant usage as the prefix and estimates trailing messages", () => {
    const messages: Message[] = [
      msg("u1", "user", "hello", 1),
      msg("a1", "assistant", "reply", 2, {
        usage: {
          totalTokens: 1_000,
          inputTokens: 700,
          outputTokens: 300,
        },
      }),
      msg("u2", "user", "x".repeat(400), 3),
    ];

    const result = estimateContextTokens(messages);

    expect(result.usageTokens).toBe(1_000);
    expect(result.trailingTokens).toBeGreaterThanOrEqual(100);
    expect(result.tokens).toBe(result.usageTokens + result.trailingTokens);
    expect(result.lastUsageIndex).toBe(1);
  });

  it("ignores aborted or error assistant messages when finding usage", () => {
    const messages: Message[] = [
      msg("a1", "assistant", "ok", 1, {
        usage: { totalTokens: 500 },
      }),
      msg("a2", "assistant", "Error: failed", 2, {
        interrupted: true,
        usage: { totalTokens: 5_000 },
      }),
      msg("u1", "user", "continue", 3),
    ];

    const result = estimateContextTokens(messages);

    expect(result.usageTokens).toBe(500);
    expect(result.lastUsageIndex).toBe(0);
  });
});
