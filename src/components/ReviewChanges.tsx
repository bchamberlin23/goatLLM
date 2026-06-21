import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, FileDiff, FilePlus, FileEdit, File as FileIcon } from "lucide-react";
import type { Message } from "../stores/chat";
import { useChatStore } from "../stores/chat";
import { parseUnifiedDiff, type DiffResult } from "../lib/diff-utils";
import { DiffView } from "./DiffView";

interface FileDiffEntry {
  path: string;
  added: number;
  removed: number;
  diffText: string | null;
  parsed: DiffResult | null;
}

function isNoChanges(text: string): boolean {
  const t = text.trim();
  return t === "(no changes)" || t.length === 0;
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx + 1) : "";
}

function fileStatusKind(entry: FileDiffEntry): "added" | "modified" | "edited" {
  if (!entry.parsed) return "edited";
  if (entry.removed === 0 && entry.added > 0) return "added";
  return "modified";
}

export function ReviewChanges({ message }: { message: Message }) {
  const files = message.editedFiles;
  const workspacePath = useChatStore((s) => s.workspacePath);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<FileDiffEntry[]>([]);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [gitAvailable, setGitAvailable] = useState(true);

  const loadDiffs = useCallback(async () => {
    if (!files?.length || !workspacePath) return;
    setLoading(true);
    const next: FileDiffEntry[] = [];
    let anyGit = false;
    for (const path of files) {
      try {
        const diffText = await invoke<string>("diff_file", { workspace: workspacePath, path });
        if (!isNoChanges(diffText)) {
          anyGit = true;
          const parsed = parseUnifiedDiff(diffText);
          next.push({
            path,
            added: parsed.added,
            removed: parsed.removed,
            diffText,
            parsed,
          });
        } else {
          next.push({ path, added: 0, removed: 0, diffText: null, parsed: null });
        }
      } catch {
        next.push({ path, added: 0, removed: 0, diffText: null, parsed: null });
      }
    }
    setGitAvailable(anyGit);
    setEntries(next);
    setLoading(false);
  }, [files, workspacePath]);

  useEffect(() => {
    if (!expanded || !files?.length) return;
    void loadDiffs();
  }, [expanded, files, loadDiffs]);

  const totalAdded = useMemo(() => entries.reduce((n, e) => n + e.added, 0), [entries]);
  const totalRemoved = useMemo(() => entries.reduce((n, e) => n + e.removed, 0), [entries]);
  const showCounts = gitAvailable && entries.length > 0 && !loading;

  if (!files?.length) return null;

  const renderSummaryChip = () => {
    if (loading) {
      return (
        <span className="text-[10.5px] font-mono tabular-nums text-text-4 ml-auto shrink-0">
          loading…
        </span>
      );
    }
    if (showCounts) {
      return (
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          <span className="inline-flex items-center gap-1 rounded-md border border-hairline bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums">
            <span className="text-success">+{totalAdded}</span>
            <span className="text-text-4">·</span>
            <span className="text-error">−{totalRemoved}</span>
          </span>
          <span className="text-[10.5px] text-text-3 tabular-nums">
            {files.length} {files.length === 1 ? "file" : "files"}
          </span>
        </span>
      );
    }
    return (
      <span className="text-[10.5px] text-text-3 tabular-nums ml-auto shrink-0">
        {files.length} {files.length === 1 ? "file" : "files"}
      </span>
    );
  };

  const renderFileRow = (entry: FileDiffEntry & { path: string }) => {
    const status = fileStatusKind(entry);
    const isOpen = openPath === entry.path;
    const hasChanges = entry.parsed && (entry.added > 0 || entry.removed > 0);

    const StatusIcon = status === "added" ? FilePlus : status === "modified" ? FileEdit : FileIcon;
    const statusColor =
      status === "added"
        ? "text-success"
        : status === "modified"
          ? "text-accent"
          : "text-text-4";

    return (
      <div
        key={entry.path}
        className={`rounded-lg overflow-hidden transition-colors ${
          isOpen ? "bg-white/[0.025]" : "hover:bg-white/[0.025]"
        }`}
      >
        <button
          type="button"
          onClick={() => setOpenPath((p) => (p === entry.path ? null : entry.path))}
          className="flex items-center gap-2 w-full px-2.5 py-2 text-left rounded-lg"
          aria-expanded={isOpen}
        >
          <ChevronRight
            size={11}
            strokeWidth={2}
            className={`text-text-4 shrink-0 transition-transform duration-200 ${
              isOpen ? "rotate-90" : ""
            }`}
            aria-hidden
          />
          <StatusIcon
            size={13}
            strokeWidth={1.75}
            className={`shrink-0 ${statusColor}`}
            aria-hidden
          />
          <div className="min-w-0 flex-1 flex items-baseline gap-1.5">
            <code className="text-[11.5px] text-text-1 font-mono font-medium truncate">
              {basename(entry.path)}
            </code>
            <code className="text-[10.5px] text-text-4 font-mono truncate min-w-0">
              {dirname(entry.path)}
            </code>
          </div>
          {hasChanges ? (
            <span className="text-[10.5px] font-mono tabular-nums shrink-0">
              <span className="text-success">+{entry.added}</span>{" "}
              <span className="text-error">−{entry.removed}</span>
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-wider text-text-4 shrink-0">
              edited
            </span>
          )}
        </button>
        {isOpen && entry.parsed && (
          <div className="px-2 pb-2 pt-0.5">
            <DiffView diff={entry.parsed} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mt-3 soft-card rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2.5 text-left hover:bg-white/[0.03] transition-colors"
        aria-expanded={expanded}
      >
        <ChevronRight
          size={12}
          strokeWidth={2}
          className={`text-text-4 shrink-0 transition-transform duration-200 ${
            expanded ? "rotate-90" : ""
          }`}
          aria-hidden
        />
        <FileDiff size={14} strokeWidth={1.75} className="text-accent shrink-0" aria-hidden />
        <span className="text-[12.5px] font-medium text-text-1">Review changes</span>
        {renderSummaryChip()}
      </button>

      {expanded && (
        <div className="border-t border-hairline">
          {loading && (
            <div className="px-3 py-3 flex items-center gap-2 text-[11.5px] text-text-3">
              <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
              </span>
              Loading diffs…
            </div>
          )}
          {!loading && showCounts && (
            <div className="px-3 py-1.5 flex items-center gap-3 text-[10.5px] font-mono tabular-nums text-text-4 bg-white/[0.015] border-b border-hairline">
              <span>{entries.length} files</span>
              <span className="text-success">+{totalAdded} added</span>
              <span className="text-error">−{totalRemoved} removed</span>
            </div>
          )}
          {!loading && (
            <div className="px-2 py-2 flex flex-col gap-0.5 max-h-[420px] overflow-y-auto">
              {(entries.length > 0
                ? entries
                : files.map((path) => ({ path, added: 0, removed: 0, diffText: null, parsed: null }))
              ).map(renderFileRow)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
