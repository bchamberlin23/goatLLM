import { Activity, CheckCircle, FileDiff, ListChecks, XCircle } from "lucide-react";
import {
  buildVerificationSuggestions,
} from "../lib/agent-session";
import { summarizeAgentTurn } from "../lib/agent-turn-summary";
import { requestSuggestedCheckApproval } from "../lib/tools/approval";
import { useChatStore } from "../stores/chat";

export function WorkspaceHealthPanel() {
  const activeId = useChatStore((s) => s.activeId);
  const workspacePath = useChatStore((s) => s.workspacePath);
  const verificationPolicy = useChatStore((s) => s.verificationPolicy);
  const projectCheckMemory = useChatStore((s) => s.projectCheckMemory);
  const messages = useChatStore((s) => (activeId ? s.messages[activeId] ?? [] : []));
  const agentTurns = messages.filter((message) => message.role === "assistant" && message.toolCalls?.length);
  const latest = agentTurns.length > 0 ? agentTurns[agentTurns.length - 1] : undefined;
  const summary = latest ? summarizeAgentTurn(latest) : null;

  if (!workspacePath || !summary) return null;

  const healthTone =
    summary.doneContract.status === "failed"
      ? "text-error"
      : summary.doneContract.status === "blocked"
        ? "text-accent"
        : "text-success";
  const Icon = summary.doneContract.status === "failed" ? XCircle : CheckCircle;
  const statusLabel =
    summary.doneContract.status === "blocked"
      ? "Blocked"
      : summary.doneContract.status === "rolled_back"
        ? "Rolled back"
        : summary.verification.label;
  const needsAttention = summary.doneContract.status === "blocked" || summary.doneContract.status === "failed";
  const suggestedChecks = needsAttention
    ? buildVerificationSuggestions(summary.changedFiles, verificationPolicy, projectCheckMemory)
      .filter((check) => summary.checks.every((existing) => existing.label !== check.command))
    : [];
  const shouldShow =
    needsAttention ||
    summary.pendingApprovals > 0 ||
    summary.verification.status === "running" ||
    suggestedChecks.length > 0;

  if (!shouldShow) return null;

  const runSuggestedCheck = (command: string) => {
    if (!activeId || !latest) return;
    requestSuggestedCheckApproval({
      conversationId: activeId,
      messageId: latest.id,
      command,
    });
  };

  return (
    <div className="w-full max-w-[720px] rounded-lg border border-hairline bg-white/5 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Activity size={13} strokeWidth={1.8} className="shrink-0 text-text-4" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-3">
            Workspace health
          </span>
        </div>
        <div className={`flex shrink-0 items-center gap-1.5 text-[11.5px] font-medium ${healthTone}`}>
          <Icon size={12} strokeWidth={1.8} aria-hidden />
          {statusLabel}
        </div>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-md border border-hairline bg-white/5 px-1.5 py-0.5 text-[10.5px] text-text-3">
          <FileDiff size={10} strokeWidth={1.8} aria-hidden />
          {summary.changedFiles.length} {summary.changedFiles.length === 1 ? "file" : "files"} changed
        </span>
        {summary.doneContract.nextSteps.map((step) => (
          <span
            key={step}
            className="rounded-md border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-[10.5px] text-accent"
          >
            {step}
          </span>
        ))}
      </div>
      {suggestedChecks.length > 0 && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
          {suggestedChecks.map((check) => (
            <button
              key={check.command}
              type="button"
              onClick={() => runSuggestedCheck(check.command)}
              className="inline-flex items-center gap-1 rounded-md border border-accent/24 bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/15 hover:border-accent/35"
            >
              <ListChecks size={11} strokeWidth={1.8} aria-hidden />
              {check.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
