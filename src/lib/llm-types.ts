/**
 * Shared LLM types — extracted out of llm.ts so agentLoop.ts and any future
 * stream consumers (PR2's subagent runtime) can import the type surface
 * without a circular dependency on llm.ts itself.
 */

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
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}
