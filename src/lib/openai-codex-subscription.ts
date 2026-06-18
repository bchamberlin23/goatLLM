import { asSchema, type ModelMessage, type ToolSet } from "ai";
import type { ModelConfig } from "./providers";
import type { LlmConfig, LlmContentPart, LlmMessage, StreamCallbacks } from "./llm-types";
import { resolveReasoningRequest } from "./reasoning";

type FlexibleToolSchema = Parameters<typeof asSchema>[0];

export const OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID = "openai-codex-subscription";
export const OPENAI_CODEX_SUBSCRIPTION_PROVIDER_NAME = "OpenAI Codex";
export const OPENAI_CODEX_SUBSCRIPTION_BASE_URL = "https://chatgpt.com/backend-api";

export const OPENAI_CODEX_SUBSCRIPTION_MODELS: ModelConfig[] = [
  { id: "gpt-5.5", name: "GPT-5.5", contextWindow: 272_000, vision: true, reasoning: true },
  { id: "gpt-5.4", name: "GPT-5.4", contextWindow: 272_000, vision: true, reasoning: true },
  { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", contextWindow: 272_000, vision: true, reasoning: true },
  { id: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark", contextWindow: 272_000, vision: true, reasoning: true },
];

export function isOpenAICodexSubscriptionProvider(providerId: string): boolean {
  return providerId === OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID;
}

export interface CodexResponsesTextPart {
  type: "input_text" | "output_text";
  text: string;
}

export interface CodexResponsesImagePart {
  type: "input_image";
  image_url: string;
}

export interface CodexResponsesFilePart {
  type: "input_file";
  file_data: string;
}

export interface CodexResponsesInputMessage {
  role: "user" | "assistant" | "system";
  content: Array<CodexResponsesTextPart | CodexResponsesImagePart | CodexResponsesFilePart>;
}

export interface CodexResponsesFunctionCallItem {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
}

export interface CodexResponsesFunctionCallOutputItem {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export type CodexResponsesInputItem =
  | CodexResponsesInputMessage
  | CodexResponsesFunctionCallItem
  | CodexResponsesFunctionCallOutputItem;

export interface CodexResponsesTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: false;
}

export interface CodexResponsesRequest {
  model: string;
  store: false;
  stream: true;
  instructions: string;
  input: CodexResponsesInputItem[];
  text: { verbosity: "low" | "medium" | "high" };
  include: string[];
  prompt_cache_key?: string;
  tool_choice: "auto";
  parallel_tool_calls: true;
  tools?: CodexResponsesTool[];
  reasoning?: { effort: string; summary: "auto" };
  max_output_tokens?: number;
}

export type NormalizedCodexStreamEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "tool-call";
      itemId?: string;
      callId?: string;
      toolName?: string;
      arguments: string;
    }
  | {
      type: "tool-call-delta";
      itemId?: string;
      callId?: string;
      argumentsDelta: string;
    }
  | {
      type: "tool-call-start";
      itemId?: string;
      callId?: string;
      toolName?: string;
      arguments?: string;
    }
  | {
      type: "completed";
      usage?: {
        inputTokens: number;
        outputTokens: number;
        cacheRead?: number;
        cacheWrite?: number;
      };
    }
  | { type: "error"; message: string }
  | { type: "ignore" };

export interface StreamCodexSubscriptionOptions {
  abortSignal?: AbortSignal;
  parentSignal?: AbortSignal;
  sessionId?: string;
  tools?: ToolSet;
  maxToolRounds?: number;
  subagentsEnabled?: boolean;
  depth?: number;
}

export function clampCodexPromptCacheKey(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  const chars = Array.from(key);
  return chars.length <= 64 ? key : chars.slice(0, 64).join("");
}

export function buildCodexResponsesRequest(
  messages: LlmMessage[],
  systemPrompt: string | null,
  config: LlmConfig,
  options?: {
    sessionId?: string;
    inputItems?: CodexResponsesInputItem[];
    tools?: CodexResponsesTool[];
  },
): CodexResponsesRequest {
  const promptCacheKey = clampCodexPromptCacheKey(options?.sessionId);
  const body: CodexResponsesRequest = {
    model: config.modelId,
    store: false,
    stream: true,
    instructions: systemPrompt?.trim() || "You are a helpful assistant.",
    input: options?.inputItems ?? messages.map(toCodexInputMessage),
    text: { verbosity: "low" },
    include: ["reasoning.encrypted_content"],
    tool_choice: "auto",
    parallel_tool_calls: true,
  };

  if (promptCacheKey) {
    body.prompt_cache_key = promptCacheKey;
  }

  if (options?.tools?.length) {
    body.tools = options.tools;
  }

  if (config.maxResponseTokens && config.maxResponseTokens > 0) {
    body.max_output_tokens = config.maxResponseTokens;
  }

  const resolvedReasoning = resolveReasoningRequest({ config });
  if (resolvedReasoning.codexReasoning) {
    body.reasoning = resolvedReasoning.codexReasoning;
  }

  return body;
}

export async function codexResponsesToolsFromToolSet(tools: ToolSet): Promise<CodexResponsesTool[]> {
  const entries = Object.entries(tools);
  const converted = await Promise.all(
    entries.map(async ([name, definition]) => {
      const toolDefinition = definition as {
        description?: string;
        inputSchema?: unknown;
        strict?: boolean;
      };
      const schema = toolDefinition.inputSchema
        ? await asSchema(toolDefinition.inputSchema as FlexibleToolSchema).jsonSchema
        : emptyParametersSchema();
      return {
        type: "function" as const,
        name,
        description: toolDefinition.description ?? "",
        parameters: isRecord(schema) ? schema : emptyParametersSchema(),
        strict: false as const,
      };
    }),
  );
  return converted;
}

function toCodexInputMessage(message: LlmMessage): CodexResponsesInputMessage {
  const role = message.role;
  if (typeof message.content === "string") {
    return {
      role,
      content: [textPartForRole(role, message.content)],
    };
  }

  return {
    role,
    content: message.content.flatMap((part) => toCodexContentPart(role, part)),
  };
}

function textPartForRole(role: LlmMessage["role"], text: string): CodexResponsesTextPart {
  return {
    type: role === "assistant" ? "output_text" : "input_text",
    text,
  };
}

function toCodexContentPart(
  role: LlmMessage["role"],
  part: LlmContentPart,
): Array<CodexResponsesTextPart | CodexResponsesImagePart | CodexResponsesFilePart> {
  if (part.type === "text") return [textPartForRole(role, part.text)];
  if (part.type === "image") return [{ type: "input_image", image_url: part.image }];
  return [{ type: "input_file", file_data: part.data }];
}

export function normalizeCodexStreamEvent(event: unknown): NormalizedCodexStreamEvent {
  if (!event || typeof event !== "object") return { type: "ignore" };
  const payload = event as Record<string, unknown>;
  const type = typeof payload.type === "string" ? payload.type : "";

  if (type === "response.output_text.delta") {
    return { type: "text", text: stringField(payload.delta) };
  }

  if (
    type === "response.reasoning_summary_text.delta" ||
    type === "response.reasoning_summary.delta" ||
    type === "response.reasoning_text.delta"
  ) {
    return { type: "thinking", text: stringField(payload.delta) };
  }

  if (type === "response.completed" || type === "response.done" || type === "response.incomplete") {
    return { type: "completed", usage: usageFromResponse(payload.response) };
  }

  if (type === "response.output_item.added") {
    const item = functionCallItem(payload.item);
    if (item) {
      return {
        type: "tool-call-start",
        itemId: item.itemId,
        callId: item.callId,
        toolName: item.toolName,
        arguments: item.arguments,
      };
    }
  }

  if (type === "response.function_call_arguments.delta") {
    return {
      type: "tool-call-delta",
      itemId: stringField(payload.item_id) || stringField(payload.itemId) || undefined,
      callId: stringField(payload.call_id) || stringField(payload.callId) || undefined,
      argumentsDelta: stringField(payload.delta),
    };
  }

  if (type === "response.function_call_arguments.done") {
    return {
      type: "tool-call",
      itemId: stringField(payload.item_id) || stringField(payload.itemId) || undefined,
      callId: stringField(payload.call_id) || stringField(payload.callId) || undefined,
      toolName: stringField(payload.name) || undefined,
      arguments: stringField(payload.arguments),
    };
  }

  if (type === "response.output_item.done") {
    const item = functionCallItem(payload.item);
    if (item) {
      return {
        type: "tool-call",
        itemId: item.itemId,
        callId: item.callId,
        toolName: item.toolName,
        arguments: item.arguments ?? "",
      };
    }
  }

  if (type === "response.failed") {
    return { type: "error", message: errorMessageFromResponse(payload.response) };
  }

  if (type === "error") {
    const message =
      stringField(payload.message) ||
      stringField(payload.code) ||
      "OpenAI Codex returned an error.";
    return { type: "error", message };
  }

  return { type: "ignore" };
}

export async function streamCodexSubscription(
  messages: LlmMessage[],
  systemPrompt: string | null,
  config: LlmConfig,
  callbacks: StreamCallbacks,
  options?: StreamCodexSubscriptionOptions,
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  const signal = combineSignals(options?.abortSignal, options?.parentSignal);
  let inputItems: CodexResponsesInputItem[] = messages.map(toCodexInputMessage);
  let fullText = "";
  let toolRounds = 0;
  const maxToolRounds = Math.max(0, options?.maxToolRounds ?? 30);

  try {
    const effectiveTools = await buildEffectiveTools(config, options);
    const codexTools = effectiveTools ? await codexResponsesToolsFromToolSet(effectiveTools) : undefined;

    while (true) {
      if (signal?.aborted) {
        callbacks.onDone(fullText);
        return;
      }

      const body = buildCodexResponsesRequest(messages, systemPrompt, config, {
        sessionId: options?.sessionId,
        inputItems,
        tools: codexTools,
      });

      const response = await streamCodexRequestOnce({
        body,
        config,
        invoke,
        listen,
        sessionId: options?.sessionId,
        signal,
        callbacks,
        onText: (text) => {
          fullText += text;
        },
      });

      if (response.aborted) {
        callbacks.onDone(fullText);
        return;
      }

      if (!response.toolCalls.length) {
        callbacks.onDone(fullText);
        return;
      }

      if (!effectiveTools) {
        callbacks.onError(new Error("OpenAI Codex requested a tool, but no goatLLM tools are active."));
        return;
      }

      if (toolRounds >= maxToolRounds) {
        callbacks.onError(
          new Error(`OpenAI Codex reached the tool round limit (${maxToolRounds}).`),
        );
        return;
      }
      toolRounds += 1;

      if (response.text) {
        inputItems = [
          ...inputItems,
          {
            role: "assistant",
            content: [{ type: "output_text", text: response.text }],
          },
        ];
      }

      const toolExecution = await executeCodexToolCalls({
        toolCalls: response.toolCalls,
        tools: effectiveTools,
        callbacks,
        messages,
        abortSignal: signal,
      });

      if (toolExecution.done) {
        callbacks.onDone(fullText, toolExecution.summary);
        return;
      }

      inputItems = [...inputItems, ...toolExecution.inputItems];
    }
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && /abort|cancel/i.test(error.message))
    ) {
      callbacks.onDone(fullText);
      return;
    }
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

interface CodexStreamRequestOnceArgs {
  body: CodexResponsesRequest;
  config: LlmConfig;
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  listen: (
    eventName: string,
    callback: (event: { payload: unknown }) => void,
  ) => Promise<() => void>;
  sessionId?: string;
  signal?: AbortSignal;
  callbacks: StreamCallbacks;
  onText: (text: string) => void;
}

interface CodexStreamRequestOnceResult {
  text: string;
  toolCalls: CapturedCodexToolCall[];
  aborted: boolean;
}

async function streamCodexRequestOnce({
  body,
  config,
  invoke,
  listen,
  sessionId,
  signal,
  callbacks,
  onText,
}: CodexStreamRequestOnceArgs): Promise<CodexStreamRequestOnceResult> {
  const runId = createRunId();
  const eventName = `openai-codex-stream:${runId}`;
  const pendingToolCalls = new PendingCodexToolCalls();
  let text = "";
  let settled = false;
  let unlisten: (() => void) | undefined;
  let abortHandler: (() => void) | undefined;
  let resolveDone: (result: CodexStreamRequestOnceResult) => void = () => undefined;
  let rejectDone: (error: Error) => void = () => undefined;

  const donePromise = new Promise<CodexStreamRequestOnceResult>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const settle = (result: CodexStreamRequestOnceResult) => {
    if (settled) return;
    settled = true;
    resolveDone(result);
  };

  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    rejectDone(error);
  };

  try {
    unlisten = await listen(eventName, (event: { payload: unknown }) => {
      const payload = event.payload;
      if (!payload || typeof payload !== "object") return;
      const record = payload as Record<string, unknown>;
      const kind = typeof record.kind === "string" ? record.kind : "";

      if (kind === "event") {
        const normalized = normalizeCodexStreamEvent(record.event);
        switch (normalized.type) {
          case "text":
            text += normalized.text;
            onText(normalized.text);
            callbacks.onToken(normalized.text);
            break;
          case "thinking":
            callbacks.onThinking?.(normalized.text);
            break;
          case "completed":
            if (normalized.usage) callbacks.onUsage?.(normalized.usage);
            break;
          case "tool-call-start":
            pendingToolCalls.upsert({
              itemId: normalized.itemId,
              callId: normalized.callId,
              toolName: normalized.toolName,
              arguments: normalized.arguments,
            });
            break;
          case "tool-call-delta":
            pendingToolCalls.appendArguments({
              itemId: normalized.itemId,
              callId: normalized.callId,
              argumentsDelta: normalized.argumentsDelta,
            });
            break;
          case "tool-call":
            pendingToolCalls.upsert({
              itemId: normalized.itemId,
              callId: normalized.callId,
              toolName: normalized.toolName,
              arguments: normalized.arguments,
            });
            break;
          case "error":
            fail(new Error(normalized.message));
            break;
          case "ignore":
            break;
        }
        return;
      }

      if (kind === "error") {
        const message =
          typeof record.message === "string"
            ? record.message
            : "OpenAI Codex returned an error.";
        fail(new Error(message));
        return;
      }

      if (kind === "done") {
        settle({
          text,
          toolCalls: pendingToolCalls.finalize(),
          aborted: false,
        });
      }
    });

    abortHandler = () => {
      void invoke("openai_codex_cancel", { runId }).catch(() => undefined);
      settle({ text, toolCalls: pendingToolCalls.finalize(), aborted: true });
    };

    if (signal?.aborted) {
      abortHandler();
    } else {
      signal?.addEventListener("abort", abortHandler, { once: true });

      void invoke("openai_codex_stream", {
        runId,
        body,
        sessionId,
        baseUrl: config.baseUrl ?? OPENAI_CODEX_SUBSCRIPTION_BASE_URL,
      }).catch((error: unknown) => {
        if (settled || signal?.aborted) return;
        fail(error instanceof Error ? error : new Error(String(error)));
      });
    }

    return await donePromise;
  } finally {
    if (abortHandler) {
      signal?.removeEventListener("abort", abortHandler);
    }
    unlisten?.();
  }
}

function createRunId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `codex-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

interface CapturedCodexToolCall {
  itemId?: string;
  callId: string;
  toolName: string;
  arguments: string;
}

interface PendingCodexToolCall {
  itemId?: string;
  callId?: string;
  toolName?: string;
  arguments: string;
}

class PendingCodexToolCalls {
  private readonly calls = new Map<string, PendingCodexToolCall>();

  upsert(call: {
    itemId?: string;
    callId?: string;
    toolName?: string;
    arguments?: string;
  }): void {
    const key = this.keyFor(call);
    const previous = this.calls.get(key) ?? { arguments: "" };
    this.calls.set(key, {
      ...previous,
      itemId: call.itemId ?? previous.itemId,
      callId: call.callId ?? previous.callId,
      toolName: call.toolName ?? previous.toolName,
      arguments: call.arguments ?? previous.arguments,
    });
  }

  appendArguments(call: {
    itemId?: string;
    callId?: string;
    argumentsDelta: string;
  }): void {
    const key = this.keyFor(call);
    const previous = this.calls.get(key) ?? { arguments: "" };
    this.calls.set(key, {
      ...previous,
      itemId: call.itemId ?? previous.itemId,
      callId: call.callId ?? previous.callId,
      arguments: `${previous.arguments}${call.argumentsDelta}`,
    });
  }

  finalize(): CapturedCodexToolCall[] {
    return Array.from(this.calls.values()).flatMap((call) => {
      if (!call.callId || !call.toolName) return [];
      return [
        {
          itemId: call.itemId,
          callId: call.callId,
          toolName: call.toolName,
          arguments: call.arguments || "{}",
        },
      ];
    });
  }

  private keyFor(call: { itemId?: string; callId?: string }): string {
    if (call.itemId) return `item:${call.itemId}`;
    if (call.callId) {
      for (const [key, existing] of this.calls) {
        if (existing.callId === call.callId) return key;
      }
      return `call:${call.callId}`;
    }
    if (this.calls.size === 1) return Array.from(this.calls.keys())[0];
    return `unknown:${this.calls.size}`;
  }
}

interface ExecuteCodexToolCallsArgs {
  toolCalls: CapturedCodexToolCall[];
  tools: ToolSet;
  callbacks: StreamCallbacks;
  messages: LlmMessage[];
  abortSignal?: AbortSignal;
}

interface ExecuteCodexToolCallsResult {
  inputItems: CodexResponsesInputItem[];
  done: boolean;
  summary?: string;
}

async function executeCodexToolCalls({
  toolCalls,
  tools,
  callbacks,
  messages,
  abortSignal,
}: ExecuteCodexToolCallsArgs): Promise<ExecuteCodexToolCallsResult> {
  const inputItems: CodexResponsesInputItem[] = [];
  const providerMessages = mapMessagesForToolExecution(messages);

  for (const toolCall of toolCalls) {
    const toolCallId = codexToolCallId(toolCall);
    const rawInput = parseToolArguments(toolCall);
    const toolDefinition = tools[toolCall.toolName];
    const input = toolDefinition
      ? await validateToolInput(toolDefinition, rawInput)
      : rawInput;

    callbacks.onToolCall?.({
      toolCallId,
      toolName: toolCall.toolName,
      input,
    });

    const callItem: CodexResponsesFunctionCallItem = {
      type: "function_call",
      ...(toolCall.itemId ? { id: toolCall.itemId } : {}),
      call_id: toolCall.callId,
      name: toolCall.toolName,
      arguments: JSON.stringify(input),
    };

    let output: unknown;
    let outputText: string;

    if (!toolDefinition || typeof toolDefinition.execute !== "function") {
      const error = new Error(`Tool "${toolCall.toolName}" is not available in goatLLM.`);
      callbacks.onToolError?.({ toolCallId, toolName: toolCall.toolName, error });
      output = { error: error.message };
      outputText = serializeToolOutput(output);
    } else {
      try {
        const rawOutput = await toolDefinition.execute(input, {
          toolCallId,
          messages: providerMessages,
          abortSignal,
        });
        output = await collectToolOutput(rawOutput);
        callbacks.onToolResult?.({
          toolCallId,
          toolName: toolCall.toolName,
          input,
          output,
        });
        outputText = await serializeToolOutputForModel(toolDefinition, {
          toolCallId,
          input,
          output,
        });
      } catch (error) {
        callbacks.onToolError?.({ toolCallId, toolName: toolCall.toolName, error });
        output = {
          error: error instanceof Error ? error.message : String(error),
        };
        outputText = serializeToolOutput(output);
      }
    }

    if (toolCall.toolName === "done" && isDoneResultAllowed(output)) {
      return {
        inputItems,
        done: true,
        summary: doneSummaryFromInput(input),
      };
    }

    inputItems.push(callItem, {
      type: "function_call_output",
      call_id: toolCall.callId,
      output: outputText,
    });
  }

  return { inputItems, done: false };
}

async function buildEffectiveTools(
  config: LlmConfig,
  options?: StreamCodexSubscriptionOptions,
): Promise<ToolSet | undefined> {
  if (!hasTools(options?.tools)) return undefined;
  let effectiveTools: ToolSet = { ...options.tools };
  const depth = options?.depth ?? 0;
  const subagentsEnabled = options?.subagentsEnabled !== false;

  if (depth < 2 && subagentsEnabled) {
    const { createSpawnSubagent } = await import("./tools/builtins/subagent");
    effectiveTools = {
      ...effectiveTools,
      spawn_subagent: createSpawnSubagent({
        depth,
        parentSignal: options?.parentSignal,
        abortSignal: options?.abortSignal,
        config,
        maxToolRounds: options?.maxToolRounds,
      }),
    };
  }

  const { done } = await import("./tools/builtins/done");
  return { ...effectiveTools, done };
}

function hasTools(tools: ToolSet | undefined): tools is ToolSet {
  return !!tools && Object.keys(tools).length > 0;
}

function combineSignals(
  inner: AbortSignal | undefined,
  parent: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!parent) return inner;
  if (!inner) return parent;
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") return anyFn([inner, parent]);

  const controller = new AbortController();
  const abortInner = () => controller.abort(inner.reason);
  const abortParent = () => controller.abort(parent.reason);
  if (inner.aborted) controller.abort(inner.reason);
  else inner.addEventListener("abort", abortInner, { once: true });
  if (parent.aborted) controller.abort(parent.reason);
  else parent.addEventListener("abort", abortParent, { once: true });
  return controller.signal;
}

function codexToolCallId(toolCall: CapturedCodexToolCall): string {
  return toolCall.itemId ? `${toolCall.callId}|${toolCall.itemId}` : toolCall.callId;
}

function parseToolArguments(toolCall: CapturedCodexToolCall): unknown {
  const text = toolCall.arguments.trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON arguments for ${toolCall.toolName}: ${message}`);
  }
}

async function validateToolInput(toolDefinition: ToolSet[string], input: unknown): Promise<unknown> {
  const schema = asSchema(
    (toolDefinition as { inputSchema?: unknown }).inputSchema as FlexibleToolSchema,
  );
  if (typeof schema.validate !== "function") return input;
  const result = await schema.validate(input);
  if (result.success) return result.value;
  throw result.error;
}

async function collectToolOutput(output: unknown): Promise<unknown> {
  if (!isAsyncIterable(output)) return output;
  const chunks: unknown[] = [];
  for await (const chunk of output) {
    chunks.push(chunk);
  }
  return chunks.length === 1 ? chunks[0] : chunks;
}

async function serializeToolOutputForModel(
  toolDefinition: ToolSet[string],
  args: { toolCallId: string; input: unknown; output: unknown },
): Promise<string> {
  const toModelOutput = (toolDefinition as {
    toModelOutput?: (options: typeof args) => unknown | PromiseLike<unknown>;
  }).toModelOutput;
  if (typeof toModelOutput !== "function") return serializeToolOutput(args.output);
  return serializeModelOutput(await toModelOutput(args), args.output);
}

function serializeModelOutput(modelOutput: unknown, fallback: unknown): string {
  if (!modelOutput || typeof modelOutput !== "object") return serializeToolOutput(fallback);
  const output = modelOutput as { type?: unknown; value?: unknown; reason?: unknown };
  if (output.type === "text" || output.type === "error-text") {
    return typeof output.value === "string" ? output.value : serializeToolOutput(output.value);
  }
  if (output.type === "json" || output.type === "error-json") {
    return serializeToolOutput(output.value);
  }
  if (output.type === "execution-denied") {
    const reason = typeof output.reason === "string" ? output.reason : "Tool execution was denied.";
    return serializeToolOutput({ error: reason });
  }
  if (output.type === "content" && Array.isArray(output.value)) {
    const text = output.value
      .flatMap((part) =>
        part && typeof part === "object" && (part as { type?: unknown }).type === "text"
          ? [stringField((part as { text?: unknown }).text)]
          : [],
      )
      .filter(Boolean)
      .join("\n");
    return text || serializeToolOutput(output.value);
  }
  return serializeToolOutput(fallback);
}

function serializeToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output === undefined) return "";
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function doneSummaryFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const summary = (input as { summary?: unknown }).summary;
  return typeof summary === "string" ? summary : undefined;
}

function isDoneResultAllowed(output: unknown): boolean {
  if (!output || typeof output !== "object") return true;
  const result = output as { done?: unknown; blocked?: unknown };
  return result.done !== false && result.blocked !== true;
}

function mapMessagesForToolExecution(messages: LlmMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return { role: message.role, content: message.content } as ModelMessage;
    }
    return {
      role: message.role,
      content: message.content.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text };
        if (part.type === "image") return { type: "image", image: part.image, mimeType: part.mimeType };
        return { type: "file", data: part.data, mediaType: part.mimeType };
      }),
    } as ModelMessage;
  });
}

function functionCallItem(value: unknown):
  | {
      itemId?: string;
      callId?: string;
      toolName?: string;
      arguments?: string;
    }
  | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (item.type !== "function_call") return undefined;
  const itemId = stringField(item.id) || undefined;
  const callId = stringField(item.call_id) || stringField(item.callId) || undefined;
  const toolName = stringField(item.name) || undefined;
  const args = stringField(item.arguments);
  return {
    itemId,
    callId,
    toolName,
    arguments: args,
  };
}

function emptyParametersSchema(): Record<string, unknown> {
  return { type: "object", properties: {}, additionalProperties: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return !!value && typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorMessageFromResponse(value: unknown): string {
  if (!value || typeof value !== "object") return "OpenAI Codex response failed.";
  const response = value as Record<string, unknown>;
  const error = response.error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "OpenAI Codex response failed.";
}

function usageFromResponse(value: unknown): NormalizedCodexStreamEvent extends infer T
  ? T extends { type: "completed"; usage?: infer U }
    ? U | undefined
    : never
  : never {
  if (!value || typeof value !== "object") return undefined;
  const usage = (value as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as Record<string, unknown>;
  const inputTokens = numberField(u.input_tokens);
  const outputTokens = numberField(u.output_tokens);
  const details = u.input_tokens_details;
  const outputDetails = u.output_tokens_details;
  const cacheRead =
    details && typeof details === "object"
      ? numberField((details as Record<string, unknown>).cached_tokens)
      : undefined;
  const cacheWrite =
    outputDetails && typeof outputDetails === "object"
      ? numberField((outputDetails as Record<string, unknown>).reasoning_tokens)
      : undefined;

  return {
    inputTokens,
    outputTokens,
    ...(cacheRead ? { cacheRead } : {}),
    ...(cacheWrite ? { cacheWrite } : {}),
  };
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
