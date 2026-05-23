import { describe, it, expect } from "vitest";
import { compactMessages, estimateTotalTokens } from "../lib/context-manager";
import type { Message } from "../stores/chat";

function msg(
  role: Message["role"],
  content: string,
  overrides: Partial<Message> = {},
): Message {
  return {
    id: Math.random().toString(36),
    conversationId: "test",
    role,
    content,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("compactMessages", () => {
  it("returns messages unchanged when under the limit", () => {
    const messages = [
      msg("user", "hi"),
      msg("assistant", "hello"),
    ];
    const r = compactMessages(messages, 10000);
    expect(r.compacted).toBe(false);
    expect(r.messages).toHaveLength(2);
    expect(r.summarizedCount).toBe(0);
    expect(r.truncatedCount).toBe(0);
  });

  it("strips tool calls in stripTools mode", () => {
    const messages = [
      msg("user", "list files"),
      msg("assistant", "did it", {
        toolCalls: [
          {
            toolCallId: "1",
            toolName: "list_dir",
            input: { path: "." },
            output: "file1.txt\nfile2.txt",
            state: "done",
          },
        ],
      }),
    ];
    const r = compactMessages(messages, 10000, { stripTools: true });
    expect(r.compacted).toBe(true);
    expect(r.toolsInlinedCount).toBe(1);
    // The assistant message content should now embed the tool result
    const assistant = r.messages.find((m) => m.role === "assistant")!;
    expect(typeof assistant.content === "string" && assistant.content).toMatch(/list_dir/);
    expect(typeof assistant.content === "string" && assistant.content).toMatch(/file1\.txt/);
  });

  it("truncates oversized tool outputs", () => {
    const huge = "x".repeat(5000);
    const messages = [
      msg("user", "go"),
      msg("assistant", "ok", {
        toolCalls: [
          {
            toolCallId: "1",
            toolName: "bash",
            input: { command: "yes" },
            output: huge,
            state: "done",
          },
        ],
      }),
    ];
    const r = compactMessages(messages, 100000);
    expect(r.compacted).toBe(true);
    expect(r.truncatedCount).toBe(1);
  });

  it("summarizes oldest messages when over limit", () => {
    const big = "x".repeat(2000); // ~500 tokens each
    const messages: Message[] = [];
    for (let i = 0; i < 30; i++) {
      messages.push(msg("user", `msg ${i} ${big}`));
      messages.push(msg("assistant", `reply ${i} ${big}`));
    }
    const r = compactMessages(messages, 1000);
    expect(r.compacted).toBe(true);
    expect(r.summarizedCount).toBeGreaterThan(0);
    // First message should be the system summary
    expect(r.messages[0].role).toBe("system");
    expect(typeof r.messages[0].content === "string" && r.messages[0].content).toMatch(/Earlier conversation summary/);
  });

  it("preserves system messages across compaction", () => {
    const big = "x".repeat(2000);
    const messages: Message[] = [
      msg("system", "be helpful"),
      ...Array.from({ length: 20 }, (_, i) => msg("user", `${i} ${big}`)),
    ];
    const r = compactMessages(messages, 500);
    // Original system message should still be in result
    const systemMsgs = r.messages.filter((m) => m.role === "system");
    expect(systemMsgs.length).toBeGreaterThanOrEqual(1);
    expect(typeof systemMsgs[0].content === "string" && systemMsgs[0].content).toBe("be helpful");
  });
});

describe("estimateTotalTokens", () => {
  it("returns 0 for empty conversations", () => {
    expect(estimateTotalTokens([])).toBe(0);
  });

  it("scales with content length", () => {
    const short = estimateTotalTokens([msg("user", "hi")]);
    const long = estimateTotalTokens([msg("user", "x".repeat(1000))]);
    expect(long).toBeGreaterThan(short);
  });

  it("includes tool-call overhead", () => {
    const noTools = estimateTotalTokens([msg("assistant", "ok")]);
    const withTools = estimateTotalTokens([
      msg("assistant", "ok", {
        toolCalls: [
          {
            toolCallId: "1",
            toolName: "list_dir",
            input: { path: "." },
            output: "x".repeat(500),
            state: "done",
          },
        ],
      }),
    ]);
    expect(withTools).toBeGreaterThan(noTools);
  });
});
