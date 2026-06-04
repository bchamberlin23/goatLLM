import { ChevronRight, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { Message } from "../stores/chat";
import { buildRollbackPreview, summarizeAgentTurn } from "../lib/agent-turn-summary";
import { useChatStore } from "../stores/chat";

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function AgentTurnTimelineHeader({
  durationLabel,
  expanded,
  onToggle,
}: {
  message: Message;
  durationLabel: string;
  expanded: boolean;
  onToggle: () => void;
  onRunSuggestedCheck?: (command: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="control-pill flex items-center gap-2 py-1 px-1.5 -ml-1.5 rounded text-[13px] font-medium outline-none transition-colors"
      aria-expanded={expanded}
      aria-label={expanded ? "Collapse run timeline" : "Expand run timeline"}
    >
      <ChevronRight
        size={14}
        strokeWidth={2}
        className={`shrink-0 text-[#777] transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
        aria-hidden
      />
      <span>Run timeline</span>
      {durationLabel !== "0s" && (
        <>
          <span className="text-[#555] font-light">•</span>
          <span className="font-mono text-[11px] text-[#777] tabular-nums">{durationLabel}</span>
        </>
      )}
    </button>
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
        className="control-pill inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-medium transition-colors disabled:opacity-60"
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
        <div className="soft-card mt-2 rounded-lg p-3">
          <div className="text-[12px] font-medium text-text-2">Rollback preview</div>
          <div className="mt-2 flex flex-col gap-1">
            {rollbackPreview.map((file) => (
              <div key={file.path} className="rounded-md border border-white/[0.06] bg-white/[0.025] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
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
              className="control-pill rounded-md px-2.5 py-1.5 text-[11.5px] transition-colors"
              onClick={() => setPreviewOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={state === "running"}
              className="primary-action rounded-md px-2.5 py-1.5 text-[11.5px] font-medium transition-colors disabled:opacity-60"
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
