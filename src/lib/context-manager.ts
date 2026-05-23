/**
 * Context window management for long conversations.
 * Auto-summarizes old messages and truncates tool outputs
 * to keep the context within model limits.
 */

import type { Message } from "../stores/chat";
import type { LlmMessage } from "./llm";

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

  // Step 1: Truncate oversized tool outputs
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

  // Step 2: Count total tokens
  let totalTokens = 0;
  for (const msg of truncated) {
    totalTokens += estimateMessageTokens(msg);
  }

  // Step 3: If over limit, summarize from the oldest messages forward
  if (totalTokens <= maxTokens) {
    return {
      messages: messagesToLlm(truncated),
      compacted,
      summarizedCount: 0,
      truncatedCount,
      toolsInlinedCount,
    };
  }

  compacted = true;

  // Keep system messages + most recent messages intact.
  // Summarize older user/assistant pairs into a single system message.
  const systemMsgs = truncated.filter((m) => m.role === "system");
  const nonSystem = truncated.filter((m) => m.role !== "system");

  // Work backwards: keep as many recent messages as fit
  const kept: Message[] = [];
  let keptTokens = 0;

  for (let i = nonSystem.length - 1; i >= 0; i--) {
    const msgTokens = estimateMessageTokens(nonSystem[i]);
    if (keptTokens + msgTokens <= maxTokens * 0.7) {
      // 70% for recent messages, 30% buffer for response
      kept.unshift(nonSystem[i]);
      keptTokens += msgTokens;
    } else {
      break;
    }
  }

  // Messages that didn't fit become a summary
  const dropped = nonSystem.slice(0, nonSystem.length - kept.length);
  if (dropped.length > 0) {
    const summary = buildSummary(dropped);
    summarizedCount = dropped.length;

    const result = [...systemMsgs, ...kept];
    // Insert summary between system and recent messages
    result.splice(systemMsgs.length, 0, {
      id: "__summary__",
      conversationId: "",
      role: "system",
      content: summary,
      createdAt: 0,
    } as Message);

    return {
      messages: messagesToLlm(result),
      compacted,
      summarizedCount,
      truncatedCount,
      toolsInlinedCount,
    };
  }

  return {
    messages: messagesToLlm([...systemMsgs, ...kept]),
    compacted,
    summarizedCount,
    truncatedCount,
    toolsInlinedCount,
  };
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
