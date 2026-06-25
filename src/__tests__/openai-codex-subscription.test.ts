import { tool } from "ai";
import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmConfig, LlmMessage } from "../lib/llm-types";
import {
  OPENAI_CODEX_SUBSCRIPTION_BASE_URL,
  OPENAI_CODEX_SUBSCRIPTION_MODELS,
  OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID,
  buildCodexResponsesRequest,
  clampCodexPromptCacheKey,
  codexResponsesToolsFromToolSet,
  isOpenAICodexSubscriptionProvider,
  normalizeCodexStreamEvent,
  streamCodexSubscription,
} from "../lib/openai-codex-subscription";

const invokeMock = vi.hoisted(() => vi.fn());
const eventListeners = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
    eventListeners.set(eventName, callback);
    return () => eventListeners.delete(eventName);
  }),
}));

const config: LlmConfig = {
  provider: OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID,
  modelId: "gpt-5.5",
  apiKey: null,
  baseUrl: OPENAI_CODEX_SUBSCRIPTION_BASE_URL,
  reasoningEffort: "high",
  reasoning: true,
};

describe("OpenAI Codex subscription provider helpers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    eventListeners.clear();
  });

  it("defines a separate built-in provider and model catalog", () => {
    expect(OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID).toBe("openai-codex-subscription");
    expect(isOpenAICodexSubscriptionProvider("openai-codex-subscription")).toBe(true);
    expect(isOpenAICodexSubscriptionProvider("openai")).toBe(false);
    expect(OPENAI_CODEX_SUBSCRIPTION_MODELS.map((m) => m.id)).toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex-spark",
    ]);
  });

  it("builds a native Codex Responses request without API-key or CLI fields", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "Can you inspect this screenshot?" },
      { role: "assistant", content: "Sure, send it over." },
      {
        role: "user",
        content: [
          { type: "text", text: "Here it is." },
          { type: "image", image: "data:image/png;base64,AAAA", mimeType: "image/png" },
        ],
      },
    ];

    const body = buildCodexResponsesRequest(messages, "System rules", config, {
      sessionId: "session-123",
    });

    expect(body).toMatchObject({
      model: "gpt-5.5",
      store: false,
      stream: true,
      instructions: "System rules",
      text: { verbosity: "low" },
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: "session-123",
      tool_choice: "auto",
      parallel_tool_calls: true,
      reasoning: { effort: "high", summary: "auto" },
    });
    expect(JSON.stringify(body)).not.toContain("codex exec");
    expect(JSON.stringify(body)).not.toContain("apiKey");
    expect(body.input).toEqual([
      {
        role: "user",
        content: [{ type: "input_text", text: "Can you inspect this screenshot?" }],
      },
      {
        role: "assistant",
        content: [{ type: "output_text", text: "Sure, send it over." }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Here it is." },
          { type: "input_image", image_url: "data:image/png;base64,AAAA" },
        ],
      },
    ]);
  });

  it("omits reasoning when effort is off and clamps prompt cache keys", () => {
    const body = buildCodexResponsesRequest(
      [{ role: "user", content: "Hello" }],
      null,
      { ...config, reasoningEffort: "off" },
      { sessionId: "x".repeat(90) },
    );

    expect(body.reasoning).toBeUndefined();
    expect(body.instructions).toBe("You are a helpful assistant.");
    expect(body.prompt_cache_key).toBe("x".repeat(64));
    expect(clampCodexPromptCacheKey(undefined)).toBeUndefined();
  });

  it("normalizes output text, reasoning, usage, completion, and error events", () => {
    expect(normalizeCodexStreamEvent({ type: "response.output_text.delta", delta: "Hi" })).toEqual({
      type: "text",
      text: "Hi",
    });
    expect(
      normalizeCodexStreamEvent({
        type: "response.reasoning_summary_text.delta",
        delta: "Considering constraints",
      }),
    ).toEqual({ type: "thinking", text: "Considering constraints" });
    expect(
      normalizeCodexStreamEvent({
        type: "response.completed",
        response: {
          usage: {
            input_tokens: 10,
            output_tokens: 4,
            input_tokens_details: { cached_tokens: 3 },
          },
        },
      }),
    ).toEqual({
      type: "completed",
      usage: { inputTokens: 10, outputTokens: 4, cacheRead: 3 },
    });
    expect(
      normalizeCodexStreamEvent({
        type: "response.failed",
        response: { error: { message: "No entitlement" } },
      }),
    ).toEqual({ type: "error", message: "No entitlement" });
    expect(normalizeCodexStreamEvent({ type: "response.created" })).toEqual({ type: "ignore" });
  });

  it("maps goatLLM tools to Codex Responses function tools", async () => {
    const tools = {
      echo: tool({
        description: "Echo some text.",
        inputSchema: z.object({
          text: z.string().describe("Text to echo."),
        }),
        execute: async ({ text }) => `echo: ${text}`,
      }),
    };

    await expect(codexResponsesToolsFromToolSet(tools)).resolves.toEqual([
      expect.objectContaining({
        type: "function",
        name: "echo",
        description: "Echo some text.",
        parameters: expect.objectContaining({
          type: "object",
          required: ["text"],
          properties: {
            text: expect.objectContaining({
              type: "string",
              description: "Text to echo.",
            }),
          },
        }),
        strict: false,
      }),
    ]);
  });

  it("normalizes Responses function-call events", () => {
    expect(
      normalizeCodexStreamEvent({
        type: "response.output_item.done",
        item: {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "echo",
          arguments: "{\"text\":\"hi\"}",
        },
      }),
    ).toEqual({
      type: "tool-call",
      itemId: "fc_1",
      callId: "call_1",
      toolName: "echo",
      arguments: "{\"text\":\"hi\"}",
    });
    expect(
      normalizeCodexStreamEvent({
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        delta: "{\"text\"",
      }),
    ).toEqual({
      type: "tool-call-delta",
      itemId: "fc_1",
      argumentsDelta: "{\"text\"",
    });
  });

  it("streams native Codex events through goatLLM callbacks", async () => {
    invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      expect(command).toBe("openai_codex_stream");
      expect(args.body).toMatchObject({ model: "gpt-5.5", store: false, stream: true });
      expect(args.sessionId).toBe("session-123");
      queueMicrotask(() => {
        const listener = eventListeners.get(`openai-codex-stream:${args.runId}`);
        expect(listener).toBeDefined();
        listener?.({ payload: { kind: "event", event: { type: "response.output_text.delta", delta: "Hi" } } });
        listener?.({
          payload: {
            kind: "event",
            event: { type: "response.reasoning_summary_text.delta", delta: "thinking" },
          },
        });
        listener?.({
          payload: {
            kind: "event",
            event: {
              type: "response.completed",
              response: { usage: { input_tokens: 7, output_tokens: 2 } },
            },
          },
        });
        listener?.({ payload: { kind: "done", cancelled: false } });
      });
    });

    const callbacks = {
      onToken: vi.fn(),
      onThinking: vi.fn(),
      onUsage: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    };

    await streamCodexSubscription(
      [{ role: "user", content: "Hello" }],
      "System rules",
      config,
      callbacks,
      { sessionId: "session-123" },
    );

    expect(callbacks.onToken).toHaveBeenCalledWith("Hi");
    expect(callbacks.onThinking).toHaveBeenCalledWith("thinking");
    expect(callbacks.onUsage).toHaveBeenCalledWith({ inputTokens: 7, outputTokens: 2 });
    expect(callbacks.onDone).toHaveBeenCalledWith("Hi");
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("executes goatLLM tools and continues with Responses function-call output", async () => {
    const tools = {
      echo: tool({
        description: "Echo some text.",
        inputSchema: z.object({
          text: z.string(),
        }),
        execute: vi.fn(async ({ text }) => `echo: ${text}`),
      }),
    };

    invokeMock.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      expect(command).toBe("openai_codex_stream");
      const callIndex = invokeMock.mock.calls.length;
      queueMicrotask(() => {
        const listener = eventListeners.get(`openai-codex-stream:${args.runId}`);
        expect(listener).toBeDefined();
        if (callIndex === 1) {
          expect(args.body).toMatchObject({
            tools: expect.arrayContaining([
              expect.objectContaining({
                type: "function",
                name: "echo",
              }),
              expect.objectContaining({
                type: "function",
                name: "done",
              }),
            ]),
          });
          listener?.({
            payload: {
              kind: "event",
              event: {
                type: "response.output_item.done",
                item: {
                  type: "function_call",
                  id: "fc_1",
                  call_id: "call_1",
                  name: "echo",
                  arguments: "{\"text\":\"hi\"}",
                },
              },
            },
          });
          listener?.({ payload: { kind: "done", cancelled: false } });
          return;
        }

        expect(args.body).toMatchObject({
          input: expect.arrayContaining([
            {
              type: "function_call",
              id: "fc_1",
              call_id: "call_1",
              name: "echo",
              arguments: "{\"text\":\"hi\"}",
            },
            {
              type: "function_call_output",
              call_id: "call_1",
              output: "echo: hi",
            },
          ]),
        });
        listener?.({
          payload: {
            kind: "event",
            event: { type: "response.output_text.delta", delta: "All set." },
          },
        });
        listener?.({
          payload: {
            kind: "event",
            event: { type: "response.completed", response: { usage: { input_tokens: 12, output_tokens: 3 } } },
          },
        });
        listener?.({ payload: { kind: "done", cancelled: false } });
      });
    });

    const callbacks = {
      onToken: vi.fn(),
      onThinking: vi.fn(),
      onUsage: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onToolError: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    };

    await streamCodexSubscription(
      [{ role: "user", content: "Use echo." }],
      "System rules",
      config,
      callbacks,
      { sessionId: "session-123", tools },
    );

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(tools.echo.execute).toHaveBeenCalledWith(
      { text: "hi" },
      expect.objectContaining({ toolCallId: "call_1|fc_1" }),
    );
    expect(callbacks.onToolCall).toHaveBeenCalledWith({
      toolCallId: "call_1|fc_1",
      toolName: "echo",
      input: { text: "hi" },
    });
    expect(callbacks.onToolResult).toHaveBeenCalledWith({
      toolCallId: "call_1|fc_1",
      toolName: "echo",
      input: { text: "hi" },
      output: "echo: hi",
    });
    expect(callbacks.onToolError).not.toHaveBeenCalled();
    expect(callbacks.onToken).toHaveBeenCalledWith("All set.");
    expect(callbacks.onUsage).toHaveBeenCalledWith({ inputTokens: 12, outputTokens: 3 });
    expect(callbacks.onDone).toHaveBeenCalledWith("All set.");
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("executes many spawn_subagent calls concurrently in one tool round", async () => {
    let active = 0;
    let maxActive = 0;
    const subagentCount = 12;
    const tools = {
      spawn_subagent: tool({
        description: "Spawn a subagent.",
        inputSchema: z.object({
          task: z.string(),
        }),
        execute: vi.fn(async ({ task }) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active -= 1;
          return `done: ${String(task)}`;
        }),
      }),
    };

    invokeMock.mockImplementation(async (_command: string, args: Record<string, unknown>) => {
      await Promise.resolve();
      const callIndex = invokeMock.mock.calls.length;
      queueMicrotask(() => {
        const listener = eventListeners.get(`openai-codex-stream:${String(args.runId)}`);
        expect(listener).toBeDefined();
        if (callIndex === 1) {
          for (let i = 0; i < subagentCount; i++) {
            const index = String(i);
            listener?.({
              payload: {
                kind: "event",
                event: {
                  type: "response.output_item.done",
                  item: {
                    type: "function_call",
                    id: `fc_${index}`,
                    call_id: `call_${index}`,
                    name: "spawn_subagent",
                    arguments: JSON.stringify({ task: `task ${index}` }),
                  },
                },
              },
            });
          }
          listener?.({ payload: { kind: "done", cancelled: false } });
          return;
        }

        expect(args.body).toMatchObject({
          input: expect.arrayContaining([
            {
              type: "function_call_output",
              call_id: "call_11",
              output: "done: task 11",
            },
          ]),
        });
        listener?.({
          payload: {
            kind: "event",
            event: { type: "response.output_text.delta", delta: "Merged." },
          },
        });
        listener?.({ payload: { kind: "done", cancelled: false } });
      });
    });

    const callbacks = {
      onToken: vi.fn(),
      onThinking: vi.fn(),
      onUsage: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onToolError: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    };

    await streamCodexSubscription(
      [{ role: "user", content: "Spawn many subagents." }],
      "System rules",
      config,
      callbacks,
      { tools, subagentsEnabled: false },
    );

    expect(tools.spawn_subagent.execute).toHaveBeenCalledTimes(subagentCount);
    expect(maxActive).toBe(subagentCount);
    expect(callbacks.onToolResult).toHaveBeenCalledTimes(subagentCount);
    expect(callbacks.onDone).toHaveBeenCalledWith("Merged.");
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
});
