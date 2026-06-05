/**
 * agentLoop serialization contract tests.
 *
 * agentLoop.mapMessagesForProvider is the single hook where goatLLM's
 * internal LlmMessage shape gets translated into what the AI SDK's
 * streamText accepts. PR2 (subagents) will extend tool calls with a
 * `subagentTranscript` field that MUST stay UI-only and never reach the
 * model — these tests document the contract before that field exists,
 * so PR2 can't silently regress it.
 */
import { describe, it, expect } from "vitest";
import type { LlmMessage } from "../lib/llm-types";

// We intentionally re-export mapMessagesForProvider from agentLoop for
// testing. Keeping it as an internal-but-exported helper preserves the
// "one source of truth" contract while letting the test suite assert it.
import { mapMessagesForProvider } from "../lib/agentLoop";

describe("agentLoop — provider serialization", () => {
  it("passes through string-content messages unchanged", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi back" },
    ];
    const out = mapMessagesForProvider(messages) as Array<{ role: string; content: unknown }>;
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ role: "user", content: "hello" });
    expect(out[1]).toEqual({ role: "assistant", content: "hi back" });
  });

  it("maps text + image parts to provider shape", () => {
    const messages: LlmMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          { type: "image", image: "data:image/png;base64,AAAA", mimeType: "image/png" },
        ],
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
    const out = mapMessagesForProvider(messages) as Array<{ role: string; content: any[] }>;
    expect(out[0].role).toBe("user");
    expect(out[0].content).toHaveLength(2);
    expect(out[0].content[0]).toEqual({ type: "text", text: "look at this" });
    expect((out[0].content as unknown[])[1]).toEqual({
      type: "image",
      image: "data:image/png;base64,AAAA",
      mimeType: "image/png",
    });
  });

  it("maps file parts to provider shape with mediaType", () => {
    const messages: LlmMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "summarize this paper" },
          { type: "file", data: "data:application/pdf;base64,AAAA", mimeType: "application/pdf" },
        ],
      },
    ];
    const out = mapMessagesForProvider(messages) as Array<{ role: string; content: unknown[] }>;
    expect(out[0].content[0]).toEqual({ type: "text", text: "summarize this paper" });
    expect(out[0].content[1]).toEqual({
      type: "file",
      data: "data:application/pdf;base64,AAAA",
      mediaType: "application/pdf",
    });
  });

  it("does not leak goatLLM-internal fields when present on a message", () => {
    // Simulate a forward-looking message shape with extra fields the
    // codebase might attach (matches the PR2 subagent transcript surface).
    // mapMessagesForProvider should only pass role + content (or its parts).
    const messages = [
      {
        role: "assistant",
        content: "summary",
        // The fields below should NOT appear on the mapped output. If they
        // do, PR2's subagent transcript will leak into provider history.
        subagentTranscript: [{ role: "assistant", content: "internal child reasoning" }],
        dangerLevel: "destructive",
        contentAtInvocation: 42,
      } as unknown as LlmMessage,
    ];
    const out = mapMessagesForProvider(messages) as Array<Record<string, unknown>>;
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("assistant");
    expect(out[0].content).toBe("summary");
    expect(out[0].subagentTranscript).toBeUndefined();
    expect(out[0].dangerLevel).toBeUndefined();
    expect(out[0].contentAtInvocation).toBeUndefined();
    // Whitelist check: role + content are the only allowed keys.
    expect(Object.keys(out[0]).sort()).toEqual(["content", "role"]);
  });
});
