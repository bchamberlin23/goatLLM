import { memo, useState, useCallback, useRef, useEffect, type ReactElement, type ReactNode } from "react";
import { Message, useChatStore, type ToolCallEntry } from "../stores/chat";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ArtifactCard } from "./ArtifactPanel";
import { approveExecution, denyExecution } from "../lib/tools";
import { computeDiff, type DiffResult } from "../lib/diff-utils";
import { Shimmer, WorkingHeader } from "./ThinkingIndicator";
import { ChevronDown, AlertTriangle, Copy, Check } from "lucide-react";
import { ansiToHtml, hasAnsi } from "../lib/ansi";

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
            <code className="block bg-[#2c2c2e] border border-white/5 rounded-lg p-2.5 font-mono text-[11.5px] text-[#ececec] whitespace-pre-wrap break-all max-h-[180px] overflow-auto">{formatInput(tc.input)}</code>
          </div>
        ) : isExec ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a0a0a0]">Command</span>
            <code className="block bg-[#2c2c2e] border border-white/5 rounded-lg p-2.5 font-mono text-[11.5px] text-[#ececec] whitespace-pre-wrap break-all">{getInputField(tc.input, "command") || "(unknown)"}</code>
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
          <code className="block bg-[#2c2c2e] border border-white/5 rounded-lg p-2.5 font-mono text-[11.5px] text-[#ececec] whitespace-pre-wrap break-all">{formatInput(tc.input)}</code>
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

  if (isPending) return <ApprovalGate tc={tc} />;

  return (
    <div className={`flex items-start gap-2 text-[13px] leading-relaxed py-1 ${isError ? "text-[#f87171]" : "text-[#b4b4b4]"}`}>
      <span className={`shrink-0 mt-[3px] flex items-center justify-center w-3.5 h-3.5 ${isRunning ? "text-[#ececec] animate-[pulse-soft_1.6s_ease-in-out_infinite]" : isError ? "text-[#f87171]" : "text-[#8e8e8e]"}`}>
        {pres.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div>
          <span className={`font-medium whitespace-nowrap ${isRunning ? "shimmer" : "text-[#ececec]"}`}>
            {verb}
          </span>
          {pres.target && (
            <>
              {" "}
              <code className="font-mono text-[12px] bg-white/5 border border-white/5 rounded px-1.5 py-px text-[#ececec] max-w-full truncate inline-block align-middle">
                {pres.target}
              </code>
            </>
          )}
          {isError && " — error"}
        </div>
        {pres.detail && (
          <div className="mt-0.5 text-[12px] text-[#a0a0a0] font-mono break-all line-clamp-1">{pres.detail}</div>
        )}
        {expanded && hasOutput && (
          <TerminalOutput text={String(tc.output)} toolName={tc.toolName} />
        )}
      </div>
      {(isDone || isError) && hasOutput && (
        <button
          className={`shrink-0 mt-[5px] text-[#a0a0a0] hover:text-[#ececec] transition-colors ${expanded ? "rotate-180" : ""}`}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown size={11} strokeWidth={1.6} />
        </button>
      )}
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
        className="mt-[5px] ml-4 p-2.5 bg-[#1a1a1c] border border-white/5 rounded-lg font-mono text-[11.5px] leading-relaxed text-[#b4b4b4] max-h-[280px] overflow-auto whitespace-pre-wrap break-all"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <pre className="mt-2 ml-5 p-2.5 bg-[#2c2c2e] border border-white/5 rounded-lg font-mono text-[11.5px] leading-relaxed text-[#b4b4b4] max-h-[280px] overflow-auto whitespace-pre-wrap break-all">{text}</pre>
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

  const handleStartEdit = useCallback(() => { setEditValue(message.content); setEditing(true); }, [message.content]);
  const handleSaveEdit = useCallback(() => {
    const store = useChatStore.getState();
    store.editMessage(message.conversationId, message.id, editValue);
    store.removeMessagesAfter(message.conversationId, message.id);
    store.triggerResend(message.conversationId, editValue);
    setEditing(false);
  }, [message.conversationId, message.id, editValue]);
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

  const hasToolCalls = !!(message.toolCalls && message.toolCalls.length > 0);
  const anyToolRunning = !!message.toolCalls?.some((t) => t.state === "running" || t.state === "pending_approval");
  const isWorking = isAssistant && isStreaming && (anyToolRunning || message.content.trim().length === 0);
  const startedAt = isAssistant ? message.createdAt : null;
  const agentMode = useChatStore((s) => s.agentMode);
  const showWorkingHeader = isAssistant && (hasToolCalls || (isStreaming && agentMode));
  const headerRunning = isAssistant && isStreaming;

  return (
    <div className={`group px-6 py-2.5 w-full ${isUser ? "flex justify-end" : ""}`}>
      <div className={`flex flex-col gap-1.5 ${isUser ? "items-end" : "items-stretch"} w-full max-w-[720px] mx-auto`}>
        <div className={`flex items-center gap-1.5 min-h-[18px] ${isUser ? "flex-row-reverse" : ""}`}>
          <span className="text-[11px] font-medium text-[#a0a0a0] uppercase tracking-wider">
            {isUser ? "You" : "goatLLM"}
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
          </div>
        </div>

        {showWorkingHeader && <WorkingHeader startedAt={startedAt} running={headerRunning} label="Working" />}

        {hasToolCalls && (
          <div className="flex flex-col gap-1.5 mb-2 w-full">
            {message.toolCalls!.map((tc) => <InlineToolCall key={tc.toolCallId} tc={tc} />)}
          </div>
        )}

        <div className={isUser ? "bg-[#2d2d2d] border border-white/5 rounded-2xl px-4 py-2.5 max-w-[85%]" : "w-full"}>
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
            <div className="text-[14px] leading-relaxed text-[#ececec] whitespace-pre-wrap break-words">{message.content}</div>
          ) : message.content.length === 0 && isWorking ? (
            <Shimmer text="Thinking" className="thinking-line" />
          ) : (
            <>
              <MarkdownRenderer content={message.content} />
              {!isStreaming && (
                <ArtifactCards messageId={message.id} />
              )}
              {isStreaming && message.content.length > 0 && (
                <span className="inline-block w-0.5 h-4 bg-[#b4b4b4] ml-0.5 align-text-bottom rounded-sm animate-[cursorBlink_1s_step-end_infinite]" />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

// ── Inline artifact cards ──

function ArtifactCards({ messageId }: { messageId: string }) {
  const activeId = useChatStore((s) => s.activeId);
  const artifacts = useChatStore((s) => (activeId ? s.artifacts[activeId] : undefined));
  const messageArtifacts = artifacts?.filter((a) => a.messageId === messageId) ?? [];

  if (messageArtifacts.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 mt-3">
      {messageArtifacts.map((a) => (
        <ArtifactCard key={a.id} artifact={a} />
      ))}
    </div>
  );
}
