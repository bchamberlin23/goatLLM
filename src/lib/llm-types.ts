/**
 * Shared LLM types — extracted out of llm.ts so agentLoop.ts and any future
 * stream consumers (PR2's subagent runtime) can import the type surface
 * without a circular dependency on llm.ts itself.
 */

export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mimeType?: string }
  /** Raw file content (typically a PDF) sent to providers that natively
   *  understand the format — Anthropic does server-side OCR + layout
   *  parsing on PDF parts, which is what we use for scanned PDFs. The AI
   *  SDK rejects this part on providers that don't support it, so the
   *  send pipeline routes it conditionally. */
  | { type: "file"; data: string; mimeType: string };

export interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string | LlmContentPart[];
}

export interface LlmConfig {
  provider: string;
  modelId: string;
  apiKey: string | null;
  baseUrl?: string;
  /** User override for max output/response tokens. When set, this is passed
   *  as maxOutputTokens to the model instead of relying on provider defaults. */
  maxResponseTokens?: number;
  /** Reasoning/thinking effort level.
   *  "off" means no extended thinking; otherwise one of the pi-ai
   *  ThinkingLevel values: "minimal" | "low" | "medium" | "high" | "xhigh". */
  reasoningEffort?: string;
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

export interface ToolErrorInfo {
  toolCallId: string;
  toolName: string;
  error: unknown;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onToolCall?: (toolCall: ToolCallInfo) => void;
  onToolResult?: (result: ToolResultInfo) => void;
  /** Called when a single tool invocation fails. Stream continues; this is
   * not a fatal error and should not be surfaced as a user-facing error. */
  onToolError?: (info: ToolErrorInfo) => void;
  /** Called when the model produces thinking/reasoning content (e.g. Claude
   *  extended thinking, DeepSeek R1). Chunks arrive incrementally. */
  onThinking?: (chunk: string) => void;
  /** Called once at the end of a stream with token usage stats.
   *  generationMs is the cumulative time the model spent generating tokens
   *  (excludes tool execution time). Used for accurate tokens/second. */
  onUsage?: (usage: { inputTokens: number; outputTokens: number; cacheRead?: number; cacheWrite?: number; generationMs?: number }) => void;
  onDone: (fullText: string, summary?: string) => void;
  onError: (error: Error) => void;
}

/** Captured tool call from a subagent's transcript. Lightweight — no UI
 *  state (shimmer, approval) needed since subagent tools auto-execute. */
export interface SubagentToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  state: "done" | "error";
  approvalBypassed?: boolean;
}

/** One turn in a subagent conversation transcript. */
export interface SubagentTranscriptEntry {
  role: "user" | "assistant";
  content: string;
  toolCalls?: SubagentToolCall[];
}
