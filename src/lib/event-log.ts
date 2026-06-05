/**
 * Agent event logger.
 *
 * Append-only event recording for debugging, resumability, and sharing.
 * Events are written to SQLite via the `log_event` Tauri command.
 * Reading is done via `get_events`.
 */

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

import { log, withError } from "./logger";

export type EventType =
  | "message"
  | "tool_call"
  | "tool_result"
  | "approval"
  | "error"
  | "lifecycle";

export interface AgentEvent {
  type: EventType;
  conversationId: string;
  data: unknown;
  timestamp?: number;
}

/**
 * Log an event to the agent event log. Fire-and-forget — never throws.
 */
export async function logAgentEvent(event: AgentEvent): Promise<void> {
  try {
    const payload = JSON.stringify({
      type: event.type,
      data: event.data,
      timestamp: event.timestamp ?? Date.now(),
    });
    await invoke("log_event", {
      conversationId: event.conversationId,
      eventType: event.type,
      payload,
    });
  } catch (e) {
    // Best-effort logging — never break the app for logging failures
    log.warn("Failed to log event", withError("event-log", undefined, e));
  }
}

/**
 * Log a message event (user or assistant).
 */
export function logMessage(
  conversationId: string,
  role: string,
  content: string,
  messageId: string,
): void {
  logAgentEvent({
    type: "message",
    conversationId,
    data: { role, content, messageId },
  });
}

/**
 * Log a tool call event.
 */
export function logToolCall(
  conversationId: string,
  toolCallId: string,
  toolName: string,
  input: unknown,
): void {
  logAgentEvent({
    type: "tool_call",
    conversationId,
    data: { toolCallId, toolName, input },
  });
}

/**
 * Log a tool result event.
 */
export function logToolResult(
  conversationId: string,
  toolCallId: string,
  toolName: string,
  output: unknown,
): void {
  logAgentEvent({
    type: "tool_result",
    conversationId,
    data: { toolCallId, toolName, output },
  });
}

/**
 * Log an approval decision event.
 */
export function logApproval(
  conversationId: string,
  toolCallId: string,
  toolName: string,
  approved: boolean,
): void {
  logAgentEvent({
    type: "approval",
    conversationId,
    data: { toolCallId, toolName, approved },
  });
}

/**
 * Log an error event.
 */
export function logError(
  conversationId: string,
  error: string,
  context?: string,
): void {
  logAgentEvent({
    type: "error",
    conversationId,
    data: { error, context },
  });
}

/**
 * Retrieve all events for a conversation from the event log.
 */
export async function getEvents(conversationId: string): Promise<AgentEvent[]> {
  try {
    const raw = await invoke<string[]>("get_events", { conversationId });
    return raw.map((r) => JSON.parse(r));
  } catch {
    return [];
  }
}
