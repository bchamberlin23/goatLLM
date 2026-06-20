import { useState, useEffect, useCallback, useMemo, type ReactNode, type ReactElement } from "react";
import type { ToolCallEntry } from "../stores/chat";
import { useChatStore } from "../stores/chat";
import { approveExecution, denyExecution } from "../lib/tools";
import { computeDiff, type DiffResult } from "../lib/diff-utils";
import { DiffView } from "./DiffView";
import { Shimmer } from "./ThinkingIndicator";
import { ChevronDown, AlertTriangle, ArrowUpRight, File, Folder, Globe, CheckCircle2, Copy, Check, Sliders, Terminal } from "lucide-react";
import { ansiToHtml, hasAnsi } from "../lib/ansi";
import { MarkdownRenderer } from "./MarkdownRenderer";

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
  if (name === "web_fetch" || name === "scrape_url") {
    return { runningVerb: name === "scrape_url" ? "Scraping" : "Fetching", doneVerb: name === "scrape_url" ? "Scraped" : "Fetched", target: url, icon: baseIcon(<><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /></>) };
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
    const tasks = (tc.input && typeof tc.input === "object" && (tc.input as any).tasks) || null;
    const target = Array.isArray(tasks)
      ? `${tasks.length} tasks`
      : `task: ${getInputField(tc.input, "title") || "task"}`;
    return { runningVerb: "Creating", doneVerb: "Created", target, icon: baseIcon(<><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>) };
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

  // Try to find a human-friendly target from input for generic tools
  let target = name;
  if (tc.input && typeof tc.input === "object") {
    const obj = tc.input as Record<string, unknown>;
    const keys = ["path", "AbsolutePath", "TargetFile", "command", "CommandLine", "query", "pattern", "url", "name", "id", "title"];
    for (const k of keys) {
      if (typeof obj[k] === "string" && obj[k]) {
        target = truncate(obj[k] as string, 45);
        break;
      }
    }
  }

  return {
    runningVerb: "Running",
    doneVerb: "Ran",
    target,
    icon: baseIcon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>)
  };
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
    <div className="motion-surface-in border border-accent/35 bg-accent/5 rounded-xl p-3.5 flex flex-col gap-3 my-1">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-accent">
          Needs approval
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {tc.toolName === "write_file" && diffPreview ? (
          <DiffView diff={diffPreview} />
        ) : isWrite ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-3">
              File
            </span>
            <code className="block bg-surface-2 border border-white/5 rounded-lg p-2.5 font-mono text-[11.5px] text-text-1 whitespace-pre-wrap break-all max-h-[180px] overflow-auto select-text">
              {formatInput(tc.input)}
            </code>
          </div>
        ) : isExec ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-3">
              Command
            </span>
            <code className="block bg-surface-2 border border-white/5 rounded-lg p-2.5 font-mono text-[11.5px] text-text-1 whitespace-pre-wrap break-all select-text">
              {getInputField(tc.input, "command") || "(unknown)"}
            </code>
            {isDestructive && (
              <div className="flex items-center gap-1.5 mt-1 px-2.5 py-1.5 bg-red-500/10 border border-red-500/20 rounded-md text-[11.5px] font-semibold text-error">
                <AlertTriangle size={12} className="text-error" />
                DESTRUCTIVE — {tc.dangerReason}
              </div>
            )}
            {isSuspicious && (
              <div className="flex items-center gap-1.5 mt-1 px-2.5 py-1.5 bg-accent/10 border border-accent/20 rounded-md text-[11.5px] font-semibold text-accent">
                <AlertTriangle size={12} className="text-accent" />
                Suspicious — {tc.dangerReason}
              </div>
            )}
            {needsDoubleConfirm && (
              <div className="mt-1 text-[11.5px] text-text-3 italic">
                This will permanently affect your system. Click again to
                confirm.
              </div>
            )}
          </div>
        ) : (
          <div className="soft-card block rounded-lg p-2.5 max-h-[220px] overflow-auto select-text">
            <JsonInspectorNode value={tc.input} depth={0} />
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button
          className="control-pill px-3.5 py-1.5 rounded-md text-[12.5px] transition-colors"
          onClick={() => denyExecution(tc.toolCallId)}
        >
          Deny
        </button>
        <button
          className={`px-3.5 py-1.5 rounded-md text-[12.5px] font-medium transition-colors ${
            isDestructive && !needsDoubleConfirm
              ? "bg-red-500/20 text-error hover:bg-red-500/30 hover:text-error"
              : "primary-action"
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

// ── JSON Syntax Highlight ──────────────────────────────────────────

function JsonToken({ type, value }: { type: string; value: string }) {
  const colors: Record<string, string> = {
    key: "var(--info)",     // info blue — keys
    string: "var(--success)",  // success green — string values
    number: "var(--accent)",   // accent amber — numbers
    boolean: "var(--accent)",  // accent amber — booleans
    null: "var(--text-4)",     // text-4 — null
    brace: "var(--text-2)",    // text-2 — structural chars
    colon: "var(--text-4)",
    comma: "var(--text-4)",
  };
  return (
    <span style={{ color: colors[type] ?? "var(--text-1)" }}>{value}</span>
  );
}

function SyntaxHighlightedJson({ value }: { value: unknown }) {
  const tokens = useMemo(() => tokenizeJson(value), [value]);
  return (
    <span>
      {tokens.map((t, i) => (
        <JsonToken key={i} type={t.type} value={t.value} />
      ))}
    </span>
  );
}

interface Token { type: string; value: string }

function tokenizeJson(val: unknown, depth = 0): Token[] {
  if (val === null) return [{ type: "null", value: "null" }];
  if (typeof val === "boolean") return [{ type: "boolean", value: String(val) }];
  if (typeof val === "number") return [{ type: "number", value: String(val) }];
  if (typeof val === "string") return [{ type: "string", value: JSON.stringify(val) }];

  const indent = "  ".repeat(depth);
  const innerIndent = "  ".repeat(depth + 1);

  if (Array.isArray(val)) {
    if (val.length === 0) return [{ type: "brace", value: "[]" }];
    const tokens: Token[] = [{ type: "brace", value: "[\n" }];
    val.forEach((item, i) => {
      tokens.push({ type: "brace", value: innerIndent });
      tokens.push(...tokenizeJson(item, depth + 1));
      if (i < val.length - 1) tokens.push({ type: "comma", value: "," });
      tokens.push({ type: "brace", value: "\n" });
    });
    tokens.push({ type: "brace", value: indent + "]" });
    return tokens;
  }

  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return [{ type: "brace", value: "{}" }];
    const tokens: Token[] = [{ type: "brace", value: "{\n" }];
    entries.forEach(([k, v], i) => {
      tokens.push({ type: "brace", value: innerIndent });
      tokens.push({ type: "key", value: JSON.stringify(k) });
      tokens.push({ type: "colon", value: ": " });
      tokens.push(...tokenizeJson(v, depth + 1));
      if (i < entries.length - 1) tokens.push({ type: "comma", value: "," });
      tokens.push({ type: "brace", value: "\n" });
    });
    tokens.push({ type: "brace", value: indent + "}" });
    return tokens;
  }

  return [{ type: "brace", value: String(val) }];
}

// ── Visual JSON Inspector ──────────────────────────────────────────

function JsonInspectorNode({
  label,
  value,
  depth = 0,
}: {
  label?: string | number;
  value: unknown;
  depth: number;
}) {
  const [isExpanded, setIsExpanded] = useState(depth < 2); // Default to expanding first couple levels
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

  if (type === "null") {
    return (
      <div className="flex items-baseline gap-1.5 py-0.5 font-mono text-[11.5px] leading-normal">
        {label !== undefined && <span className="text-text-4 select-none">{label}:</span>}
        <span className="text-text-4 italic">null</span>
      </div>
    );
  }

  if (type === "array") {
    const arr = value as unknown[];
    const isEmpty = arr.length === 0;
    return (
      <div className="flex flex-col py-0.5 font-mono text-[11.5px] leading-normal">
        <div
          onClick={() => !isEmpty && setIsExpanded(!isExpanded)}
          className={`flex items-baseline gap-1 select-none ${
            isEmpty ? "" : "cursor-pointer hover:text-text-1 transition-colors"
          } text-text-4`}
        >
          {!isEmpty && (
            <ChevronDown
              size={10.5}
              strokeWidth={2}
              className={`shrink-0 text-text-4 mr-0.5 transition-transform duration-100 ${
                isExpanded ? "" : "-rotate-90"
              }`}
            />
          )}
          {label !== undefined && <span className="text-text-2 font-medium">{label}:</span>}
          <span className="text-text-4 text-[10.5px]">
            {isEmpty ? "[]" : `[${arr.length} item${arr.length === 1 ? "" : "s"}]`}
          </span>
        </div>
        {isExpanded && !isEmpty && (
          <div className="motion-expand-content border-l border-hairline ml-[5px] pl-3.5 mt-0.5 flex flex-col gap-0.5">
            {arr.map((item, idx) => (
              <JsonInspectorNode key={idx} label={idx} value={item} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (type === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    const isEmpty = keys.length === 0;
    return (
      <div className="flex flex-col py-0.5 font-mono text-[11.5px] leading-normal">
        <div
          onClick={() => !isEmpty && setIsExpanded(!isExpanded)}
          className={`flex items-baseline gap-1 select-none ${
            isEmpty ? "" : "cursor-pointer hover:text-text-1 transition-colors"
          } text-text-4`}
        >
          {!isEmpty && (
            <ChevronDown
              size={10.5}
              strokeWidth={2}
              className={`shrink-0 text-text-4 mr-0.5 transition-transform duration-100 ${
                isExpanded ? "" : "-rotate-90"
              }`}
            />
          )}
          {label !== undefined && <span className="text-text-2 font-medium">{label}:</span>}
          <span className="text-text-4 text-[10.5px]">
            {isEmpty ? "{}" : `{${keys.length} field${keys.length === 1 ? "" : "s"}}`}
          </span>
        </div>
        {isExpanded && !isEmpty && (
          <div className="motion-expand-content border-l border-hairline ml-[5px] pl-3.5 mt-0.5 flex flex-col gap-0.5">
            {keys.map((k) => (
              <JsonInspectorNode key={k} label={k} value={obj[k]} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  let valElement: ReactNode;
  if (type === "boolean") {
    valElement = <span className="text-accent font-semibold">{String(value)}</span>;
  } else if (type === "number") {
    valElement = <span className="text-accent font-semibold tabular-nums">{String(value)}</span>;
  } else if (type === "string") {
    const str = value as string;
    if (str.includes("\n") || str.length > 80) {
      valElement = (
        <pre className="mt-1 p-2 bg-black/20 border border-hairline rounded font-mono text-[11px] leading-relaxed max-h-[160px] overflow-auto whitespace-pre-wrap break-all select-text text-text-2">
          {str}
        </pre>
      );
    } else {
      valElement = <span className="text-success select-text">"{str}"</span>;
    }
  } else {
    valElement = <span className="text-text-1 select-text">{String(value)}</span>;
  }

  return (
    <div className="flex items-baseline gap-1.5 py-0.5 font-mono text-[11.5px] leading-normal hover:bg-white/[0.02] rounded px-1 -mx-1 transition-colors">
      {label !== undefined && <span className="text-text-4 select-none">{label}:</span>}
      {valElement}
    </div>
  );
}



function renderMassiveContent(obj: Record<string, unknown>) {
  const content = obj.content ?? obj.CodeContent ?? obj.codeContent;
  const target = obj.TargetContent ?? obj.targetContent;
  const replacement = obj.ReplacementContent ?? obj.replacementContent;

  if (content !== undefined) {
    return (
      <div className="col-span-2 mt-1 w-full">
        <span className="text-text-4 font-sans text-[10.5px] font-semibold uppercase tracking-wider block mb-1">Code Content</span>
        <pre className="p-2.5 bg-black/25 border border-hairline rounded-lg font-mono text-[11.5px] max-h-[220px] overflow-auto whitespace-pre-wrap break-all select-text text-text-1">
          {String(content)}
        </pre>
      </div>
    );
  }

  if (target !== undefined || replacement !== undefined) {
    return (
      <div className="col-span-2 mt-1.5 w-full flex flex-col gap-2">
        {target !== undefined && (
          <div>
            <span className="text-error/70 font-sans text-[10.5px] font-semibold uppercase tracking-wider block mb-1">Target Content (To Replace)</span>
            <pre className="p-2.5 bg-red-950/15 border border-red-500/10 rounded-lg font-mono text-[11px] max-h-[140px] overflow-auto whitespace-pre-wrap break-all select-text text-error">
              {String(target)}
            </pre>
          </div>
        )}
        {replacement !== undefined && (
          <div>
            <span className="text-success/70 font-sans text-[10.5px] font-semibold uppercase tracking-wider block mb-1">Replacement Content</span>
            <pre className="p-2.5 bg-emerald-950/15 border border-emerald-500/10 rounded-lg font-mono text-[11px] max-h-[140px] overflow-auto whitespace-pre-wrap break-all select-text text-success">
              {String(replacement)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return null;
}



// ── File Listing Output ────────────────────────────────────────────

interface FileEntry {
  name: string;
  isDir?: boolean;
  sizeBytes?: number;
  children?: number;
}

function FileListOutput({ output }: { output: string }) {
  const entries = useMemo<FileEntry[]>(() => {
    const trimmed = output.trim();
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
        return parsed.map((item: any) => ({
          name: String(item.name ?? ""),
          isDir: Boolean(item.isDir ?? item.is_dir ?? item.type === "directory"),
          sizeBytes: item.sizeBytes ?? item.size ?? item.size_bytes,
          children: item.children,
        }));
      }
    } catch {
      // not a standard JSON array, try NDJSON
    }

    const lines = trimmed.split("\n");
    const result: FileEntry[] = [];
    for (const line of lines) {
      if (!line.trim() || line.startsWith("Summary:")) continue;
      try {
        const parsed = JSON.parse(line.trim());
        if (parsed && typeof parsed === "object" && "name" in parsed) {
          result.push({
            name: String(parsed.name ?? ""),
            isDir: Boolean(parsed.isDir ?? parsed.is_dir ?? parsed.type === "directory"),
            sizeBytes: parsed.sizeBytes ?? parsed.size ?? parsed.size_bytes,
            children: parsed.children,
          });
        }
      } catch {
        // skip non-JSON lines
      }
    }
    return result;
  }, [output]);

  const summary = useMemo(() => {
    const match = output.match(/Summary:\s*(.+)/);
    return match ? match[1] : null;
  }, [output]);

  if (entries.length === 0) {
    return <PlainOutput text={output} />;
  }

  const dirs = entries.filter(e => e.isDir);
  const files = entries.filter(e => !e.isDir);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="rounded-lg border border-hairline overflow-hidden bg-black/15">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-hairline bg-white/[0.01]">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">
          Directory Contents
        </span>
        {summary && (
          <span className="text-[10px] text-text-4 tabular-nums">{summary}</span>
        )}
      </div>
      <div className="max-h-[240px] overflow-auto">
        {dirs.map((entry, i) => (
          <div
            key={i}
            className="motion-row flex items-center gap-2 px-3 py-1.5 border-b border-hairline last:border-0 hover:bg-white/[0.02] transition-colors"
          >
            <Folder size={12} className="shrink-0 text-accent" strokeWidth={1.6} />
            <span className="font-mono text-[11.5px] text-text-2 truncate flex-1">{entry.name}</span>
            {entry.children !== undefined && (
              <span className="text-[10px] text-text-4 tabular-nums shrink-0">{entry.children} items</span>
            )}
          </div>
        ))}
        {files.map((entry, i) => (
          <div
            key={i}
            className="motion-row flex items-center gap-2 px-3 py-1.5 border-b border-hairline last:border-0 hover:bg-white/[0.02] transition-colors"
          >
            <File size={12} className="shrink-0 text-text-4" strokeWidth={1.6} />
            <span className="font-mono text-[11.5px] text-text-4 truncate flex-1">{entry.name}</span>
            {entry.sizeBytes !== undefined && (
              <span className="text-[10px] text-text-4 tabular-nums shrink-0">{formatSize(entry.sizeBytes)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Web Search Results ─────────────────────────────────────────────

interface SearchResult {
  title?: string;
  url?: string;
  snippet?: string;
  content?: string;
}

function WebSearchOutput({ output }: { output: string }) {
  const results = useMemo<SearchResult[]>(() => {
    try {
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed)) return parsed;
      if (parsed?.results && Array.isArray(parsed.results)) return parsed.results;
      if (parsed?.organic && Array.isArray(parsed.organic)) return parsed.organic;
    } catch {
      // Not JSON
    }
    return [];
  }, [output]);

  if (results.length === 0) return <PlainOutput text={output} />;

  return (
    <div className="flex flex-col gap-1.5">
      {results.slice(0, 5).map((result, i) => (
        <div
          key={i}
          className="rounded-lg border border-hairline bg-black/15 p-2.5 flex flex-col gap-1"
        >
          <div className="flex items-start gap-2">
            <Globe size={11} className="shrink-0 mt-0.5 text-info" strokeWidth={1.6} />
            <div className="min-w-0 flex-1">
              {result.title && (
                <div className="text-[12px] font-medium text-text-1 leading-snug truncate">
                  {result.title}
                </div>
              )}
              {result.url && (
                <div className="text-[10.5px] text-text-4 truncate font-mono mt-0.5">
                  {result.url}
                </div>
              )}
            </div>
          </div>
          {(result.snippet || result.content) && (
            <p className="text-[11.5px] text-text-4 leading-relaxed line-clamp-2 pl-[19px]">
              {result.snippet || result.content}
            </p>
          )}
        </div>
      ))}
      {results.length > 5 && (
        <div className="text-[10.5px] text-text-4 pl-1">+{results.length - 5} more results</div>
      )}
    </div>
  );
}

// ── JSON Output ────────────────────────────────────────────────────

function JsonOutput({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"visual" | "raw">("visual");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return <PlainOutput text={text} />;
  }

  const formatted = JSON.stringify(parsed, null, 2);
  const lineCount = formatted.split("\n").length;

  const handleCopy = () => {
    navigator.clipboard.writeText(formatted).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="rounded-lg border border-hairline overflow-hidden bg-black/15">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-hairline bg-white/[0.01]">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">JSON</span>
          <div className="flex items-center gap-0.5 rounded bg-white/[0.03] border border-hairline p-0.5">
            <button
              onClick={() => setViewMode("visual")}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors font-sans ${
                viewMode === "visual"
                  ? "bg-accent text-bg font-semibold"
                  : "text-text-4 hover:text-text-2"
              }`}
            >
              Visual
            </button>
            <button
              onClick={() => setViewMode("raw")}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors font-sans ${
                viewMode === "raw"
                  ? "bg-accent text-bg font-semibold"
                  : "text-text-4 hover:text-text-2"
              }`}
            >
              Raw
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-4 tabular-nums">{lineCount} lines</span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-text-4 hover:text-text-2 hover:bg-white/5 transition-colors"
          >
            {copied ? <Check size={10} strokeWidth={2} className="text-success" /> : <Copy size={10} strokeWidth={1.6} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <div className="p-3 max-h-[320px] overflow-auto select-text">
        {viewMode === "visual" ? (
          <JsonInspectorNode value={parsed} depth={0} />
        ) : (
          <pre className="font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all">
            <SyntaxHighlightedJson value={parsed} />
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Grep / Search Results ──────────────────────────────────────────

function GrepOutput({ text }: { text: string }) {
  const lines = text.trim().split("\n");
  const results: Array<{ File?: string; LineNumber?: number; LineContent?: string }> = [];
  let isJsonl = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object" && "File" in obj) {
        results.push(obj);
        isJsonl = true;
      }
    } catch {
      break;
    }
  }

  if (!isJsonl || results.length === 0) return <PlainOutput text={text} />;

  return (
    <div className="rounded-lg border border-hairline overflow-hidden bg-black/15">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-hairline bg-white/[0.01]">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">
          {results.length} match{results.length !== 1 ? "es" : ""}
        </span>
      </div>
      <div className="max-h-[240px] overflow-auto">
        {results.map((r, i) => (
          <div key={i} className="px-3 py-1.5 border-b border-hairline last:border-0 flex gap-2 items-baseline hover:bg-white/[0.02] transition-colors">
            {r.LineNumber !== undefined && (
              <span className="text-[10px] text-text-4 tabular-nums shrink-0 w-8 text-right">{r.LineNumber}</span>
            )}
            <div className="min-w-0">
              <span className="font-mono text-[10.5px] text-info truncate block">
                {r.File ?? ""}
              </span>
              {r.LineContent && (
                <span className="font-mono text-[11px] text-text-3 whitespace-pre truncate block">
                  {r.LineContent.trimStart()}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Plain / Terminal Output ────────────────────────────────────────

const PLAIN_LINE_LIMIT = 20;

function PlainOutput({ text, toolName }: { text: string; toolName?: string }) {
  const [showAll, setShowAll] = useState(false);
  const isCommand = toolName === "bash" || toolName === "exec_command";
  const useAnsi = isCommand && hasAnsi(text);
  const lines = text.split("\n");
  const overLimit = lines.length > PLAIN_LINE_LIMIT;
  const visibleText = overLimit && !showAll ? lines.slice(0, PLAIN_LINE_LIMIT).join("\n") : text;
  const html = useAnsi ? ansiToHtml(visibleText) : null;

  return (
    <div className="flex flex-col gap-1 w-full">
      {html ? (
        <pre
          className="p-2.5 bg-black/20 border border-hairline rounded-lg font-mono text-[11.5px] leading-relaxed text-text-2 max-h-[280px] overflow-auto whitespace-pre-wrap break-all select-text"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="p-2.5 bg-black/20 border border-hairline rounded-lg font-mono text-[11.5px] leading-relaxed text-text-2 max-h-[280px] overflow-auto whitespace-pre-wrap break-all select-text">
          {visibleText}
        </pre>
      )}
      {overLimit && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="self-start text-[10.5px] text-text-4 hover:text-text-4 transition-colors mt-0.5 ml-0.5"
        >
          {showAll ? "Show less" : `Show ${lines.length - PLAIN_LINE_LIMIT} more lines`}
        </button>
      )}
    </div>
  );
}

// ── Error Output ───────────────────────────────────────────────────

function ErrorOutput({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/5 overflow-hidden">
      <pre className="p-2.5 font-mono text-[11.5px] leading-relaxed text-error max-h-[200px] overflow-auto whitespace-pre-wrap break-all select-text">
        {text}
      </pre>
    </div>
  );
}

// ── Success Summary ────────────────────────────────────────────────

function SuccessOutput({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-success/15 bg-success/5 overflow-hidden">
      <pre className="p-2.5 font-mono text-[11.5px] leading-relaxed text-text-3 max-h-[120px] overflow-auto whitespace-pre-wrap break-all select-text">
        {text}
      </pre>
    </div>
  );
}

// ── Smart Output Router ────────────────────────────────────────────

function ToolOutput({ tc }: { tc: ToolCallEntry }) {
  const text = String(tc.output ?? "");
  const isError = tc.state === "error";
  const toolName = tc.toolName;

  if (isError) return <ErrorOutput text={text} />;

  if (!text.trim()) {
    return (
      <div className="flex items-center gap-1.5 text-[10.5px] text-text-4">
        <CheckCircle2 size={11} className="text-success/60" strokeWidth={2} />
        <span>Done — no output returned</span>
      </div>
    );
  }

  if (toolName === "list_dir") {
    return <FileListOutput output={text} />;
  }

  if (toolName === "web_search" || toolName === "remote_web_search") {
    return <WebSearchOutput output={text} />;
  }

  if (toolName === "search_content" || toolName === "grep_search" || toolName === "file_search") {
    return <GrepOutput text={text} />;
  }

  if (toolName === "bash" || toolName === "exec_command") {
    return <PlainOutput text={text} toolName={toolName} />;
  }

  if (
    (toolName === "write_file" || toolName === "edit_file" || toolName === "str_replace") &&
    text.trim().length < 120 &&
    !text.includes("\n")
  ) {
    return <SuccessOutput text={text} />;
  }

  try {
    JSON.parse(text);
    return <JsonOutput text={text} />;
  } catch {
    // fall through
  }

  return <PlainOutput text={text} toolName={toolName} />;
}

// ── Terminal Output (ANSI-aware) ───────────────────

function TerminalOutput({ text, toolName }: { text: string; toolName: string }) {
  const isCommand = toolName === "bash" || toolName === "exec_command";
  const useAnsi = isCommand && hasAnsi(text);

  if (useAnsi) {
    const html = ansiToHtml(text);
    return (
      <pre
        className="mt-[5px] ml-4 p-2.5 bg-bg border border-white/5 rounded-lg font-mono text-[11.5px] leading-relaxed text-text-2 max-h-[280px] overflow-auto whitespace-pre-wrap break-all select-text"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <pre className="mt-2 ml-5 p-2.5 bg-surface-2 border border-white/5 rounded-lg font-mono text-[11.5px] leading-relaxed text-text-2 max-h-[280px] overflow-auto whitespace-pre-wrap break-all select-text">
      {text}
    </pre>
  );
}

export { TerminalOutput };

// ── Terminal View (Tailored) ───────────────────────────────────────

function TerminalView({ tc }: { tc: ToolCallEntry }) {
  const command = getInputField(tc.input, "command") || getInputField(tc.input, "CommandLine") || "(unknown command)";
  const output = String(tc.output ?? "");

  return (
    <div className="mt-1.5 ml-4 rounded-xl border border-hairline bg-sunken overflow-hidden flex flex-col font-mono text-[11.5px] leading-relaxed shadow-lg">
      {/* Terminal Window Header */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-hairline bg-white/[0.02] select-none">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-error" />
          <span className="w-2.5 h-2.5 rounded-full bg-accent" />
          <span className="w-2.5 h-2.5 rounded-full bg-success" />
        </div>
        <span className="text-[10px] text-text-4 font-sans font-medium uppercase tracking-wider">Terminal — bash</span>
        <div className="w-12" />
      </div>

      {/* Terminal Content */}
      <div className="p-3.5 flex flex-col gap-2 bg-black/[0.15]">
        {/* Command line */}
        <div className="flex items-start gap-2 text-accent">
          <span className="text-text-4 select-none">$</span>
          <span className="font-semibold select-all break-all">{command}</span>
        </div>
        
        {/* Output */}
        {output.trim() ? (
          <div className="border-t border-hairline pt-2 mt-1 max-h-[300px] overflow-auto select-text">
            <PlainOutput text={output} toolName={tc.toolName} />
          </div>
        ) : (
          <div className="text-[10.5px] text-text-4 italic pt-1">Command completed with no output</div>
        )}
      </div>
    </div>
  );
}

// ── File Operation View (Tailored) ─────────────────────────────────

function FileOperationView({ tc }: { tc: ToolCallEntry }) {
  const name = tc.toolName;
  const path = getInputField(tc.input, "path") || getInputField(tc.input, "TargetFile") || getInputField(tc.input, "AbsolutePath") || "(unknown path)";
  
  const isRead = name === "read_file" || name === "view_file";
  const isWrite = name === "write_file";
  const isEdit = name === "edit_file" || name === "str_replace" || name === "multi_replace_file_content" || name === "replace_file_content";
  const isDiff = name === "diff_file";

  const isMarkdown = path.toLowerCase().endsWith(".md") || path.toLowerCase().endsWith(".mdx") || path.toLowerCase().endsWith(".markdown");

  let opLabel = "File Action";
  let opColor = "text-text-2";
  if (isRead) { opLabel = "Read File"; opColor = "text-info"; }
  else if (isWrite) { opLabel = "Write File"; opColor = "text-success"; }
  else if (isEdit) { opLabel = "Edit File"; opColor = "text-accent"; }
  else if (isDiff) { opLabel = "Diff File"; opColor = "text-accent"; }

  const obj = (tc.input && typeof tc.input === "object" ? tc.input : {}) as Record<string, unknown>;
  const startLine = obj.StartLine ?? obj.startLine ?? obj.offset;
  const endLine = obj.EndLine ?? obj.endLine ?? obj.limit;
  const outputText = String(tc.output ?? "");

  return (
    <div className="mt-1.5 ml-4 rounded-xl border border-hairline bg-sunken overflow-hidden flex flex-col font-sans text-[11.5px] leading-relaxed shadow-lg">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-hairline bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <File size={13} className={isRead ? "text-info" : isWrite ? "text-success" : "text-accent"} />
          <span className="font-mono font-semibold text-text-1 select-all truncate max-w-[280px]">
            {path.split("/").pop()}
          </span>
          <span className="text-[10px] text-text-4 truncate max-w-[150px] font-mono select-all">
            {path}
          </span>
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-white/[0.03] border border-hairline ${opColor}`}>
          {opLabel}
        </span>
      </div>

      <div className="p-3.5 flex flex-col gap-3 bg-black/[0.15]">
        <div className="grid grid-cols-[100px_1fr] gap-y-1.5 gap-x-3 text-[11px] text-text-4 font-mono border-b border-hairline pb-2">
          {startLine !== undefined && (
            <div className="contents">
              <span>Start Line:</span>
              <span className="text-text-2 tabular-nums">{String(startLine)}</span>
            </div>
          )}
          {endLine !== undefined && (
            <div className="contents">
              <span>End Line / Limit:</span>
              <span className="text-text-2 tabular-nums">{String(endLine)}</span>
            </div>
          )}
          {obj.Overwrite !== undefined && (
            <div className="contents">
              <span>Overwrite:</span>
              <span className={obj.Overwrite ? "text-error" : "text-success"}>{String(obj.Overwrite)}</span>
            </div>
          )}
        </div>

        {isRead && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4 select-none">
              File Contents
            </span>
            {outputText.trim() ? (
              isMarkdown ? (
                <div className="p-3.5 bg-bg border border-hairline rounded-lg max-h-[250px] overflow-auto select-text text-text-1">
                  <MarkdownRenderer content={outputText} />
                </div>
              ) : (
                <pre className="p-2.5 bg-bg border border-hairline rounded-lg font-mono text-[11.5px] leading-relaxed max-h-[220px] overflow-auto whitespace-pre-wrap break-all select-text text-text-1">
                  {outputText}
                </pre>
              )
            ) : (
              <span className="text-text-4 italic text-[11px]">Empty file</span>
            )}
          </div>
        )}

        {isWrite && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4 select-none">
              Written Content
            </span>
            {isMarkdown ? (
              <div className="p-3.5 bg-bg border border-hairline rounded-lg max-h-[250px] overflow-auto select-text text-text-1">
                <MarkdownRenderer content={String(obj.content ?? obj.CodeContent ?? obj.codeContent ?? "")} />
              </div>
            ) : (
              renderMassiveContent(obj) ?? (
                <pre className="p-2.5 bg-bg border border-hairline rounded-lg font-mono text-[11.5px] leading-relaxed max-h-[220px] overflow-auto whitespace-pre-wrap break-all select-text text-text-1">
                  {String(obj.content ?? obj.CodeContent ?? obj.codeContent ?? "")}
                </pre>
              )
            )}
          </div>
        )}

        {isEdit && (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4 select-none">
              Modifications
            </span>
            {obj.ReplacementChunks ? (
              <div className="flex flex-col gap-3">
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
                {(obj.ReplacementChunks as any[]).map((chunk, idx) => (
                  <div key={idx} className="border border-hairline rounded-lg overflow-hidden bg-black/20">
                    <div className="px-2.5 py-1 bg-white/[0.02] border-b border-hairline text-[10px] text-text-4 font-mono">
                      Chunk #{idx + 1} (Lines {chunk.StartLine ?? "?"} - {chunk.EndLine ?? "?"})
                    </div>
                    <div className="p-2 flex flex-col gap-2">
                      <div>
                        <span className="text-[10px] text-error/70 font-semibold uppercase block mb-0.5 select-none">Target</span>
                        <pre className="p-2 bg-red-950/10 border border-red-500/10 rounded font-mono text-[11px] leading-relaxed max-h-[100px] overflow-auto whitespace-pre-wrap text-error">
                          {chunk.TargetContent}
                        </pre>
                      </div>
                      <div>
                        <span className="text-[10px] text-success/70 font-semibold uppercase block mb-0.5 select-none">Replacement</span>
                        <pre className="p-2 bg-emerald-950/10 border border-emerald-500/10 rounded font-mono text-[11px] leading-relaxed max-h-[100px] overflow-auto whitespace-pre-wrap text-success">
                          {chunk.ReplacementContent}
                        </pre>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              renderMassiveContent(obj)
            )}
            
            {outputText.trim() && (
              <div className="flex items-center gap-1.5 mt-1 text-[11px] text-success/80 font-mono">
                <CheckCircle2 size={12} className="text-success" />
                <span>{outputText}</span>
              </div>
            )}
          </div>
        )}

        {isDiff && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4 select-none">
              Diff View
            </span>
            <pre className="p-2.5 bg-bg border border-hairline rounded-lg font-mono text-[11.5px] leading-relaxed max-h-[220px] overflow-auto whitespace-pre-wrap break-all select-text text-text-1">
              {outputText}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Grep Results View (Tailored) ───────────────────────────────────

function GrepResultsView({ tc }: { tc: ToolCallEntry }) {
  const query = getInputField(tc.input, "query") || getInputField(tc.input, "pattern") || getInputField(tc.input, "Query") || "(unknown pattern)";
  const searchPath = getInputField(tc.input, "SearchPath") || getInputField(tc.input, "path") || "";
  const output = String(tc.output ?? "");

  const lines = output.trim().split("\n");
  const results: Array<{ File?: string; LineNumber?: number; LineContent?: string }> = [];
  let isJsonl = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object" && "File" in obj) {
        results.push(obj);
        isJsonl = true;
      }
    } catch {
      break;
    }
  }

  const groupedMatches: Record<string, typeof results> = {};
  if (isJsonl) {
    results.forEach(match => {
      const file = match.File || "unknown";
      if (!groupedMatches[file]) groupedMatches[file] = [];
      groupedMatches[file].push(match);
    });
  }

  return (
    <div className="mt-1.5 ml-4 rounded-xl border border-hairline bg-sunken overflow-hidden flex flex-col font-sans text-[11.5px] leading-relaxed shadow-lg">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-hairline bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <Globe size={13} className="text-info" />
          <span className="font-semibold text-text-1">Project Search</span>
        </div>
        <span className="text-[10px] text-text-4 font-mono">
          {searchPath || "."}
        </span>
      </div>

      <div className="p-3.5 flex flex-col gap-3 bg-black/[0.15]">
        <div className="flex items-center justify-between border-b border-hairline pb-2 font-mono text-[11px] text-text-4">
          <div>
            <span>Query: </span>
            <span className="text-accent font-semibold">"{query}"</span>
          </div>
          <div>
            <span className="text-text-2 tabular-nums font-semibold">{isJsonl ? results.length : "0"}</span>
            <span> matches</span>
          </div>
        </div>

        {isJsonl && results.length > 0 ? (
          <div className="max-h-[250px] overflow-auto flex flex-col gap-2">
            {Object.entries(groupedMatches).map(([filePath, fileMatches]) => (
              <div key={filePath} className="border border-hairline rounded-lg overflow-hidden bg-black/15">
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/[0.01] border-b border-hairline text-[10.5px] font-mono text-text-2">
                  <File size={11} className="text-text-4" />
                  <span className="font-semibold text-text-1 truncate">{filePath.split("/").pop()}</span>
                  <span className="text-text-4 truncate max-w-[200px]">{filePath}</span>
                </div>

                <div className="flex flex-col">
                  {fileMatches.map((m, idx) => (
                    <div key={idx} className="flex gap-2 items-baseline px-2.5 py-1.5 hover:bg-white/[0.02] border-b border-hairline last:border-0 font-mono text-[11px]">
                      {m.LineNumber !== undefined && (
                        <span className="text-[10px] text-text-4 tabular-nums shrink-0 w-8 text-right select-none">{m.LineNumber}</span>
                      )}
                      <span className="text-text-3 whitespace-pre-wrap break-all flex-1 select-text">
                        {m.LineContent ? (
                          m.LineContent.trimStart().split(query).map((part, i, arr) => (
                            <span key={i}>
                              {part}
                              {i < arr.length - 1 && <span className="bg-accent/20 text-text-1 px-0.5 rounded font-semibold">{query}</span>}
                            </span>
                          ))
                        ) : (
                          <span className="italic text-text-4">No content snippet</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : !isJsonl && output.trim() ? (
          <pre className="p-2.5 bg-bg border border-hairline rounded-lg font-mono text-[11px] leading-relaxed max-h-[180px] overflow-auto text-text-2">
            {output}
          </pre>
        ) : (
          <div className="text-[11px] text-text-4 italic">No matches found.</div>
        )}
      </div>
    </div>
  );
}

// ── Todo View (Tailored) ───────────────────────────────────────────

function TodoView({ tc }: { tc: ToolCallEntry }) {
  const name = tc.toolName;

  const outputText = String(tc.output ?? "");

  let actionLabel = "Todo Task";
  let color = "text-text-2";
  if (name === "todo_create") { actionLabel = "Task Created"; color = "text-success"; }
  else if (name === "todo_update") { actionLabel = "Task Updated"; color = "text-accent"; }
  else if (name === "todo_delete") { actionLabel = "Task Deleted"; color = "text-error"; }
  else if (name === "todo_list") { actionLabel = "Todo List"; color = "text-info"; }
  else if (name === "todo_get") { actionLabel = "Task Retrieved"; color = "text-info"; }

  // Extract task board serialized state from comment markers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
  let boardTasks: any[] = [];
  const BOARD_MARKER = "<!-- TODO_BOARD";
  const BOARD_MARKER_END = "TODO_BOARD -->";
  const start = outputText.lastIndexOf(BOARD_MARKER);
  if (start !== -1) {
    const afterMarker = outputText.indexOf("\n", start + BOARD_MARKER.length);
    if (afterMarker !== -1) {
      const end = outputText.indexOf(BOARD_MARKER_END, afterMarker);
      if (end !== -1) {
        const json = outputText.slice(afterMarker + 1, end).trim();
        try {
          const raw = JSON.parse(json);
          if (raw && Array.isArray(raw.tasks)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
            boardTasks = raw.tasks.filter((t: any) => t.status !== "deleted");
          }
        } catch {}
      }
    }
  }

  const actionSummary = start !== -1 ? outputText.slice(0, start).trim() : outputText;

  return (
    <div className="mt-1.5 ml-4 rounded-xl border border-hairline bg-sunken overflow-hidden flex flex-col font-sans text-[11.5px] leading-relaxed shadow-lg">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-hairline bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <Sliders size={13} className="text-success" />
          <span className="font-semibold text-text-1">Workspace Tasks</span>
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-white/[0.03] border border-hairline ${color}`}>
          {actionLabel}
        </span>
      </div>

      <div className="p-3.5 bg-black/[0.15] flex flex-col gap-3">
        {actionSummary && name !== "todo_list" && (
          <div className="text-[11px] font-mono text-text-4 pb-2 border-b border-hairline">
            {actionSummary.split("\n\n")[0]}
          </div>
        )}

        {boardTasks.length > 0 ? (
          <div className="flex flex-col gap-1.5 max-h-[240px] overflow-auto">
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
            {boardTasks.map((t: any) => {
              const isCompleted = t.status === "completed";
              const isInProgress = t.status === "in_progress";
              const isBlocked = t.blockedBy && t.blockedBy.length > 0;

              return (
                <div key={t.id} className="flex items-center gap-2.5 p-2.5 bg-white/[0.02] border border-hairline rounded-lg hover:bg-white/[0.03] transition-all">
                  <span className={`w-4 h-4 rounded border transition-colors ${
                    isCompleted 
                      ? "border-success bg-success/15 text-success" 
                      : isInProgress 
                        ? "border-accent bg-accent/10 text-accent" 
                        : "border-white/20"
                  } flex items-center justify-center text-[10px] font-bold shrink-0`}>
                    {isCompleted && "✓"}
                    {isInProgress && "›"}
                  </span>
                  
                  <div className="flex-1 min-w-0">
                    <div className={`font-semibold text-[11.5px] truncate ${
                      isCompleted ? "text-text-4 line-through font-normal" : "text-text-2"
                    }`}>
                      {t.title}
                    </div>
                    {t.description && (
                      <div className="text-[10.5px] text-text-4 truncate mt-0.5">
                        {t.description}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isBlocked && !isCompleted && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-red-500/10 text-red-400 border border-red-500/10 rounded font-mono" title={`Blocked by: ${t.blockedBy.join(", ")}`}>
                        Blocked
                      </span>
                    )}
                    <span className="text-[9px] px-1.5 py-0.5 bg-white/[0.03] text-text-4 border border-hairline rounded font-mono select-all">
                      {t.id.slice(-8)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <pre className="p-2.5 bg-black/20 border border-hairline rounded-lg font-mono text-[11px] leading-relaxed max-h-[160px] overflow-auto text-text-2 select-text">
            {actionSummary}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Web Operation View (Tailored) ──────────────────────────────────

function WebOpView({ tc }: { tc: ToolCallEntry }) {
  const name = tc.toolName;
  const isSearch = name === "web_search" || name === "remote_web_search";
  const isScrape = name === "scrape_url";
  const query = getInputField(tc.input, "query") || getInputField(tc.input, "url") || "(unknown query)";
  const output = String(tc.output ?? "");

  return (
    <div className="mt-1.5 ml-4 rounded-xl border border-hairline bg-sunken overflow-hidden flex flex-col font-sans text-[11.5px] leading-relaxed shadow-lg">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-hairline bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <Globe size={13} className="text-info" />
          <span className="font-semibold text-text-1">
            {isSearch ? "Web Search" : isScrape ? "Web Scrape" : "Web Fetch"}
          </span>
        </div>
        <span className="text-[10px] text-accent font-mono truncate max-w-[200px] select-all">
          {query}
        </span>
      </div>

      <div className="p-3.5 bg-black/[0.15]">
        {isSearch ? (
          <WebSearchOutput output={output} />
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4 select-none">
              {isScrape ? "Scraped Page Content" : "Fetched Page Content"}
            </span>
            <div className="p-3.5 bg-black/20 border border-hairline rounded-lg max-h-[250px] overflow-auto select-text text-text-1">
              <MarkdownRenderer content={output} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Subagent View (Tailored) ───────────────────────────────────────

function SubagentView({ tc }: { tc: ToolCallEntry }) {
  const task = getInputField(tc.input, "task") || getInputField(tc.input, "name") || "subagent task";
  const output = String(tc.output ?? "");

  return (
    <div className="mt-1.5 ml-4 rounded-xl border border-hairline bg-sunken overflow-hidden flex flex-col font-sans text-[11.5px] leading-relaxed shadow-lg">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-hairline bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <Sliders size={13} className="text-accent" />
          <span className="font-semibold text-text-1">Agentic Loop</span>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4 rounded bg-white/[0.03] px-2 py-0.5 border border-hairline">
          Subagent
        </span>
      </div>

      <div className="p-3.5 bg-black/[0.15] flex flex-col gap-2">
        <div className="border border-hairline bg-white/[0.01] rounded-lg p-3">
          <div className="text-[10px] font-semibold text-text-4 uppercase tracking-wider mb-1">Assigned Task</div>
          <p className="text-[12px] font-medium text-text-1">{task}</p>
        </div>
        {output.trim() && (
          <div className="flex flex-col gap-1.5 mt-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4 select-none">Output / Status</span>
            <pre className="p-2.5 bg-black/20 border border-hairline rounded-lg font-mono text-[11px] max-h-[120px] overflow-auto text-text-2">
              {output}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Integrated Personalized Router ─────────────────────────────────

function PersonalizedToolPanel({ tc }: { tc: ToolCallEntry }) {
  const name = tc.toolName;

  if (name === "bash" || name === "exec_command") {
    return <TerminalView tc={tc} />;
  }

  if (
    name === "read_file" ||
    name === "view_file" ||
    name === "write_file" ||
    name === "edit_file" ||
    name === "str_replace" ||
    name === "diff_file" ||
    name === "multi_replace_file_content" ||
    name === "replace_file_content"
  ) {
    return <FileOperationView tc={tc} />;
  }

  if (
    name === "search_content" ||
    name === "grep_search" ||
    name === "file_search"
  ) {
    return <GrepResultsView tc={tc} />;
  }

  if (name.startsWith("todo_")) {
    return <TodoView tc={tc} />;
  }

  if (
    name === "web_search" ||
    name === "remote_web_search" ||
    name === "web_fetch" ||
    name === "scrape_url"
  ) {
    return <WebOpView tc={tc} />;
  }

  if (name === "spawn_subagent" || name === "load_skill") {
    return <SubagentView tc={tc} />;
  }

  if (name === "list_dir") {
    const path = getInputField(tc.input, "path") || ".";
    return (
      <div className="mt-1.5 ml-4 rounded-xl border border-hairline bg-sunken overflow-hidden flex flex-col font-sans text-[11.5px] leading-relaxed shadow-lg">
        <div className="flex items-center justify-between px-3.5 py-2 border-b border-hairline bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Folder size={13} className="text-accent" />
            <span className="font-semibold text-text-1">Directory Listing</span>
          </div>
          <span className="text-[10px] text-text-4 font-mono">{path}</span>
        </div>
        <div className="p-3 bg-black/[0.15]">
          <FileListOutput output={String(tc.output ?? "")} />
        </div>
      </div>
    );
  }

  const hasOutput = tc.output !== undefined;
  return (
    <div className="mt-1.5 ml-4 rounded-xl border border-hairline bg-sunken overflow-hidden flex flex-col shadow-lg">
      <div className="px-3.5 py-2.5 bg-white/[0.01] border-b border-hairline flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-4">
          <Sliders size={11} className="text-accent" strokeWidth={2} />
          Parameters
        </div>
        {tc.input && typeof tc.input === "object" ? (
          <JsonInspectorNode value={tc.input} depth={0} />
        ) : (
          <div className="text-[11.5px] font-mono text-text-2">{String(tc.input)}</div>
        )}
      </div>

      {hasOutput && (
        <div className="px-3.5 py-2.5 bg-black/[0.15] border-t border-hairline flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-4">
            <Terminal size={11} className="text-success" strokeWidth={2} />
            Result
          </div>
          <ToolOutput tc={tc} />
        </div>
      )}
    </div>
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
  const pres = presentTool(tc);
  const verb = isRunning || isPending ? pres.runningVerb : pres.doneVerb;
  const canExpand = (isDone || isError);
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
          <span className="shrink-0 self-center text-text-4 group-hover/tool:text-text-3 transition-colors">
            {pres.icon}
          </span>
          {isRunning ? (
            <Shimmer text={label} className="text-[13px] font-normal" />
          ) : (
            <span
              className={`truncate ${isError ? "text-error/70" : "text-text-3"} ${
                canExpand
                  ? "group-hover/tool:text-text-2 transition-colors"
                  : ""
              }`}
            >
              {label}
              {isError && <span className="text-error/60 ml-1">— failed</span>}
            </span>
          )}
          {pres.detail && !isRunning && (
            <span className="text-[12px] text-text-4 font-mono break-all line-clamp-1 shrink-0">
              {pres.detail}
            </span>
          )}
          {canExpand && (
            <ChevronDown
              size={11}
              strokeWidth={1.6}
              className={`shrink-0 self-center text-text-4 group-hover/tool:text-text-3 transition-all duration-200 ${
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
                className="shrink-0 rounded border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-[10.5px] font-medium text-accent"
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
            className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-accent hover:bg-accent/10 transition-colors"
            title="Open subagent workspace"
          >
            <ArrowUpRight size={11} strokeWidth={2} />
          </button>
        )}
      </div>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-[var(--d-short)] ease-[var(--ease-out)] ${
          expanded
            ? "grid-rows-[1fr] opacity-100 mt-2"
            : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className={`overflow-hidden min-h-0 ${expanded ? "motion-expand-content" : ""}`}>
          {children
            ? children
            : tc.subagentTranscript
              ? null
              : tc.toolName === "spawn_subagent"
                ? null
                : <PersonalizedToolPanel tc={tc} />}
        </div>
      </div>
    </div>
  );
}
