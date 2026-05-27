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
 * streamChat is now a thin wrapper that calls agentLoop with depth=0 and
 * no parentSignal — preserving every existing import-site contract.
 */
import { streamText, stepCountIs, type ToolSet } from "ai";
import { createModel } from "./model-factory";
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
 *
 * Today the only decorations live on tool calls (dangerLevel, danger
 * reason, contentAtInvocation) — those never appear on the message
 * objects passed in, so the mapping here is a structural pass-through.
 * The hook is in place for PR2's subagentTranscript, which will live
 * alongside output but must NOT be serialized to the model.
 */
export function mapMessagesForProvider(messages: LlmMessage[]): unknown[] {
  return messages.map((m) => {
    const role = m.role as "user" | "assistant" | "system";
    if (typeof m.content === "string") {
      return { role, content: m.content };
    }
    return {
      role,
      content: m.content.map((part) => {
        if (part.type === "text") return { type: "text" as const, text: part.text };
        if (part.type === "file")
          return { type: "file" as const, data: part.data, mediaType: part.mimeType };
        return { type: "image" as const, image: part.image, mimeType: part.mimeType };
      }),
    };
  });
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
    // Inject spawn_subagent into the tool set when depth allows.
    // Dynamic import to avoid circular dep: subagent.ts → agentLoop.ts.
    let effectiveTools = options?.tools;
    if (effectiveTools && (options?.depth ?? 0) < 2) {
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

    const result = streamText({
      model,
      system: systemPrompt ?? undefined,
      messages: mapMessagesForProvider(messages) as any,
      ...(effectiveTools ? { tools: effectiveTools, toolChoice: "auto" as const } : {}),
      // Only cap tool rounds when explicitly requested (e.g. research/design modes).
      // Default is unlimited — the agent loops until it finishes or context overflows.
      ...(options?.maxToolRounds != null
        ? { stopWhen: stepCountIs(options.maxToolRounds) }
        : effectiveTools
          ? {}
          : { stopWhen: stepCountIs(1) }),
      abortSignal: effectiveSignal,
      ...(config.maxResponseTokens ? { maxOutputTokens: config.maxResponseTokens } : {}),
      ...(providerOptions ? { providerOptions: providerOptions as any } : {}),
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
          // A failing tool is recoverable — the model can react to it on the
          // next step. Don't escalate to onError (which trashes the message
          // and shows a toast). Just notify so the UI can mark the pill as
          // errored, and let the stream continue.
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
          // stream complete
          break;
      }
    }

    callbacks.onDone(fullText);
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
