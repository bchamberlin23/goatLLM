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

export interface CanvasChatMessage {
  id: string;
  role: CanvasChatRole;
  content: string;
  /** True while the assistant message is still streaming. Runtime-only. */
  streaming?: boolean;
  /** Short labels for edits the assistant applied during this turn. */
  edits?: string[];
  createdAt: number;
}

export interface CanvasBoard {
  panels: CanvasPanel[];
  chat: CanvasChatMessage[];
}

const DEFAULT_SIZE: Record<CanvasPanelKind, { w: number; h: number }> = {
  doc: { w: 420, h: 340 },
  code: { w: 460, h: 320 },
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
  const step = 28;
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
    .map((m) => (m.streaming ? { ...m, streaming: false } : m));
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

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

// ── Assistant editing tools ─────────────────────────────────────────────────

export interface CanvasToolDeps {
  getBoard: () => CanvasBoard;
  setPanelContent: (panelId: string, content: string) => void;
  addPanel: (kind: CanvasPanelKind, title: string, content: string) => string;
  recordEdit: (summary: string) => void;
}

export function createCanvasTools(deps: CanvasToolDeps) {
  const findPanel = (panelId: string): CanvasPanel | undefined =>
    deps.getBoard().panels.find((p) => p.id === panelId);

  const runEdit = (panelId: string, compute: (panel: CanvasPanel) => CanvasEditResult): string => {
    const panel = findPanel(panelId);
    if (!panel) {
      const ids = deps.getBoard().panels.map((p) => p.id).join(", ") || "(none)";
      return `No panel with id "${panelId}". Existing panel ids: ${ids}.`;
    }
    const result = compute(panel);
    if (!result.ok) {
      return `No change: ${result.summary}. Use rewrite_panel if you can't match exact text.`;
    }
    deps.setPanelContent(panelId, result.content);
    deps.recordEdit(result.summary);
    return `OK — ${result.summary.toLowerCase()}. It now has ${result.content.length} characters.`;
  };

  return {
    create_panel: tool({
      description:
        "Create a new panel on the board. Use 'doc' for prose/Markdown (emails, notes, articles) and 'code' for a runnable Python file. Returns the new panel id.",
      inputSchema: z.object({
        kind: z.enum(["doc", "code"]).describe("Panel type."),
        title: z.string().describe("Short panel title, e.g. 'Outreach email' or 'analysis.py'."),
        content: z.string().default("").describe("Initial content (optional)."),
      }),
      execute: async ({ kind, title, content }) => {
        const id = deps.addPanel(kind, title, content ?? "");
        deps.recordEdit(`Created ${title}`);
        return `Created ${kind} panel "${title}" with id ${id}.`;
      },
    }),
    rewrite_panel: tool({
      description:
        "Replace the ENTIRE content of a panel. Best for drafting from scratch or sweeping rewrites. Pass the full new content, not a diff.",
      inputSchema: z.object({
        panel_id: z.string().describe("Target panel id (see the panel list in context)."),
        content: z.string().describe("Complete new content for the panel."),
      }),
      execute: async ({ panel_id, content }) => runEdit(panel_id, (p) => applyRewrite(p, content)),
    }),
    replace_in_panel: tool({
      description:
        "Replace one exact span of text in a panel with new text. Best for small surgical edits. 'find' must match exactly, including whitespace.",
      inputSchema: z.object({
        panel_id: z.string().describe("Target panel id."),
        find: z.string().describe("Exact text to locate."),
        replace: z.string().describe("Replacement text."),
      }),
      execute: async ({ panel_id, find, replace }) =>
        runEdit(panel_id, (p) => applyReplace(p, find, replace)),
    }),
    append_to_panel: tool({
      description: "Add text to the end of a panel without touching what's above.",
      inputSchema: z.object({
        panel_id: z.string().describe("Target panel id."),
        text: z.string().describe("Text to append."),
      }),
      execute: async ({ panel_id, text }) => runEdit(panel_id, (p) => applyAppend(p, text)),
    }),
  };
}

export function buildCanvasSystemPrompt(board: CanvasBoard): string {
  const panelList = board.panels.length
    ? board.panels
        .map((p) => {
          const body = p.content.trim() || "(empty)";
          return [
            `### Panel ${p.id}`,
            `- type: ${p.kind === "code" ? "code (Python)" : "doc (Markdown prose)"}`,
            `- title: ${p.title}`,
            "- content:",
            "```",
            body,
            "```",
          ].join("\n");
        })
        .join("\n\n")
    : "(the board is empty — create a panel to start)";

  return [
    "You are the assistant inside goatLLM's Canvas — a freeform document work area.",
    "The user works on a board of panels shown beside this chat. Each panel is either a prose/Markdown document (an email, note, article) or a runnable Python code file. You can read every panel and edit any of them.",
    "",
    "When the user asks you to write, change, fix, shorten, expand, restructure, or draft something, DO IT by calling an edit tool — do not paste the new version into chat. Tools:",
    "- create_panel: add a new doc or code panel.",
    "- rewrite_panel: replace a panel's whole content (best for drafting / big rewrites).",
    "- replace_in_panel: swap one exact span for new text (best for small edits).",
    "- append_to_panel: add to the end of a panel.",
    "",
    "If the board is empty and the user asks for content, create a panel first. If the user only asks a question or for advice, just answer in chat without editing.",
    "After editing, reply with one short plain sentence describing what you changed — don't repeat the full text back. Match each document's existing tone and formatting. Keep code syntactically valid.",
    "",
    "CURRENT BOARD:",
    panelList,
  ].join("\n");
}
