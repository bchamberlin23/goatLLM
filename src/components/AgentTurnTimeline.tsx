import { ChevronRight, FileDiff, ListChecks, RotateCcw, ShieldAlert, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import type { Message } from "../stores/chat";
import { buildRollbackPreview, summarizeAgentTurn } from "../lib/agent-turn-summary";
import { useChatStore } from "../stores/chat";

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function MetaPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warning" | "success" | "error";
}) {
  const toneClass =
    tone === "error"
      ? "text-error border-error/20 bg-error/10"
      : tone === "success"
        ? "text-success border-success/20 bg-success/10"
        : tone === "warning"
          ? "text-accent border-accent/20 bg-accent/10"
          : "text-text-3 border-white/[0.06] bg-white/[0.04]";

  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums ${toneClass}`}>
      {children}
    </span>
  );
}

export function AgentTurnTimelineHeader({
  message,
  durationLabel,
  expanded,
  onToggle,
  onRunSuggestedCheck,
}: {
  message: Message;
  durationLabel: string;
  expanded: boolean;
  onToggle: () => void;
  onRunSuggestedCheck?: (command: string) => void;
}) {
  const summary = summarizeAgentTurn(message);
  const visibleFiles = summary.changedFiles.slice(0, 3);
  const hiddenFileCount = Math.max(0, summary.changedFiles.length - visibleFiles.length);

  return (
    <div className="w-full rounded-lg border border-white/[0.06] bg-sunken px-3 py-2">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left"
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse run timeline" : "Expand run timeline"}
      >
        <div className="flex min-w-0 items-start gap-2">
          <ChevronRight
            size={12}
            strokeWidth={2}
            className={`mt-1 shrink-0 text-text-4 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[12.5px] font-medium text-text-2">Run timeline</span>
              {durationLabel !== "0s" && (
                <span className="font-mono text-[10.5px] text-text-4 tabular-nums">{durationLabel}</span>
              )}
            </div>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
              {summary.verification.status !== "not_applicable" && (
                <MetaPill tone={summary.verification.tone}>{summary.verification.label}</MetaPill>
              )}
              {summary.totalTools > 0 && (
                <MetaPill>
                  <Wrench size={10} strokeWidth={1.8} className="mr-1" aria-hidden />
                  {countLabel(summary.totalTools, "tool")}
                </MetaPill>
              )}
              {summary.failedTools > 0 && (
                <MetaPill tone="error">{countLabel(summary.failedTools, "failed", "failed")}</MetaPill>
              )}
              {summary.pendingApprovals > 0 && (
                <MetaPill tone="warning">{countLabel(summary.pendingApprovals, "approval")}</MetaPill>
              )}
              {summary.checks.length > 0 && (
                <MetaPill>
                  <ListChecks size={10} strokeWidth={1.8} className="mr-1" aria-hidden />
                  {countLabel(summary.checks.length, "check")}
                </MetaPill>
              )}
              {summary.changedFiles.length > 0 && (
                <MetaPill>
                  <FileDiff size={10} strokeWidth={1.8} className="mr-1" aria-hidden />
                  {countLabel(summary.changedFiles.length, "file")}
                </MetaPill>
              )}
              {summary.rollbackFiles.length > 0 && (
                <MetaPill>
                  <RotateCcw size={10} strokeWidth={1.8} className="mr-1" aria-hidden />
                  Checkpoint
                </MetaPill>
              )}
              {summary.subagentBypassCount > 0 && (
                <MetaPill tone="warning">
                  <ShieldAlert size={10} strokeWidth={1.8} className="mr-1" aria-hidden />
                  Subagent auto-ran {countLabel(summary.subagentBypassCount, "tool")}
                </MetaPill>
              )}
            </div>
            {visibleFiles.length > 0 && (
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
                {visibleFiles.map((file) => (
                  <code
                    key={file}
                    className="max-w-[180px] truncate rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10.5px] text-text-3"
                    title={file}
                  >
                    {file}
                  </code>
                ))}
                {hiddenFileCount > 0 && (
                  <span className="text-[10.5px] text-text-4 tabular-nums">
                    +{hiddenFileCount} more
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </button>
      {summary.suggestedChecks.length > 0 && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 pl-5">
          {summary.suggestedChecks.map((check) => (
            <button
              key={check.command}
              type="button"
              onClick={() => onRunSuggestedCheck?.(check.command)}
              className="inline-flex items-center gap-1 rounded-md border border-accent/20 bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/15"
            >
              <ListChecks size={11} strokeWidth={1.8} aria-hidden />
              {check.label}
            </button>
          ))}
        </div>
      )}
      {expanded && summary.groups.length > 0 && (
        <div className="mt-2 grid gap-2 pl-5">
          <div className="grid gap-1">
            {summary.groups.map((group) => (
              <div key={group.label} className="flex min-w-0 items-center gap-2 text-[11px] text-text-4">
                <span className="w-24 shrink-0 text-text-3">{group.label}</span>
                <span className="font-mono tabular-nums">{group.count}</span>
                <span className="min-w-0 truncate font-mono">{group.toolNames.join(", ")}</span>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-white/[0.06] bg-white/[0.025] p-2">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-text-4">Done contract</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <MetaPill tone={
                summary.doneContract.status === "failed"
                  ? "error"
                  : summary.doneContract.status === "blocked"
                    ? "warning"
                    : "success"
              }>
                {summary.doneContract.status.replace(/_/g, " ")}
              </MetaPill>
              {summary.doneContract.nextSteps.map((step) => (
                <MetaPill key={step} tone="warning">{step}</MetaPill>
              ))}
            </div>
          </div>
          {summary.auditEntries.length > 0 && (
            <div className="rounded-md border border-white/[0.06] bg-white/[0.025] p-2">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-text-4">Audit log</div>
              <div className="mt-1 grid gap-1">
                {summary.auditEntries.map((entry, index) => (
                  <div key={`${entry.label}-${index}`} className="flex min-w-0 items-center gap-2 text-[11px] text-text-3">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      entry.tone === "error"
                        ? "bg-error"
                        : entry.tone === "warning"
                          ? "bg-accent"
                          : entry.tone === "success"
                          ? "bg-success"
                            : "bg-white/30"
                    }`} aria-hidden />
                    <span className="min-w-0 truncate">{entry.label}</span>
                    {entry.detail && <span className="min-w-0 truncate font-mono text-text-4">{entry.detail}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function rollbackSnapshots(message: Message) {
  const snapshots = new Map<string, NonNullable<Message["toolCalls"]>[number]["rollbackSnapshot"]>();
  for (const tc of message.toolCalls ?? []) {
    const snapshot = tc.rollbackSnapshot;
    if (snapshot && !snapshots.has(snapshot.path)) snapshots.set(snapshot.path, snapshot);
  }
  return Array.from(snapshots.values()).filter(Boolean) as NonNullable<NonNullable<Message["toolCalls"]>[number]["rollbackSnapshot"]>[];
}

export async function restoreAgentTurnSnapshots(message: Message, workspace: string): Promise<string[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  const restored: string[] = [];
  for (const snapshot of rollbackSnapshots(message)) {
    if (snapshot.existed) {
      await invoke("write_file", {
        workspace,
        path: snapshot.path,
        content: snapshot.content,
      });
    } else {
      await invoke("delete_file", {
        workspace,
        path: snapshot.path,
      });
    }
    restored.push(snapshot.path);
  }
  return restored;
}

export function AgentTurnRollbackButton({ message }: { message: Message }) {
  const workspace = useChatStore((s) => s.workspacePath);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const summary = summarizeAgentTurn(message);
  const rollbackPreview = buildRollbackPreview(message);
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [previewOpen, setPreviewOpen] = useState(false);

  if (!workspace || summary.rollbackFiles.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={state === "running"}
        onClick={() => setPreviewOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] font-medium text-text-3 transition-colors hover:bg-white/[0.07] disabled:opacity-60"
      >
        <RotateCcw size={12} strokeWidth={1.8} aria-hidden />
        {state === "running"
          ? "Rolling back..."
          : state === "done"
            ? `Rolled back ${countLabel(summary.rollbackFiles.length, "file")}`
            : state === "error"
              ? "Rollback failed"
              : "Preview rollback"}
      </button>
      {previewOpen && state !== "done" && (
        <div className="mt-2 rounded-lg border border-white/[0.08] bg-white/[0.035] p-3">
          <div className="text-[12px] font-medium text-text-2">Rollback preview</div>
          <div className="mt-2 flex flex-col gap-1">
            {rollbackPreview.map((file) => (
              <div key={file.path} className="rounded-md border border-white/[0.06] bg-white/[0.025] p-2">
                <div className="flex min-w-0 items-center gap-2 text-[11.5px] text-text-3">
                  <span className="rounded border border-white/[0.06] bg-white/[0.04] px-1.5 py-0.5 text-[10.5px] text-text-4">
                    {file.action}
                  </span>
                  <code className="min-w-0 truncate font-mono">{file.path}</code>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="min-w-0">
                    <div className="text-[10.5px] font-medium text-text-4">Before rollback</div>
                    <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2 font-mono text-[10.5px] leading-relaxed text-text-3">
                      {file.beforeSnippet}
                    </pre>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10.5px] font-medium text-text-4">After current turn</div>
                    <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2 font-mono text-[10.5px] leading-relaxed text-text-3">
                      {file.afterSnippet}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md px-2.5 py-1.5 text-[11.5px] text-text-3 transition-colors hover:bg-white/[0.05]"
              onClick={() => setPreviewOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={state === "running"}
              className="rounded-md bg-white px-2.5 py-1.5 text-[11.5px] font-medium text-black transition-colors hover:bg-white/90 disabled:opacity-60"
              onClick={async () => {
                setState("running");
                try {
                  const files = await restoreAgentTurnSnapshots(message, workspace);
                  updateMessage(message.conversationId, message.id, {
                    rollbackResult: {
                      status: "done",
                      files,
                      completedAt: Date.now(),
                    },
                  });
                  setState("done");
                  setPreviewOpen(false);
                } catch (err) {
                  const error = err instanceof Error ? err.message : String(err);
                  updateMessage(message.conversationId, message.id, {
                    rollbackResult: {
                      status: "error",
                      files: summary.rollbackFiles.map((file) => file.path),
                      completedAt: Date.now(),
                      error,
                    },
                  });
                  setState("error");
                }
              }}
            >
              Confirm rollback
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
