/**
 * Context window management for long conversations.
 * Auto-summarizes old messages and truncates tool outputs
 * to keep the context within model limits.
 */

import type { Message } from "../stores/chat";
import type { LlmConfig, LlmMessage } from "./llm";

// ── Token Estimation ──

/** Rough estimate: ~4 characters per token for English text. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(msg: Message): number {
  let tokens = estimateTokens(msg.content);
  // Tool call overhead
  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      tokens += estimateTokens(JSON.stringify(tc.input ?? ""));
      if (tc.output && typeof tc.output === "string") {
        tokens += estimateTokens(tc.output);
      }
    }
  }
  return tokens;
}

// ── Tool Output Truncation ──

const MAX_TOOL_OUTPUT_CHARS = 800;

/**
 * Truncate a tool output string, keeping the first N chars
 * and adding a summary of what was removed.
 */
function truncateToolOutput(output: string): string {
  if (output.length <= MAX_TOOL_OUTPUT_CHARS) return output;
  const truncated = output.slice(0, MAX_TOOL_OUTPUT_CHARS);
  const removed = output.length - MAX_TOOL_OUTPUT_CHARS;
  return `${truncated}\n\n… [${removed} more characters truncated]`;
}

// ── Compaction ──

const DEFAULT_MAX_TOKENS = 8000; // Conservative: leave room for response
const TOOL_OUTPUT_TRUNCATION_THRESHOLD = 2000; // Truncate tool outputs over 2000 chars

export interface CompactionOptions {
  /** When true, inline tool-call results into message content so non-tool models see them. */
  stripTools?: boolean;
}

export interface CompactionResult {
  /** The compacted messages ready to send to the LLM. */
  messages: LlmMessage[];
  /** Whether compaction was performed. */
  compacted: boolean;
  /** Number of messages summarized. */
  summarizedCount: number;
  /** Number of tool outputs truncated. */
  truncatedCount: number;
  /** Number of tool calls inlined for non-tool model compat. */
  toolsInlinedCount: number;
  /** Number of pinned messages forcibly de-pinned because pins exceeded the soft cap. */
  pinnedDroppedCount: number;
  /** The actual messages dropped from the conversation, for callers that
   * want to run a higher-quality LLM summary asynchronously. */
  droppedMessages?: Message[];
  /** Index of the auto-generated summary in `messages`, or -1 when no
   * summary was inserted. Lets callers patch the summary text in place
   * once an async LLM-summary returns. */
  summaryMessageIndex?: number;
}

/**
 * Compact a conversation for the LLM context window.
 *
 * Strategy:
 * 1. Always include system messages
 * 2. Truncate oversized tool outputs (>2KB) to 800 chars
 * 3. If total tokens exceed the limit, summarize oldest messages
 *    using a simple extractive approach (keep first 200 chars
 *    of user messages, drop old tool output details)
 * 4. Keep the most recent messages intact
 */
export function compactMessages(
  messages: Message[],
  maxTokens: number = DEFAULT_MAX_TOKENS,
  options: CompactionOptions = {},
): CompactionResult {
  let compacted = false;
  let summarizedCount = 0;
  let truncatedCount = 0;
  let toolsInlinedCount = 0;
  let pinnedDroppedCount = 0;

  // Step 0: If stripping tools, inline tool-call results into message content
  const inlined = options.stripTools
    ? messages.map((msg) => {
        if (!msg.toolCalls || msg.toolCalls.length === 0) return msg;
        toolsInlinedCount++;
        compacted = true;
        const parts: string[] = [msg.content];
        for (const tc of msg.toolCalls) {
          const outputStr =
            tc.output && typeof tc.output === "string"
              ? tc.output.slice(0, 500)
              : tc.output !== undefined
                ? JSON.stringify(tc.output).slice(0, 500)
                : "(no output)";
          parts.push(`\n[Tool: ${tc.toolName}]\nInput: ${JSON.stringify(tc.input).slice(0, 200)}\nResult: ${outputStr}`);
        }
        return { ...msg, content: parts.join("\n") };
      })
    : messages;

  // Step 1: Truncate oversized tool outputs (applies to pinned messages too —
  // pinning preserves intent, not the 50KB stack trace).
  const truncated = inlined.map((msg) => {
    if (!msg.toolCalls) return msg;
    let changed = false;
    const newToolCalls = msg.toolCalls.map((tc) => {
      if (
        tc.output &&
        typeof tc.output === "string" &&
        tc.output.length > TOOL_OUTPUT_TRUNCATION_THRESHOLD
      ) {
        truncatedCount++;
        changed = true;
        return { ...tc, output: truncateToolOutput(tc.output) };
      }
      return tc;
    });
    if (changed) {
      compacted = true;
      return { ...msg, toolCalls: newToolCalls };
    }
    return msg;
  });

  // Step 1.5: Implicitly pin any message that carries attachments. PDFs,
  // Word docs, slides, etc. expand to tens of thousands of characters — if
  // compaction drops them, buildSummary keeps only the first 200 chars of
  // user prose and the model is left blind. We mark them pinned here so the
  // rest of the pipeline treats them like a user-pinned message. This
  // catches existing conversations from before auto-pin-on-send shipped.
  const attachmentPinned = truncated.map((m) => {
    if (m.role === "user" && m.attachments && m.attachments.length > 0 && !m.pinned) {
      compacted = true;
      return { ...m, pinned: true, _attachmentPin: true } as Message & { _attachmentPin?: boolean };
    }
    return m as Message & { _attachmentPin?: boolean };
  });

  // Step 2: Soft cap on pinned messages. If pins alone exceed 50% of the
  // budget we de-pin oldest first so recent context still has room. This is a
  // last-resort defense against "I pinned everything" — the UI should warn
  // before we ever hit this path. Attachment-pinned messages are excluded
  // from this cap: the user explicitly attached the file expecting the model
  // to read it; silently summarizing it away is the bug we're trying to fix.
  const pinnedBudget = maxTokens * 0.5;
  const partitioned = attachmentPinned.map((m) => ({ ...m }));
  const pinnedIdxs = partitioned
    .map((m, i) => ({ m, i }))
    .filter((x) => x.m.role !== "system" && x.m.pinned && !x.m._attachmentPin)
    .sort((a, b) => a.m.createdAt - b.m.createdAt); // oldest first

  let pinnedTokens = pinnedIdxs.reduce(
    (s, x) => s + estimateMessageTokens(x.m),
    0,
  );
  for (const { i } of pinnedIdxs) {
    if (pinnedTokens <= pinnedBudget) break;
    const m = partitioned[i];
    pinnedTokens -= estimateMessageTokens(m);
    partitioned[i] = { ...m, pinned: false };
    pinnedDroppedCount++;
    compacted = true;
  }

  // Step 3: Total tokens.
  let totalTokens = 0;
  for (const msg of partitioned) {
    totalTokens += estimateMessageTokens(msg);
  }

  if (totalTokens <= maxTokens) {
    return {
      messages: messagesToLlm(partitioned),
      compacted,
      summarizedCount: 0,
      truncatedCount,
      toolsInlinedCount,
      pinnedDroppedCount,
    };
  }

  compacted = true;

  // Always include system messages and pinned messages. Run the recency
  // budget loop on the remaining unpinned non-system messages only.
  const systemMsgs = partitioned.filter((m) => m.role === "system");
  const nonSystem = partitioned.filter((m) => m.role !== "system");
  const pinnedMsgs = nonSystem.filter((m) => m.pinned);
  const unpinned = nonSystem.filter((m) => !m.pinned);

  const fixedTokens =
    systemMsgs.reduce((s, m) => s + estimateMessageTokens(m), 0) +
    pinnedMsgs.reduce((s, m) => s + estimateMessageTokens(m), 0);
  const recentBudget = Math.max(0, maxTokens * 0.7 - fixedTokens);

  const kept: Message[] = [];
  let keptTokens = 0;
  // Always keep the most recent user/assistant turn intact — dropping the
  // very message we're about to respond to (or the assistant reply that
  // produced the latest output) leaves the model blind. Big single messages
  // (a 50KB PDF extraction, say) get to override the recency budget; the
  // earlier-message summary path absorbs the slack.
  if (unpinned.length > 0) {
    const last = unpinned[unpinned.length - 1];
    kept.push(last);
    keptTokens += estimateMessageTokens(last);
  }
  for (let i = unpinned.length - 2; i >= 0; i--) {
    const msgTokens = estimateMessageTokens(unpinned[i]);
    if (keptTokens + msgTokens <= recentBudget) {
      kept.unshift(unpinned[i]);
      keptTokens += msgTokens;
    } else {
      break;
    }
  }

  const dropped = unpinned.slice(0, unpinned.length - kept.length);

  // Reassemble in original order: system → summary (if any) → pinned + kept by createdAt
  const tail = [...pinnedMsgs, ...kept].sort(compareByCreated);

  if (dropped.length > 0) {
    const summary = buildSummary(dropped);
    summarizedCount = dropped.length;
    const summaryEntry: Message = {
      id: "__summary__",
      conversationId: "",
      role: "system",
      content: summary,
      createdAt: 0,
    } as Message;
    const result: Message[] = [
      ...systemMsgs,
      summaryEntry,
      ...tail,
    ];
    const llmMessages = messagesToLlm(result);
    return {
      messages: llmMessages,
      compacted,
      summarizedCount,
      truncatedCount,
      toolsInlinedCount,
      pinnedDroppedCount,
      droppedMessages: dropped,
      summaryMessageIndex: systemMsgs.length, // index of the summary in result
    };
  }

  return {
    messages: messagesToLlm([...systemMsgs, ...tail]),
    compacted,
    summarizedCount,
    truncatedCount,
    toolsInlinedCount,
    pinnedDroppedCount,
  };
}

function compareByCreated(a: Message, b: Message): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Build a concise summary of dropped messages using extractive sampling.
 * Each user message gets its first ~200 chars preserved; assistant messages
 * are summarized more aggressively.
 */
function buildSummary(messages: Message[]): string {
  const parts: string[] = ["[Earlier conversation summary]"];

  for (const msg of messages) {
    if (msg.role === "user") {
      const content = msg.content.slice(0, 200);
      parts.push(`User: ${content}${msg.content.length > 200 ? "…" : ""}`);
    } else if (msg.role === "assistant") {
      // Summarize assistant responses: first sentence or first 150 chars
      const firstSentence = msg.content.split(/[.!?]\s/)[0] || "";
      const snippet =
        firstSentence.length > 10
          ? firstSentence.slice(0, 150)
          : msg.content.slice(0, 150);
      parts.push(
        `Assistant: ${snippet}${msg.content.length > 150 ? "…" : ""}`
      );

      // Mention tool calls briefly
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const toolNames = msg.toolCalls.map((tc) => tc.toolName).join(", ");
        parts.push(`  [Used tools: ${toolNames}]`);
      }
    }
  }

  parts.push("[/Earlier conversation summary]");
  return parts.join("\n");
}

// ── Helpers ──

function messagesToLlm(messages: Message[]): LlmMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
    .map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));
}

/**
 * Estimate the total token count of the current conversation.
 */
export function estimateTotalTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

// ── LLM-based summarization ──

const LLM_SUMMARY_PROMPT = `You are a context-compaction assistant. The user is mid-conversation with another agent and needs an older slice of the conversation summarized so it fits in the LLM context window.

Produce a structured summary that preserves enough state for the agent to resume seamlessly. Use this exact format:

## Summary
<2-4 sentences: what the user was trying to do, current status, and any decisions made>

## Files touched
<bulleted list of file paths read, written, or edited, each with a one-line note>

## Tools used
<bulleted list of tool names with a count and one-line note about why>

## Open questions / next steps
<bulleted list, or "None" if everything was resolved>

Rules:
- Stay under 500 words.
- Quote exact identifiers (function names, file paths, error messages).
- Do NOT speculate beyond what's in the transcript.
- Do NOT include any preamble like "Here's the summary" — start with the ## Summary heading.`;

/**
 * Render a list of messages into a compact transcript suitable for feeding
 * to a summarization LLM. Tool calls are inlined.
 */
function renderTranscript(messages: Message[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      parts.push(`[USER]\n${msg.content}`);
    } else if (msg.role === "assistant") {
      const body = [msg.content];
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          const out =
            typeof tc.output === "string"
              ? tc.output.slice(0, 600)
              : tc.output !== undefined
                ? JSON.stringify(tc.output).slice(0, 600)
                : "(no output)";
          body.push(
            `\n[TOOL ${tc.toolName}]\nInput: ${JSON.stringify(tc.input).slice(0, 300)}\nResult: ${out}`,
          );
        }
      }
      parts.push(`[ASSISTANT]\n${body.join("\n")}`);
    } else if (msg.role === "system") {
      parts.push(`[SYSTEM]\n${msg.content.slice(0, 400)}`);
    }
  }
  return parts.join("\n\n---\n\n");
}

/**
 * Generate a structured LLM summary of the given messages. Falls back to
 * the extractive `buildSummary` if the LLM call fails or returns nothing
 * usable. The returned string can be dropped straight into the system-role
 * summary slot inserted by `compactMessages`.
 */
export async function summarizeWithLlm(
  dropped: Message[],
  config: LlmConfig,
  signal?: AbortSignal,
): Promise<string> {
  if (dropped.length === 0) return "";
  const transcript = renderTranscript(dropped);
  // Cap transcript size sent to the summarizer so we don't blow its own
  // context window. 24k chars ≈ 6k tokens — small enough to fit the smallest
  // sane summarizer model with room for instructions and reply.
  const trimmed =
    transcript.length > 24_000
      ? transcript.slice(0, 12_000) +
        `\n\n…[middle ${transcript.length - 24_000} chars elided]…\n\n` +
        transcript.slice(transcript.length - 12_000)
      : transcript;
  try {
    const { generateText } = await import("ai");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const { initFetch, getFetch } = await import("./fetch-adapter");
    await initFetch();
    const customFetch = getFetch() ?? globalThis.fetch.bind(globalThis);
    let model: any;
    if (config.provider === "anthropic") {
      model = createAnthropic({ apiKey: config.apiKey ?? "", fetch: customFetch }).languageModel(
        config.modelId,
      );
    } else if (
      ["opencode-go", "opencode-go-free", "groq", "deepseek", "openrouter", "ollama", "lmstudio"].includes(config.provider)
    ) {
      model = createOpenAICompatible({
        name: config.provider,
        baseURL: config.baseUrl ?? "http://localhost:1234/v1",
        apiKey: config.apiKey ?? "not-needed",
        fetch: customFetch,
      }).languageModel(config.modelId);
    } else {
      model = createOpenAI({ apiKey: config.apiKey ?? "", fetch: customFetch }).languageModel(
        config.modelId,
      );
    }
    const result = await generateText({
      model,
      system: LLM_SUMMARY_PROMPT,
      prompt: `Summarize the following conversation slice:\n\n${trimmed}`,
      maxOutputTokens: 800,
      temperature: 0.2,
      abortSignal: signal,
    });
    const text = result.text.trim();
    if (text.length < 40) {
      // Implausibly short — the model probably refused or stalled. Fall back.
      return buildSummary(dropped);
    }
    return `[Earlier conversation summary — LLM generated]\n\n${text}`;
  } catch {
    // Network / auth / quota — graceful fallback to extractive summary.
    return buildSummary(dropped);
  }
}
