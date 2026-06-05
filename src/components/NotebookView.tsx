import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Notebook as NotebookIcon,
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
  Plus,
  FilePlus2,
  PenLine,
  Replace,
  ListPlus,
  Type,
  AlertCircle,
} from "lucide-react";
import { useChatStore } from "../stores/chat";
import {
  createBoard,
  createPanel,
  createCanvasMessage,
  nextPanelPosition,
  nextZ,
  buildNotebookSystemPrompt,
  createNotebookTools,
  deriveCanvasAction,
  resolveActionResult,
  type CanvasAction,
  type CanvasActionKind,
  type CanvasPanel,
  type CanvasPanelKind,
  type CanvasChatMessage,
  type NotebookToolDeps,
  type PanelLayout,
} from "../lib/canvas";
import type { LlmMessage } from "../lib/llm-types";
import { agentLoop } from "../lib/agentLoop";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ModeToggle } from "./ModeToggle";
import { ModelPicker } from "./ModelPicker";

const MIN_W = 280;
const MIN_H = 168;
const RAIL_W = 320;
/** Max tool/step rounds for one notebook turn (single-call agent-loop path). */
const MAX_NOTEBOOK_ROUNDS = 16;

/**
 * NotebookView — a freeform board of draggable/resizable panels (prose docs +
 * runnable Python) with one AI assistant rail beside it, scoped to the active
 * notebook. The assistant runs on the shared agent harness (agentLoop): panels
 * are exposed as editable documents through createNotebookTools (list/read/
 * create/write/edit/append/rename), so it reads large panels on demand and
 * edits existing ones in place. All board state lives
 * inside the active notebook in the chat store (notebooks / activeNotebookId)
 * and is routed through getActiveNotebook() + setActiveNotebookContents(), so it
 * survives reloads; sanitizeNotebooks settles mid-stream panels/messages on
 * hydrate. With no notebooks at all, a full-pane empty state invites creating
 * the first one.
 */
export function NotebookView({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const activeNotebook = useChatStore((s) => s.getActiveNotebook());
  const createNotebook = useChatStore((s) => s.createNotebook);

  // ── Board mutation helpers ────────────────────────────────────────────────
  // Each helper reads the freshest active notebook so concurrent assistant tool
  // edits and direct user edits never clobber each other. They no-op when there
  // is no active notebook (e.g. it was just deleted mid-gesture).
  const mutatePanels = useCallback(
    (map: (panels: CanvasPanel[]) => CanvasPanel[], persist = true) => {
      const nb = useChatStore.getState().getActiveNotebook();
      if (!nb) return;
      useChatStore
        .getState()
        .setActiveNotebookContents({ panels: map(nb.panels), chat: nb.chat }, persist);
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
      const nb = useChatStore.getState().getActiveNotebook();
      if (!nb) return "";
      const panel = createPanel(kind, {
        title,
        content,
        layout: nextPanelPosition(nb, kind),
        z: nextZ(nb),
      });
      useChatStore
        .getState()
        .setActiveNotebookContents({ panels: [...nb.panels, panel], chat: nb.chat }, true);
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
      const nb = useChatStore.getState().getActiveNotebook();
      if (!nb) return;
      const top = nb.panels.reduce((max, p) => Math.max(max, p.z), 0);
      const panel = nb.panels.find((p) => p.id === id);
      if (!panel || panel.z === top) return; // already on top — no churn
      mutatePanels((panels) => panels.map((p) => (p.id === id ? { ...p, z: top + 1 } : p)), false);
    },
    [mutatePanels],
  );

  const panels = activeNotebook?.panels ?? [];
  const panelCount = panels.length;
  const boardBounds = useMemo(() => {
    let w = 0;
    let h = 0;
    for (const p of panels) {
      w = Math.max(w, p.layout.x + p.layout.w);
      h = Math.max(h, p.layout.y + p.layout.h);
    }
    // Trailing slack: keep it tight on the x-axis so the board doesn't show a
    // horizontal scrollbar unless a panel genuinely sits past the viewport;
    // a touch more on the y-axis where vertical scroll is expected.
    return { w: w + 24, h: h + 48 };
  }, [panels]);

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
              <NotebookIcon size={16} className="text-accent" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold text-text-1 leading-tight truncate">
                {activeNotebook ? activeNotebook.name : "Notebook"}
              </h1>
              <p className="text-[11.5px] text-text-3 tabular-nums">
                {!activeNotebook
                  ? "No notebook selected"
                  : panelCount === 0
                    ? "A board for documents and code, with an assistant"
                    : `${panelCount} panel${panelCount === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {activeNotebook && (
              <>
                <button
                  onClick={() => addPanel("doc")}
                  className="control-pill flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium"
                  title="Add a prose document panel"
                >
                  <FileText size={13} aria-hidden="true" />
                  Doc
                </button>
                <button
                  onClick={() => addPanel("code")}
                  className="control-pill flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium"
                  title="Add a runnable Python panel"
                >
                  <Code2 size={13} aria-hidden="true" />
                  Code
                </button>
                <div className="w-px h-5 bg-hairline mx-1" aria-hidden="true" />
              </>
            )}
            <ModeToggle />
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {activeNotebook ? (
          <>
            {/* Freeform board */}
            <div className="notebook-board relative flex-1 min-w-0 overflow-auto">
              {panelCount === 0 ? (
                <BoardEmptyState onAdd={addPanel} />
              ) : (
                <div
                  className="relative"
                  style={{
                    width: boardBounds.w,
                    height: boardBounds.h,
                    minWidth: "100%",
                    minHeight: "100%",
                  }}
                >
                  {panels.map((panel) => (
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
            <AssistantRail addPanel={addPanel} onOpenSettings={onOpenSettings} />
          </>
        ) : (
          <NoNotebooksEmptyState onCreate={() => createNotebook()} />
        )}
      </div>
    </div>
  );
}

function NoNotebooksEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 animate-[fadeIn_320ms_var(--ease-out)]">
      <div className="w-14 h-14 rounded-2xl bg-accent-soft border border-accent/15 flex items-center justify-center mb-4">
        <NotebookIcon size={26} className="text-accent" aria-hidden="true" />
      </div>
      <h2 className="text-[18px] font-semibold text-text-1 mb-1.5">No notebooks yet</h2>
      <p className="text-[13px] text-text-3 max-w-[400px] mb-6 leading-relaxed">
        A notebook is a freeform board of documents and runnable code with an assistant
        that can read and edit every panel. Create one to get started.
      </p>
      <button
        onClick={onCreate}
        className="primary-action flex items-center gap-1.5 px-4 py-2 rounded-md text-[12.5px] font-semibold"
      >
        <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
        Create your first notebook
      </button>
    </div>
  );
}

function BoardEmptyState({ onAdd }: { onAdd: (kind: CanvasPanelKind) => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 animate-[fadeIn_320ms_var(--ease-out)]">
      <div className="w-14 h-14 rounded-2xl bg-accent-soft border border-accent/15 flex items-center justify-center mb-4">
        <NotebookIcon size={26} className="text-accent" aria-hidden="true" />
      </div>
      <h2 className="text-[18px] font-semibold text-text-1 mb-1.5">This notebook is empty</h2>
      <p className="text-[13px] text-text-3 max-w-[380px] mb-6 leading-relaxed">
        Drop documents and runnable code anywhere on the board, then ask the assistant
        on the right to draft, edit, or refactor any of them.
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => onAdd("doc")}
          className="control-pill flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[12.5px] font-medium"
        >
          <FileText size={14} aria-hidden="true" />
          New document
        </button>
        <button
          onClick={() => onAdd("code")}
          className="control-pill flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[12.5px] font-medium"
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

  // Keep the latest commit callback in a ref so the window listeners below can
  // be attached ONCE for the panel's lifetime. Re-binding them per render races
  // with the onFocus() re-render inside beginGesture: the effect cleanup would
  // remove the very pointermove/pointerup listeners we just attached, silently
  // dropping the in-flight drag — which is why panels wouldn't move.
  const commitLayout = useRef(onLayoutChange);
  commitLayout.current = onLayoutChange;

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
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
    };
    const handleUp = () => {
      if (!gesture.current) return;
      gesture.current = null;
      setDraft((d) => {
        if (d) commitLayout.current(d, true); // commit + persist
        return null;
      });
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, []);

  const beginGesture = useCallback(
    (mode: "move" | "resize", e: React.PointerEvent) => {
      e.preventDefault();
      onFocus();
      gesture.current = { mode, startX: e.clientX, startY: e.clientY, origin: panel.layout };
    },
    [onFocus, panel.layout],
  );

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
      className="notebook-panel absolute flex flex-col rounded-xl overflow-hidden"
      style={{ left: layout.x, top: layout.y, width: layout.w, height: layout.h, zIndex: panel.z }}
      onPointerDown={onFocus}
    >
      {/* Header — drag handle */}
      <div
        className="notebook-panel__header flex items-center justify-between gap-2 border-b border-hairline px-2.5 py-2 cursor-grab active:cursor-grabbing select-none"
        onPointerDown={(e) => {
          // Ignore drags that start on an interactive control in the header.
          if ((e.target as HTMLElement).closest("button,input")) return;
          beginGesture("move", e);
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0 group/title">
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
            <>
              {/* Plain span (not a button) so the header body stays draggable —
                  the drag handler's closest("button,input") guard would cancel a
                  drag started on a button. Rename via double-click or the pencil. */}
              <span
                onDoubleClick={() => setEditingTitle(true)}
                className="truncate text-[12px] font-medium text-text-1 select-none"
                title="Double-click to rename"
              >
                {panel.title}
              </span>
              <button
                onClick={() => setEditingTitle(true)}
                className="shrink-0 p-0.5 rounded text-text-4 hover:text-accent opacity-0 group-hover/title:opacity-100 focus-visible:opacity-100 transition-[color,opacity]"
                aria-label="Rename panel"
                title="Rename panel"
              >
                <Pencil size={11} aria-hidden="true" />
              </button>
            </>
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
        className="group/resize absolute bottom-0 right-0 w-5 h-5 cursor-se-resize"
        onPointerDown={(e) => beginGesture("resize", e)}
        title="Resize"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          className="absolute bottom-0.5 right-0.5 text-text-4 group-hover/resize:text-accent transition-colors pointer-events-none"
          aria-hidden="true"
        >
          <path d="M11 15L15 11M6 15L15 6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

// ── Assistant rail ────────────────────────────────────────────────────────

function AssistantRail({
  addPanel,
  onOpenSettings,
}: {
  addPanel: (kind: CanvasPanelKind, title?: string, content?: string) => string;
  onOpenSettings?: () => void;
}) {
  const chat = useChatStore((s) => s.getActiveNotebook()?.chat ?? []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow the composer with its content up to a ceiling, then scroll. Mirrors
  // the main InputBar so the rail input doesn't feel cramped at one line.
  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [input, adjustHeight]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  // Persist a chat-message array onto the active notebook (panels untouched).
  // persist=false for mid-stream token updates; sanitizeNotebooks settles
  // streaming flags on reload. No-op if the active notebook was just deleted.
  const writeChat = useCallback(
    (map: (msgs: CanvasChatMessage[]) => CanvasChatMessage[], persist: boolean) => {
      const nb = useChatStore.getState().getActiveNotebook();
      if (!nb) return;
      useChatStore
        .getState()
        .setActiveNotebookContents({ panels: nb.panels, chat: map(nb.chat) }, persist);
    },
    [],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;

    const cfg = useChatStore.getState().getActiveLlmConfig();
    if (!cfg) {
      setError("No model selected. Pick one from the model menu below.");
      return;
    }
    const activeNb = useChatStore.getState().getActiveNotebook();
    if (!activeNb) return;

    setError(null);
    setInput("");
    setBusy(true);

    const userMsg = createCanvasMessage("user", text);
    const assistantMsg: CanvasChatMessage = { ...createCanvasMessage("assistant", ""), streaming: true };
    writeChat((msgs) => [...msgs, userMsg, assistantMsg], true);

    // Prior thread → provider messages. The board rides in the system prompt
    // (small panels inline, large ones as previews the model can read on demand).
    const priorThread = (useChatStore.getState().getActiveNotebook()?.chat ?? []).filter(
      (m) => m.id !== assistantMsg.id && m.content.trim().length > 0,
    );
    const llmMessages: LlmMessage[] = priorThread.map((m) => ({ role: m.role, content: m.content }));

    // Store-backed tool deps — panels are the "files" the agent edits. No disk,
    // no approval gate (like the artifact editor); edits flow straight to the board.
    const updatePanelField = (panelId: string, patch: Partial<CanvasPanel>) => {
      const nb = useChatStore.getState().getActiveNotebook();
      if (!nb) return;
      useChatStore.getState().setActiveNotebookContents(
        {
          panels: nb.panels.map((p) =>
            p.id === panelId ? { ...p, ...patch, updatedAt: Date.now() } : p,
          ),
          chat: nb.chat,
        },
        true,
      );
    };
    const deps: NotebookToolDeps = {
      getBoard: () => useChatStore.getState().getActiveNotebook() ?? createBoard(),
      createPanel: (kind, title, content) => addPanel(kind, title, content),
      setPanelContent: (panelId, content) => updatePanelField(panelId, { content }),
      setPanelTitle: (panelId, title) => updatePanelField(panelId, { title }),
    };

    // Live, structured feedback. Each tool call becomes a row that shows
    // "running" the moment the model invokes it, then flips to done/error when
    // its result streams back. Keyed by toolCallId.
    let acc = "";
    const actions: CanvasAction[] = [];
    const writeContent = (persist: boolean) =>
      writeChat(
        (msgs) => msgs.map((m) => (m.id === assistantMsg.id ? { ...m, content: acc } : m)),
        persist,
      );
    const pushActions = () =>
      writeChat(
        (msgs) => msgs.map((m) => (m.id === assistantMsg.id ? { ...m, actions: [...actions] } : m)),
        false,
      );

    const controller = new AbortController();
    abortRef.current = controller;

    let finished = false;
    const finalize = (content: string) => {
      if (finished) return;
      finished = true;
      const settled = actions.map((a) => (a.status === "running" ? { ...a, status: "done" as const } : a));
      const wasAborted = controller.signal.aborted;
      const finalText =
        content.trim() || (settled.length ? "" : wasAborted ? "_Stopped._" : "(no response)");
      writeChat(
        (msgs) =>
          msgs.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: finalText, actions: settled, streaming: false }
              : m,
          ),
        true,
      );
    };

    try {
      const board = useChatStore.getState().getActiveNotebook() ?? createBoard();
      await agentLoop(
        llmMessages,
        buildNotebookSystemPrompt(board),
        cfg,
        {
          onToken: (token) => {
            acc += token;
            writeContent(false); // in-memory; spare localStorage mid-stream
          },
          onToolCall: (tc) => {
            const boardNow = useChatStore.getState().getActiveNotebook() ?? createBoard();
            const derived = deriveCanvasAction(
              tc.toolName,
              (tc.input as Record<string, unknown>) ?? {},
              boardNow,
            );
            if (derived) {
              actions.push({ id: tc.toolCallId, status: "running", ...derived });
              pushActions();
            }
          },
          onToolResult: (tr) => {
            const i = actions.findIndex((a) => a.id === tr.toolCallId);
            if (i === -1) return;
            const action = actions[i];
            if (action.kind === "read") {
              // read_panel returns content, not a status marker — settle here.
              const failed = typeof tr.output === "string" && /^no panel/i.test(tr.output);
              actions[i] = { ...action, status: failed ? "error" : "done" };
            } else {
              const { status, detail } = resolveActionResult(tr.output);
              actions[i] = { ...action, status, detail };
            }
            pushActions();
          },
          onToolError: (te) => {
            const i = actions.findIndex((a) => a.id === te.toolCallId);
            if (i !== -1) {
              actions[i] = { ...actions[i], status: "error", detail: "Tool failed" };
              pushActions();
            }
          },
          onDone: (fullText, summary) => finalize(fullText || acc || summary || ""),
          onError: (err) => {
            finalize(acc);
            setError(err instanceof Error ? err.message : String(err));
          },
        },
        {
          abortSignal: controller.signal,
          tools: createNotebookTools(deps),
          subagentsEnabled: false,
          maxToolRounds: MAX_NOTEBOOK_ROUNDS,
          sessionId: activeNb.id,
          depth: 0,
        },
      );
      // agentLoop resolves after its terminal callback; ensure we settle even if
      // it returned without one (defensive).
      finalize(acc);
    } catch (err) {
      const aborted = controller.signal.aborted || (err instanceof Error && /abort/i.test(err.message));
      finalize(acc);
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
      className="notebook-rail shrink-0 flex flex-col min-h-0"
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
        <div className="composer-surface flex flex-col gap-2 rounded-2xl px-3 py-2.5 transition-[border-color,box-shadow] focus-within:border-hairline-strong">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            rows={1}
            placeholder="Ask to draft, edit, or refactor a panel…"
            className="selectable w-full min-h-[44px] resize-none bg-transparent border-0 text-[14px] leading-relaxed text-text-1 placeholder:text-text-4 focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2">
            <ModelPicker onOpenSettings={onOpenSettings} />
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
  const hasActions = !!message.actions && message.actions.length > 0;
  return (
    <div className="self-start w-full">
      {message.content && (
        <div className="text-[13px] text-text-1 leading-relaxed selectable">
          <MarkdownRenderer content={message.content} isStreaming={message.streaming} />
        </div>
      )}
      {message.streaming && !message.content && !hasActions && (
        <span className="streaming-cursor" />
      )}
      {hasActions && (
        <div className={`flex flex-col gap-1.5 ${message.content ? "mt-2.5" : ""}`}>
          {message.actions!.map((action) => (
            <ActionRow key={action.id} action={action} />
          ))}
        </div>
      )}
      {/* Legacy plain-text edit chips (messages saved before structured actions). */}
      {!hasActions && message.edits && message.edits.length > 0 && (
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

const ACTION_META: Record<
  CanvasActionKind,
  { Icon: typeof FilePlus2; running: string; done: string; error: string }
> = {
  create: { Icon: FilePlus2, running: "Creating", done: "Created", error: "Couldn't create" },
  rewrite: { Icon: PenLine, running: "Rewriting", done: "Rewrote", error: "Couldn't rewrite" },
  replace: { Icon: Replace, running: "Editing", done: "Edited", error: "Couldn't edit" },
  append: { Icon: ListPlus, running: "Appending to", done: "Appended to", error: "Couldn't append to" },
  rename: { Icon: Type, running: "Renaming", done: "Renamed", error: "Couldn't rename" },
  read: { Icon: Eye, running: "Reading", done: "Read", error: "Couldn't read" },
};

function ActionRow({ action }: { action: CanvasAction }) {
  const meta = ACTION_META[action.kind];
  const Icon = meta.Icon;
  const running = action.status === "running";
  const errored = action.status === "error";
  const verb = running ? meta.running : errored ? meta.error : meta.done;

  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 transition-colors animate-[fadeIn_200ms_var(--ease-out)] ${
        errored ? "border-error/25 bg-error/[0.06]" : "border-hairline bg-white/[0.025]"
      }`}
    >
      <div
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
          errored
            ? "bg-error/10 text-error"
            : running
              ? "bg-accent-soft text-accent"
              : "bg-white/[0.05] text-text-2"
        }`}
      >
        <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
      </div>

      <div className="min-w-0 flex-1 leading-tight">
        <span className="text-[12px] text-text-3">{verb} </span>
        <span className="text-[12px] font-medium text-text-1 break-words">{action.title}</span>
        {action.detail && !running && (
          <span className="ml-1 text-[11px] text-text-4 tabular-nums">· {action.detail}</span>
        )}
      </div>

      <div className="shrink-0">
        {running ? (
          <Loader2 size={13} className="animate-spin text-accent" aria-label="Working" />
        ) : errored ? (
          <AlertCircle size={13} className="text-error" aria-label="Failed" />
        ) : (
          <Check size={13} className="text-success" aria-label="Done" />
        )}
      </div>
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
