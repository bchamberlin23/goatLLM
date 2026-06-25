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
import { beforeEach, describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { LlmMessage } from "../lib/llm-types";

const mocks = vi.hoisted(() => ({
  streamText: vi.fn(),
  createModel: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: mocks.streamText,
    stepCountIs: (count: number) => ({ type: "step-count", count }),
  };
});

vi.mock("../lib/model-factory", () => ({
  createModel: mocks.createModel,
}));

// We intentionally re-export mapMessagesForProvider from agentLoop for
// testing. Keeping it as an internal-but-exported helper preserves the
// "one source of truth" contract while letting the test suite assert it.
import { TOOL_STEP_BATCH_SIZE, agentLoop, mapMessagesForProvider } from "../lib/agentLoop";

function fakeStream({
  chunks,
  steps,
  messages = [],
}: {
  chunks: unknown[];
  steps: unknown[];
  messages?: unknown[];
}) {
  return {
    fullStream: (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
    response: Promise.resolve({ messages }),
    steps: Promise.resolve(steps),
    usage: Promise.resolve({ inputTokens: 100, outputTokens: 10, totalTokens: 110, inputTokenDetails: {} }),
  };
}

describe("agentLoop — provider serialization", () => {
  beforeEach(() => {
    mocks.streamText.mockReset();
    mocks.createModel.mockReset();
    mocks.createModel.mockResolvedValue({});
  });

  it("uses a subagent-friendly tool step batch above the old ten-step ceiling", () => {
    expect(TOOL_STEP_BATCH_SIZE).toBeGreaterThan(10);
  });

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

describe("agentLoop — tool continuation", () => {
  beforeEach(() => {
    mocks.streamText.mockReset();
    mocks.createModel.mockReset();
    mocks.createModel.mockResolvedValue({});
  });

  it("continues after a textual action preamble instead of ending the turn before tool use", async () => {
    mocks.streamText
      .mockReturnValueOnce(fakeStream({
        chunks: [
          { type: "text-delta", text: "I'll inspect the project files now." },
          { type: "finish" },
        ],
        steps: [{ finishReason: "stop", toolCalls: [] }],
        messages: [{ role: "assistant", content: "I'll inspect the project files now." }],
      }))
      .mockReturnValueOnce(fakeStream({
        chunks: [
          { type: "tool-call", toolCallId: "tc-1", toolName: "read_file", input: { path: "package.json" } },
          { type: "tool-result", toolCallId: "tc-1", toolName: "read_file", input: { path: "package.json" }, output: "{}" },
          { type: "tool-call", toolCallId: "done-1", toolName: "done", input: { summary: "Inspected package.json." } },
          { type: "tool-result", toolCallId: "done-1", toolName: "done", input: { summary: "Inspected package.json." }, output: { done: true } },
          { type: "finish" },
        ],
        steps: [
          {
            finishReason: "tool-calls",
            toolCalls: [
              { toolCallId: "tc-1", toolName: "read_file", input: { path: "package.json" } },
              { toolCallId: "done-1", toolName: "done", input: { summary: "Inspected package.json." } },
            ],
            toolResults: [
              { toolCallId: "tc-1", output: "{}" },
              { toolCallId: "done-1", output: { done: true } },
            ],
          },
        ],
        messages: [],
      }));

    const tokens: string[] = [];
    const toolCalls: string[] = [];
    const done = vi.fn();

    await agentLoop(
      [{ role: "user", content: "Check the project files." }],
      "Use tools when inspecting files.",
      { provider: "openai", modelId: "gpt-4.1", apiKey: "test" },
      {
        onToken: (token) => tokens.push(token),
        onToolCall: (toolCall) => toolCalls.push(toolCall.toolName),
        onDone: done,
        onError: (error) => {
          throw error;
        },
      },
      {
        tools: {
          read_file: {
            description: "Read a file",
            inputSchema: z.object({ path: z.string() }),
            execute: vi.fn(),
          },
        },
        subagentsEnabled: false,
      },
    );

    expect(mocks.streamText).toHaveBeenCalledTimes(2);
    expect(tokens.join("")).toBe("I'll inspect the project files now.");
    expect(toolCalls).toContain("read_file");
    expect(done).toHaveBeenCalledWith("I'll inspect the project files now.", "Inspected package.json.");
  });
});
