import { tool } from "ai";
import { z } from "zod";

/**
 * Canvas — a freeform document work area. A "board" holds multiple panels the
 * user can drag and resize: prose documents, code files, and runnable cells.
 * One AI assistant sits beside the board and can read every panel and edit any
 * of them (or spin up new ones) through tool calls. This module is the data
 * model plus the assistant's editing tools, kept pure and testable.
 */

export type CanvasPanelKind = "doc" | "code";

export interface PanelLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanvasPanel {
  id: string;
  kind: CanvasPanelKind;
  title: string;
  content: string;
  layout: PanelLayout;
  /** Code panels only: last run state. Runtime-flavored but persisted. */
  status: "idle" | "running" | "done" | "error";
  output?: string;
  /** Monotonic z-order; the focused panel floats above the rest. */
  z: number;
  updatedAt: number;
}

export type CanvasChatRole = "user" | "assistant";

/**
 * A single edit the assistant performed during a turn, surfaced live in the
 * rail as a status row (running → done/error). Captured from the tool-call /
 * tool-result stream so the user sees exactly what's happening and to which
 * panel, by title.
 */
export type CanvasActionKind = "create" | "rewrite" | "replace" | "append" | "rename" | "read";

export interface CanvasAction {
  /** The tool call id, so a streamed tool-result can find and finalize it. */
  id: string;
  kind: CanvasActionKind;
  /** Panel title the action targets (resolved at call time). */
  title: string;
  panelKind?: CanvasPanelKind;
  status: "running" | "done" | "error";
  /** Short suffix: char count on success, reason on failure. */
  detail?: string;
}

export interface CanvasChatMessage {
  id: string;
  role: CanvasChatRole;
  content: string;
  /** True while the assistant message is still streaming. Runtime-only. */
  streaming?: boolean;
  /** Structured, live-updating record of edits applied during this turn. */
  actions?: CanvasAction[];
  /** Legacy: plain-text edit summaries from before the structured actions. */
  edits?: string[];
  createdAt: number;
}

export interface CanvasBoard {
  panels: CanvasPanel[];
  chat: CanvasChatMessage[];
}

export type NotebookSourceKind = "file" | "web" | "text";
export type NotebookSourceStatus = "ready" | "processing" | "error";
export type NotebookSourceContextMode = "full" | "summary" | "off";
export type NotebookNoteKind = "manual" | "ai";
export type NotebookNoteContextMode = "full" | "off";

export interface NotebookSource {
  id: string;
  title: string;
  kind: NotebookSourceKind;
  content: string;
  summary: string;
  url?: string;
  filename?: string;
  mimeType?: string;
  status: NotebookSourceStatus;
  error?: string;
  contextMode: NotebookSourceContextMode;
  createdAt: number;
  updatedAt: number;
}

export interface NotebookNote {
  id: string;
  title: string;
  content: string;
  kind: NotebookNoteKind;
  sourceIds: string[];
  contextMode: NotebookNoteContextMode;
  createdAt: number;
  updatedAt: number;
}

/**
 * A named notebook wraps a board ({ panels, chat }) with identity and
 * timestamps so the app can keep a collection of them and switch between them.
 * The inner board shape is unchanged, so every pure helper above keeps working
 * against `{ panels, chat }`.
 */
export interface Notebook {
  id: string;
  name: string;
  description: string;
  sources: NotebookSource[];
  notes: NotebookNote[];
  panels: CanvasPanel[];
  chat: CanvasChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_NOTEBOOK_NAME = "Untitled notebook";

const DEFAULT_SIZE: Record<CanvasPanelKind, { w: number; h: number }> = {
  doc: { w: 380, h: 320 },
  code: { w: 400, h: 300 },
};

export function createBoard(): CanvasBoard {
  return { panels: [], chat: [] };
}

let panelSeq = 0;

export function createPanel(
  kind: CanvasPanelKind,
  overrides: Partial<CanvasPanel> = {},
  seed = Date.now(),
): CanvasPanel {
  const size = DEFAULT_SIZE[kind];
  return {
    id: overrides.id ?? `panel-${seed}-${(panelSeq++).toString(36)}`,
    kind,
    title: overrides.title ?? (kind === "code" ? "script.py" : "Untitled"),
    content: overrides.content ?? "",
    layout: overrides.layout ?? { x: 32, y: 32, w: size.w, h: size.h },
    status: overrides.status ?? "idle",
    output: overrides.output,
    z: overrides.z ?? 1,
    updatedAt: overrides.updatedAt ?? seed,
  };
}

/**
 * Cascade the next panel down-and-right of the busiest area so a freshly added
 * panel doesn't land exactly on top of an existing one. Pure given the board.
 */
export function nextPanelPosition(board: CanvasBoard, kind: CanvasPanelKind): PanelLayout {
  const size = DEFAULT_SIZE[kind];
  const count = board.panels.length;
  const step = 44;
  return {
    x: 32 + (count % 6) * step,
    y: 32 + (count % 6) * step,
    w: size.w,
    h: size.h,
  };
}

export function nextZ(board: CanvasBoard): number {
  return board.panels.reduce((max, p) => Math.max(max, p.z), 0) + 1;
}

export function createCanvasMessage(
  role: CanvasChatRole,
  content: string,
  seed = Date.now(),
): CanvasChatMessage {
  return {
    id: `cv-${seed}-${Math.random().toString(36).slice(2, 7)}`,
    role,
    content,
    createdAt: seed,
  };
}

// ── Hydration sanitizers (CLAUDE.md "Persistence for New Features") ──────────

/**
 * Streaming assistant messages and running code panels are runtime-only. On
 * reload, settle anything left mid-flight so a restored board looks finished:
 * no stuck typing dots, no frozen "running" spinners.
 */
export function sanitizeCanvasMessages(messages: unknown): CanvasChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (m): m is CanvasChatMessage =>
        !!m && typeof m === "object" && "id" in m && "role" in m,
    )
    .map((m) => {
      let next = m;
      // A streaming message restored from storage is finished by definition.
      if (next.streaming) next = { ...next, streaming: false };
      // Any action left "running" mid-stream settles to "done" so a reloaded
      // chat never shows a stuck spinner. (CLAUDE.md persistence rule.)
      if (Array.isArray(next.actions) && next.actions.some((a) => a?.status === "running")) {
        next = {
          ...next,
          actions: next.actions.map((a) =>
            a?.status === "running" ? { ...a, status: "done" as const } : a,
          ),
        };
      }
      return next;
    });
}

export function sanitizePanels(panels: unknown): CanvasPanel[] {
  if (!Array.isArray(panels)) return [];
  return panels
    .filter((p): p is CanvasPanel => !!p && typeof p === "object" && "id" in p && "layout" in p)
    .map((p) =>
      p.status === "running" ? { ...p, status: p.output ? ("done" as const) : ("idle" as const) } : p,
    );
}

export function sanitizeBoard(board: unknown): CanvasBoard {
  if (!board || typeof board !== "object") return createBoard();
  const b = board as Partial<CanvasBoard>;
  return {
    panels: sanitizePanels(b.panels),
    chat: sanitizeCanvasMessages(b.chat),
  };
}

// ── Notebook collection (named, switchable boards) ──────────────────────────

let notebookSeq = 0;
let sourceSeq = 0;
let noteSeq = 0;

function cleanLabel(value: string | undefined, fallback: string): string {
  const clean = (value ?? "").trim().replace(/\s+/g, " ");
  return clean || fallback;
}

export function createNotebook(name?: string, seed = Date.now()): Notebook {
  return {
    id: `nb-${seed}-${(notebookSeq++).toString(36)}`,
    name: name?.trim() || DEFAULT_NOTEBOOK_NAME,
    description: "",
    sources: [],
    notes: [],
    panels: [],
    chat: [],
    createdAt: seed,
    updatedAt: seed,
  };
}

function summarizeNotebookText(text: string, maxChars = 1200): string {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return "";
  if (clean.length <= maxChars) return clean;
  const paragraphs = clean.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const picked: string[] = [];
  let used = 0;
  for (const paragraph of paragraphs) {
    if (used >= maxChars) break;
    const remaining = maxChars - used;
    const next = paragraph.length > remaining ? `${paragraph.slice(0, Math.max(0, remaining - 1)).trim()}…` : paragraph;
    if (next) picked.push(next);
    used += next.length + 2;
  }
  return picked.join("\n\n") || `${clean.slice(0, maxChars - 1).trim()}…`;
}

export function createNotebookSource(input: {
  title: string;
  kind: NotebookSourceKind;
  content: string;
  summary?: string;
  url?: string;
  filename?: string;
  mimeType?: string;
  contextMode?: NotebookSourceContextMode;
  status?: NotebookSourceStatus;
  error?: string;
  seed?: number;
}): NotebookSource {
  const seed = input.seed ?? Date.now();
  const content = input.content ?? "";
  return {
    id: `src-${seed}-${(sourceSeq++).toString(36)}`,
    title: cleanLabel(input.title, input.filename || input.url || "Untitled source"),
    kind: input.kind,
    content,
    summary: input.summary ?? summarizeNotebookText(content),
    url: input.url,
    filename: input.filename,
    mimeType: input.mimeType,
    status: input.status ?? "ready",
    error: input.error,
    contextMode: input.contextMode ?? "full",
    createdAt: seed,
    updatedAt: seed,
  };
}

export function createNotebookNote(input: {
  title: string;
  content: string;
  kind?: NotebookNoteKind;
  sourceIds?: string[];
  contextMode?: NotebookNoteContextMode;
  seed?: number;
}): NotebookNote {
  const seed = input.seed ?? Date.now();
  return {
    id: `note-${seed}-${(noteSeq++).toString(36)}`,
    title: cleanLabel(input.title, "Untitled note"),
    content: input.content ?? "",
    kind: input.kind ?? "manual",
    sourceIds: input.sourceIds ?? [],
    contextMode: input.contextMode ?? "full",
    createdAt: seed,
    updatedAt: seed,
  };
}

function sanitizeSourceKind(kind: unknown): NotebookSourceKind {
  return kind === "file" || kind === "web" || kind === "text" ? kind : "text";
}

function sanitizeSourceStatus(status: unknown): NotebookSourceStatus {
  if (status === "processing") return "error";
  return status === "ready" || status === "error" ? status : "ready";
}

function sanitizeSourceContextMode(mode: unknown): NotebookSourceContextMode {
  return mode === "summary" || mode === "off" || mode === "full" ? mode : "full";
}

function sanitizeNoteKind(kind: unknown): NotebookNoteKind {
  return kind === "ai" ? "ai" : "manual";
}

function sanitizeNoteContextMode(mode: unknown): NotebookNoteContextMode {
  return mode === "off" ? "off" : "full";
}

export function sanitizeNotebookSources(raw: unknown): NotebookSource[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Partial<NotebookSource> => !!item && typeof item === "object")
    .map((item) => {
      const now = Date.now();
      const status = sanitizeSourceStatus(item.status);
      const content = typeof item.content === "string" ? item.content : "";
      const summary = typeof item.summary === "string" ? item.summary : summarizeNotebookText(content);
      const createdAt = typeof item.createdAt === "number" ? item.createdAt : now;
      return {
        id: typeof item.id === "string" && item.id ? item.id : `src-${now}-${(sourceSeq++).toString(36)}`,
        title: cleanLabel(item.title, item.filename || item.url || "Untitled source"),
        kind: sanitizeSourceKind(item.kind),
        content,
        summary,
        url: typeof item.url === "string" ? item.url : undefined,
        filename: typeof item.filename === "string" ? item.filename : undefined,
        mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
        status,
        error:
          status === "error"
            ? typeof item.error === "string" && item.error.trim()
              ? item.error
              : "Processing was interrupted."
            : undefined,
        contextMode: sanitizeSourceContextMode(item.contextMode),
        createdAt,
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : createdAt,
      };
    });
}

export function sanitizeNotebookNotes(raw: unknown): NotebookNote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Partial<NotebookNote> => !!item && typeof item === "object")
    .map((item) => {
      const now = Date.now();
      const createdAt = typeof item.createdAt === "number" ? item.createdAt : now;
      return {
        id: typeof item.id === "string" && item.id ? item.id : `note-${now}-${(noteSeq++).toString(36)}`,
        title: cleanLabel(item.title, "Untitled note"),
        content: typeof item.content === "string" ? item.content : "",
        kind: sanitizeNoteKind(item.kind),
        sourceIds: Array.isArray(item.sourceIds)
          ? item.sourceIds.filter((id): id is string => typeof id === "string")
          : [],
        contextMode: sanitizeNoteContextMode(item.contextMode),
        createdAt,
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : createdAt,
      };
    });
}

/**
 * Validate one notebook from storage. Backfills a missing id/name/timestamps
 * and delegates the inner arrays to the existing per-board sanitizers so
 * streaming messages and running code panels settle on reload.
 */
export function sanitizeNotebook(raw: unknown): Notebook | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Partial<Notebook>;
  const now = Date.now();
  const createdAt = typeof n.createdAt === "number" ? n.createdAt : now;
  return {
    id: typeof n.id === "string" && n.id ? n.id : `nb-${now}-${(notebookSeq++).toString(36)}`,
    name: typeof n.name === "string" && n.name.trim() ? n.name : DEFAULT_NOTEBOOK_NAME,
    description: typeof n.description === "string" ? n.description : "",
    sources: sanitizeNotebookSources(n.sources),
    notes: sanitizeNotebookNotes(n.notes),
    panels: sanitizePanels(n.panels),
    chat: sanitizeCanvasMessages(n.chat),
    createdAt,
    updatedAt: typeof n.updatedAt === "number" ? n.updatedAt : createdAt,
  };
}

export function sanitizeNotebooks(raw: unknown): Notebook[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeNotebook).filter((n): n is Notebook => n !== null);
}

/**
 * One-time migration: if there are no notebooks yet but a legacy single board
 * exists with content, fold it into one notebook named "Notebook" so the user's
 * existing work is preserved. Pure and testable — returns the notebook array to
 * persist (empty if nothing to migrate).
 */
export function migrateLegacyBoard(
  rawBoard: unknown,
  rawNotebooks: unknown,
  seed = Date.now(),
): Notebook[] {
  const existing = sanitizeNotebooks(rawNotebooks);
  if (existing.length > 0) return existing;
  const board = sanitizeBoard(rawBoard);
  if (board.panels.length === 0 && board.chat.length === 0) return [];
  return [
    {
      ...createNotebook("Notebook", seed),
      description: "",
      panels: board.panels,
      chat: board.chat,
    },
  ];
}

export interface NotebookContextBuild {
  context: string;
  tokenCount: number;
  charCount: number;
  sourceCount: number;
  noteCount: number;
}

export function buildNotebookContext(notebook: Notebook): NotebookContextBuild {
  const blocks: string[] = [`# Notebook: ${notebook.name}`];
  const description = notebook.description.trim();
  if (description) blocks.push(description);

  let sourceCount = 0;
  for (const source of notebook.sources) {
    if (source.contextMode === "off" || source.status !== "ready") continue;
    const body = source.contextMode === "summary" ? source.summary || summarizeNotebookText(source.content) : source.content;
    if (!body.trim()) continue;
    sourceCount++;
    const modeLabel = source.contextMode === "summary" ? "summary" : "full content";
    const origin = source.url ? ` (${source.url})` : source.filename ? ` (${source.filename})` : "";
    blocks.push(`## Source ${sourceCount}: ${source.title}${origin}\nContext: ${modeLabel}\n\n${body.trim()}`);
  }

  let noteCount = 0;
  for (const note of notebook.notes) {
    if (note.contextMode === "off" || !note.content.trim()) continue;
    noteCount++;
    const kind = note.kind === "ai" ? "AI note" : "Manual note";
    blocks.push(`## Note ${noteCount}: ${note.title}\nType: ${kind}\n\n${note.content.trim()}`);
  }

  const context = blocks.join("\n\n").trim();
  return {
    context,
    tokenCount: Math.ceil(context.length / 4),
    charCount: context.length,
    sourceCount,
    noteCount,
  };
}

// ── Document edit operations (pure, testable) ───────────────────────────────

export interface CanvasEditResult {
  content: string;
  summary: string;
  ok: boolean;
}

export function applyRewrite(panel: CanvasPanel, content: string): CanvasEditResult {
  return {
    content,
    summary: panel.content.trim() ? `Rewrote ${panel.title}` : `Drafted ${panel.title}`,
    ok: true,
  };
}

export function applyReplace(panel: CanvasPanel, find: string, replace: string): CanvasEditResult {
  if (!find) return { content: panel.content, summary: "Empty search text", ok: false };
  const index = panel.content.indexOf(find);
  if (index === -1) {
    return { content: panel.content, summary: `Couldn't find "${truncate(find, 40)}"`, ok: false };
  }
  const next = panel.content.slice(0, index) + replace + panel.content.slice(index + find.length);
  return { content: next, summary: `Edited ${panel.title}`, ok: true };
}

export function applyAppend(panel: CanvasPanel, text: string): CanvasEditResult {
  const base = panel.content.replace(/\s+$/, "");
  const next = base ? `${base}\n\n${text}` : text;
  return { content: next, summary: `Appended to ${panel.title}`, ok: true };
}

/**
 * Apply a batch of exact-text replacements in order. Each oldText is matched
 * against the running content (first occurrence). Fails atomically — if any
 * edit can't be matched, nothing is applied. Mirrors edit_file's multi-edit.
 */
export function applyEdits(
  panel: CanvasPanel,
  edits: { oldText: string; newText: string }[],
): CanvasEditResult {
  if (!edits.length) return { content: panel.content, summary: "No edits provided", ok: false };
  let content = panel.content;
  for (const e of edits) {
    if (!e.oldText) return { content: panel.content, summary: "Empty search text", ok: false };
    const index = content.indexOf(e.oldText);
    if (index === -1) {
      return { content: panel.content, summary: `Couldn't find "${truncate(e.oldText, 40)}"`, ok: false };
    }
    content = content.slice(0, index) + e.newText + content.slice(index + e.oldText.length);
  }
  return { content, summary: `Edited ${panel.title}`, ok: true };
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

// ── Notebook agent tools (panels as editable documents) ─────────────────────

/**
 * Panels are exposed to the assistant like files: it lists them, reads them by
 * id (especially large ones, shown only as a preview in context), and edits or
 * renames them through tool calls. Deps are store-backed (no disk, no approval
 * gate) — modeled on the artifact editor.
 */
export interface NotebookToolDeps {
  getBoard: () => CanvasBoard | Notebook;
  createPanel: (kind: CanvasPanelKind, title: string, content: string) => string;
  setPanelContent: (panelId: string, content: string) => void;
  setPanelTitle: (panelId: string, title: string) => void;
  createNote?: (title: string, content: string, sourceIds?: string[]) => string;
  setNoteContent?: (noteId: string, content: string) => void;
  setNoteTitle?: (noteId: string, title: string) => void;
}

/** Panels at or below this size are inlined whole in the system prompt; larger
 *  ones are shown as a preview and the assistant reads them on demand. */
export const PANEL_INLINE_LIMIT = 1200;

function isNotebookBoard(board: CanvasBoard | Notebook): board is Notebook {
  return "sources" in board && "notes" in board && Array.isArray(board.sources) && Array.isArray(board.notes);
}

function sourceSnippet(text: string, query: string, max = 280): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const index = clean.toLowerCase().indexOf(query.toLowerCase());
  const start = index === -1 ? 0 : Math.max(0, index - 90);
  const end = Math.min(clean.length, start + max);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < clean.length ? "..." : "";
  return `${prefix}${clean.slice(start, end).trim()}${suffix}`;
}

export function createNotebookTools(deps: NotebookToolDeps) {
  const findPanel = (panelId: string): CanvasPanel | undefined =>
    deps.getBoard().panels.find((p) => p.id === panelId);

  const getNotebook = (): Notebook | null => {
    const board = deps.getBoard();
    return isNotebookBoard(board) ? board : null;
  };

  const findSource = (sourceId: string): NotebookSource | undefined =>
    getNotebook()?.sources.find((source) => source.id === sourceId);

  const findNote = (noteId: string): NotebookNote | undefined =>
    getNotebook()?.notes.find((note) => note.id === noteId);

  const idsHint = (): string =>
    deps.getBoard().panels.map((p) => `${p.id} ("${p.title}")`).join(", ") || "(none)";

  const sourceIdsHint = (): string =>
    getNotebook()?.sources.map((s) => `${s.id} ("${s.title}")`).join(", ") || "(none)";

  const noteIdsHint = (): string =>
    getNotebook()?.notes.map((n) => `${n.id} ("${n.title}")`).join(", ") || "(none)";

  const runEdit = (panelId: string, compute: (panel: CanvasPanel) => CanvasEditResult): string => {
    const panel = findPanel(panelId);
    if (!panel) return `No panel with id "${panelId}". Existing panels: ${idsHint()}.`;
    const result = compute(panel);
    if (!result.ok) {
      return `No change: ${result.summary}. Call read_panel to see the exact current text, or use write_panel for a full rewrite.`;
    }
    deps.setPanelContent(panelId, result.content);
    return `OK — ${result.summary.toLowerCase()}. It now has ${result.content.length} characters.`;
  };

  return {
    list_panels: tool({
      description:
        "List every panel on the board with its id, title, type, and size (characters). Use this to re-orient before editing if you're unsure which panel to touch.",
      inputSchema: z.object({}),
      execute: async () => {
        const panels = deps.getBoard().panels;
        if (!panels.length) return "The board is empty. Use create_panel to add the first panel.";
        return panels
          .map((p) => `- id ${p.id} · "${p.title}" · ${p.kind} · ${p.content.length} chars`)
          .join("\n");
      },
    }),
    read_panel: tool({
      description:
        "Read a panel's full current content by id. Large panels appear only as a short preview in your context — call this to get the complete text before editing them so your old_text matches exactly.",
      inputSchema: z.object({
        panel_id: z.string().describe("Target panel id (see the panel list)."),
      }),
      execute: async ({ panel_id }) => {
        const panel = findPanel(panel_id);
        if (!panel) return `No panel with id "${panel_id}". Existing panels: ${idsHint()}.`;
        const kindLabel = panel.kind === "code" ? "code (Python)" : "doc (Markdown)";
        return `# ${panel.title} — ${kindLabel}\n\n${panel.content || "(empty)"}`;
      },
    }),
    create_panel: tool({
      description:
        "Create a new panel on the board. Use 'doc' for prose/Markdown (emails, notes, articles) and 'code' for a runnable Python file. Only create when no existing panel fits the request. Returns the new panel id.",
      inputSchema: z.object({
        kind: z.enum(["doc", "code"]).describe("Panel type."),
        title: z.string().describe("Short panel title, e.g. 'Outreach email' or 'analysis.py'."),
        content: z.string().default("").describe("Initial content (optional)."),
      }),
      execute: async ({ kind, title, content }) => {
        const id = deps.createPanel(kind, title, content ?? "");
        return `Created ${kind} panel "${title}" with id ${id}.`;
      },
    }),
    write_panel: tool({
      description:
        "Replace the ENTIRE content of a panel by id. Best for drafting from scratch or sweeping rewrites. Pass the full new content, not a diff.",
      inputSchema: z.object({
        panel_id: z.string().describe("Target panel id."),
        content: z.string().describe("Complete new content for the panel."),
      }),
      execute: async ({ panel_id, content }) => runEdit(panel_id, (p) => applyRewrite(p, content)),
    }),
    edit_panel: tool({
      description:
        "Make targeted text replacement(s) in a panel by id. For a single edit pass old_text + new_text (old_text must match exactly once, including whitespace). For several, pass an edits array of {oldText,newText} applied in order. Best for small surgical changes.",
      inputSchema: z.object({
        panel_id: z.string().describe("Target panel id."),
        old_text: z.string().optional().describe("Exact text to locate (single edit)."),
        new_text: z.string().optional().describe("Replacement text (single edit)."),
        edits: z
          .array(z.object({ oldText: z.string(), newText: z.string() }))
          .optional()
          .describe("Multiple replacements, each matched against the running content."),
      }),
      execute: async ({ panel_id, old_text, new_text, edits }) => {
        if (edits && edits.length > 0) return runEdit(panel_id, (p) => applyEdits(p, edits));
        if (old_text !== undefined && new_text !== undefined) {
          return runEdit(panel_id, (p) => applyReplace(p, old_text, new_text));
        }
        return "No change: provide either old_text and new_text, or an edits array.";
      },
    }),
    append_panel: tool({
      description: "Add text to the end of a panel by id, without touching what's above.",
      inputSchema: z.object({
        panel_id: z.string().describe("Target panel id."),
        text: z.string().describe("Text to append."),
      }),
      execute: async ({ panel_id, text }) => runEdit(panel_id, (p) => applyAppend(p, text)),
    }),
    rename_panel: tool({
      description:
        "Change a panel's title by id. Use when the user asks, or when a title no longer matches its content after a rewrite. Does not change the content.",
      inputSchema: z.object({
        panel_id: z.string().describe("Target panel id."),
        title: z.string().describe("The new title."),
      }),
      execute: async ({ panel_id, title }) => {
        const panel = findPanel(panel_id);
        if (!panel) return `No panel with id "${panel_id}". Existing panels: ${idsHint()}.`;
        const clean = title.trim();
        if (!clean) return "No change: the new title is empty.";
        if (clean === panel.title) return `No change: "${panel.title}" already has that title.`;
        deps.setPanelTitle(panel_id, clean);
        return `Renamed "${panel.title}" to "${clean}".`;
      },
    }),
    list_sources: tool({
      description:
        "List notebook sources with ids, titles, types, context modes, status, and size. Use these ids when reading or searching source material.",
      inputSchema: z.object({}),
      execute: async () => {
        const notebook = getNotebook();
        if (!notebook?.sources.length) return "This notebook has no sources yet.";
        return notebook.sources
          .map((source) => {
            const status = source.status === "error" ? `error: ${source.error || "unknown"}` : source.status;
            return [
              `- id ${source.id}`,
              `"${source.title}"`,
              source.kind,
              `${source.content.length} chars`,
              `context ${source.contextMode}`,
              status,
            ].join(" · ");
          })
          .join("\n");
      },
    }),
    read_source: tool({
      description:
        "Read a notebook source's full extracted text by id. Use this before making citation-sensitive claims from a source.",
      inputSchema: z.object({
        source_id: z.string().describe("Target source id from list_sources."),
      }),
      execute: async ({ source_id }) => {
        const source = findSource(source_id);
        if (!source) return `No source with id "${source_id}". Existing sources: ${sourceIdsHint()}.`;
        const origin = source.url ? `\nURL: ${source.url}` : source.filename ? `\nFile: ${source.filename}` : "";
        const status = source.status === "ready" ? "" : `\nStatus: ${source.status}${source.error ? ` (${source.error})` : ""}`;
        return `# ${source.title}\nType: ${source.kind}${origin}${status}\nContext mode: ${source.contextMode}\n\n${source.content || "(empty)"}`;
      },
    }),
    search_sources: tool({
      description:
        "Search ready notebook sources and included notes for a query. Excludes sources or notes whose context mode is off. Returns short snippets with ids.",
      inputSchema: z.object({
        query: z.string().describe("Search text."),
      }),
      execute: async ({ query }) => {
        const needle = query.trim().toLowerCase();
        if (!needle) return "No search run: provide a non-empty query.";
        const notebook = getNotebook();
        if (!notebook) return "No notebook sources are available in this board.";
        const matches: string[] = [];
        for (const source of notebook.sources) {
          if (source.status !== "ready" || source.contextMode === "off") continue;
          const haystack = `${source.title}\n${source.summary}\n${source.content}`;
          if (!haystack.toLowerCase().includes(needle)) continue;
          matches.push(`- source ${source.id} · "${source.title}": ${sourceSnippet(haystack, query)}`);
        }
        for (const note of notebook.notes) {
          if (note.contextMode === "off") continue;
          const haystack = `${note.title}\n${note.content}`;
          if (!haystack.toLowerCase().includes(needle)) continue;
          matches.push(`- note ${note.id} · "${note.title}": ${sourceSnippet(haystack, query)}`);
        }
        return matches.length ? matches.join("\n") : `No included sources or notes matched "${query}".`;
      },
    }),
    list_notes: tool({
      description: "List notebook notes with ids, titles, type, context mode, and size.",
      inputSchema: z.object({}),
      execute: async () => {
        const notes = getNotebook()?.notes ?? [];
        if (!notes.length) return "This notebook has no notes yet.";
        return notes
          .map((note) => `- id ${note.id} · "${note.title}" · ${note.kind} · ${note.content.length} chars · context ${note.contextMode}`)
          .join("\n");
      },
    }),
    read_note: tool({
      description: "Read a notebook note's full current content by id.",
      inputSchema: z.object({
        note_id: z.string().describe("Target note id from list_notes."),
      }),
      execute: async ({ note_id }) => {
        const note = findNote(note_id);
        if (!note) return `No note with id "${note_id}". Existing notes: ${noteIdsHint()}.`;
        return `# ${note.title}\nType: ${note.kind}\nContext mode: ${note.contextMode}\n\n${note.content || "(empty)"}`;
      },
    }),
    create_note: tool({
      description:
        "Create a durable notebook note from a synthesis, answer, outline, or extracted quote set. Use this when the user asks to save or when durable synthesis is clearly useful.",
      inputSchema: z.object({
        title: z.string().describe("Short note title."),
        content: z.string().describe("Markdown note content."),
        source_ids: z.array(z.string()).optional().describe("Source ids this note is based on."),
      }),
      execute: async ({ title, content, source_ids }) => {
        if (!deps.createNote) return "No change: this notebook cannot create notes from tools right now.";
        const cleanTitle = cleanLabel(title, "Untitled note");
        const id = deps.createNote(cleanTitle, content ?? "", source_ids ?? []);
        return `Created note "${cleanTitle}" with id ${id}.`;
      },
    }),
    write_note: tool({
      description:
        "Replace a notebook note's title and/or entire content by id. Best for rewriting saved synthesis notes.",
      inputSchema: z.object({
        note_id: z.string().describe("Target note id."),
        title: z.string().optional().describe("New note title."),
        content: z.string().optional().describe("Complete new note content."),
      }),
      execute: async ({ note_id, title, content }) => {
        const note = findNote(note_id);
        if (!note) return `No note with id "${note_id}". Existing notes: ${noteIdsHint()}.`;
        const nextTitle = title === undefined ? note.title : cleanLabel(title, note.title);
        if (title !== undefined) {
          if (!deps.setNoteTitle) return "No change: this notebook cannot rename notes from tools right now.";
          deps.setNoteTitle(note_id, nextTitle);
        }
        if (content !== undefined) {
          if (!deps.setNoteContent) return "No change: this notebook cannot edit notes from tools right now.";
          deps.setNoteContent(note_id, content);
        }
        return `OK — updated note "${nextTitle}". It now has ${(content ?? note.content).length} characters.`;
      },
    }),
  };
}

// ── Live action feedback (derived from the tool-call stream) ─────────────────

const CREATE_DEFAULT_TITLE: Record<CanvasPanelKind, string> = {
  code: "script.py",
  doc: "Untitled",
};

/**
 * Turn a streamed notebook tool call into a structured action for the rail's
 * live feedback. Resolves the target panel's title from the board so the user
 * sees "Editing Outreach email" rather than an opaque id. Read-only orientation
 * calls (list_panels) and the harness's `done` signal produce no row. Pure.
 */
export function deriveCanvasAction(
  toolName: string,
  input: Record<string, unknown>,
  board: CanvasBoard,
): Omit<CanvasAction, "id" | "status"> | null {
  if (toolName === "create_panel") {
    const panelKind: CanvasPanelKind = input.kind === "code" ? "code" : "doc";
    const rawTitle = typeof input.title === "string" ? input.title.trim() : "";
    return { kind: "create", panelKind, title: rawTitle || CREATE_DEFAULT_TITLE[panelKind] };
  }

  const editKinds: Record<string, CanvasActionKind> = {
    write_panel: "rewrite",
    edit_panel: "replace",
    append_panel: "append",
    rename_panel: "rename",
    read_panel: "read",
  };
  const kind = editKinds[toolName];
  if (!kind) return null; // list_panels, done, etc. — no row

  const panelId = typeof input.panel_id === "string" ? input.panel_id : "";
  const panel = board.panels.find((p) => p.id === panelId);
  // For a rename, the action's title is what it's becoming.
  const title =
    kind === "rename" && typeof input.title === "string" && input.title.trim()
      ? input.title.trim()
      : panel?.title ?? "panel";
  return { kind, title, panelKind: panel?.kind };
}

/**
 * Read an edit tool's result string to settle an action to done/error with a
 * short detail. Mirrors the success markers the tools emit ("OK", "Created",
 * "Renamed"). Read actions are settled by the caller, not here. Pure.
 */
export function resolveActionResult(output: unknown): { status: "done" | "error"; detail?: string } {
  const text = (typeof output === "string" ? output : "").trim();
  if (!text) return { status: "done" };
  if (/^(ok|created|renamed)\b/i.test(text)) {
    const chars = text.match(/(\d[\d,]*)\s+characters/i);
    return { status: "done", detail: chars ? `${chars[1]} chars` : undefined };
  }
  if (/^no panel with id/i.test(text)) return { status: "error", detail: "Panel not found" };
  const miss = text.match(/couldn't find "([^"]*)"/i);
  if (miss) return { status: "error", detail: `No match for "${truncate(miss[1], 24)}"` };
  if (/^no change/i.test(text)) return { status: "error", detail: "No change" };
  return { status: "error", detail: truncate(text, 48) };
}

export function buildNotebookSystemPrompt(board: CanvasBoard | Notebook): string {
  const panelList = board.panels.length
    ? board.panels
        .map((p) => {
          const kindLabel = p.kind === "code" ? "code (Python)" : "doc (Markdown prose)";
          const chars = p.content.length;
          const header = `### "${p.title}"  [id: ${p.id} · ${kindLabel} · ${chars} chars]`;
          if (chars === 0) return `${header}\n(empty)`;
          if (chars <= PANEL_INLINE_LIMIT) {
            return [header, "```", p.content, "```"].join("\n");
          }
          const preview = p.content.slice(0, 400).replace(/\s+$/, "");
          return [
            header,
            `(large — preview only; call read_panel with id "${p.id}" for the full content before editing)`,
            "```",
            `${preview}\n…`,
            "```",
          ].join("\n");
        })
        .join("\n\n")
    : "(the board is empty — create a panel to start)";

  const notebookContext =
    isNotebookBoard(board)
      ? (() => {
          const built = buildNotebookContext(board);
          const hasContext = built.sourceCount > 0 || built.noteCount > 0 || board.description.trim().length > 0;
          return [
            "NOTEBOOK CONTEXT:",
            hasContext
              ? `Selected context: ${built.sourceCount} source${built.sourceCount === 1 ? "" : "s"}, ${built.noteCount} note${built.noteCount === 1 ? "" : "s"}, ~${built.tokenCount.toLocaleString()} tokens.`
              : "",
            hasContext ? built.context : "No sources or notes are currently selected for context.",
          ]
            .filter(Boolean)
            .join("\n");
        })()
      : "NOTEBOOK CONTEXT:\nThis board has no source or note collection attached.";

  return [
    "You are the assistant inside goatLLM's Notebook — a research workspace with sources, durable notes, chat, and a freeform canvas of documents/runnable Python panels. You manage notes and panels through tool calls, the same way an agent edits files.",
    "",
    "Sources are evidence. Notes are saved synthesis. Answer from the selected notebook context when it is relevant, and be explicit when the available sources do not support a claim.",
    "",
    notebookContext,
    "",
    "Each panel is a small document with an id, a title, and a type (doc = Markdown prose, code = runnable Python). Tools:",
    "- list_sources / read_source / search_sources: inspect notebook evidence by id.",
    "- list_notes / read_note / create_note / write_note: inspect or save durable notebook synthesis.",
    "- list_panels: list every panel (id, title, type, size). Use it to re-orient if unsure.",
    "- read_panel: read a panel's full current content by id. Large panels are shown below as a preview only — read_panel them before editing so your edits match.",
    "- create_panel: add a new doc or code panel (kind, title, content).",
    "- write_panel: replace a panel's entire content by id (best for drafting / big rewrites).",
    "- edit_panel: make targeted text replacement(s) in a panel by id (best for small edits; old_text must match exactly, or pass an edits array).",
    "- append_panel: add text to the end of a panel by id.",
    "- rename_panel: change a panel's title by id.",
    "",
    "Rules:",
    "- EDIT THE EXISTING PANEL the user means — match it by title, type, or content in the list below and pass its exact id. Only create_panel when nothing fits; never duplicate a panel that already exists.",
    "- Use edit_panel for small changes and write_panel for full rewrites. After a big rewrite, rename_panel if the title no longer fits the content.",
    "- If a panel is shown as a preview only, call read_panel before editing it.",
    "- If the user only asks a question or for advice, answer in chat without touching the board.",
    "- When you finish, reply with one short sentence describing what you changed — the user already sees a live list of your edits, so keep it brief. Match each document's tone; keep code syntactically valid.",
    "",
    "CURRENT BOARD:",
    panelList,
  ].join("\n");
}
