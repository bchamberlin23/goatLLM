/**
 * Context window management for long conversations.
 * Auto-summarizes old messages and truncates tool outputs
 * to keep the context within model limits.
 */

import type { Message } from "../stores/chat";
import type { LlmConfig, LlmMessage } from "./llm";
import { findCutPoint } from "./compaction/cut-point";
import { buildTurnPrefixSummary, mergeSplitTurnSummary } from "./compaction/split-turn";
import {
  AUTO_COMPACTION_THRESHOLD,
  createCompactionId,
  DEFAULT_COMPACTION_SETTINGS,
  type CompactionEntry,
  type CompactionMode,
  type CompactionPromptVersion,
  type CompactionSettings,
  type CompactionSource,
} from "./compaction/types";
import {
  estimateMessageTokens,
  estimateTextTokens,
} from "./compaction/token-estimate";

export type { CompactionSettings } from "./compaction/types";

// ── Token Estimation ──

export interface ContextUsage {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface EstimatedContextTokens {
  tokens: number;
  usageTokens: number;
  trailingTokens: number;
  lastUsageIndex: number;
}

export function calculateContextTokens(usage: ContextUsage | undefined | null): number {
  if (!usage) return 0;
  if (typeof usage.totalTokens === "number" && usage.totalTokens > 0) {
    return usage.totalTokens;
  }
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheRead ?? 0) +
    (usage.cacheWrite ?? 0)
  );
}

export function getLastAssistantUsage(messages: Message[]): { usage: ContextUsage; index: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    if (message.interrupted) continue;
    if (/^\s*Error:/i.test(message.content)) continue;
    const usage = message.usage ?? {
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
    };
    if (calculateContextTokens(usage) > 0) return { usage, index: i };
    if (typeof message.estimatedContextTokens === "number" && message.estimatedContextTokens > 0) {
      return { usage: { totalTokens: message.estimatedContextTokens }, index: i };
    }
  }
  return null;
}

/**
 * Estimate a complete request before the provider has returned token usage.
 * The system prompt is intentionally included here: it contains built-in
 * instructions, project context, skill bodies, memories, and artifacts that
 * are not represented by visible chat messages.
 */
export function estimateRequestContextTokens(
  systemPrompt: string | null | undefined,
  messages: LlmMessage[],
  tools?: unknown,
): number {
  let tokens = estimateTextTokens(systemPrompt);
  for (const message of messages) {
    if (typeof message.content === "string") {
      tokens += estimateTextTokens(message.content);
      continue;
    }
    for (const part of message.content) {
      if (part.type === "text") tokens += estimateTextTokens(part.text);
      // Native image and file tokenization differs by model. Their exact cost
      // is replaced with provider usage as soon as the response completes.
      else if (part.type === "image") tokens += 1_536;
      else tokens += Math.ceil((part.data.length * 0.75) / 16);
    }
  }
  if (tools) {
    try {
      tokens += estimateTextTokens(JSON.stringify(tools));
    } catch {
      // Tool schemas can contain non-serializable implementation details.
      // Their system-prompt descriptions are still included above.
    }
  }
  return tokens;
}

export function estimateContextTokens(messages: Message[]): EstimatedContextTokens {
  const lastUsage = getLastAssistantUsage(messages);
  if (!lastUsage) {
    const tokens = messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
    return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: -1 };
  }
  const usageTokens = calculateContextTokens(lastUsage.usage);
  const trailingTokens = messages
    .slice(lastUsage.index + 1)
    .reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  return {
    tokens: usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex: lastUsage.index,
  };
}

export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings = DEFAULT_COMPACTION_SETTINGS,
): boolean {
  if (!settings.enabled) return false;
  if (contextWindow <= 0) return false;
  return contextTokens >= contextWindow * AUTO_COMPACTION_THRESHOLD;
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
  previousEntry?: CompactionEntry | null;
  previousSummary?: string;
  conversationId?: string;
  source?: CompactionSource;
  mode?: CompactionMode;
  modelId?: string;
  tokensBefore?: number;
  keepRecentTokens?: number;
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
  /** Durable compaction entry for callers to persist. */
  compactionEntry?: CompactionEntry;
}

function inlineToolCallsForTextOnly(messages: Message[]): { messages: Message[]; count: number } {
  let count = 0;
  const inlined = messages.map((msg) => {
    if (!msg.toolCalls || msg.toolCalls.length === 0) return msg;
    count++;
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
  });
  return { messages: inlined, count };
}

export function buildCompactedLlmMessages(
  messages: Message[],
  options: { stripTools?: boolean } = {},
): LlmMessage[] {
  const prepared = options.stripTools ? inlineToolCallsForTextOnly(messages).messages : messages;
  return messagesToLlm(prepared);
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
  const inlineResult = options.stripTools ? inlineToolCallsForTextOnly(messages) : { messages, count: 0 };
  const inlined = inlineResult.messages;
  if (inlineResult.count > 0) {
    toolsInlinedCount = inlineResult.count;
    compacted = true;
  }

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
  const totalTokens = partitioned.reduce(
    (sum, msg) => sum + estimateMessageTokens(msg),
    0,
  );

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

  // Always include system messages. The cut-point search works on the
  // remaining linear timeline so tool calls, pinned messages, and split turns
  // are treated as constraints on a single boundary.
  const systemMsgs = partitioned.filter((m) => m.role === "system");
  const timeline = partitioned.filter((m) => m.role !== "system");
  if (timeline.length === 0) {
    return {
      messages: messagesToLlm(systemMsgs),
      compacted,
      summarizedCount,
      truncatedCount,
      toolsInlinedCount,
      pinnedDroppedCount,
    };
  }
  const pinnedTimeline = timeline.filter((message) => message.pinned);
  const unpinnedTimeline = timeline.filter((message) => !message.pinned);
  if (unpinnedTimeline.length === 0) {
    return {
      messages: messagesToLlm([...systemMsgs, ...pinnedTimeline]),
      compacted,
      summarizedCount,
      truncatedCount,
      toolsInlinedCount,
      pinnedDroppedCount,
    };
  }

  const fixedTokens = systemMsgs.reduce((s, m) => s + estimateMessageTokens(m), 0);
  const keepRecentTokens = Math.max(
    1,
    options.keepRecentTokens ?? Math.floor(maxTokens * 0.7) - fixedTokens,
  );
  const cut = findCutPoint(unpinnedTimeline, 0, unpinnedTimeline.length - 1, keepRecentTokens);
  const dropped = unpinnedTimeline.slice(0, cut.firstKeptIndex);
  const keptUnpinned = unpinnedTimeline.slice(cut.firstKeptIndex);
  const kept = [
    ...pinnedTimeline,
    ...keptUnpinned,
  ].sort(compareByCreated);

  if (dropped.length > 0) {
    const previousEntry = options.previousEntry ?? null;
    const deltaOps = extractFileOperations(dropped);
    const cumulative = mergeFileOperations(previousEntry, deltaOps);
    let summary = buildSummary(dropped, {
      previousSummary: options.previousSummary ?? previousEntry?.summary,
      deltaReadFiles: deltaOps.readFiles,
      deltaModifiedFiles: deltaOps.modifiedFiles,
      cumulativeReadFiles: cumulative.readFiles,
      cumulativeModifiedFiles: cumulative.modifiedFiles,
      updateMode: !!(options.previousSummary ?? previousEntry?.summary),
    });
    let turnPrefix: string | undefined;
    if (cut.isSplitTurn) {
      turnPrefix = buildTurnPrefixSummary(unpinnedTimeline.slice(cut.turnStartIndex, cut.firstKeptIndex));
      summary = mergeSplitTurnSummary(summary, turnPrefix);
    }
    summarizedCount = dropped.length;
    const firstKept = keptUnpinned[0] ?? kept[0];
    const promptVersion: CompactionPromptVersion =
      options.previousSummary || previousEntry?.summary ? "update" : "initial";
    const compactionEntry: CompactionEntry | undefined = firstKept
      ? {
          id: createCompactionId(),
          conversationId:
            options.conversationId ??
            firstKept.conversationId ??
            messages.find((message) => message.conversationId)?.conversationId ??
            "",
          firstKeptId: firstKept.id,
          summary,
          readFiles: cumulative.readFiles,
          modifiedFiles: cumulative.modifiedFiles,
          tokensBefore: options.tokensBefore ?? totalTokens,
          source: options.source ?? "auto",
          isSplitTurn: cut.isSplitTurn,
          turnPrefix,
          promptVersion,
          createdAt: Date.now(),
          mode: options.mode ?? "chat",
          modelId: options.modelId,
        }
      : undefined;
    const summaryEntry: Message = {
      id: compactionEntry ? `compaction-${compactionEntry.id}` : "__summary__",
      conversationId: compactionEntry?.conversationId ?? "",
      role: "system",
      content: summary,
      createdAt: kept[0]?.createdAt ? kept[0].createdAt - 0.5 : 0,
    } as Message;
    const result: Message[] = [
      ...systemMsgs,
      summaryEntry,
      ...kept,
    ];
    const llmMessages = messagesToLlm(result);
    return {
      messages: llmMessages,
      compacted,
      summarizedCount,
      truncatedCount,
      toolsInlinedCount,
      pinnedDroppedCount,
      compactionEntry,
    };
  }

  return {
    messages: messagesToLlm([...systemMsgs, ...kept]),
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

export interface FileOperations {
  readFiles: string[];
  modifiedFiles: string[];
}

interface BuildSummaryOptions {
  previousSummary?: string;
  deltaReadFiles?: string[];
  deltaModifiedFiles?: string[];
  cumulativeReadFiles?: string[];
  cumulativeModifiedFiles?: string[];
  updateMode?: boolean;
}

function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort();
}

function extractToolPath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as { path?: unknown; filePath?: unknown }).path ??
    (input as { filePath?: unknown }).filePath;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractFileOperations(messages: Message[]): FileOperations {
  const readFiles = new Set<string>();
  const modifiedFiles = new Set<string>();

  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      const path = extractToolPath(toolCall.input);
      if (!path) continue;
      if (
        toolCall.toolName === "read_file" ||
        toolCall.toolName === "read_pdf" ||
        toolCall.toolName === "read_text_file_abs" ||
        toolCall.toolName === "list_dir" ||
        toolCall.toolName === "search_content"
      ) {
        readFiles.add(path);
      } else if (
        toolCall.toolName === "write_file" ||
        toolCall.toolName === "edit_file" ||
        toolCall.toolName === "delete_file"
      ) {
        modifiedFiles.add(path);
      }
    }
    for (const path of message.editedFiles ?? []) {
      modifiedFiles.add(path);
    }
  }

  return {
    readFiles: sortedUnique(readFiles),
    modifiedFiles: sortedUnique(modifiedFiles),
  };
}

function mergeFileOperations(
  previousEntry: CompactionEntry | null,
  delta: FileOperations,
): FileOperations {
  return {
    readFiles: sortedUnique([...(previousEntry?.readFiles ?? []), ...delta.readFiles]),
    modifiedFiles: sortedUnique([...(previousEntry?.modifiedFiles ?? []), ...delta.modifiedFiles]),
  };
}

/**
 * Build a concise summary of dropped messages using extractive sampling.
 * Each user message gets its first ~200 chars preserved; assistant messages
 * are summarized more aggressively.
 */
function buildSummary(messages: Message[], options: BuildSummaryOptions = {}): string {
  const parts: string[] = [];

  if (options.updateMode && options.previousSummary?.trim()) {
    parts.push("## Previous Context");
    parts.push(options.previousSummary.trim());
    parts.push("");
    parts.push("## New Context");
  }

  parts.push("## Goal");
  // Extract goal from first user message
  const firstUser = messages.find((m) => m.role === "user");
  if (firstUser) {
    parts.push(firstUser.content.slice(0, 200) + (firstUser.content.length > 200 ? "…" : ""));
  }

  parts.push("");
  parts.push("## Progress");
  parts.push("### Done");

  for (const msg of messages) {
    if (msg.role === "user") {
      parts.push(`- User: ${msg.content.slice(0, 120)}${msg.content.length > 120 ? "…" : ""}`);
    } else if (msg.role === "assistant") {
      const snippet = msg.content.slice(0, 150);
      if (snippet.trim()) parts.push(`- ${snippet}${msg.content.length > 150 ? "…" : ""}`);

      // Track files from tool calls
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          const path = extractToolPath(tc.input);
          parts.push(`  - [Used ${tc.toolName}${path ? `: ${path}` : ""}]`);
        }
      }
    }
  }

  // File tracking section. The rendered summary shows this compaction's
  // delta, while the persisted CompactionEntry stores cumulative history.
  const deltaReadFiles = options.deltaReadFiles ?? extractFileOperations(messages).readFiles;
  const deltaModifiedFiles = options.deltaModifiedFiles ?? extractFileOperations(messages).modifiedFiles;
  if (deltaReadFiles.length > 0 || deltaModifiedFiles.length > 0) {
    parts.push("");
    parts.push("## Files touched");
    if (deltaReadFiles.length > 0) {
      parts.push("<read-files>");
      for (const f of deltaReadFiles) parts.push(f);
      parts.push("</read-files>");
    }
    if (deltaModifiedFiles.length > 0) {
      parts.push("<modified-files>");
      for (const f of deltaModifiedFiles) parts.push(f);
      parts.push("</modified-files>");
    }
  }

  const cumulativeReadFiles = options.cumulativeReadFiles ?? [];
  const cumulativeModifiedFiles = options.cumulativeModifiedFiles ?? [];
  if (cumulativeReadFiles.length > 0 || cumulativeModifiedFiles.length > 0) {
    parts.push("");
    parts.push("## Cumulative files");
    if (cumulativeReadFiles.length > 0) {
      parts.push(`Read: ${cumulativeReadFiles.join(", ")}`);
    }
    if (cumulativeModifiedFiles.length > 0) {
      parts.push(`Modified: ${cumulativeModifiedFiles.join(", ")}`);
    }
  }

  parts.push("");
  parts.push("## Next steps");
  parts.push("Continue from where the conversation left off.");

  return parts.join("\n");
}

// ── Helpers ──

/** Fold persisted reasoning into assistant content so "continue" reuses prior analysis. */
function assistantContentForLlm(m: Message): string {
  const thinking = m.thinkingContent?.trim();
  const body = m.content?.trim() ?? "";
  if (!thinking) return m.content;
  const marker = "[Prior reasoning";
  if (body.includes(marker)) return m.content;
  const prefix =
    `${marker} — do not repeat this analysis; build on it and continue the response]\n` +
    `${thinking}\n\n[Response]\n`;
  return body ? `${prefix}${m.content}` : `${prefix}(no answer text yet — continue from the reasoning above)`;
}

function messagesToLlm(messages: Message[]): LlmMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
    .map((m) => {
      if (m.role !== "assistant" || !m.toolCalls?.length) {
        const content =
          m.role === "assistant" ? assistantContentForLlm(m) : m.content;
        return { role: m.role as "user" | "assistant" | "system", content };
      }
      const doneTools = m.toolCalls.filter((tc) => tc.state === "done");
      const baseContent = assistantContentForLlm(m);
      if (!doneTools.length) {
        return { role: m.role, content: baseContent };
      }
      const toolLines = doneTools.map((tc) => {
        const prefix = tc.toolName === "write_file" || tc.toolName === "edit_file"
          ? `[wrote: ${(tc.input as { path?: string })?.path ?? "file"}]`
          : `[${tc.toolName}]`;
        const result = typeof tc.output === "string" ? tc.output.slice(0, 250) : "";
        return result ? `${prefix} ${result}${tc.output && (typeof tc.output === "string") && tc.output.length >= 250 ? "…" : ""}` : prefix;
      }).join("\n");
      const content = baseContent
        ? `${baseContent}\n${toolLines}`
        : toolLines;
      return { role: "assistant", content };
    });
}

/**
 * Estimate the total token count of the current conversation.
 */
export function estimateTotalTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

// ── LLM-based summarization ──

const INITIAL_SUMMARY_PROMPT = `You are a context-compaction assistant. The user is mid-conversation with another agent and needs an older slice of the conversation summarized so it fits in the LLM context window.

Produce a structured summary that preserves enough state for the agent to resume seamlessly. Use this exact format:

## Goal
<2-4 sentences: what the user was trying to do, current status, and any decisions made>

## Constraints & Preferences
- <requirements mentioned by user>

## Progress
### Done
- [x] <completed tasks>

### In Progress
- [ ] <current work>

### Blocked
- <issues, if any>

## Key Decisions
- **<Decision>**: <rationale>

## Files touched
<read-files>
path/to/file1.ts
path/to/file2.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>

## Next Steps
1. <what should happen next>

## Critical Context
- <data needed to continue>

Rules:
- Stay under 500 words.
- Quote exact identifiers (function names, file paths, error messages).
- Do NOT speculate beyond what's in the transcript.
- Do NOT include any preamble like "Here's the summary" — start with the ## Goal heading.`;

const UPDATE_SUMMARY_PROMPT = `You are a context-compaction assistant updating an existing conversation summary with a newer slice of transcript.

preserve all existing durable context, add new facts and decisions, and move items from in-progress to done when the transcript proves they were completed.

Use the same structured format as the previous summary:

## Goal
## Constraints & Preferences
## Progress
### Done
### In Progress
### Blocked
## Key Decisions
## Files touched
## Next Steps
## Critical Context

Rules:
- Stay under 650 words.
- Preserve all existing context unless the new transcript explicitly supersedes it.
- Quote exact identifiers (function names, file paths, error messages).
- Do NOT speculate beyond the transcript.
- Do NOT include a preamble. Start with the ## Goal heading.`;

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

export interface SummarizationRequestInput {
  dropped: Message[];
  previousSummary?: string;
  cumulativeFiles?: FileOperations;
  customInstructions?: string;
}

export interface SummarizationRequest {
  system: string;
  prompt: string;
  promptVersion: CompactionPromptVersion;
}

export function buildSummarizationRequest(input: SummarizationRequestInput): SummarizationRequest {
  const transcript = renderTranscript(input.dropped);
  const trimmed =
    transcript.length > 24_000
      ? transcript.slice(0, 12_000) +
        `\n\n…[middle ${transcript.length - 24_000} chars elided]…\n\n` +
        transcript.slice(transcript.length - 12_000)
      : transcript;
  const hasPrevious = !!input.previousSummary?.trim();
  const promptVersion: CompactionPromptVersion = hasPrevious ? "update" : "initial";
  const blocks: string[] = [];
  if (input.customInstructions?.trim()) {
    blocks.push(`Focus especially on: ${input.customInstructions.trim()}`);
  }
  if (hasPrevious) {
    blocks.push(`<previous-summary>\n${input.previousSummary!.trim()}\n</previous-summary>`);
  }
  if (
    input.cumulativeFiles &&
    (input.cumulativeFiles.readFiles.length > 0 || input.cumulativeFiles.modifiedFiles.length > 0)
  ) {
    blocks.push(
      [
        "<cumulative-files>",
        "<read-files>",
        ...input.cumulativeFiles.readFiles,
        "</read-files>",
        "<modified-files>",
        ...input.cumulativeFiles.modifiedFiles,
        "</modified-files>",
        "</cumulative-files>",
      ].join("\n"),
    );
  }
  blocks.push(`Summarize the following conversation slice:\n\n${trimmed}`);

  return {
    system: hasPrevious ? UPDATE_SUMMARY_PROMPT : INITIAL_SUMMARY_PROMPT,
    prompt: blocks.join("\n\n"),
    promptVersion,
  };
}

/**
 * Generate a structured LLM summary of the given messages. Falls back to
 * the extractive `buildSummary` if the LLM call fails or returns nothing
 * usable. The returned string can be dropped straight into the system-role
 * summary slot inserted by `compactMessages`.
 *
 * @param customInstructions Optional user instructions to focus the summary
 *        (e.g., "focus on the authentication flow").
 */
export async function summarizeWithLlm(
  dropped: Message[],
  config: LlmConfig,
  signal?: AbortSignal,
  customInstructions?: string,
  previousSummary?: string,
  cumulativeFiles?: FileOperations,
): Promise<string> {
  if (dropped.length === 0) return "";
  const request = buildSummarizationRequest({
    dropped,
    previousSummary,
    cumulativeFiles,
    customInstructions,
  });
  try {
    const { generateText } = await import("ai");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const { initFetch, getFetch } = await import("./fetch-adapter");
    await initFetch();
    const customFetch = getFetch() ?? globalThis.fetch.bind(globalThis);
    type SummaryModelFactory =
      | ReturnType<typeof createAnthropic>
      | ReturnType<typeof createOpenAICompatible>
      | ReturnType<typeof createOpenAI>;
    let modelFactory: SummaryModelFactory;
    if (config.provider === "anthropic") {
      modelFactory = createAnthropic({ apiKey: config.apiKey ?? "", fetch: customFetch });
    } else if (
      ["opencode-go", "opencode-go-free", "groq", "deepseek", "openrouter", "ollama", "lmstudio"].includes(config.provider)
    ) {
      modelFactory = createOpenAICompatible({
        name: config.provider,
        baseURL: config.baseUrl ?? "http://localhost:1234/v1",
        apiKey: config.apiKey ?? "not-needed",
        fetch: customFetch,
      });
    } else {
      modelFactory = createOpenAI({ apiKey: config.apiKey ?? "", fetch: customFetch });
    }
    const model = modelFactory.languageModel(config.modelId);
    const result = await generateText({
      model,
      system: request.system,
      prompt: request.prompt,
      maxOutputTokens: 800,
      temperature: 0.2,
      abortSignal: signal,
    });
    const text = result.text.trim();
    if (text.length < 40) {
      // Implausibly short — the model probably refused or stalled. Fall back.
      return buildSummary(dropped, {
        previousSummary,
        cumulativeReadFiles: cumulativeFiles?.readFiles,
        cumulativeModifiedFiles: cumulativeFiles?.modifiedFiles,
        updateMode: request.promptVersion === "update",
      });
    }
    return `[Earlier conversation summary — LLM generated]\n\n${text}`;
  } catch {
    // Network / auth / quota — graceful fallback to extractive summary.
    return buildSummary(dropped, {
      previousSummary,
      cumulativeReadFiles: cumulativeFiles?.readFiles,
      cumulativeModifiedFiles: cumulativeFiles?.modifiedFiles,
      updateMode: request.promptVersion === "update",
    });
  }
}
