import { memo, useState, useCallback, useRef, useEffect, useMemo, type ReactElement, type ReactNode } from "react";
import { Message, useChatStore, normalizeTitle, type ArtifactKind, type ToolCallEntry } from "../stores/chat";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { AttachmentChips, stripAttachmentMarkers } from "./AttachmentChips";
import { ArtifactCard, ArtifactPlaceholderCard } from "./ArtifactPanel";
import { splitContentByArtifacts, type ContentSegment } from "../lib/artifact-segments";
import { approveExecution, denyExecution } from "../lib/tools";
import { computeDiff, type DiffResult } from "../lib/diff-utils";
import { Shimmer, WorkingHeader } from "./ThinkingIndicator";
import { ChevronDown, AlertTriangle, Copy, Check, Pin, PinOff, Hammer, ListChecks, Sparkles } from "lucide-react";
import { ansiToHtml, hasAnsi } from "../lib/ansi";
import { formatMessageTime, formatLongDateTime } from "../lib/datetime";
import { splitByQuestionForm } from "../lib/design/parser";
import { QuestionFormRenderer } from "./design/QuestionFormRenderer";

function stripMarkdown(md: string): string {
  return md
    // fenced code blocks: keep contents, drop the fences
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/```/g, "")
    // inline code
    .replace(/`([^`]+)`/g, "$1")
    // images / links → keep label
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // bold + italic markers
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1$2")
    // headers, blockquotes, list markers
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    // horizontal rules
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .trim();
}

interface MessageBubbleProps { message: Message; }

function getInputField(input: unknown, field: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const val = (input as Record<string, unknown>)[field];
  return typeof val === "string" ? val : undefined;
}

function formatInput(input: unknown): string {
  if (!input || typeof input !== "object") return String(input ?? "");
  const obj = input as Record<string, unknown>;
  if (obj.path && obj.content) return String(obj.path);
  if (obj.path) return String(obj.path);
  if (obj.command) return String(obj.command);
  if (obj.pattern) return String(obj.pattern);
  return JSON.stringify(input, null, 2);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

interface ToolPresentation {
  runningVerb: string;
  doneVerb: string;
  target?: string;
  detail?: string;
  icon: ReactElement;
}

function presentTool(tc: ToolCallEntry): ToolPresentation {
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
  return { runningVerb: "Running", doneVerb: "Ran", target: name, detail: formatInput(tc.input).slice(0, 200), icon: baseIcon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>) };
}

/* ─── Diff Preview ─── */
function DiffPreview({ diff }: { diff: DiffResult }) {
  const [expanded, setExpanded] = useState(false);
  const maxPreview = 20;
  const displayLines = expanded ? diff.lines : diff.lines.slice(0, maxPreview);

  return (
    <div className="border border-white/5 rounded-md overflow-hidden bg-black/20">
      <div className="px-2.5 py-1.5 bg-white/5 border-b border-white/5">
        <span className="text-[10px] text-[#a0a0a0] font-mono font-medium">
          <span className="text-[#34d399] font-semibold">+{diff.added}</span> / <span className="text-[#f87171] font-semibold">-{diff.removed}</span> lines
        </span>
      </div>
      <pre className="m-0 p-2.5 font-mono text-[11px] leading-relaxed max-h-[280px] overflow-auto whitespace-pre text-[#b4b4b4]">
        {displayLines.map((line, i) => (
          <span key={i} className={`block ${
            line.type === "added" ? "bg-green-500/10 text-[#bbf7d0]" :
            line.type === "removed" ? "bg-red-500/10 text-[#fecaca]" :
            "text-[#a0a0a0]"
          }`}>
            {line.content}{"\n"}
          </span>
        ))}
      </pre>
      {diff.lines.length > maxPreview && !expanded && (
        <button className="w-full px-2.5 py-1.5 bg-white/5 border-t border-white/5 text-[11px] text-[#a0a0a0] hover:bg-white/10 hover:text-[#ececec] transition-colors" onClick={() => setExpanded(true)}>
          Show all {diff.lines.length} lines…
        </button>
      )}
    </div>
  );
}

/* ─── Approval Gate ─── */
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
        const currentContent = await tauriInvoke<string>("read_file", { workspace, path, offset: null, limit: null });
        if (cancelled) return;
        setDiffPreview(computeDiff(currentContent, newContent));
      } catch { if (!cancelled) setDiffPreview(computeDiff("", newContent)); }
    })();
    return () => { cancelled = true; };
  }, [tc.toolName, tc.input]);

  return (
    <div className="border border-amber-500/35 bg-amber-500/5 rounded-xl p-3.5 flex flex-col gap-3 my-1">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[#f59e0b]">Needs approval</span>
      </div>
      <div className="flex flex-col gap-2">
        {tc.toolName === "write_file" && diffPreview ? (
          <DiffPreview diff={diffPreview} />
        ) : isWrite ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a0a0a0]">File</span>
            <code className="block bg-[#2c2c2e] border border-white/5 rounded-lg p-2.5 font-mono text-[11.5px] text-[#ececec] whitespace-pre-wrap break-all max-h-[180px] overflow-auto select-text">{formatInput(tc.input)}</code>
          </div>
        ) : isExec ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a0a0a0]">Command</span>
            <code className="block bg-[#2c2c2e] border border-white/5 rounded-lg p-2.5 font-mono text-[11.5px] text-[#ececec] whitespace-pre-wrap break-all select-text">{getInputField(tc.input, "command") || "(unknown)"}</code>
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
                This will permanently affect your system. Click again to confirm.
              </div>
            )}
          </div>
        ) : (
          <code className="block bg-[#2c2c2e] border border-white/5 rounded-lg p-2.5 font-mono text-[11.5px] text-[#ececec] whitespace-pre-wrap break-all select-text">{formatInput(tc.input)}</code>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button className="px-3.5 py-1.5 rounded-md text-[12.5px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors" onClick={() => denyExecution(tc.toolCallId)}>Deny</button>
        <button
          className={`px-3.5 py-1.5 rounded-md text-[12.5px] font-medium transition-colors ${
            isDestructive && !needsDoubleConfirm
              ? "bg-red-500/20 text-[#fca5a5] hover:bg-red-500/30 hover:text-[#fecaca]"
              : "bg-[#ececec] text-black hover:bg-white"
          }`}
          onClick={() => { if (needsDoubleConfirm) setConfirmStep(1); else approveExecution(tc.toolCallId); }}
        >
          {isDestructive && !needsDoubleConfirm ? "Execute anyway" : needsDoubleConfirm ? "Approve" : "Approve"}
        </button>
      </div>
    </div>
  );
}

/* ─── Inline Tool Call ─── */
function InlineToolCall({ tc }: { tc: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = tc.state === "running";
  const isError = tc.state === "error";
  const isPending = tc.state === "pending_approval";
  const isDone = tc.state === "done";
  const hasOutput = tc.output !== undefined;
  const pres = presentTool(tc);
  const verb = isRunning || isPending ? pres.runningVerb : pres.doneVerb;
  const canExpand = (isDone || isError) && hasOutput;

  if (isPending) return <ApprovalGate tc={tc} />;

  // Compose the label as a single string so the shimmer sweeps across the
  // whole phrase, not just the verb. "Reading src/foo.ts" / "Read src/foo.ts".
  const label = pres.target ? `${verb} ${pres.target}` : verb;

  return (
    <div className="py-1 group/tool">
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => canExpand && setExpanded((v) => !v)}
        className={`flex items-baseline gap-1.5 text-[13px] leading-relaxed text-left w-full max-w-full min-w-0 ${
          canExpand ? "cursor-pointer" : "cursor-default"
        }`}
        aria-expanded={canExpand ? expanded : undefined}
      >
        {isRunning ? (
          <Shimmer text={label} className="text-[13px] font-normal" />
        ) : (
          <span className={`truncate ${isError ? "text-[#888]" : "text-[#a0a0a0]"} ${canExpand ? "group-hover/tool:text-[#d5d5d5] transition-colors" : ""}`}>
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
            className={`shrink-0 self-center text-[#666] group-hover/tool:text-[#a0a0a0] transition-all duration-200 ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        )}
      </button>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          expanded && hasOutput ? "grid-rows-[1fr] opacity-100 mt-1" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden min-h-0">
          {hasOutput && <TerminalOutput text={String(tc.output)} toolName={tc.toolName} />}
        </div>
      </div>
    </div>
  );
}

/* ─── Terminal Output (ANSI-aware) ─── */
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
    <pre className="mt-2 ml-5 p-2.5 bg-[#2c2c2e] border border-white/5 rounded-lg font-mono text-[11.5px] leading-relaxed text-[#b4b4b4] max-h-[280px] overflow-auto whitespace-pre-wrap break-all select-text">{text}</pre>
  );
}
export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isStreaming = !!message.isStreaming;
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleCopy = useCallback(async () => {
    const text = isAssistant ? stripMarkdown(message.content) : message.content;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable — silent */
    }
  }, [isAssistant, message.content]);

  const handleStartEdit = useCallback(() => {
    // Strip the inlined attachment marker blocks from the edit textarea so
    // the user only sees their actual prose. The chips above already show
    // what's attached; the markers get re-baked at send time.
    setEditValue(stripAttachmentMarkers(message.content));
    setEditing(true);
  }, [message.content]);
  const handleSaveEdit = useCallback(() => {
    const store = useChatStore.getState();
    // Preserve the original attachments through the resend cycle so editing
    // a question that referenced a PDF doesn't strip the PDF from context.
    // The send pipeline re-runs extractAndAppend, which is idempotent thanks
    // to the attachment cache (no re-OCR / re-extract on the same dataUrl).
    const attachments = message.attachments;
    store.editMessage(message.conversationId, message.id, editValue);
    store.removeMessagesAfter(message.conversationId, message.id);
    store.triggerResend(message.conversationId, editValue, attachments);
    setEditing(false);
  }, [message.conversationId, message.id, message.attachments, editValue]);
  const handleCancelEdit = useCallback(() => setEditing(false), []);
  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
    if (e.key === "Escape") handleCancelEdit();
  }, [handleSaveEdit, handleCancelEdit]);

  useEffect(() => {
    if (editing) {
      const ta = textareaRef.current;
      if (ta) { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; ta.focus(); }
    }
  }, [editing]);

  const handleRegenerate = useCallback(() => {
    const store = useChatStore.getState();
    const convMessages = store.messages[message.conversationId] ?? [];
    const idx = convMessages.findIndex((m) => m.id === message.id);
    if (idx <= 0) return;
    const prevMessage = convMessages[idx - 1];
    if (prevMessage.role !== "user") return;
    store.removeMessagesAfter(message.conversationId, prevMessage.id);
    store.triggerResend(message.conversationId, prevMessage.content, prevMessage.attachments);
  }, [message.conversationId, message.id]);

  const handleTogglePin = useCallback(() => {
    const store = useChatStore.getState();
    store.updateMessage(message.conversationId, message.id, { pinned: !message.pinned });
  }, [message.conversationId, message.id, message.pinned]);

  const isInterrupted = isAssistant && !!(message as Message & { interrupted?: boolean }).interrupted;
  const handleContinueAfterInterrupt = useCallback(() => {
    const store = useChatStore.getState();
    const convMessages = store.messages[message.conversationId] ?? [];
    const idx = convMessages.findIndex((m) => m.id === message.id);
    if (idx <= 0) return;
    const prevMessage = convMessages[idx - 1];
    if (prevMessage.role !== "user") return;
    // Mark this assistant message as no longer interrupted (it's about to be
    // replaced) and resend the user message that triggered it.
    store.updateMessage(message.conversationId, message.id, { interrupted: false } as Record<string, unknown>);
    store.removeMessagesAfter(message.conversationId, prevMessage.id);
    store.triggerResend(message.conversationId, prevMessage.content, prevMessage.attachments);
  }, [message.conversationId, message.id]);

  const hasToolCalls = !!(message.toolCalls && message.toolCalls.length > 0);
  const anyToolRunning = !!message.toolCalls?.some((t) => t.state === "running" || t.state === "pending_approval");
  const isWorking = isAssistant && isStreaming && (anyToolRunning || message.content.trim().length === 0);
  const startedAt = isAssistant ? message.createdAt : null;
  const agentMode = useChatStore((s) => s.agentMode);
  const showWorkingHeader = isAssistant && isStreaming && (hasToolCalls || agentMode);
  const headerRunning = isAssistant && isStreaming;

  return (
    <div className={`group px-6 py-1.5 w-full ${isUser ? "flex justify-end" : ""}`}>
      <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-stretch"} w-full max-w-[720px] mx-auto`}>
        <div className={`flex items-center gap-1.5 min-h-[16px] ${isUser ? "flex-row-reverse" : ""}`}>
          <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wider">
            {isUser ? "You" : "goatLLM"}
          </span>
          <span
            className="text-[10.5px] text-[#888888] tabular-nums"
            title={formatLongDateTime(message.createdAt)}
            aria-label={formatLongDateTime(message.createdAt)}
          >
            {formatMessageTime(message.createdAt)}
          </span>
          <div className={`flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? "flex-row-reverse" : ""}`}>
            {!isStreaming && message.content.trim().length > 0 && (
              <button
                className="w-6 h-6 flex items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5 transition-colors"
                onClick={handleCopy}
                aria-label={copied ? "Copied to clipboard" : isUser ? "Copy your message" : "Copy assistant response"}
                title={copied ? "Copied" : "Copy"}
              >
                {copied ? (
                  <Check size={13} strokeWidth={2} className="text-[#34d399]" aria-hidden="true" />
                ) : (
                  <Copy size={13} strokeWidth={1.6} aria-hidden="true" />
                )}
              </button>
            )}
            {isUser && !isStreaming && (
              <button className="w-6 h-6 flex items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5 transition-colors" onClick={editing ? handleCancelEdit : handleStartEdit} aria-label={editing ? "Cancel edit" : "Edit message"} title={editing ? "Cancel" : "Edit"}>
                {editing ? (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="2" y1="2" x2="14" y2="14" /><line x1="14" y1="2" x2="2" y2="14" /></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 2l3 3-9 9H2v-3l9-9z" /></svg>
                )}
              </button>
            )}
            {isAssistant && !isStreaming && (
              <button className="w-6 h-6 flex items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5 transition-colors" onClick={handleRegenerate} aria-label="Regenerate response" title="Regenerate">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 4v4h4" /><path d="M15 12v-4h-4" /><path d="M13.5 6A6 6 0 002.2 8.8M2.5 10a6 6 0 0011.3-2.9" /></svg>
              </button>
            )}
            {!isStreaming && message.content.trim().length > 0 && (
              <button
                className={`w-6 h-6 flex items-center justify-center rounded-md transition-colors ${message.pinned ? "text-[#f59e42] hover:bg-white/5" : "text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5"}`}
                onClick={handleTogglePin}
                aria-label={message.pinned ? "Unpin from context" : "Pin to context"}
                title={message.pinned ? "Pinned — survives auto-compaction" : "Pin to context"}
              >
                {message.pinned ? (
                  <Pin size={13} strokeWidth={2} aria-hidden="true" fill="currentColor" />
                ) : (
                  <PinOff size={13} strokeWidth={1.6} aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        </div>

        {showWorkingHeader && <WorkingHeader startedAt={startedAt} running={headerRunning} label="Working" />}

        {isAssistant && isStreaming && (() => {
          const autoTriggerNames = useChatStore.getState().autoTriggerSkills;
          if (autoTriggerNames.size === 0) return null;
          return (
            <div className="flex items-center gap-1.5 mb-1.5">
              {[...autoTriggerNames].map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#f59e42]/10 text-[11.5px] text-[#f59e42]"
                >
                  <Sparkles size={10} strokeWidth={1.75} />
                  {name}
                </span>
              ))}
            </div>
          );
        })()}

        {isInterrupted && (
          <div className="flex items-center justify-between gap-3 px-3 py-2 mb-1 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] text-[12px]">
            <span className="text-[#f59e42]">⚠ This response was interrupted (app closed mid-stream).</span>
            <button
              onClick={handleContinueAfterInterrupt}
              className="px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-[#fcd34d] text-[11.5px] font-medium transition-colors shrink-0"
            >
              Continue from here
            </button>
          </div>
        )}

        {hasToolCalls && isAssistant ? (() => {
          // Interleave text and tool calls chronologically using contentAtInvocation
          const toolCalls = message.toolCalls!;
          const content = message.content;

          // Build segments: each tool call splits the content at its invocation point
          type Segment = { type: "text"; text: string } | { type: "tool"; tc: ToolCallEntry };
          const segments: Segment[] = [];
          let lastContentPos = 0;

          // Sort tool calls by contentAtInvocation to ensure correct order
          const sortedTcs = [...toolCalls].sort(
            (a, b) => (a.contentAtInvocation ?? 0) - (b.contentAtInvocation ?? 0)
          );

          for (const tc of sortedTcs) {
            const pos = tc.contentAtInvocation ?? 0;
            if (pos > lastContentPos && content.length > 0) {
              const textSlice = content.slice(lastContentPos, pos).trim();
              if (textSlice) segments.push({ type: "text", text: textSlice });
            }
            segments.push({ type: "tool", tc });
            lastContentPos = Math.max(lastContentPos, pos);
          }

          // Remaining text after last tool call
          if (lastContentPos < content.length) {
            const remaining = content.slice(lastContentPos).trim();
            if (remaining) segments.push({ type: "text", text: remaining });
          }

          return segments.map((seg, i) => {
            if (seg.type === "tool") {
              return <InlineToolCall key={seg.tc.toolCallId} tc={seg.tc} />;
            }
            return (
              <div key={`text-${i}`} className="w-full">
                <SegmentedAssistantText
                  content={seg.text}
                  messageId={message.id}
                  isStreaming={isStreaming}
                />
              </div>
            );
          });
        })()
        : (
          <div className={isUser ? "bg-[#2d2d2d] border border-white/5 rounded-2xl px-4 py-2 max-w-[85%]" : "w-full"}>
            {editing ? (
              <textarea
                ref={textareaRef}
                className="w-full min-w-[320px] bg-[#2c2c2e] border border-white/10 rounded-xl text-[14px] text-[#ececec] p-2.5 resize-none outline-none leading-relaxed"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                rows={1}
              />
            ) : isUser ? (
              <UserMessageContent message={message} />
            ) : message.content.length === 0 && isWorking ? (
              <Shimmer text="Thinking" className="thinking-line" />
            ) : (
              <>
                <SegmentedAssistantText
                  content={message.content}
                  messageId={message.id}
                  isStreaming={isStreaming}
                />
                {isStreaming && message.content.length > 0 && (
                  <span className="inline-block w-0.5 h-4 bg-[#b4b4b4] ml-0.5 align-text-bottom rounded-sm animate-[cursorBlink_1s_step-end_infinite]" />
                )}
              </>
            )}
          </div>
        )}

        {hasToolCalls && isAssistant && isStreaming && message.content.length === 0 && (
          <Shimmer text="Thinking" className="thinking-line" />
        )}
        {hasToolCalls && isAssistant && isStreaming && message.content.length > 0 && (
          <span className="inline-block w-0.5 h-4 bg-[#b4b4b4] ml-0.5 align-text-bottom rounded-sm animate-[cursorBlink_1s_step-end_infinite]" />
        )}
        {hasToolCalls && isAssistant && !isStreaming && (
          <FallbackArtifactCards messageId={message.id} />
        )}
        {isAssistant && !isStreaming && (
          <PlanBuildCTA message={message} />
        )}
      </div>
    </div>
  );
});

// ── User message content (with attachment chips and stripped markers) ──

function UserMessageContent({ message }: { message: Message }) {
  const cleaned = useMemo(() => stripAttachmentMarkers(message.content), [message.content]);
  const hasAttachments = !!message.attachments && message.attachments.length > 0;
  // Render LaTeX math the user typed/pasted (e.g. `$\int_0^1 x^2 dx$`,
  // `$$\sum_{i=1}^n i$$`). We sniff for paired `$` or `$$` delimiters before
  // routing through MarkdownRenderer so plain prose with stray `$` (prices,
  // shell prompts) keeps its whitespace-pre-wrap rendering. Triggers on
  // either delimited math or markdown that uses fenced code / headings
  // — students often paste from textbooks so we want both rendered.
  const hasMath = useMemo(() => {
    if (!cleaned) return false;
    // $$ ... $$ block math.
    if (/\$\$[^$]+\$\$/.test(cleaned)) return true;
    // $ ... $ inline math — require at least one balanced pair containing a
    // letter or backslash so we don't trigger on "$5" or shell prompts.
    if (/\$[^$\n]*[\\A-Za-z][^$\n]*\$/.test(cleaned)) return true;
    return false;
  }, [cleaned]);
  const hasMarkdown = useMemo(() => {
    if (!cleaned) return false;
    return /(```|^#{1,6}\s|^\s*[-*]\s+|\[[^\]]+\]\([^)]+\))/m.test(cleaned);
  }, [cleaned]);
  const useRichRender = hasMath || hasMarkdown;

  return (
    <div className="flex flex-col">
      {hasAttachments && <AttachmentChips attachments={message.attachments!} />}
      {cleaned.length > 0 && (
        useRichRender ? (
          <div className="text-[14px] leading-relaxed text-[#ececec] select-text">
            <MarkdownRenderer content={cleaned} />
          </div>
        ) : (
          <div className="text-[14px] leading-relaxed text-[#ececec] whitespace-pre-wrap break-words select-text">{cleaned}</div>
        )
      )}
    </div>
  );
}

// ── Assistant text → markdown + inline artifact cards ──
//
// The model authors artifacts as fenced code blocks (```docx … ```, etc.).
// Showing the raw fence to the user is noisy — the real artifact lives in the
// side panel — so we strip those fences out of the text and replace each one
// with an inline `ArtifactCard` (or a placeholder while the body is still
// streaming). Non-artifact code blocks pass through untouched.
//
// `DesignAwareText` is the design-mode wrapper: it splits the text on
// any `<question-form>` block and renders it as a native form. When the
// user isn't in design mode, this is just a passthrough to MarkdownRenderer.
function DesignAwareText({ text, messageId }: { text: string; messageId: string }) {
  const designMode = useChatStore((s) => s.designMode);
  const conversationId = useChatStore((s) => s.activeId);
  const segments = useMemo(
    () => (designMode ? splitByQuestionForm(text) : null),
    [designMode, text],
  );
  if (!segments) return <MarkdownRenderer content={text} />;
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return <MarkdownRenderer key={`fseg-${messageId}-${i}`} content={seg.text} />;
        }
        if (seg.form && conversationId) {
          return (
            <QuestionFormRenderer
              key={`fseg-${messageId}-${i}`}
              form={seg.form}
              conversationId={conversationId}
            />
          );
        }
        // Streaming-in-progress form — show a tiny placeholder card.
        return (
          <div
            key={`fseg-${messageId}-${i}`}
            className="my-3 rounded-xl border border-white/[0.08] bg-[#2a2a2c] px-4 py-3 text-[12px] text-[#a0a0a0] thinking-line"
          >
            Composing form…
          </div>
        );
      })}
    </>
  );
}

function SegmentedAssistantText({
  content,
  messageId,
  isStreaming,
}: {
  content: string;
  messageId: string;
  isStreaming: boolean;
}) {
  const activeId = useChatStore((s) => s.activeId);
  const artifacts = useChatStore((s) => (activeId ? s.artifacts[activeId] : undefined));
  const autoArtifacts = useChatStore((s) => s.autoArtifacts);
  const officeArtifacts = useChatStore((s) => s.officeArtifacts);

  const parts = useMemo(() => {
    // Hide the literal BUILD-PLAN-COMPLETE marker from the rendered text —
    // it's a control signal for the Build CTA, not user-facing copy.
    const stripped = content.replace(/\n*BUILD-PLAN-COMPLETE\s*\.?\s*$/m, "").replace(/\s+$/, "");
    if (!autoArtifacts) {
      // User opted out — keep every fence inline as a regular code block.
      return [{ type: "text" as const, text: stripped }];
    }
    const enabledKinds = new Set<ArtifactKind>(["html", "latex", "python"]);
    if (officeArtifacts) {
      enabledKinds.add("docx");
      enabledKinds.add("pptx");
      enabledKinds.add("xlsx");
    }
    return splitContentByArtifacts(stripped, { enabledKinds });
  }, [content, autoArtifacts, officeArtifacts]);

  // Build a lookup so the inline placeholder slots can resolve to a real
  // artifact once detection runs after the stream finishes. We match on
  // (kind + normalized title) which is exactly the key the detector uses.
  const findArtifact = (kind: ArtifactKind, title: string) => {
    if (!artifacts) return undefined;
    const want = normalizeTitle(title);
    if (!want) {
      return [...artifacts]
        .reverse()
        .find((a) => a.messageId === messageId && a.kind === kind);
    }
    return [...artifacts]
      .reverse()
      .find((a) => a.kind === kind && normalizeTitle(a.title) === want);
  };

  return (
    <>
      {parts.map((p, i) => {
        if (p.type === "text") {
          return <DesignAwareText key={`t-${i}`} text={p.text} messageId={messageId} />;
        }
        const real = findArtifact(p.kind, p.title);
        if (real) {
          return (
            <div key={`a-${i}`} className="my-2">
              <ArtifactCard artifact={real} />
            </div>
          );
        }
        // No artifact in the store yet — either still streaming, or the
        // closing fence is missing. Show the placeholder so the user has
        // something to look at.
        return (
          <div key={`a-${i}`} className="my-2">
            <ArtifactPlaceholderCard kind={p.kind} title={p.title} />
          </div>
        );
      })}
      {/* If the bubble is mid-stream and the last segment is an open fence,
          add a subtle "writing" hint below the placeholder. */}
      {isStreaming && parts.length > 0 && parts[parts.length - 1].type === "artifact" && (
        <div className="text-[11px] text-[#a0a0a0] mt-1 thinking-line">Writing…</div>
      )}
    </>
  );
}

// ── Inline artifact cards (fallback) ──
//
// Some artifacts may have been detected from a message that didn't preserve
// its fences in the visible content (legacy messages, or content that got
// trimmed). Anything not already placed inline by the segmenter falls back
// to a row of cards under the bubble.
function FallbackArtifactCards({ messageId }: { messageId: string }) {
  const activeId = useChatStore((s) => s.activeId);
  const artifacts = useChatStore((s) => (activeId ? s.artifacts[activeId] : undefined));
  const messages = useChatStore((s) => (activeId ? s.messages[activeId] : undefined));
  const messageArtifacts = artifacts?.filter((a) => a.messageId === messageId) ?? [];

  if (messageArtifacts.length === 0) return null;

  // Look at the message text — if every artifact is referenced by an inline
  // fence, the segmenter already drew them. Skip the duplicate cards.
  const message = messages?.find((m) => m.id === messageId);
  if (message) {
    const inlineParts = splitContentByArtifacts(message.content);
    const inlineKeys = new Set(
      inlineParts
        .filter((p): p is Extract<ContentSegment, { type: "artifact" }> => p.type === "artifact")
        .map((p) => `${p.kind}|${normalizeTitle(p.title)}`),
    );
    const unplaced = messageArtifacts.filter(
      (a) => !inlineKeys.has(`${a.kind}|${normalizeTitle(a.title)}`),
    );
    if (unplaced.length === 0) return null;
    return (
      <div className="flex flex-col gap-1.5 mt-3">
        {unplaced.map((a) => (
          <ArtifactCard key={a.id} artifact={a} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 mt-3">
      {messageArtifacts.map((a) => (
        <ArtifactCard key={a.id} artifact={a} />
      ))}
    </div>
  );
}

// ── Plan-mode “Build” call-to-action ──
//
// When the agent finishes a plan-mode reply, it ends the message with the
// literal `BUILD-PLAN-COMPLETE` marker. We strip that marker from the
// rendered text (handled in stripMarkdown for the copy button only — see
// below) and surface a CTA banner with a Build button. Click flips the
// store off plan mode and replays the user's last prompt so the agent
// continues with write tools available, fully aware of the plan above.
function PlanBuildCTA({ message }: { message: Message }) {
  const activeId = useChatStore((s) => s.activeId);
  const planMode = useChatStore((s) => s.planMode);
  const setPlanMode = useChatStore((s) => s.setPlanMode);
  const triggerResend = useChatStore((s) => s.triggerResend);
  const messages = useChatStore((s) => (activeId ? s.messages[activeId] : undefined));
  const isStreaming = useChatStore((s) => activeId ? s.isConversationStreaming(activeId) : false);
  // Local consumed flag for instant feedback. Once the user clicks Build
  // (or otherwise dismisses), we hide the CTA immediately rather than
  // waiting for the resend round-trip to update the message list.
  const [consumed, setConsumed] = useState(false);

  // Trigger purely on the marker so the CTA still shows up if the user
  // toggles plan mode off between turns. Tolerates whitespace/punctuation
  // after the marker so a stray period or trailing newline doesn't hide it.
  const looksLikePlan = /BUILD-PLAN-COMPLETE\s*\.?\s*$/.test(message.content.trim());
  if (!looksLikePlan) return null;

  // Only show the CTA on the latest assistant message in the conversation.
  // Once any further message lands — the build resend, a manual follow-up,
  // anything — the plan is no longer the live tail and the button stops
  // making sense. This makes the CTA single-shot by construction.
  if (messages && messages.length > 0) {
    const idx = messages.findIndex((m) => m.id === message.id);
    if (idx !== -1 && idx !== messages.length - 1) return null;
  }

  if (consumed) return null;

  const handleBuild = () => {
    if (!activeId || isStreaming || !messages) return;
    // Find the last user message to replay. Plan-mode only ever sits
    // between a single user prompt and a single assistant plan, so this
    // is unambiguous.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setConsumed(true);
    setPlanMode(false);
    // Append a small directive so the model knows this turn executes the
    // plan rather than re-plans. Keep the original attachments.
    const directive = lastUser.content.trim()
      ? `${lastUser.content}\n\nProceed and build the plan above.`
      : "Proceed and build the plan above.";
    triggerResend(activeId, directive, lastUser.attachments);
  };

  return (
    <div className="mt-4 rounded-2xl border border-[#f59e42]/30 bg-gradient-to-b from-[#f59e42]/[0.06] to-transparent p-4 flex items-start gap-3">
      <div className="shrink-0 w-9 h-9 rounded-xl bg-[#f59e42]/15 flex items-center justify-center">
        <ListChecks size={16} strokeWidth={1.75} className="text-[#f59e42]" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[#ececec] leading-tight">
          Plan ready{planMode ? " — read-only investigation done" : ""}
        </div>
        <div className="text-[11.5px] text-[#a0a0a0] mt-0.5 leading-snug">
          Review the steps above. Build executes the plan with full write tools.
        </div>
      </div>
      <button
        onClick={handleBuild}
        disabled={isStreaming}
        className="shrink-0 inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full bg-[#f59e42] text-[#1a1a1c] text-[13px] font-semibold hover:bg-[#f0903a] active:bg-[#e88a32] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        aria-label="Build the plan"
        title="Switch to write mode and execute the plan"
      >
        <Hammer size={14} strokeWidth={2} aria-hidden="true" />
        Build
      </button>
    </div>
  );
}
