import { Copy, Download, Pencil, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import {
  buildAgentCheckpoints,
  buildLineHunks,
  buildSessionExport,
  buildSessionExportJson,
  nameCheckpoints,
  planTransactionalRestore,
} from "../lib/agent-session";
import { buildRollbackPreview } from "../lib/agent-turn-summary";
import { useChatStore } from "../stores/chat";
import { AgentTurnRollbackButton } from "./AgentTurnTimeline";

function formatCheckpointTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function AgentRecoveryPanel() {
  const activeId = useChatStore((s) => s.activeId);
  const workspacePath = useChatStore((s) => s.workspacePath);
  const conversations = useChatStore((s) => s.conversations);
  const messages = useChatStore((s) => (activeId ? s.messages[activeId] ?? [] : []));
  const checkpointNames = useChatStore((s) => s.checkpointNames);
  const setCheckpointName = useChatStore((s) => s.setCheckpointName);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const checkpoints = useMemo(() => nameCheckpoints(buildAgentCheckpoints(messages), checkpointNames), [messages, checkpointNames]);
  const selected = messages.find((message) => message.id === (selectedId ?? checkpoints[0]?.messageId));
  const preview = selected ? buildRollbackPreview(selected) : [];
  const conversationTitle = conversations.find((conversation) => conversation.id === activeId)?.title ?? "Session";

  if (!workspacePath || checkpoints.length === 0) return null;

  const downloadText = (filename: string, text: string, type: string) => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const auditContent = (format: "markdown" | "json") => format === "json"
    ? buildSessionExportJson({ conversationTitle, workspacePath, messages })
    : buildSessionExport({ conversationTitle, workspacePath, messages });

  const copyAudit = async () => {
    try {
      await navigator.clipboard?.writeText(auditContent("markdown"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(true);
    }
  };

  const downloadAudit = (format: "markdown" | "json" = "markdown") => {
    const content = auditContent(format);
    downloadText(
      `${conversationTitle.replace(/\W+/g, "-").toLowerCase()}-audit.${format === "json" ? "json" : "md"}`,
      content,
      format === "json" ? "application/json" : "text/markdown",
    );
  };

  return (
    <div className="liquid-surface w-full max-w-[720px] rounded-xl px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <RotateCcw size={13} strokeWidth={1.8} className="shrink-0 text-text-4" aria-hidden />
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="text-[11px] font-semibold uppercase tracking-wider text-text-3 transition-colors hover:text-text-2"
            aria-expanded={open}
          >
            Recovery
          </button>
          <span className="text-[10.5px] text-text-4 tabular-nums">{checkpoints.length}</span>
        </div>
        {open && <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={copyAudit}
            className="control-pill inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
          >
            <Copy size={11} strokeWidth={1.8} aria-hidden />
            {copied ? "Copied" : "Copy audit"}
          </button>
          <button
            type="button"
            onClick={() => downloadAudit("markdown")}
            className="control-pill inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
          >
            <Download size={11} strokeWidth={1.8} aria-hidden />
            Download audit
          </button>
        </div>}
      </div>
      {open && <div className="mt-2 text-[10.5px] font-semibold uppercase tracking-wider text-text-4">Checkpoints</div>}
      {open && <div className="mt-2 grid gap-1">
        {checkpoints.map((checkpoint) => (
          <button
            key={checkpoint.messageId}
            type="button"
            onClick={() => setSelectedId(checkpoint.messageId)}
            className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] transition-colors ${
              (selected?.id ?? checkpoints[0]?.messageId) === checkpoint.messageId
                ? "bg-accent/10 text-text-2 shadow-[inset_0_0_0_1px_rgba(245,158,66,0.16)]"
                : "text-text-3 hover:bg-white/5"
            }`}
          >
            <span className="shrink-0 font-mono text-[10.5px] text-text-4">{formatCheckpointTime(checkpoint.createdAt)}</span>
            <span className="min-w-0 truncate font-mono">{checkpoint.name || checkpoint.changedFiles.join(", ")}</span>
            <span className="ml-auto shrink-0 rounded border border-hairline px-1.5 py-0.5 text-[10px] text-text-4">
              {checkpoint.status}
            </span>
          </button>
        ))}
      </div>}
      {open && selected && preview.length > 0 && (
        <div className="soft-card mt-2 rounded-md p-2">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-text-4">Compare to current</div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="min-w-0 truncate text-[10.5px] text-text-4">
              {checkpointNames[selected.id] || "Unnamed checkpoint"}
            </div>
            <button
              type="button"
              onClick={() => setRenaming((value) => !value)}
              className="control-pill inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
            >
              <Pencil size={11} strokeWidth={1.8} aria-hidden />
              Rename checkpoint
            </button>
          </div>
          {renaming && (
            <input
              value={checkpointNames[selected.id] ?? ""}
              onChange={(event) => setCheckpointName(selected.id, event.currentTarget.value)}
              placeholder="Name checkpoint"
              className="mt-2 w-full rounded-md border border-hairline-strong bg-black/20 px-2 py-1 text-[11px] text-text-2 outline-none placeholder:text-text-4 focus:border-accent/45 focus:ring-1 focus:ring-accent/20"
            />
          )}
          <div className="mt-2 text-[10.5px] text-text-4">
            {planTransactionalRestore(preview.map((row) => row.path)).join(" → ")}
          </div>
          <div className="mt-1 grid gap-1">
            {preview.map((row) => (
              <div key={row.path} className="grid gap-1 text-[11px] text-text-3">
                <code className="min-w-0 truncate font-mono">{row.path}</code>
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-1.5 font-mono text-[10px] leading-relaxed text-text-4">
                  {buildLineHunks(row.beforeSnippet, row.afterSnippet).map((hunk, index) => `${hunk.type === "added" ? "+ " : hunk.type === "removed" ? "- " : "  "}${hunk.line}${index === buildLineHunks(row.beforeSnippet, row.afterSnippet).length - 1 ? "" : "\n"}`)}
                </pre>
              </div>
            ))}
          </div>
          <AgentTurnRollbackButton message={selected} />
        </div>
      )}
    </div>
  );
}
