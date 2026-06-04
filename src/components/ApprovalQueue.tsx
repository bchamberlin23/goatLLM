import { Check, X } from "lucide-react";
import { approveExecution, denyExecution } from "../lib/tools";
import { useChatStore } from "../stores/chat";
import type { ToolCallEntry } from "../stores/chat";

function inputLabel(tc: ToolCallEntry) {
  if (tc.input && typeof tc.input === "object") {
    const input = tc.input as Record<string, unknown>;
    if (typeof input.command === "string") return input.command;
    if (typeof input.path === "string") return input.path;
    if (typeof input.url === "string") return input.url;
  }
  return tc.toolName;
}

export function ApprovalQueue() {
  const activeId = useChatStore((s) => s.activeId);
  const messages = useChatStore((s) => (activeId ? s.messages[activeId] ?? [] : []));
  const pending = messages.flatMap((message) =>
    (message.toolCalls ?? [])
      .filter((tc) => tc.state === "pending_approval")
      .map((tc) => ({ message, tc })),
  );

  if (pending.length === 0) return null;

  return (
    <div className="w-full max-w-[720px] rounded-lg border border-accent/25 bg-accent/[0.07] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
          Approvals
        </span>
        <span className="font-mono text-[10.5px] text-text-4 tabular-nums">
          {pending.length}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {pending.map(({ tc }) => (
          <div key={tc.toolCallId} className="flex min-w-0 items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-2">
              {inputLabel(tc)}
            </code>
            <button
              type="button"
              className="control-icon inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors"
              aria-label={`Deny ${tc.toolName}`}
              onClick={() => denyExecution(tc.toolCallId)}
            >
              <X size={12} strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              className="primary-action inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors"
              aria-label={`Approve ${tc.toolName}`}
              onClick={() => approveExecution(tc.toolCallId)}
            >
              <Check size={12} strokeWidth={2} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
