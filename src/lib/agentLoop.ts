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
import { streamText, stepCountIs, type ToolSet, type ModelMessage } from "ai";
import { createModel } from "./model-factory";
import { getContextWindow } from "./context-window";
import type {
  LlmConfig,
  LlmMessage,
  StreamCallbacks,
  ToolCallInfo,
  ToolResultInfo,
  ToolErrorInfo,
} from "./llm-types";

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
}

// ── Context compaction constants ──

/** Steps per API call when running the unbounded agent loop. */
const BATCH_SIZE = 10;

/** Trigger compaction when input tokens exceed this fraction of context window. */
const CONTEXT_PRESSURE_THRESHOLD = 0.8;

/** Target token budget after compaction — aim for 50% of context window. */
const COMPACTION_TARGET = 0.5;

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
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join(" ");
        const toolCalls = msg.content.filter((p: any) => p.type === "tool-call");
        if (texts) parts.push(`Assistant: ${texts.slice(0, 150)}${texts.length > 150 ? "…" : ""}`);
        if (toolCalls.length > 0) {
          const names = toolCalls.map((tc: any) => tc.toolName).join(", ");
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

  // Build provider-specific reasoning/thinking options from the user's
  // reasoningEffort override (set via the gear icon in the model picker).
  let providerOptions: Record<string, Record<string, unknown>> | undefined;
  const effort = config.reasoningEffort;
  if (effort && effort !== "off") {
    const providerKey = config.provider;
    if (providerKey === "anthropic") {
      const budget = effort === "minimal" || effort === "low" ? 4000
        : effort === "medium" ? 8000
        : effort === "high" ? 16000
        : 32000; // xhigh
      providerOptions = {
        [providerKey]: {
          thinking: { type: "enabled", budgetTokens: budget },
        },
      };
    } else {
      // OpenAI and OpenAI-compatible providers accept reasoningEffort.
      // Clamp xhigh → high (only a subset of models support xhigh natively).
      const re = effort === "xhigh" ? "high" : effort;
      providerOptions = {
        [providerKey]: { reasoningEffort: re },
      };
    }
  }

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
      const pressureLimit = contextWindow > 0
        ? Math.floor(contextWindow * CONTEXT_PRESSURE_THRESHOLD)
        : Infinity;
      const compactionTarget = contextWindow > 0
        ? Math.floor(contextWindow * COMPACTION_TARGET)
        : 0;
      let fullText = "";

      while (true) {
        if (effectiveSignal?.aborted) {
          callbacks.onDone(fullText);
          return;
        }

        const result = streamText({
          model,
          system: systemPrompt ?? undefined,
          messages: workingMessages as any,
          tools: effectiveTools,
          toolChoice: "auto" as const,
          stopWhen: stepCountIs(BATCH_SIZE),
          abortSignal: effectiveSignal,
          ...(config.maxResponseTokens ? { maxOutputTokens: config.maxResponseTokens } : {}),
          ...(providerOptions ? { providerOptions: providerOptions as any } : {}),
        });

        let batchText = "";
        let finished = false;

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
              finished = true;
              break;
          }
        }

        // Accumulate the response messages for the next batch.
        // result.response.messages contains assistant + tool messages in
        // the AI SDK's native format — exactly what streamText expects.
        const responseMessages = await result.response.then(r => r.messages);
        workingMessages = [...workingMessages, ...responseMessages];

        // Count steps from this batch.
        const stepResults = await result.steps;
        totalSteps += stepResults.length;

        // Check if the model is done (no tool calls in the last step).
        const lastStep = stepResults[stepResults.length - 1];
        const modelIsDone = !lastStep?.toolCalls?.length;

        if (modelIsDone || finished) {
          callbacks.onDone(fullText);
          return;
        }

        // ── Context pressure check ──
        // Use actual token usage from the provider if available.
        const usage = await result.usage;
        const inputTokens = usage?.inputTokens ?? estimateMessageTokens(workingMessages);

        if (contextWindow > 0 && inputTokens > pressureLimit) {
          // We're at 80%+ of the context window. Compact.
          const before = workingMessages.length;
          workingMessages = compactModelMessages(workingMessages, compactionTarget);
          const dropped = before - workingMessages.length;
          if (dropped > 0) {
            console.log(
              `[agentLoop] Context compaction: ${before} → ${workingMessages.length} messages ` +
              `(~${inputTokens} tokens → target ${compactionTarget})`
            );
          }
        }
      }
    } else {
      // ── Simple single-call path ──
      // Used when maxToolRounds is explicitly set (research/design modes)
      // or when there are no tools (chat mode).

      // ── Anthropic prompt caching ──
      // Mark the first user message with cache_control so Anthropic caches
      // the system prompt + early messages across turns. Design mode's
      // system prompt (~10K tokens) benefits enormously.
      const isAnthropic = config.provider === "anthropic";
      let messagesForStream = mapMessagesForProvider(messages);

      if (isAnthropic) {
        const firstUserIdx = messagesForStream.findIndex((m) => m.role === "user");
        if (firstUserIdx >= 0) {
          messagesForStream = messagesForStream.map((m, i) => {
            if (i === firstUserIdx) {
              return {
                ...m,
                providerOptions: {
                  anthropic: { cacheControl: { type: "ephemeral" } },
                },
              } as ModelMessage;
            }
            return m;
          });
        }
      }

      const mergedProviderOptions = isAnthropic && systemPrompt
        ? { ...(providerOptions ?? {}), anthropic: { ...(providerOptions?.anthropic ?? {}), cacheControl: { type: "ephemeral" } } }
        : providerOptions;

      const result = streamText({
        model,
        system: systemPrompt ?? undefined,
        messages: messagesForStream as any,
        ...(effectiveTools ? { tools: effectiveTools, toolChoice: "auto" as const } : {}),
        ...(hasExplicitCap
          ? { stopWhen: stepCountIs(options!.maxToolRounds!) }
          : effectiveTools
            ? {}
            : { stopWhen: stepCountIs(1) }),
        abortSignal: effectiveSignal,
        ...(config.maxResponseTokens ? { maxOutputTokens: config.maxResponseTokens } : {}),
        ...(mergedProviderOptions ? { providerOptions: mergedProviderOptions as any } : {}),
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

          case "error":
            callbacks.onError((chunk as Record<string, unknown>).error as Error);
            return;

          case "abort":
            callbacks.onDone(fullText);
            return;

          case "finish":
            // stream complete — emit usage stats for cache tracking
            try {
              const usage = await result.usage;
              if (usage) {
                callbacks.onUsage?.({
                  inputTokens: usage.inputTokens ?? 0,
                  outputTokens: usage.outputTokens ?? 0,
                  cacheRead: (usage as any).cacheReadTokens ?? undefined,
                  cacheWrite: (usage as any).cacheWriteTokens ?? undefined,
                });
              }
            } catch { /* usage not available */ }
            break;
        }
      }

      callbacks.onDone(fullText);
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
      const originalMsgs = (error as any).__originalMessages as ModelMessage[] | undefined;
      if (originalMsgs && originalMsgs.length > 4) {
        const contextWindow = getContextWindow(config.provider, config.modelId);
        const target = contextWindow > 0 ? Math.floor(contextWindow * 0.45) : 40_000;
        const compacted = compactModelMessages(originalMsgs, target);
        if (compacted.length < originalMsgs.length) {
          console.log(`[agentLoop] Auto-compacting on overflow: ${originalMsgs.length} → ${compacted.length} messages`);
          // Retry once with compacted messages
          try {
            const retryResult = streamText({
              model,
              system: systemPrompt ?? undefined,
              messages: compacted as any,
              abortSignal: effectiveSignal,
              ...(config.maxResponseTokens ? { maxOutputTokens: config.maxResponseTokens } : {}),
              ...(providerOptions ? { providerOptions: providerOptions as any } : {}),
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
