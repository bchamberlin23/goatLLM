/**
 * llm.ts — public stream entry points and the title generator.
 *
 * The stream-and-tool-loop body lives in agentLoop.ts (one source of
 * truth for both parent agents and PR2's subagents). This file is the
 * stable surface call sites import: streamChat for the parent stream,
 * generateTitle for async title generation, and the shared types.
 */
import { generateText } from "ai";
import { createModel } from "./model-factory";
import { agentLoop, type AgentLoopOptions } from "./agentLoop";
import type {
  LlmConfig,
  LlmMessage,
  LlmContentPart,
  StreamCallbacks,
  ToolCallInfo,
  ToolResultInfo,
  ToolErrorInfo,
} from "./llm-types";

export type {
  LlmConfig,
  LlmMessage,
  LlmContentPart,
  StreamCallbacks,
  ToolCallInfo,
  ToolResultInfo,
  ToolErrorInfo,
};

/** Public stream options. Mirrors AgentLoopOptions but omits internal
 *  fields (parentSignal, depth) so callers can't accidentally pretend to
 *  be a subagent. PR2's spawn_subagent calls agentLoop directly. */
export interface StreamOptions {
  abortSignal?: AbortSignal;
  tools?: AgentLoopOptions["tools"];
  maxToolRounds?: number;
}

/**
 * Stream a chat turn (parent agent or chat-mode). Thin wrapper over
 * agentLoop with depth=0 and no parentSignal so existing call sites are
 * unchanged. PR2 will introduce a separate spawn entry point that calls
 * agentLoop with depth=1 and the parent's signal chained in.
 */
export async function streamChat(
  messages: LlmMessage[],
  systemPrompt: string | null,
  config: LlmConfig,
  callbacks: StreamCallbacks,
  options?: StreamOptions,
): Promise<void> {
  return agentLoop(messages, systemPrompt, config, callbacks, {
    abortSignal: options?.abortSignal,
    tools: options?.tools,
    maxToolRounds: options?.maxToolRounds,
    depth: 0,
  });
}

export async function generateTitle(
  firstMessage: string,
  config: LlmConfig,
  assistantReply?: string,
): Promise<string | null> {
  const user = firstMessage.trim().slice(0, 600);
  const assistant = (assistantReply ?? "").trim().slice(0, 600);

  const transcript = assistant
    ? `User: ${user}\n\nAssistant: ${assistant}`
    : `User: ${user}`;

  const prompt =
    `You generate short, descriptive titles for chat conversations, like ChatGPT does.\n\n` +
    `Rules:\n` +
    `- 3 to 6 words, max 60 characters.\n` +
    `- Use Title Case (capitalize main words).\n` +
    `- Summarize the topic, not the literal first message. Prefer the subject the user is asking about over filler words like "help", "question", "please".\n` +
    `- No surrounding quotes, no trailing punctuation, no emojis, no markdown.\n` +
    `- Reply in the same language as the user.\n` +
    `- Output ONLY the title on a single line. No prefix like "Title:".\n\n` +
    `Conversation:\n${transcript}`;

  try {
    const model = await createModel(config);
    const result = await generateText({
      model,
      prompt,
      maxOutputTokens: 24,
      temperature: 0.3,
    });

    const cleaned = sanitizeTitle(result.text);
    return cleaned || null;
  } catch (err) {
    console.warn("[generateTitle] failed, will fall back to heuristic:", err);
    return null;
  }
}

/** Words that are useless on their own as a chat title. */
const TITLE_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "with", "by", "is", "are", "was", "were", "be", "been", "being", "do", "does",
  "did", "have", "has", "had", "can", "could", "would", "should", "will",
  "shall", "may", "might", "i", "you", "he", "she", "it", "we", "they", "me",
  "my", "your", "our", "their", "this", "that", "these", "those", "there",
  "here", "how", "what", "why", "when", "where", "who", "which", "please",
  "hi", "hey", "hello", "thanks", "thank", "just", "some", "any", "now", "so",
  "if", "as", "about", "from", "into", "than", "then", "too", "also",
]);

/** Cheap, deterministic fallback when the LLM titler is unavailable. Picks the
 * most informative words from the user's first message and Title-Cases them. */
export function heuristicTitle(firstMessage: string): string {
  const cleaned = firstMessage
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\[File:[^\]]*\]/g, " ")
    .replace(/\[PDF:[^\]]*\]/g, " ")
    .replace(/\[Word:[^\]]*\]/g, " ")
    .replace(/\[Slides:[^\]]*\]/g, " ")
    .replace(/\[Spreadsheet:[^\]]*\]/g, " ")
    .replace(/\[Notebook:[^\]]*\]/g, " ")
    .replace(/\[RTF:[^\]]*\]/g, " ")
    .replace(/\[Image OCR:[^\]]*\]/g, " ")
    .replace(/\[Web:[^\]]*\]/g, " ")
    .replace(/\[YouTube:[^\]]*\]/g, " ")
    .replace(/\[Audio:[^\]]*\]/g, " ")
    .replace(/\[Attached:[^\]]*\]/g, " ")
    .replace(/[^\p{L}\p{N}\s'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "New chat";

  const tokens = cleaned.split(" ");
  const meaningful = tokens.filter(
    (t) => t.length > 1 && !TITLE_STOPWORDS.has(t.toLowerCase())
  );
  const pool = meaningful.length >= 2 ? meaningful : tokens;

  const picked = pool.slice(0, 6);
  const titled = picked
    .map((w, i) => {
      const lower = w.toLowerCase();
      // Don't lowercase obvious acronyms (RUST, API, AWS) — keep as-is.
      if (w.length > 1 && w === w.toUpperCase()) return w;
      if (i > 0 && TITLE_STOPWORDS.has(lower) && lower.length <= 3) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");

  const final = sanitizeTitle(titled);
  return final || "New chat";
}

function sanitizeTitle(raw: string): string {
  let t = raw.trim();
  // Drop a leading "Title:" / "title -" prefix the model sometimes adds.
  t = t.replace(/^\s*title\s*[:\-–—]\s*/i, "");
  // Take only the first non-empty line.
  t = t.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0) ?? "";
  // Strip wrapping quotes (straight or curly) and matching trailing quote.
  t = t.replace(/^["'“”‘’`]+/, "").replace(/["'“”‘’`]+$/, "");
  // Strip trailing punctuation (.,;:!?…).
  t = t.replace(/[\s.,;:!?…]+$/u, "");
  // Collapse internal whitespace.
  t = t.replace(/\s+/g, " ").trim();
  // Hard cap so wildly long titles don't blow up the sidebar.
  if (t.length > 60) t = t.slice(0, 60).trim();
  return t;
}
