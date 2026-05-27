/**
 * Approval gate — the central choke point that turns "the model wants to
 * call a write tool" into "the user said yes." Every write tool wraps its
 * execute() body in withApproval() so the user gets a card and clicks
 * Approve / Deny before the operation runs (or skips when permission mode
 * is "auto" or "yolo").
 *
 * This module owns:
 * - pendingApprovals: the live registry of operations waiting on the user
 * - withApproval: the wrapper write tools call
 * - approveExecution / denyExecution: the UI-side resolvers
 * - WRITE_TOOL_NAMES + AUTO_MODE_SAFE_TOOLS: which tools need approval, and
 *   which can auto-run under "auto" mode
 * - isWriteTool / shouldAutoApprove: pure helpers used by InputBar + tests
 *
 * Lifted out of src/lib/tools.ts during the registry split so MCP and
 * subagent code can share one approval surface without a circular import.
 */
import { useChatStore } from "../../stores/chat";
import { logApproval } from "../event-log";

export type DeferredOperation = () => Promise<unknown>;

interface PendingApproval {
  resolveApproval: (approved: boolean) => void;
  operation: DeferredOperation;
  conversationId: string;
  messageId: string;
}

const pendingApprovals = new Map<string, PendingApproval>();

const WRITE_TOOL_NAMES = new Set([
  "write_file",
  "edit_file",
  "bash",
  "exec_command",
  "diff_file",
  "read_lints",
  "run_tests",
  "browser_fetch",
  "browser_extract",
  "browser_session_open",
  "browser_session_navigate",
  "index_workspace",
]);

/** Tools that "auto" mode can run without prompting. Shell-style commands are
 * intentionally NOT in this set: bash and exec_command can do anything to the
 * machine, so they always require explicit approval unless mode is "yolo". */
const AUTO_MODE_SAFE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "diff_file",
  "read_lints",
  "run_tests",
]);

export type PermissionMode = "manual" | "auto" | "yolo";

/** Module-level bypass flag. Set by spawn_subagent while the child loop
 *  runs — all write tools auto-execute without pausing for user approval.
 *  Restored to false after the subagent finishes so the parent's
 *  permission mode resumes normal gating. */
let _bypassApproval = false;

/** Run a function with the approval gate bypassed. Used by spawn_subagent
 *  so the child loop's write tools execute immediately. Restores the
 *  bypass state in a finally block. */
export async function withSubagentBypass<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _bypassApproval;
  _bypassApproval = true;
  try {
    return await fn();
  } finally {
    _bypassApproval = prev;
  }
}

/** Check if a tool name requires user approval before execution. */
export function isWriteTool(name: string): boolean {
  return WRITE_TOOL_NAMES.has(name);
}

/** Whether a write-tool call should bypass the approval gate under the given mode. */
export function shouldAutoApprove(toolName: string, mode: PermissionMode): boolean {
  if (mode === "yolo") return true;
  if (mode === "auto") return AUTO_MODE_SAFE_TOOLS.has(toolName);
  return false;
}

/** Find a tool call entry in the store by toolCallId. */
function findToolCall(toolCallId: string): { toolName: string } | undefined {
  const store = useChatStore.getState();
  for (const msgs of Object.values(store.messages)) {
    for (const m of msgs) {
      const tc = m.toolCalls?.find((t) => t.toolCallId === toolCallId);
      if (tc) return tc;
    }
  }
  return undefined;
}

/** Locate the (conversationId, messageId) that contains a given toolCallId. */
function locateToolCall(toolCallId: string): { conversationId: string; messageId: string } {
  const store = useChatStore.getState();
  for (const [cid, msgs] of Object.entries(store.messages)) {
    for (const m of msgs) {
      if (m.toolCalls?.some((tc) => tc.toolCallId === toolCallId)) {
        return { conversationId: cid, messageId: m.id };
      }
    }
  }
  return { conversationId: "", messageId: "" };
}

/**
 * Approve a pending tool execution. Called from the UI (MessageBubble).
 * Transitions tool call state to "running" and resolves the promise.
 */
export function approveExecution(toolCallId: string): void {
  const pending = pendingApprovals.get(toolCallId);
  if (!pending) return;
  const store = useChatStore.getState();
  store.updateToolCallState(
    pending.conversationId,
    pending.messageId,
    toolCallId,
    "running",
  );
  const tc = findToolCall(toolCallId);
  logApproval(pending.conversationId, toolCallId, tc?.toolName ?? "unknown", true);
  pending.resolveApproval(true);
}

/**
 * Deny a pending tool execution. Called from the UI (MessageBubble).
 * Transitions tool call state to "done" with a denial message and resolves the promise.
 */
export function denyExecution(toolCallId: string): void {
  const pending = pendingApprovals.get(toolCallId);
  if (!pending) return;
  const store = useChatStore.getState();
  store.completeToolCall(
    pending.conversationId,
    pending.messageId,
    toolCallId,
    "❌ Operation denied by user.",
  );
  const tc = findToolCall(toolCallId);
  logApproval(pending.conversationId, toolCallId, tc?.toolName ?? "unknown", false);
  pending.resolveApproval(false);
}

/**
 * Shared approval gate for write tools. Each write tool wraps its execute()
 * body in this; the wrapper either auto-approves under permission-mode
 * rules or parks the operation in pendingApprovals until the UI resolves.
 */
export async function withApproval(
  toolCallId: string,
  operation: DeferredOperation,
): Promise<unknown> {
  // Subagent bypass: all tools auto-execute without the approval gate.
  if (_bypassApproval) return operation();

  const store = useChatStore.getState();
  const tcEarly = findToolCall(toolCallId);
  const toolName = tcEarly?.toolName ?? "unknown";

  // Auto-approve path: skip the gate entirely when permission mode allows it,
  // or when design mode is active (design mode is always yolo).
  if (store.designMode || shouldAutoApprove(toolName, store.permissionMode)) {
    const { conversationId, messageId } = locateToolCall(toolCallId);
    store.updateToolCallState(conversationId, messageId, toolCallId, "running");
    logApproval(conversationId, toolCallId, toolName, true);
    return operation();
  }

  const { conversationId, messageId } = locateToolCall(toolCallId);

  const approved = await new Promise<boolean>((resolve) => {
    pendingApprovals.set(toolCallId, {
      resolveApproval: resolve,
      operation,
      conversationId,
      messageId,
    });
  });

  if (!approved) {
    pendingApprovals.delete(toolCallId);
    return "❌ Operation denied by user.";
  }

  const op = pendingApprovals.get(toolCallId)?.operation;
  pendingApprovals.delete(toolCallId);
  if (!op) return "Operation expired.";
  return op();
}
