/**
 * agentLoop — the generic stream loop both the parent agent and (in PR2)
 * subagents drive. Lifted out of streamChat so there's one chunk-handling
 * switch, one error mapper, and one place to evolve when the AI SDK
 * changes shape.
 *
 * Design (per /plan-eng-review D12=B):
 * - Accept messages + system + tools + abortSignal + callbacks just like
 *   streamChat.
 * - Accept an optional parentSignal — when set, the effective abort signal
 *   is the OR of (abortSignal, parentSignal) so a parent's ⌘. cascades
 *   into every nested loop without each layer re-implementing teardown.
 * - Accept an optional depth — currently advisory; the spawn_subagent
 *   tool (PR2) uses it to enforce the depth ≤ 2 cap from D7.
 * - Strip non-provider fields off ToolCallEntry on the way to the model
 *   (T4) so future tool-result decorations (subagent transcripts, danger
 *   labels) don't leak into the serialized history.
 *
 * Context compaction:
 * - When tools are active and no explicit maxToolRounds cap is set, the
 *   loop runs in batches (BATCH_SIZE steps per API call).
 * - After each batch, actual token usage is checked against the model's
 *   context window. If usage exceeds CONTEXT_PRESSURE_THRESHOLD (80%),
 *   the oldest non-pinned messages are dropped and a summary is inserted.
 * - This lets the agent run indefinitely without hitting context overflow.
 *
 * streamChat is now a thin wrapper that calls agentLoop with depth=0 and
 * no parentSignal — preserving every existing import-site contract.
 */
import {
  streamText,
  stepCountIs,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { createModel } from "./model-factory";
import { getContextWindow } from "./context-window";
import { shouldCompact } from "./context-manager";
import { log } from "./logger";
import { resolveReasoningRequest } from "./reasoning";
import type {
  LlmConfig,
  LlmMessage,
  StreamCallbacks,
  ToolCallInfo,
  ToolResultInfo,
  ToolErrorInfo,
} from "./llm-types";

type StreamTextOptions = Parameters<typeof streamText>[0];
type ProviderOptions = NonNullable<StreamTextOptions["providerOptions"]>;

export interface AgentLoopOptions {
  abortSignal?: AbortSignal;
  /** Parent loop's abort signal — when set, abort propagates from parent to
   * this loop. Used by spawn_subagent (PR2) to cascade ⌘. into every child. */
  parentSignal?: AbortSignal;
  /** Loop depth in the parent → child chain. 0 for the top-level parent.
   * Currently advisory; spawn_subagent uses it for the depth ≤ 2 cap. */
  depth?: number;
  tools?: ToolSet;
  maxToolRounds?: number;
  /** When false, spawn_subagent is not injected into the tool set.
   *  Used by the parent to disable subagents based on user settings. */
  subagentsEnabled?: boolean;
  /** Session ID for prompt cache affinity. Sent as prompt_cache_key to OpenAI
   *  and used for session affinity headers. Generated per conversation. */
  sessionId?: string;
  /** Cache retention policy: "short" (default, provider-defined), "long" (24h
   *  for OpenAI, 1h for Anthropic), or "none" (disable caching). */
  cacheRetention?: "none" | "short" | "long";
}

// ── Context compaction constants ──

/** Steps per API call when running the unbounded agent loop. */
const BATCH_SIZE = 10;

/** Target token budget after compaction — aim for 50% of context window. */
const COMPACTION_TARGET = 0.5;

/** Pull the summary arg from a `done` tool call, if present. */
function extractDoneSummary(
  steps: Array<{ toolCalls?: Array<{ toolName: string; input?: unknown }> }> | undefined,
): string | undefined {
  if (!steps) return undefined;
  for (const step of steps) {
    for (const tc of step.toolCalls ?? []) {
      if (tc.toolName === "done") {
        return (tc.input as { summary?: string } | undefined)?.summary;
      }
    }
  }
  return undefined;
}

function isDoneResultAllowed(output: unknown): boolean {
  if (!output || typeof output !== "object") return true;
  const result = output as { done?: unknown; blocked?: unknown };
  return result.done !== false && result.blocked !== true;
}

interface TextSummaryPart {
  type: "text";
  text: string;
}

interface ToolCallSummaryPart {
  type: "tool-call";
  toolName: string;
}

function isTextSummaryPart(part: unknown): part is TextSummaryPart {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { type?: unknown }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string"
  );
}

function isToolCallSummaryPart(part: unknown): part is ToolCallSummaryPart {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { type?: unknown }).type === "tool-call" &&
    typeof (part as { toolName?: unknown }).toolName === "string"
  );
}

function originalMessagesFromError(error: unknown): ModelMessage[] | undefined {
  if (!error || typeof error !== "object") return undefined;
  const originalMessages = (error as { __originalMessages?: unknown }).__originalMessages;
  return Array.isArray(originalMessages) ? (originalMessages as ModelMessage[]) : undefined;
}


/**
 * Clamp a cache key to OpenAI's 64-character limit.
 * Matches pi agent's clampOpenAIPromptCacheKey implementation.
 */
function clampCacheKey(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  const chars = Array.from(key);
  if (chars.length <= 64) return key;
  return chars.slice(0, 64).join("");
}

/**
 * Combine an inner abort signal with an optional parent signal so abort
 * from either side cancels the underlying streamText call. Uses
 * AbortSignal.any when available (Node 20+ / modern webviews); falls back
 * to a manual relay when running on an older runtime.
 */
function combineSignals(
  inner: AbortSignal | undefined,
  parent: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!parent) return inner;
  if (!inner) return parent;
  // Modern path.
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") {
    return anyFn([inner, parent]);
  }
  // Manual relay fallback.
  const ctrl = new AbortController();
  const onInner = () => ctrl.abort(inner.reason);
  const onParent = () => ctrl.abort(parent.reason);
  if (inner.aborted) ctrl.abort(inner.reason);
  else inner.addEventListener("abort", onInner, { once: true });
  if (parent.aborted) ctrl.abort(parent.reason);
  else parent.addEventListener("abort", onParent, { once: true });
  return ctrl.signal;
}

/**
 * Map LlmMessage[] into the shape the AI SDK expects, dropping any
 * goatLLM-internal decorations that should not leak to the provider.
 */
export function mapMessagesForProvider(messages: LlmMessage[]): ModelMessage[] {
  return messages.map((m) => {
    const role = m.role as "user" | "assistant" | "system";
    if (typeof m.content === "string") {
      return { role, content: m.content } as ModelMessage;
    }
    return {
      role,
      content: m.content.map((part) => {
        if (part.type === "text") return { type: "text" as const, text: part.text };
        if (part.type === "file")
          return { type: "file" as const, data: part.data, mediaType: part.mimeType };
        return { type: "image" as const, image: part.image, mimeType: part.mimeType };
      }),
    } as ModelMessage;
  });
}

/**
 * Estimate token count for a ModelMessage array. Rough: ~4 chars per token.
 */
function estimateMessageTokens(msgs: ModelMessage[]): number {
  let tokens = 0;
  for (const m of msgs) {
    if (typeof m.content === "string") {
      tokens += Math.ceil(m.content.length / 4);
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if ("text" in part && part.text) tokens += Math.ceil(part.text.length / 4);
        if ("data" in part && part.data) tokens += Math.ceil(String(part.data).length / 4);
        if ("image" in part && part.image) tokens += Math.ceil(String(part.image).length / 8);
      }
    }
  }
  return tokens;
}

/**
 * Build a readable summary of the AI SDK's ResponseMessage array.
 * Used when dropping old messages during mid-loop compaction.
 */
function summarizeResponseMessages(msgs: ModelMessage[]): string {
  const parts: string[] = ["[Earlier conversation summary]"];
  for (const msg of msgs) {
    if (msg.role === "user") {
      const text = typeof msg.content === "string" ? msg.content : "";
      parts.push(`User: ${text.slice(0, 200)}${text.length > 200 ? "…" : ""}`);
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        parts.push(`Assistant: ${msg.content.slice(0, 150)}${msg.content.length > 150 ? "…" : ""}`);
      } else if (Array.isArray(msg.content)) {
        const texts = msg.content
          .filter(isTextSummaryPart)
          .map((p) => p.text)
          .join(" ");
        const toolNames = msg.content.flatMap((part) =>
          isToolCallSummaryPart(part) ? [part.toolName] : [],
        );
        if (texts) parts.push(`Assistant: ${texts.slice(0, 150)}${texts.length > 150 ? "…" : ""}`);
        if (toolNames.length > 0) {
          const names = toolNames.join(", ");
          parts.push(`  [Used tools: ${names}]`);
        }
      }
    }
    // Skip tool messages — they're transient
  }
  parts.push("[/Earlier conversation summary]");
  return parts.join("\n");
}

/**
 * Compact an array of ModelMessages by dropping older messages and
 * inserting a summary. Preserves system messages and recent context.
 *
 * @param msgs - The full message array (system + user + assistant + tool)
 * @param targetTokens - Desired token count after compaction
 * @returns Compacted message array
 */
function compactModelMessages(msgs: ModelMessage[], targetTokens: number): ModelMessage[] {
  const systemMsgs = msgs.filter((m) => m.role === "system");
  const nonSystem = msgs.filter((m) => m.role !== "system");

  if (nonSystem.length <= 2) return msgs; // Don't compact tiny conversations

  // Keep the most recent messages, drop older ones
  const kept: ModelMessage[] = [];
  let keptTokens = estimateMessageTokens(systemMsgs);

  // Always keep the last message (it's likely the user's latest request)
  if (nonSystem.length > 0) {
    const last = nonSystem[nonSystem.length - 1];
    kept.unshift(last);
    keptTokens += estimateMessageTokens([last]);
  }

  // Walk backwards, keeping messages until we hit our budget
  for (let i = nonSystem.length - 2; i >= 0; i--) {
    const msgTokens = estimateMessageTokens([nonSystem[i]]);
    if (keptTokens + msgTokens <= targetTokens) {
      kept.unshift(nonSystem[i]);
      keptTokens += msgTokens;
    } else {
      break;
    }
  }

  const dropped = nonSystem.slice(0, nonSystem.length - kept.length);
  if (dropped.length === 0) return msgs; // Nothing to drop

  const summary = summarizeResponseMessages(dropped);
  const summaryMsg: ModelMessage = {
    role: "system",
    content: summary,
  } as ModelMessage;

  return [...systemMsgs, summaryMsg, ...kept];
}

/**
 * Run one stream-and-tool-loop turn against the configured model. This
 * is the shared core both streamChat (parent) and spawn_subagent (PR2,
 * child) drive — same chunk handling, same error mapping, same abort
 * semantics.
 */
export async function agentLoop(
  messages: LlmMessage[],
  systemPrompt: string | null,
  config: LlmConfig,
  callbacks: StreamCallbacks,
  options?: AgentLoopOptions,
): Promise<void> {
  const model = await createModel(config);
  const effectiveSignal = combineSignals(options?.abortSignal, options?.parentSignal);

  const providerOptions = resolveReasoningRequest({ config }).providerOptions as ProviderOptions | undefined;

  try {
    // Inject spawn_subagent into the tool set when depth allows
    // and subagents are enabled. Dynamic import to avoid circular dep.
    let effectiveTools = options?.tools;
    const subagentsEnabled = options?.subagentsEnabled !== false;
    if (effectiveTools && (options?.depth ?? 0) < 2 && subagentsEnabled) {
      const { createSpawnSubagent } = await import("./tools/builtins/subagent");
      effectiveTools = {
        ...effectiveTools,
        spawn_subagent: createSpawnSubagent({
          depth: options?.depth ?? 0,
          parentSignal: options?.parentSignal,
          abortSignal: options?.abortSignal,
          config,
          maxToolRounds: options?.maxToolRounds,
        }),
      };
    }

    // Inject the `done` tool so the model can explicitly signal completion.
    // The batched loop exits when done is called — no finishReason heuristics.
    if (effectiveTools) {
      const { done } = await import("./tools/builtins/done");
      effectiveTools = { ...effectiveTools, done };
    }

    // ── Determine if we need the batched + compaction loop ──
    // When tools are active and no explicit maxToolRounds is set, we run
    // in batches and check context pressure between each batch.
    const hasExplicitCap = options?.maxToolRounds != null;
    const needsCompactionLoop = effectiveTools && !hasExplicitCap;

    if (needsCompactionLoop) {
      // ── Batched loop with mid-loop compaction ──
      // Run in batches of BATCH_SIZE steps. After each batch, check token
      // usage and compact if approaching the context window limit.
      let workingMessages = mapMessagesForProvider(messages);
      let totalSteps = 0;
      const contextWindow = getContextWindow(config.provider, config.modelId);
      const compactionTarget = contextWindow > 0
        ? Math.floor(contextWindow * COMPACTION_TARGET)
        : 0;
      let fullText = "";
      let totalOutputTokens = 0;
      let totalGenerationMs = 0;
      let doneCalled = false;
      let doneSummary: string | undefined;

      // ── Prompt caching for batched loop ──
      const isAnthropic = config.provider === "anthropic";
      const isOpenAICompatible = [
        "openai", "deepseek", "mimo", "groq", "openrouter",
        "opencode-go", "opencode-go-free", "ollama", "lmstudio",
      ].includes(config.provider);
      const cacheRetention = options?.cacheRetention ?? "short";
      const sessionId = options?.sessionId;

      // Build provider options with caching for batched loop
      let batchedProviderOptions = providerOptions;

      if (isAnthropic && cacheRetention !== "none") {
        const cacheControl = cacheRetention === "long"
          ? { type: "ephemeral" as const, ttl: "1h" }
          : { type: "ephemeral" as const };
        batchedProviderOptions = {
          ...(batchedProviderOptions ?? {}),
          anthropic: {
            ...(batchedProviderOptions?.anthropic ?? {}),
            cacheControl,
          },
        };
      }

      if (isOpenAICompatible && cacheRetention !== "none" && sessionId) {
        const providerKey = config.provider;
        const promptCacheKey = clampCacheKey(sessionId);
        const promptCacheOptions =
          cacheRetention === "long"
            ? { promptCacheKey, promptCacheRetention: "24h" }
            : { promptCacheKey };
        batchedProviderOptions = {
          ...(batchedProviderOptions ?? {}),
          [providerKey]: {
            ...(batchedProviderOptions?.[providerKey] ?? {}),
            ...promptCacheOptions,
          },
        };
      }

      // Apply Anthropic cache_control to messages for batched loop
      if (isAnthropic && cacheRetention !== "none") {
        const cacheControl = cacheRetention === "long"
          ? { type: "ephemeral" as const, ttl: "1h" }
          : { type: "ephemeral" as const };

        const firstUserIdx = workingMessages.findIndex((m) => m.role === "user");
        if (firstUserIdx >= 0) {
          workingMessages = workingMessages.map((m, i) => {
            if (i === firstUserIdx) {
              return {
                ...m,
                providerOptions: { anthropic: { cacheControl } },
              } as ModelMessage;
            }
            return m;
          });
        }
      }

      // Track latest usage across batches for the final emitUsage call.
      let lastBatchUsage: LanguageModelUsage | undefined;

      function emitUsage() {
        if (totalOutputTokens > 0 || totalGenerationMs > 0) {
        callbacks.onUsage?.({
          totalTokens:
            (lastBatchUsage?.totalTokens ?? 0) +
            (lastBatchUsage?.inputTokenDetails.cacheReadTokens ?? 0) +
            (lastBatchUsage?.inputTokenDetails.cacheWriteTokens ?? 0),
          inputTokens: lastBatchUsage?.inputTokens ?? 0,
          outputTokens: totalOutputTokens,
          cacheRead: lastBatchUsage?.inputTokenDetails.cacheReadTokens ?? undefined,
          cacheWrite: lastBatchUsage?.inputTokenDetails.cacheWriteTokens ?? undefined,
            generationMs: totalGenerationMs,
          });
        }
      }

      while (true) {
        if (effectiveSignal?.aborted) {
          emitUsage();
          callbacks.onDone(fullText);
          return;
        }

        const batchStart = performance.now();
        const result = streamText({
          model,
          system: systemPrompt ?? undefined,
          messages: workingMessages,
          tools: effectiveTools,
          toolChoice: "auto" as const,
          stopWhen: stepCountIs(BATCH_SIZE),
          abortSignal: effectiveSignal,
          ...(config.maxResponseTokens ? { maxOutputTokens: config.maxResponseTokens } : {}),
          ...(batchedProviderOptions ? { providerOptions: batchedProviderOptions } : {}),
        });

        let batchText = "";

        for await (const chunk of result.fullStream) {
          switch (chunk.type) {
            case "text-delta":
              batchText += chunk.text;
              fullText += chunk.text;
              callbacks.onToken(chunk.text);
              break;

            case "reasoning-delta":
              callbacks.onThinking?.((chunk as Record<string, unknown>).text as string ?? "");
              break;

            case "tool-call":
              callbacks.onToolCall?.({
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                input: (chunk as Record<string, unknown>).input,
              } satisfies ToolCallInfo);
              break;

            case "tool-result":
              callbacks.onToolResult?.({
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                input: (chunk as Record<string, unknown>).input,
                output: (chunk as Record<string, unknown>).output,
              } satisfies ToolResultInfo);
              break;

            case "tool-error":
              callbacks.onToolError?.({
                toolCallId: (chunk as Record<string, unknown>).toolCallId as string,
                toolName: chunk.toolName,
                error: (chunk as Record<string, unknown>).error,
              } satisfies ToolErrorInfo);
              break;

            case "error":
              callbacks.onError((chunk as Record<string, unknown>).error as Error);
              return;

            case "abort":
              callbacks.onDone(fullText);
              return;

            case "finish":
              break;
          }
        }

        // Track generation time for this batch (streaming only, excludes
        // tool execution which happens between batches).
        totalGenerationMs += performance.now() - batchStart;

        // Accumulate the response messages for the next batch.
        // result.response.messages contains assistant + tool messages in
        // the AI SDK's native format — exactly what streamText expects.
        const responseMessages = await result.response.then(r => r.messages);
        workingMessages = [...workingMessages, ...responseMessages];

        // Count steps from this batch.
        const stepResults = await result.steps;
        totalSteps += stepResults.length;

        // Check if the model called the `done` tool this batch. The tool can
        // reject premature completion, so only exit when its result allows it.
        for (const step of stepResults) {
          for (const tc of step.toolCalls ?? []) {
            if (tc.toolName === "done") {
              const result = step.toolResults?.find((tr) => tr.toolCallId === tc.toolCallId);
              if (isDoneResultAllowed(result?.output)) {
                doneCalled = true;
                doneSummary = (tc.input as { summary?: string })?.summary;
                break;
              }
            }
          }
          if (doneCalled) break;
        }

        if (doneCalled) {
          emitUsage();
          callbacks.onDone(fullText, doneSummary);
          return;
        }

        // If no tool calls at all and finishReason is 'stop', the model
        // emitted text without calling done. This shouldn't happen (the
        // system prompt instructs it to call done), but handle gracefully
        // by exiting so the loop doesn't spin forever.
        const lastStep = stepResults[stepResults.length - 1];
        if (!lastStep?.toolCalls?.length && lastStep?.finishReason === "stop") {
          emitUsage();
          callbacks.onDone(fullText);
          return;
        }

        // ── Context pressure check ──
        // Use actual token usage from the provider if available.
        const usage = await result.usage;
        lastBatchUsage = usage;
        const inputTokens = usage?.inputTokens ?? estimateMessageTokens(workingMessages);
        if (usage?.outputTokens) totalOutputTokens += usage.outputTokens;

        if (shouldCompact(inputTokens, contextWindow)) {
          // We're at 80%+ of the context window. Compact.
          const before = workingMessages.length;
          workingMessages = compactModelMessages(workingMessages, compactionTarget);
          const dropped = before - workingMessages.length;
          if (dropped > 0) {
            log.info(
              `Context compaction: ${before} → ${workingMessages.length} messages ` +
              `(~${inputTokens} tokens → target ${compactionTarget})`,
              { tag: "agentLoop", data: { before, after: workingMessages.length, inputTokens, target: compactionTarget } }
            );
          }
        }
      }
    } else {
      // ── Simple single-call path ──
      // Used when maxToolRounds is explicitly set (research/design modes)
      // or when there are no tools (chat mode).

      // ── Prompt caching ──
      // Similar to pi agent's implementation:
      // - Anthropic: cache_control markers on system prompt, last tool, last message
      // - OpenAI: prompt_cache_key + prompt_cache_retention for server-side caching
      // - Session affinity headers for cache-friendly routing
      const isAnthropic = config.provider === "anthropic";
      const isOpenAICompatible = [
        "openai", "deepseek", "mimo", "groq", "openrouter",
        "opencode-go", "opencode-go-free", "ollama", "lmstudio",
      ].includes(config.provider);
      const cacheRetention = options?.cacheRetention ?? "short";
      const sessionId = options?.sessionId;
      let messagesForStream = mapMessagesForProvider(messages);

      // Anthropic-style cache_control markers
      if (isAnthropic && cacheRetention !== "none") {
        const cacheControl = cacheRetention === "long"
          ? { type: "ephemeral" as const, ttl: "1h" }
          : { type: "ephemeral" as const };

        // Mark system prompt
        // (handled via providerOptions below)

        // Mark first user message (caches system prompt + early context)
        const firstUserIdx = messagesForStream.findIndex((m) => m.role === "user");
        if (firstUserIdx >= 0) {
          messagesForStream = messagesForStream.map((m, i) => {
            if (i === firstUserIdx) {
              return {
                ...m,
                providerOptions: {
                  anthropic: { cacheControl },
                },
              } as ModelMessage;
            }
            return m;
          });
        }

        // Mark last user/assistant message (caches recent conversation)
        for (let i = messagesForStream.length - 1; i >= 0; i--) {
          const m = messagesForStream[i];
          if (m.role === "user" || m.role === "assistant") {
            if (i !== firstUserIdx) {
              messagesForStream[i] = {
                ...m,
                providerOptions: {
                  anthropic: { cacheControl },
                },
              } as ModelMessage;
            }
            break;
          }
        }
      }

      // Build provider options with caching
      let mergedProviderOptions = providerOptions;

      if (isAnthropic && cacheRetention !== "none") {
        const cacheControl = cacheRetention === "long"
          ? { type: "ephemeral" as const, ttl: "1h" }
          : { type: "ephemeral" as const };
        mergedProviderOptions = {
          ...(mergedProviderOptions ?? {}),
          anthropic: {
            ...(mergedProviderOptions?.anthropic ?? {}),
            cacheControl,
          },
        };
      }

      // OpenAI prompt caching via prompt_cache_key + prompt_cache_retention
      if (isOpenAICompatible && cacheRetention !== "none" && sessionId) {
        const providerKey = config.provider;
        const promptCacheKey = clampCacheKey(sessionId);
        const promptCacheOptions =
          cacheRetention === "long"
            ? { promptCacheKey, promptCacheRetention: "24h" }
            : { promptCacheKey };
        mergedProviderOptions = {
          ...(mergedProviderOptions ?? {}),
          [providerKey]: {
            ...(mergedProviderOptions?.[providerKey] ?? {}),
            ...promptCacheOptions,
          },
        };
      }

      const result = streamText({
        model,
        system: systemPrompt ?? undefined,
        messages: messagesForStream,
        ...(effectiveTools ? { tools: effectiveTools, toolChoice: "auto" as const } : {}),
        ...(hasExplicitCap
          ? { stopWhen: stepCountIs(options!.maxToolRounds!) }
          : effectiveTools
            ? {}
            : { stopWhen: stepCountIs(1) }),
        abortSignal: effectiveSignal,
        ...(config.maxResponseTokens ? { maxOutputTokens: config.maxResponseTokens } : {}),
        ...(mergedProviderOptions ? { providerOptions: mergedProviderOptions } : {}),
      });

      let fullText = "";
      for await (const chunk of result.fullStream) {
        switch (chunk.type) {
          case "text-delta":
            fullText += chunk.text;
            callbacks.onToken(chunk.text);
            break;

          case "reasoning-delta":
            callbacks.onThinking?.((chunk as Record<string, unknown>).text as string ?? "");
            break;

          case "tool-call":
            callbacks.onToolCall?.({
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              input: (chunk as Record<string, unknown>).input,
            } satisfies ToolCallInfo);
            break;

          case "tool-result":
            callbacks.onToolResult?.({
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              input: (chunk as Record<string, unknown>).input,
              output: (chunk as Record<string, unknown>).output,
            } satisfies ToolResultInfo);
            break;

          case "tool-error":
            callbacks.onToolError?.({
              toolCallId: (chunk as Record<string, unknown>).toolCallId as string,
              toolName: chunk.toolName,
              error: (chunk as Record<string, unknown>).error,
            } satisfies ToolErrorInfo);
            break;

          case "error": {
            const raw = (chunk as Record<string, unknown>).error;
            const err =
              raw instanceof Error
                ? raw
                : new Error(
                    typeof raw === "string"
                      ? raw
                      : raw &&
                          typeof raw === "object" &&
                          "message" in raw &&
                          (raw as { message?: unknown }).message != null
                        ? String((raw as { message: unknown }).message)
                        : JSON.stringify(raw ?? "Unknown stream error"),
                  );
            callbacks.onError(err);
            return;
          }

          case "abort":
            callbacks.onDone(fullText);
            return;

          case "finish":
            // stream complete — emit usage stats for cache tracking
            try {
              const usage = await result.usage;
              if (usage) {
                callbacks.onUsage?.({
                  totalTokens:
                    (usage.totalTokens ?? 0) +
                    (usage.inputTokenDetails.cacheReadTokens ?? 0) +
                    (usage.inputTokenDetails.cacheWriteTokens ?? 0),
                  inputTokens: usage.inputTokens ?? 0,
                  outputTokens: usage.outputTokens ?? 0,
                  cacheRead: usage.inputTokenDetails.cacheReadTokens ?? undefined,
                  cacheWrite: usage.inputTokenDetails.cacheWriteTokens ?? undefined,
                });
              }
            } catch { /* usage not available */ }
            break;
        }
      }

      const stepResults = await result.steps;
      const doneSummary = extractDoneSummary(stepResults);
      callbacks.onDone(fullText, doneSummary);
    }
  } catch (error) {
    // Treat any throw as a clean stop when the caller (or parent) aborted us.
    if (
      effectiveSignal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && /abort|cancel/i.test(error.message))
    ) {
      callbacks.onDone("");
      return;
    }
    const err = error instanceof Error ? error : new Error(String(error));
    // Detect common provider error patterns and surface a friendly message
    const msg = err.message || "";
    // Context-window overflow: every provider phrases this differently. We
    // detect via regex over the error message and tag the resulting Error
    // with a `code` property the UI can branch on (offer to switch model or
    // trim earlier messages with one click).
    if (
      /(context.*length|maximum.*context|too\s+(long|many)\s+tokens|prompt\s+is\s+too\s+long|exceeds.*tokens|context\s+window|input.*too\s+long)/i.test(msg) ||
      /token\s*limit/i.test(msg)
    ) {
      // Auto-retry with compaction: if we have the original messages,
      // compact them and retry once. This mirrors pi's auto-compaction
      // on context overflow.
      const originalMsgs = originalMessagesFromError(error);
      if (originalMsgs && originalMsgs.length > 4) {
        const contextWindow = getContextWindow(config.provider, config.modelId);
        const target = contextWindow > 0 ? Math.floor(contextWindow * COMPACTION_TARGET) : 0;
        const compacted = target > 0 ? compactModelMessages(originalMsgs, target) : originalMsgs;
        if (target > 0 && compacted.length < originalMsgs.length) {
          log.info(`Auto-compacting on overflow: ${originalMsgs.length} → ${compacted.length} messages`, { tag: "agentLoop", data: { before: originalMsgs.length, after: compacted.length } });
          // Retry once with compacted messages
          try {
            const retryResult = streamText({
              model,
              system: systemPrompt ?? undefined,
              messages: compacted,
              abortSignal: effectiveSignal,
              ...(config.maxResponseTokens ? { maxOutputTokens: config.maxResponseTokens } : {}),
              ...(providerOptions ? { providerOptions } : {}),
            });
            let retryText = "";
            for await (const chunk of retryResult.fullStream) {
              if (chunk.type === "text-delta") {
                retryText += chunk.text;
                callbacks.onToken(chunk.text);
              } else if (chunk.type === "reasoning-delta") {
                callbacks.onThinking?.((chunk as Record<string, unknown>).text as string ?? "");
              } else if (chunk.type === "tool-call") {
                callbacks.onToolCall?.({ toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: (chunk as Record<string, unknown>).input } satisfies ToolCallInfo);
              } else if (chunk.type === "tool-result") {
                callbacks.onToolResult?.({ toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: (chunk as Record<string, unknown>).input, output: (chunk as Record<string, unknown>).output } satisfies ToolResultInfo);
              } else if (chunk.type === "tool-error") {
                callbacks.onToolError?.({ toolCallId: (chunk as Record<string, unknown>).toolCallId as string, toolName: chunk.toolName, error: (chunk as Record<string, unknown>).error } satisfies ToolErrorInfo);
              } else if (chunk.type === "error") {
                callbacks.onError((chunk as Record<string, unknown>).error as Error);
                return;
              } else if (chunk.type === "abort") {
                callbacks.onDone(retryText);
                return;
              }
            }
            callbacks.onDone(retryText);
            return;
          } catch {
            // Retry also failed — fall through to original error
          }
        }
      }
      const overflow = new Error(
        `This request is too long for the active model. You can switch to a longer-context model or trim earlier messages.\n\nDetails: ${msg.slice(0, 240)}`,
      );
      (overflow as Error & { code?: string }).code = "context_overflow";
      callbacks.onError(overflow);
      return;
    }
    if (msg.includes("Unexpected token") || msg.includes("is not valid JSON") || msg.includes("JSON")) {
      callbacks.onError(new Error(
        `The provider returned an invalid (non-JSON) response. This may be a temporary issue with the model or API endpoint. Try again or switch models.\n\nDetails: ${msg.slice(0, 200)}`
      ));
      return;
    }
    if (msg.includes("fetch") || msg.includes("NetworkError") || msg.includes("Failed to fetch") || msg.includes("Load failed")) {
      callbacks.onError(new Error(
        `Cannot reach the model provider. Check that the service is running and accessible. If running locally, this may be a CORS issue — make sure the app is launched via \`pnpm tauri dev\` (not just \`pnpm dev\`).\n\nDetails: ${msg.slice(0, 200)}`
      ));
      return;
    }
    callbacks.onError(err);
  }
}
