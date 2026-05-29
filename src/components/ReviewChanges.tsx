import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, FileDiff } from "lucide-react";
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

  if (!files?.length) return null;

  const totalAdded = entries.reduce((n, e) => n + e.added, 0);
  const totalRemoved = entries.reduce((n, e) => n + e.removed, 0);
  const showCounts = gitAvailable && entries.length > 0 && !loading;

  return (
    <div className="mt-3 rounded-xl border border-white/[0.06] bg-[#161618] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-3.5 py-2.5 text-left hover:bg-white/[0.04] transition-colors"
        aria-expanded={expanded}
      >
        <ChevronRight
          size={12}
          strokeWidth={2}
          className={`text-[#888] shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          aria-hidden
        />
        <FileDiff size={14} strokeWidth={1.75} className="text-[#a0a0a0] shrink-0" aria-hidden />
        <span className="text-[12.5px] font-medium text-[#c9c9c9]">Review changes</span>
        {showCounts && (
          <span className="text-[11px] font-mono tabular-nums text-[#a0a0a0] ml-auto">
            <span className="text-[#4ade80]">+{totalAdded}</span>
            {" "}
            <span className="text-[#f87171]">−{totalRemoved}</span>
            {" · "}
            {files.length} {files.length === 1 ? "file" : "files"}
          </span>
        )}
        {!showCounts && (
          <span className="text-[11px] text-[#a0a0a0] ml-auto tabular-nums">
            {files.length} {files.length === 1 ? "file" : "files"}
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-white/[0.06] px-3 py-2 flex flex-col gap-1 max-h-[420px] overflow-y-auto">
          {loading && (
            <span className="text-[11.5px] text-[#a0a0a0] py-2">Loading diffs…</span>
          )}
          {!loading &&
            (entries.length > 0 ? entries : files.map((path) => ({ path, added: 0, removed: 0, diffText: null, parsed: null }))).map(
              (entry) => (
                <div key={entry.path} className="rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenPath((p) => (p === entry.path ? null : entry.path))
                    }
                    className="flex items-center gap-2 w-full px-2.5 py-2 text-left hover:bg-white/[0.04] rounded-lg transition-colors"
                  >
                    <ChevronRight
                      size={11}
                      strokeWidth={2}
                      className={`text-[#888] shrink-0 transition-transform ${openPath === entry.path ? "rotate-90" : ""}`}
                      aria-hidden
                    />
                    <code className="text-[11.5px] text-[#ececec] font-mono truncate flex-1">
                      {entry.path}
                    </code>
                    {entry.parsed && (entry.added > 0 || entry.removed > 0) ? (
                      <span className="text-[10.5px] font-mono tabular-nums shrink-0 text-[#a0a0a0]">
                        <span className="text-[#4ade80]">+{entry.added}</span>{" "}
                        <span className="text-[#f87171]">−{entry.removed}</span>
                      </span>
                    ) : (
                      <span className="text-[10.5px] text-[#888] shrink-0">edited</span>
                    )}
                  </button>
                  {openPath === entry.path && entry.parsed && (
                    <div className="px-2 pb-2">
                      <DiffView diff={entry.parsed} />
                    </div>
                  )}
                </div>
              ),
            )}
        </div>
      )}
    </div>
  );
}
