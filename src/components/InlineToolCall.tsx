import { useState, useEffect, useCallback, type ReactNode, type ReactElement } from "react";
import type { ToolCallEntry } from "../stores/chat";
import { useChatStore } from "../stores/chat";
import { approveExecution, denyExecution } from "../lib/tools";
import { computeDiff, type DiffResult } from "../lib/diff-utils";
import { DiffView } from "./DiffView";
import { Shimmer } from "./ThinkingIndicator";
import { ChevronDown, AlertTriangle, ArrowUpRight } from "lucide-react";
import { ansiToHtml, hasAnsi } from "../lib/ansi";

// ── Helpers (extracted from MessageBubble.tsx) ─────────────────────

export function getInputField(input: unknown, field: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const val = (input as Record<string, unknown>)[field];
  return typeof val === "string" ? val : undefined;
}

export function formatInput(input: unknown): string {
  if (!input || typeof input !== "object") return String(input ?? "");
  const obj = input as Record<string, unknown>;
  if (obj.path && obj.content) return String(obj.path);
  if (obj.path) return String(obj.path);
  if (obj.command) return String(obj.command);
  if (obj.pattern) return String(obj.pattern);
  return JSON.stringify(input, null, 2);
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// ── Tool presentation ──────────────────────────────────────────────

interface ToolPresentation {
  runningVerb: string;
  doneVerb: string;
  target?: string;
  detail?: string;
  icon: ReactElement;
}

export function presentTool(tc: ToolCallEntry): ToolPresentation {
  const name = tc.toolName;
  const path = getInputField(tc.input, "path");
  const command = getInputField(tc.input, "command");
  const pattern = getInputField(tc.input, "pattern");
  const query = getInputField(tc.input, "query");
  const url = getInputField(tc.input, "url");

  const baseIcon = (children: ReactNode) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );

  if (name === "read_file" || name === "view_file") {
    return { runningVerb: "Reading", doneVerb: "Read", target: path, icon: baseIcon(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>) };
  }
  if (name === "list_dir") {
    return { runningVerb: "Listing", doneVerb: "Listed", target: path || ".", icon: baseIcon(<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />) };
  }
  if (name === "search_content" || name === "grep_search") {
    return { runningVerb: "Searching", doneVerb: "Searched", target: pattern || query, icon: baseIcon(<><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>) };
  }
  if (name === "file_search") {
    return { runningVerb: "Searching files", doneVerb: "Found", target: query, icon: baseIcon(<><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>) };
  }
  if (name === "write_file") {
    return { runningVerb: "Writing", doneVerb: "Wrote", target: path, icon: baseIcon(<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>) };
  }
  if (name === "edit_file" || name === "str_replace") {
    return { runningVerb: "Editing", doneVerb: "Edited", target: path, icon: baseIcon(<><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></>) };
  }
  if (name === "bash" || name === "exec_command") {
    const cmd = command ? truncate(command, 90) : "command";
    return { runningVerb: "Running", doneVerb: "Ran", target: cmd, icon: baseIcon(<><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></>) };
  }
  if (name === "diff_file") {
    return { runningVerb: "Diffing", doneVerb: "Diffed", target: path, icon: baseIcon(<><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></>) };
  }
  if (name === "read_lints") {
    return { runningVerb: "Linting", doneVerb: "Linted", target: path, icon: baseIcon(<polyline points="20 6 9 17 4 12" />) };
  }
  if (name.startsWith("git_")) {
    const sub = name.replace("git_", "");
    return { runningVerb: `Running git ${sub}`, doneVerb: `Ran git ${sub}`, icon: baseIcon(<><circle cx="12" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><path d="M12 8v3a3 3 0 0 1-3 3H8" /><path d="M12 8v3a3 3 0 0 0 3 3h1" /><path d="M6 16v-2" /></>) };
  }
  if (name === "web_search" || name === "remote_web_search") {
    return { runningVerb: "Searching the web", doneVerb: "Searched the web", target: query, icon: baseIcon(<><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>) };
  }
  if (name === "web_fetch") {
    return { runningVerb: "Fetching", doneVerb: "Fetched", target: url, icon: baseIcon(<><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /></>) };
  }
  if (name === "spawn_subagent") {
    const task = getInputField(tc.input, "task") || "task";
    return {
      runningVerb: "Running subagent",
      doneVerb: "Ran subagent",
      target: truncate(task, 80),
      icon: baseIcon(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
    };
  }
  if (name === "todo_create") {
    const title = getInputField(tc.input, "title") || "task";
    return { runningVerb: "Creating", doneVerb: "Created", target: `task: ${title}`, icon: baseIcon(<><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>) };
  }
  if (name === "todo_update") {
    const id = getInputField(tc.input, "id") || "task";
    return { runningVerb: "Updating", doneVerb: "Updated", target: `task #${String(id).slice(-8)}`, icon: baseIcon(<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>) };
  }
  if (name === "todo_list") {
    return { runningVerb: "Listing", doneVerb: "Listed", target: "tasks", icon: baseIcon(<><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>) };
  }
  if (name === "todo_get") {
    const id = getInputField(tc.input, "id") || "task";
    return { runningVerb: "Getting", doneVerb: "Got", target: `task #${String(id).slice(-8)}`, icon: baseIcon(<><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>) };
  }
  if (name === "todo_delete") {
    const id = getInputField(tc.input, "id") || "task";
    return { runningVerb: "Deleting", doneVerb: "Deleted", target: `task #${String(id).slice(-8)}`, icon: baseIcon(<><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>) };
  }
  if (name === "todo_clear") {
    return { runningVerb: "Clearing", doneVerb: "Cleared", target: "all tasks", icon: baseIcon(<><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>) };
  }
  if (name === "load_skill") {
    const skillName = getInputField(tc.input, "name") || "skill";
    return {
      runningVerb: "Loading skill",
      doneVerb: "Loaded skill",
      target: skillName,
      icon: baseIcon(<><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></>),
    };
  }
  return { runningVerb: "Running", doneVerb: "Ran", target: name, detail: formatInput(tc.input).slice(0, 200), icon: baseIcon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>) };
}

// ── Approval Gate ──────────────────────────────────────────────────

function ApprovalGate({ tc }: { tc: ToolCallEntry }) {
  const [diffPreview, setDiffPreview] = useState<DiffResult | null>(null);
  const [confirmStep, setConfirmStep] = useState(0);
  const isDestructive = tc.dangerLevel === "destructive";
  const isSuspicious = tc.dangerLevel === "suspicious";
  const needsDoubleConfirm = isDestructive && confirmStep === 0;
  const isWrite = tc.toolName === "write_file" || tc.toolName === "edit_file";
  const isExec = tc.toolName === "bash" || tc.toolName === "exec_command";

  useEffect(() => {
    if (tc.toolName !== "write_file") return;
    const path = getInputField(tc.input, "path");
    const newContent = getInputField(tc.input, "content");
    if (!path || newContent === undefined) return;
    const workspace = useChatStore.getState().workspacePath;
    if (!workspace) return;
    let cancelled = false;
    (async () => {
      try {
        const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
        const currentContent = await tauriInvoke<string>("read_file", {
          workspace,
          path,
          offset: null,
          limit: null,
        });
        if (cancelled) return;
        setDiffPreview(computeDiff(currentContent, newContent));
      } catch {
        if (!cancelled) setDiffPreview(computeDiff("", newContent));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tc.toolName, tc.input]);

  return (
    <div className="border border-amber-500/35 bg-amber-500/5 rounded-xl p-3.5 flex flex-col gap-3 my-1">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[#f59e0b]">
          Needs approval
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {tc.toolName === "write_file" && diffPreview ? (
          <DiffView diff={diffPreview} />
        ) : isWrite ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a0a0a0]">
              File
            </span>
            <code className="block bg-[#2c2c2e] border border-white/5 rounded-lg p-2.5 font-mono text-[11.5px] text-[#ececec] whitespace-pre-wrap break-all max-h-[180px] overflow-auto select-text">
              {formatInput(tc.input)}
            </code>
          </div>
        ) : isExec ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a0a0a0]">
              Command
            </span>
            <code className="block bg-[#2c2c2e] border border-white/5 rounded-lg p-2.5 font-mono text-[11.5px] text-[#ececec] whitespace-pre-wrap break-all select-text">
              {getInputField(tc.input, "command") || "(unknown)"}
            </code>
            {isDestructive && (
              <div className="flex items-center gap-1.5 mt-1 px-2.5 py-1.5 bg-red-500/10 border border-red-500/20 rounded-md text-[11.5px] font-semibold text-[#fca5a5]">
                <AlertTriangle size={12} className="text-[#f87171]" />
                DESTRUCTIVE — {tc.dangerReason}
              </div>
            )}
            {isSuspicious && (
              <div className="flex items-center gap-1.5 mt-1 px-2.5 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-md text-[11.5px] font-semibold text-[#fde68a]">
                <AlertTriangle size={12} className="text-[#f59e0b]" />
                Suspicious — {tc.dangerReason}
              </div>
            )}
            {needsDoubleConfirm && (
              <div className="mt-1 text-[11.5px] text-[#a0a0a0] italic">
                This will permanently affect your system. Click again to
                confirm.
              </div>
            )}
          </div>
        ) : (
          <code className="block bg-[#2c2c2e] border border-white/5 rounded-lg p-2.5 font-mono text-[11.5px] text-[#ececec] whitespace-pre-wrap break-all select-text">
            {formatInput(tc.input)}
          </code>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button
          className="px-3.5 py-1.5 rounded-md text-[12.5px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
          onClick={() => denyExecution(tc.toolCallId)}
        >
          Deny
        </button>
        <button
          className={`px-3.5 py-1.5 rounded-md text-[12.5px] font-medium transition-colors ${
            isDestructive && !needsDoubleConfirm
              ? "bg-red-500/20 text-[#fca5a5] hover:bg-red-500/30 hover:text-[#fecaca]"
              : "bg-[#ececec] text-black hover:bg-white"
          }`}
          onClick={() => {
            if (needsDoubleConfirm) setConfirmStep(1);
            else approveExecution(tc.toolCallId);
          }}
        >
          {isDestructive && !needsDoubleConfirm
            ? "Execute anyway"
            : needsDoubleConfirm
              ? "Approve"
              : "Approve"}
        </button>
      </div>
    </div>
  );
}

// ── Terminal Output (ANSI-aware) ───────────────────────────────────

function TerminalOutput({ text, toolName }: { text: string; toolName: string }) {
  const isCommand = toolName === "bash" || toolName === "exec_command";
  const useAnsi = isCommand && hasAnsi(text);

  if (useAnsi) {
    const html = ansiToHtml(text);
    return (
      <pre
        className="mt-[5px] ml-4 p-2.5 bg-[#1a1a1c] border border-white/5 rounded-lg font-mono text-[11.5px] leading-relaxed text-[#b4b4b4] max-h-[280px] overflow-auto whitespace-pre-wrap break-all select-text"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <pre className="mt-2 ml-5 p-2.5 bg-[#2c2c2e] border border-white/5 rounded-lg font-mono text-[11.5px] leading-relaxed text-[#b4b4b4] max-h-[280px] overflow-auto whitespace-pre-wrap break-all select-text">
      {text}
    </pre>
  );
}

// ── Inline Tool Call ───────────────────────────────────────────────

export function InlineToolCall({
  tc,
  children,
}: {
  tc: ToolCallEntry;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = tc.state === "running";
  const isError = tc.state === "error";
  const isPending = tc.state === "pending_approval";
  const isDone = tc.state === "done";
  const hasOutput = tc.output !== undefined || tc.subagentTranscript !== undefined;
  const pres = presentTool(tc);
  const verb = isRunning || isPending ? pres.runningVerb : pres.doneVerb;
  const canExpand = (isDone || isError) && hasOutput;
  const isSubagent = tc.toolName === "spawn_subagent" && tc.subagentTranscript;

  const handleOpenPanel = useCallback(() => {
    if (isSubagent) {
      useChatStore.getState().openSubagentPanel(tc.toolCallId);
    }
  }, [isSubagent, tc.toolCallId]);

  if (isPending) return <ApprovalGate tc={tc} />;

  const label = pres.target ? `${verb} ${pres.target}` : verb;

  return (
    <div className="py-1 group/tool">
      <div className="flex items-baseline gap-1.5">
        <button
          type="button"
          disabled={!canExpand}
          onClick={() => canExpand && setExpanded((v) => !v)}
          className={`flex items-center gap-1.5 text-[13px] leading-relaxed text-left max-w-full min-w-0 ${
            canExpand ? "cursor-pointer" : "cursor-default"
          }`}
          aria-expanded={canExpand ? expanded : undefined}
        >
          <span className="shrink-0 self-center text-[#777] group-hover/tool:text-[#a0a0a0] transition-colors">
            {pres.icon}
          </span>
          {isRunning ? (
            <Shimmer text={label} className="text-[13px] font-normal" />
          ) : (
            <span
              className={`truncate ${isError ? "text-[#888]" : "text-[#a0a0a0]"} ${
                canExpand
                  ? "group-hover/tool:text-[#d5d5d5] transition-colors"
                  : ""
              }`}
            >
              {label}
              {isError && <span className="text-[#888]"> — failed</span>}
            </span>
          )}
          {pres.detail && !isRunning && (
            <span className="text-[12px] text-[#777] font-mono break-all line-clamp-1 shrink-0">
              {pres.detail}
            </span>
          )}
          {canExpand && (
            <ChevronDown
              size={11}
              strokeWidth={1.6}
              className={`shrink-0 self-center text-[#666] group-hover/tool:text-[#a0a0a0] transition-all duration-200 ${
                expanded ? "rotate-180" : ""
              }`}
              aria-hidden="true"
            />
          )}
        </button>
        {isSubagent && (isDone || isRunning) && (
          <>
            {tc.approvalBypassed && (
              <span
                className="shrink-0 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-[#f59e0b]"
                title="This subagent ran write-capable tools without individual approval cards."
              >
                Auto-ran tools
              </span>
            )}
          </>
        )}
        {isSubagent && (isDone || isRunning) && (
          <button
            type="button"
            onClick={handleOpenPanel}
            className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-[#f59e42] hover:bg-[#f59e42]/10 transition-colors"
            title="Open subagent workspace"
          >
            <ArrowUpRight size={11} strokeWidth={2} />
          </button>
        )}
      </div>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          expanded && hasOutput
            ? "grid-rows-[1fr] opacity-100 mt-1"
            : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden min-h-0">
          {children
            ? children
            : hasOutput
              ? tc.subagentTranscript
                ? null
                : tc.toolName === "spawn_subagent"
                  ? null
                  : <TerminalOutput text={String(tc.output)} toolName={tc.toolName} />
              : null}
        </div>
      </div>
    </div>
  );
}
