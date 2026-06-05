import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { streamText, stepCountIs } from "ai";
import {
  LayoutGrid,
  FileText,
  Code2,
  Play,
  Loader2,
  Square,
  Trash2,
  Eye,
  Pencil,
  Check,
  Copy,
  Sparkles,
  ArrowUp,
  Wand2,
} from "lucide-react";
import { useChatStore } from "../stores/chat";
import {
  createPanel,
  createCanvasMessage,
  nextPanelPosition,
  nextZ,
  buildCanvasSystemPrompt,
  createCanvasTools,
  type CanvasPanel,
  type CanvasPanelKind,
  type CanvasChatMessage,
  type CanvasToolDeps,
  type PanelLayout,
} from "../lib/canvas";
import type { LlmMessage } from "../lib/llm-types";
import { mapMessagesForProvider } from "../lib/agentLoop";
import { createModel } from "../lib/model-factory";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ModeToggle } from "./ModeToggle";

const MIN_W = 280;
const MIN_H = 168;
const RAIL_W = 360;
const MAX_TOOL_STEPS = 8;

/**
 * Canvas — a freeform board of draggable/resizable panels (prose docs +
 * runnable Python) with one AI assistant rail beside it. The assistant reads
 * every panel through buildCanvasSystemPrompt and edits any of them via the
 * createCanvasTools tool calls. All board state lives in the chat store
 * (canvasBoard) so it survives reloads; sanitizeBoard settles mid-stream
 * panels/messages on hydrate.
 */
export function NotebookView() {
  const board = useChatStore((s) => s.canvasBoard);

  // ── Board mutation helpers ────────────────────────────────────────────────
  // Each helper reads fresh store state so concurrent assistant tool edits and
  // direct user edits never clobber each other.
  const mutatePanels = useCallback(
    (map: (panels: CanvasPanel[]) => CanvasPanel[], persist = true) => {
      const current = useChatStore.getState().canvasBoard;
      useChatStore.getState().setCanvasBoard({ ...current, panels: map(current.panels) }, persist);
    },
    [],
  );

  const updatePanel = useCallback(
    (id: string, updates: Partial<CanvasPanel>, persist = true) => {
      mutatePanels(
        (panels) =>
          panels.map((p) => (p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p)),
        persist,
      );
    },
    [mutatePanels],
  );

  const setPanelLayout = useCallback(
    (id: string, layout: PanelLayout, persist = true) => {
      mutatePanels((panels) => panels.map((p) => (p.id === id ? { ...p, layout } : p)), persist);
    },
    [mutatePanels],
  );

  const addPanel = useCallback(
    (kind: CanvasPanelKind, title?: string, content = "") => {
      const current = useChatStore.getState().canvasBoard;
      const panel = createPanel(kind, {
        title,
        content,
        layout: nextPanelPosition(current, kind),
        z: nextZ(current),
      });
      useChatStore
        .getState()
        .setCanvasBoard({ ...current, panels: [...current.panels, panel] }, true);
      return panel.id;
    },
    [],
  );

  const removePanel = useCallback(
    (id: string) => {
      mutatePanels((panels) => panels.filter((p) => p.id !== id), true);
    },
    [mutatePanels],
  );

  const focusPanel = useCallback(
    (id: string) => {
      const current = useChatStore.getState().canvasBoard;
      const top = current.panels.reduce((max, p) => Math.max(max, p.z), 0);
      const panel = current.panels.find((p) => p.id === id);
      if (!panel || panel.z === top) return; // already on top — no churn
      mutatePanels((panels) => panels.map((p) => (p.id === id ? { ...p, z: top + 1 } : p)), false);
    },
    [mutatePanels],
  );

  const panelCount = board.panels.length;
  const boardBounds = useMemo(() => {
    let w = 0;
    let h = 0;
    for (const p of board.panels) {
      w = Math.max(w, p.layout.x + p.layout.w);
      h = Math.max(h, p.layout.y + p.layout.h);
    }
    return { w: w + 64, h: h + 64 };
  }, [board.panels]);

  // ── Code execution ────────────────────────────────────────────────────────
  const runPanel = useCallback(
    async (panel: CanvasPanel) => {
      if (panel.kind !== "code") return;
      if (!panel.content.trim()) {
        updatePanel(panel.id, { status: "error", output: "Panel is empty." });
        return;
      }
      updatePanel(panel.id, { status: "running", output: "" });
      try {
        const output = await invoke<string>("run_python", { code: panel.content });
        updatePanel(panel.id, { status: "done", output: output || "(no output)" });
      } catch (error) {
        updatePanel(panel.id, {
          status: "error",
          output: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [updatePanel],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg">
      <header className="shrink-0 border-b border-hairline bg-surface-1/40 px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-accent-soft border border-accent/20 flex items-center justify-center shrink-0">
              <LayoutGrid size={16} className="text-accent" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold text-text-1 leading-tight">Canvas</h1>
              <p className="text-[11.5px] text-text-3 tabular-nums">
                {panelCount === 0
                  ? "A board for documents and code, with an assistant"
                  : `${panelCount} panel${panelCount === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => addPanel("doc")}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-hairline bg-white/[0.02] hover:bg-white/[0.06] hover:border-hairline-strong text-text-2 hover:text-text-1 text-[12px] font-medium transition-colors"
              title="Add a prose document panel"
            >
              <FileText size={13} aria-hidden="true" />
              Doc
            </button>
            <button
              onClick={() => addPanel("code")}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-hairline bg-white/[0.02] hover:bg-white/[0.06] hover:border-hairline-strong text-text-2 hover:text-text-1 text-[12px] font-medium transition-colors"
              title="Add a runnable Python panel"
            >
              <Code2 size={13} aria-hidden="true" />
              Code
            </button>
            <div className="w-px h-5 bg-hairline mx-1" aria-hidden="true" />
            <ModeToggle />
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Freeform board */}
        <div className="relative flex-1 min-w-0 overflow-auto bg-bg">
          {panelCount === 0 ? (
            <BoardEmptyState onAdd={addPanel} />
          ) : (
            <div
              className="relative"
              style={{ width: boardBounds.w, height: boardBounds.h, minWidth: "100%", minHeight: "100%" }}
            >
              {board.panels.map((panel) => (
                <PanelCard
                  key={panel.id}
                  panel={panel}
                  onFocus={() => focusPanel(panel.id)}
                  onLayoutChange={(layout, persist) => setPanelLayout(panel.id, layout, persist)}
                  onChange={(content) => updatePanel(panel.id, { content })}
                  onTitleChange={(title) => updatePanel(panel.id, { title })}
                  onRun={() => runPanel(panel)}
                  onDelete={() => removePanel(panel.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Assistant rail */}
        <AssistantRail addPanel={addPanel} />
      </div>
    </div>
  );
}

function BoardEmptyState({ onAdd }: { onAdd: (kind: CanvasPanelKind) => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 animate-[fadeIn_320ms_var(--ease-out)]">
      <div className="w-14 h-14 rounded-2xl bg-accent-soft border border-accent/15 flex items-center justify-center mb-4">
        <LayoutGrid size={26} className="text-accent" aria-hidden="true" />
      </div>
      <h2 className="text-[18px] font-semibold text-text-1 mb-1.5">An open canvas</h2>
      <p className="text-[13px] text-text-3 max-w-[380px] mb-6 leading-relaxed">
        Drop documents and runnable code anywhere on the board, then ask the assistant
        on the right to draft, edit, or refactor any of them.
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => onAdd("doc")}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-hairline bg-white/[0.03] hover:bg-white/[0.07] hover:border-hairline-strong text-text-2 hover:text-text-1 text-[12.5px] font-medium transition-colors"
        >
          <FileText size={14} aria-hidden="true" />
          New document
        </button>
        <button
          onClick={() => onAdd("code")}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-hairline bg-white/[0.03] hover:bg-white/[0.07] hover:border-hairline-strong text-text-2 hover:text-text-1 text-[12.5px] font-medium transition-colors"
        >
          <Code2 size={14} aria-hidden="true" />
          New code file
        </button>
      </div>
    </div>
  );
}

// ── Panel card (draggable + resizable) ───────────────────────────────────────

interface PanelCardProps {
  panel: CanvasPanel;
  onFocus: () => void;
  onLayoutChange: (layout: PanelLayout, persist: boolean) => void;
  onChange: (content: string) => void;
  onTitleChange: (title: string) => void;
  onRun: () => void;
  onDelete: () => void;
}

function PanelCard({
  panel,
  onFocus,
  onLayoutChange,
  onChange,
  onTitleChange,
  onRun,
  onDelete,
}: PanelCardProps) {
  const isCode = panel.kind === "code";
  const running = panel.status === "running";
  const [editingTitle, setEditingTitle] = useState(false);
  const [preview, setPreview] = useState(() => !isCode && panel.content.trim().length > 0);
  const [copied, setCopied] = useState(false);

  // Live layout while dragging/resizing; committed (persisted) on pointer up so
  // we don't write to localStorage on every pointermove frame.
  const [draft, setDraft] = useState<PanelLayout | null>(null);
  const layout = draft ?? panel.layout;
  const gesture = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    origin: PanelLayout;
  } | null>(null);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (g.mode === "move") {
      setDraft({
        ...g.origin,
        x: Math.max(0, g.origin.x + dx),
        y: Math.max(0, g.origin.y + dy),
      });
    } else {
      setDraft({
        ...g.origin,
        w: Math.max(MIN_W, g.origin.w + dx),
        h: Math.max(MIN_H, g.origin.h + dy),
      });
    }
  }, []);

  const endGesture = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endGesture);
    setDraft((d) => {
      if (d && g) onLayoutChange(d, true); // commit + persist
      return null;
    });
  }, [onPointerMove, onLayoutChange]);

  const beginGesture = useCallback(
    (mode: "move" | "resize", e: React.PointerEvent) => {
      e.preventDefault();
      onFocus();
      gesture.current = { mode, startX: e.clientX, startY: e.clientY, origin: panel.layout };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", endGesture);
    },
    [panel.layout, onFocus, onPointerMove, endGesture],
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endGesture);
    };
  }, [onPointerMove, endGesture]);

  const copyOutput = useCallback(() => {
    if (!panel.output) return;
    navigator.clipboard.writeText(panel.output).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }, [panel.output]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isCode && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!running) onRun();
      }
    },
    [isCode, running, onRun],
  );

  const Icon = isCode ? Code2 : FileText;

  return (
    <div
      className="absolute flex flex-col rounded-xl border border-hairline bg-surface-3 shadow-[0_18px_44px_-28px_rgba(0,0,0,0.85)] overflow-hidden focus-within:border-hairline-strong"
      style={{ left: layout.x, top: layout.y, width: layout.w, height: layout.h, zIndex: panel.z }}
      onPointerDown={onFocus}
    >
      {/* Header — drag handle */}
      <div
        className="flex items-center justify-between gap-2 border-b border-hairline px-2.5 py-1.5 bg-white/[0.02] cursor-grab active:cursor-grabbing select-none"
        onPointerDown={(e) => {
          // Ignore drags that start on an interactive control in the header.
          if ((e.target as HTMLElement).closest("button,input")) return;
          beginGesture("move", e);
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={13} className="text-text-3 shrink-0" aria-hidden="true" />
          {editingTitle ? (
            <input
              autoFocus
              defaultValue={panel.title}
              onBlur={(e) => {
                onTitleChange(e.target.value.trim() || panel.title);
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              className="min-w-0 flex-1 bg-surface-1 border border-hairline-strong rounded px-1.5 py-0.5 text-[12px] text-text-1 focus:outline-none"
            />
          ) : (
            <button
              onClick={() => setEditingTitle(true)}
              className="truncate text-[12px] font-medium text-text-1 hover:text-accent transition-colors"
              title="Rename panel"
            >
              {panel.title}
            </button>
          )}
          {isCode && <StatusBadge status={panel.status} />}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {isCode ? (
            running ? (
              <IconBtn title="Running" disabled>
                <Loader2 size={13} className="animate-spin" />
              </IconBtn>
            ) : (
              <IconBtn onClick={onRun} title="Run  (⌘↵)" tone="accent">
                <Play size={13} />
              </IconBtn>
            )
          ) : (
            <IconBtn
              onClick={() => setPreview((p) => !p)}
              title={preview ? "Edit" : "Preview"}
              tone={preview ? "accent" : "default"}
            >
              {preview ? <Pencil size={13} /> : <Eye size={13} />}
            </IconBtn>
          )}
          <IconBtn onClick={onDelete} title="Delete panel" tone="error">
            <Trash2 size={13} />
          </IconBtn>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col">
        {!isCode && preview ? (
          <div className="selectable flex-1 overflow-auto px-4 py-3 text-[13px]">
            {panel.content.trim() ? (
              <MarkdownRenderer content={panel.content} />
            ) : (
              <p className="text-text-4 italic">Empty document. Switch to edit to write, or ask the assistant.</p>
            )}
          </div>
        ) : (
          <textarea
            value={panel.content}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isCode ? "# Python — print(...) to see output" : "Write in Markdown…"
            }
            spellCheck={!isCode}
            className={`selectable flex-1 min-h-0 w-full resize-none bg-transparent border-0 px-4 py-3 text-[13px] leading-relaxed text-text-1 placeholder:text-text-4 focus:outline-none ${
              isCode ? "font-mono" : "font-sans"
            }`}
          />
        )}

        {/* Code output */}
        {isCode && panel.output !== undefined && panel.output !== "" && (
          <div className="shrink-0 max-h-[45%] overflow-auto border-t border-hairline bg-sunken/60">
            <div className="flex items-center justify-between px-3 pt-2 pb-1 sticky top-0 bg-sunken/95">
              <span className="text-[10px] font-medium uppercase tracking-wide text-text-4">
                Output
              </span>
              <button
                onClick={copyOutput}
                className="flex items-center gap-1 text-[10.5px] text-text-4 hover:text-text-2 transition-colors"
                title="Copy output"
              >
                {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre
              className={`selectable px-3 pb-3 text-[12px] font-mono whitespace-pre-wrap leading-relaxed ${
                panel.status === "error" ? "text-error" : "text-text-2"
              }`}
            >
              {panel.output}
            </pre>
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        onPointerDown={(e) => beginGesture("resize", e)}
        title="Resize"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          className="absolute bottom-0.5 right-0.5 text-text-4/60 pointer-events-none"
          aria-hidden="true"
        >
          <path d="M11 15L15 11M6 15L15 6" stroke="currentColor" strokeWidth="1.25" fill="none" />
        </svg>
      </div>
    </div>
  );
}

// ── Assistant rail ────────────────────────────────────────────────────────

function AssistantRail({
  addPanel,
}: {
  addPanel: (kind: CanvasPanelKind, title?: string, content?: string) => string;
}) {
  const chat = useChatStore((s) => s.canvasBoard.chat);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  // Persist a chat-message array onto the board (panels untouched). persist=false
  // for mid-stream token updates; sanitizeBoard settles streaming flags on reload.
  const writeChat = useCallback(
    (map: (msgs: CanvasChatMessage[]) => CanvasChatMessage[], persist: boolean) => {
      const current = useChatStore.getState().canvasBoard;
      useChatStore.getState().setCanvasBoard({ ...current, chat: map(current.chat) }, persist);
    },
    [],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;

    const cfg = useChatStore.getState().getActiveLlmConfig();
    if (!cfg) {
      setError("No model selected. Pick one in the top bar.");
      return;
    }

    setError(null);
    setInput("");
    setBusy(true);

    const userMsg = createCanvasMessage("user", text);
    const assistantMsg: CanvasChatMessage = { ...createCanvasMessage("assistant", ""), streaming: true };
    writeChat((msgs) => [...msgs, userMsg, assistantMsg], true);

    // Build provider messages from the prior thread plus this turn. The board
    // contents ride along in the system prompt, not the message history.
    const priorThread = useChatStore.getState().canvasBoard.chat.filter(
      (m) => m.id !== assistantMsg.id && m.content.trim().length > 0,
    );
    const llmMessages: LlmMessage[] = priorThread.map((m) => ({ role: m.role, content: m.content }));

    const edits: string[] = [];
    const deps: CanvasToolDeps = {
      getBoard: () => useChatStore.getState().canvasBoard,
      setPanelContent: (panelId, content) => {
        const current = useChatStore.getState().canvasBoard;
        useChatStore.getState().setCanvasBoard(
          {
            ...current,
            panels: current.panels.map((p) =>
              p.id === panelId ? { ...p, content, updatedAt: Date.now() } : p,
            ),
          },
          true,
        );
      },
      addPanel: (kind, title, content) => addPanel(kind, title, content),
      recordEdit: (summary) => {
        edits.push(summary);
        writeChat(
          (msgs) => msgs.map((m) => (m.id === assistantMsg.id ? { ...m, edits: [...edits] } : m)),
          false,
        );
      },
    };

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const model = await createModel(cfg);
      const board = useChatStore.getState().canvasBoard;
      const result = streamText({
        model,
        system: buildCanvasSystemPrompt(board),
        messages: mapMessagesForProvider(llmMessages),
        tools: createCanvasTools(deps),
        toolChoice: "auto",
        stopWhen: stepCountIs(MAX_TOOL_STEPS),
        abortSignal: controller.signal,
      });

      let acc = "";
      for await (const chunk of result.fullStream) {
        if (chunk.type === "text-delta") {
          acc += chunk.text;
          // Mid-stream: in-memory only (persist=false) to spare localStorage.
          writeChat(
            (msgs) => msgs.map((m) => (m.id === assistantMsg.id ? { ...m, content: acc } : m)),
            false,
          );
        } else if (chunk.type === "error") {
          throw chunk.error instanceof Error ? chunk.error : new Error(String(chunk.error));
        }
      }

      const finalText = acc.trim() || (edits.length ? "Done." : "(no response)");
      writeChat(
        (msgs) =>
          msgs.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: finalText, edits: [...edits], streaming: false } : m,
          ),
        true,
      );
    } catch (err) {
      const aborted = controller.signal.aborted || (err instanceof Error && /abort/i.test(err.message));
      writeChat(
        (msgs) =>
          msgs.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  streaming: false,
                  content: m.content || (aborted ? "_Stopped._" : ""),
                  edits: [...edits],
                }
              : m,
          ),
        true,
      );
      if (!aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [input, busy, addPanel, writeChat]);

  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  return (
    <aside
      className="shrink-0 flex flex-col min-h-0 border-l border-hairline bg-surface-1/40"
      style={{ width: RAIL_W }}
    >
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-hairline">
        <Sparkles size={14} className="text-accent" aria-hidden="true" />
        <span className="text-[13px] font-semibold text-text-1">Assistant</span>
        <span className="text-[11px] text-text-3">reads &amp; edits every panel</span>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {chat.length === 0 ? (
          <RailEmptyState />
        ) : (
          chat.map((m) => <RailMessage key={m.id} message={m} />)
        )}
        {error && (
          <div className="rounded-lg border border-error/30 bg-error/[0.08] px-3 py-2 text-[12px] text-error">
            {error}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-hairline p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-hairline bg-surface-2 px-3 py-2 focus-within:border-hairline-strong focus-within:shadow-[0_0_0_3px_var(--accent-soft)] transition-[border-color,box-shadow]">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            rows={1}
            placeholder="Ask to draft, edit, or refactor a panel…"
            className="selectable flex-1 min-h-[24px] max-h-[160px] resize-none bg-transparent border-0 text-[14px] leading-relaxed text-text-1 placeholder:text-text-4 focus:outline-none"
          />
          {busy ? (
            <button
              onClick={stop}
              aria-label="Stop"
              title="Stop"
              className="shrink-0 w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-text-2 flex items-center justify-center transition-colors"
            >
              <Square size={13} className="fill-current" />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim()}
              aria-label="Send"
              title="Send"
              className="shrink-0 w-8 h-8 rounded-full bg-accent text-bg flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors"
            >
              <ArrowUp size={16} strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

function RailEmptyState() {
  return (
    <div className="flex flex-col items-center text-center gap-3 pt-6 animate-[fadeIn_320ms_var(--ease-out)]">
      <div className="w-11 h-11 rounded-xl bg-accent-soft border border-accent/15 flex items-center justify-center">
        <Wand2 size={20} className="text-accent" aria-hidden="true" />
      </div>
      <p className="text-[13px] text-text-2 leading-relaxed max-w-[260px]">
        I can see every panel on the board. Ask me to write a draft, tighten the wording,
        fix a bug, or spin up a new doc or script.
      </p>
    </div>
  );
}

function RailMessage({ message }: { message: CanvasChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="self-end max-w-[88%] rounded-2xl rounded-br-md bg-surface-2 border border-hairline px-3 py-2 text-[13px] text-text-1 whitespace-pre-wrap leading-relaxed">
        {message.content}
      </div>
    );
  }
  return (
    <div className="self-start w-full">
      {message.content && (
        <div className="text-[13px] text-text-1 leading-relaxed selectable">
          <MarkdownRenderer content={message.content} isStreaming={message.streaming} />
        </div>
      )}
      {message.streaming && !message.content && (
        <span className="streaming-cursor" />
      )}
      {message.edits && message.edits.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.edits.map((edit, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md border border-accent/25 bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent"
            >
              <Pencil size={10} aria-hidden="true" />
              {edit}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CanvasPanel["status"] }) {
  if (status === "running") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-accent">
        <Loader2 size={10} className="animate-spin" aria-hidden="true" />
        Running
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-success">
        <Check size={10} aria-hidden="true" />
        Done
      </span>
    );
  }
  if (status === "error") {
    return <span className="text-[10px] font-medium text-error">Error</span>;
  }
  return null;
}

function IconBtn({
  children,
  onClick,
  disabled,
  title,
  tone = "default",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title: string;
  tone?: "default" | "accent" | "error";
}) {
  const hover =
    tone === "accent" ? "hover:text-accent" : tone === "error" ? "hover:text-error" : "hover:text-text-1";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`p-1.5 rounded-md text-text-4 ${hover} hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors`}
    >
      {children}
    </button>
  );
}
