import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, stepCountIs, generateText, type ToolSet } from "ai";
import type { LanguageModel } from "ai";
import { getFetch, initFetch } from "./fetch-adapter";

export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mimeType?: string };

export interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string | LlmContentPart[];
}

export interface LlmConfig {
  provider: string;
  modelId: string;
  apiKey: string | null;
  baseUrl?: string;
}

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface ToolResultInfo {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output: unknown;
}

async function createModel(config: LlmConfig): Promise<LanguageModel> {
  await initFetch();
  const customFetch = getFetch() ?? globalThis.fetch.bind(globalThis);

  const baseURL = config.baseUrl ?? "http://localhost:1234/v1";

  if (
    config.provider === "opencode-go" ||
    config.provider === "groq"
  ) {
    const compat = createOpenAICompatible({
      name: config.provider,
      baseURL,
      apiKey: config.apiKey ?? "not-needed",
      fetch: customFetch,
    });
    return compat.languageModel(config.modelId);
  }

  const openai = createOpenAI({
    apiKey: config.apiKey ?? "",
    fetch: customFetch,
  });
  return openai.languageModel(config.modelId);
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onToolCall?: (toolCall: ToolCallInfo) => void;
  onToolResult?: (result: ToolResultInfo) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

export interface StreamOptions {
  abortSignal?: AbortSignal;
  tools?: ToolSet;
  maxToolRounds?: number;
}

export async function streamChat(
  messages: LlmMessage[],
  systemPrompt: string | null,
  config: LlmConfig,
  callbacks: StreamCallbacks,
  options?: StreamOptions,
): Promise<void> {
  const model = await createModel(config);

  try {
    const result = streamText({
      model,
      system: systemPrompt ?? undefined,
      messages: messages.map((m) => {
        const role = m.role as "user" | "assistant" | "system";
        if (typeof m.content === "string") {
          return { role, content: m.content };
        }
        return {
          role,
          content: m.content.map((part) => {
            if (part.type === "text") return { type: "text" as const, text: part.text };
            return { type: "image" as const, image: part.image, mimeType: part.mimeType };
          }),
        };
      }) as any,
      ...(options?.tools ? { tools: options.tools, toolChoice: "auto" as const } : {}),
      stopWhen: options?.tools
        ? stepCountIs(options.maxToolRounds ?? 10)
        : stepCountIs(1),
      abortSignal: options?.abortSignal,
    });

    let fullText = "";
    for await (const chunk of result.fullStream) {
      switch (chunk.type) {
        case "text-delta":
          fullText += chunk.text;
          callbacks.onToken(chunk.text);
          break;

        case "tool-call":
          callbacks.onToolCall?.({
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: (chunk as Record<string, unknown>).input,
          });
          break;

        case "tool-result":
          callbacks.onToolResult?.({
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            input: (chunk as Record<string, unknown>).input,
            output: (chunk as Record<string, unknown>).output,
          });
          break;

        case "tool-error":
          callbacks.onError(
            new Error(`Tool error: ${chunk.toolName} — ${(chunk as Record<string, unknown>).error}`),
          );
          break;

        case "error":
          callbacks.onError((chunk as Record<string, unknown>).error as Error);
          return;

        case "abort":
          return;

        case "finish":
          // stream complete
          break;
      }
    }

    callbacks.onDone(fullText);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      callbacks.onDone("");
      return;
    }
    const err = error instanceof Error ? error : new Error(String(error));
    // Detect common provider error patterns and surface a friendly message
    const msg = err.message || "";
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
