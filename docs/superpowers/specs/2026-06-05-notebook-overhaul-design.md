# Notebook Overhaul — Design

**Date:** 2026-06-05
**Status:** Approved for planning

## Summary

The feature currently called "Canvas" (internally `notebookMode`) is a freeform board of
draggable/resizable panels — prose docs + runnable Python — with an AI assistant rail. Three
problems:

1. It's labeled "Canvas" but the mode and the user's mental model are "Notebook."
2. There's exactly **one** board. No way to save, name, or switch between multiple notebooks.
   The sidebar has no notebook branch, so notebook mode shows the plain chat list — a confusing
   disconnect.
3. The board UI is visually basic and below the rest of the app's bar.
4. **Dragging is broken**: the panel title is a full-width `<button>`, and the drag handler
   bails on any `closest("button,input")` — so grabbing a panel by its title (most of the header)
   silently cancels the drag.

This overhaul: renames to "Notebook" everywhere user-facing, introduces a collection of named
notebooks with a dedicated sidebar, rebuilds the board visuals to `DESIGN.md` quality, and fixes
dragging.

**Interaction model stays freeform** (drag/resize panels anywhere) — confirmed with user. We are
polishing the existing board, not restructuring into stacked cells.

## Non-goals

- No change to the stacked/Jupyter layout (rejected in favor of freeform polish).
- No change to the assistant streaming logic, tool calls, or Python execution beyond retargeting
  the mutation path at the active notebook.
- No SQLite mirror for notebooks in this pass (see Persistence below; flagged as a follow-up).
- No rename of the `CanvasPanel` / `CanvasChatMessage` type names (neutral; avoids churning
  `canvas.test.ts`).

## Architecture

### 1. Data model — `src/lib/canvas.ts`

Today: a single `CanvasBoard = { panels, chat }`.

Add a `Notebook` wrapper around the existing board shape:

```ts
interface Notebook {
  id: string;
  name: string;
  panels: CanvasPanel[];      // unchanged
  chat: CanvasChatMessage[];  // unchanged — each notebook keeps its own assistant thread
  createdAt: number;
  updatedAt: number;
}
```

`CanvasPanel` and `CanvasChatMessage` are untouched. `CanvasBoard` stays as the
`{ panels, chat }` slice so all existing pure helpers (`createBoard`, `sanitizeBoard`,
`sanitizePanels`, `sanitizeCanvasMessages`, the edit ops, the tools) keep working unchanged.

New pure helpers (all unit-tested):
- `createNotebook(name?, seed?): Notebook` — empty panels/chat, default name `"Untitled notebook"`.
- `sanitizeNotebook(raw): Notebook` — validates one notebook, delegating to `sanitizePanels` /
  `sanitizeCanvasMessages` for the inner arrays; backfills missing id/name/timestamps.
- `sanitizeNotebooks(raw): Notebook[]` — validates the array; drops non-objects.
- `migrateLegacyBoard(rawBoard, rawNotebooks): Notebook[]` — if there are no notebooks yet but a
  legacy `{ panels, chat }` board exists with content, fold it into one notebook named
  `"Notebook"`. Pure and testable.

### 2. Store — `src/stores/chat.ts`

Replace the single-board state with a collection:

State:
- `notebooks: Notebook[]`
- `activeNotebookId: string | null`

Remove: `canvasBoard`, `setCanvasBoard`, `loadCanvasBoard`.

Actions:
- `createNotebook(): string` — creates, sets active, persists, returns id.
- `renameNotebook(id, name): void`
- `deleteNotebook(id): void` — if the active one is deleted, fall back to the most recent
  remaining notebook (or null if none).
- `setActiveNotebook(id): void`
- `getActiveNotebook(): Notebook | null` — derived.
- `setActiveNotebookContents(board: CanvasBoard, persist = true): void` — the single mutation path
  NotebookView uses. Merges `{ panels, chat }` into the active notebook, bumps `updatedAt`. Keeps
  the `persist=false` mid-stream throttle exactly as `setCanvasBoard` did.

Persistence: new localStorage key `goatllm-notebooks` written via `saveJsonSetting`. Loader
`loadNotebooks()` reads the key, runs `migrateLegacyBoard` against the old `goatllm-canvas-board`
value, sanitizes, and (on a successful migration) removes the legacy key. `activeNotebookId` is
persisted under `goatllm-active-notebook` and validated on hydrate (falls back to first notebook).

Both hydrate reset blocks (lines ~4308 and ~4418) swap `canvasBoard: loadCanvasBoard()` for
`notebooks: loadNotebooks()` + `activeNotebookId: <validated>`.

### 3. Sidebar — `src/components/Sidebar.tsx`

Add a `notebookMode` branch to the top-level `Sidebar` router (alongside agent/design/chat):

```ts
if (notebookMode) return <NotebookSidebar onOpenSettings={onOpenSettings} />;
```

New `NotebookSidebar` component, modeled on `ChatSidebar`'s structure and tokens:
- `New notebook` button (mirrors the New chat button; ⌘N affordance).
- A flat list of notebooks, sorted by `updatedAt` desc. Each row: name, relative timestamp,
  active-row highlight (the amber left-edge marker + `sidebar-action-active`), hover `More` button.
- Context menu (right-click + More button): **Rename**, **Delete** (with confirm). Reuses the
  existing `ContextMenuState` pattern and popover styling.
- Inline rename input on the row, same pattern as chat rows.
- Empty state: "No notebooks yet" + a "Create notebook" pill.

Creating/selecting a notebook sets it active; the board reflects it immediately.

### 4. Board view — `src/components/NotebookView.tsx`

Reads the active notebook via `getActiveNotebook()`; all `canvasBoard` reads/writes route through
`setActiveNotebookContents`. If there are no notebooks, render a full-pane empty state with a
"Create your first notebook" action (which calls `createNotebook`).

**Drag fix:** the header becomes the drag handle as a plain element. The title is no longer a
full-width button — it's a text span; rename is triggered by double-clicking the title or a small
pencil affordance. The `closest("button,input")` guard stays (so the Doc/Code/Run/Delete controls
don't initiate drags), but because the title is no longer a button, grabbing the header body now
drags as expected. Verify in-browser.

**Visual rebuild** (against `DESIGN.md`, no new hex tokens):
- Header: notebook name (editable), panel count in `tabular-nums`, Doc/Code add buttons, ModeToggle.
- Panel cards: `bg-surface-3`, `border-hairline`, hierarchical radius (`rounded-xl`), refined
  header/toolbar, focus lifts to `hairline-strong`. Amber accent only for active/primary (run,
  active preview toggle). Output region uses `bg-sunken`.
- Empty states (no-notebook, empty-board, empty-rail) use `fadeIn` and the shipped easings.
- Typography per the type scale; icons lucide at 13–16px, 1.75 stroke; `aria-label` on icon buttons.

## Data flow

```
NotebookSidebar ──createNotebook/setActiveNotebook──▶ store.activeNotebookId
                                                          │
NotebookView ──getActiveNotebook()──▶ render board ◀──────┘
   user drag/edit/run ──setActiveNotebookContents({panels,chat})──▶ active notebook (+persist)
   assistant stream ──setActiveNotebookContents(..., persist=false)──▶ mid-stream, throttled
```

## Persistence

Notebooks live in localStorage (`goatllm-notebooks`) — same layer the single canvas board used.
The dual-write SQLite rule in AGENTS.md is built around the conversations/messages tables; the
canvas was already localStorage-only, so this matches precedent. **Flagged:** if cross-device sync
or large-history durability is wanted for notebooks, a SQLite mirror is a clean follow-up. Calling
it out rather than silently shipping single-layer persistence.

Hydration sanitizers settle runtime-only state per notebook on load: streaming chat messages →
not-streaming, `running` code panels → `done` (if output captured) or `idle`. This reuses the
existing per-board sanitizers, now mapped across the collection.

## Migration

On first load after this ships: `loadNotebooks()` finds no `goatllm-notebooks` key, reads the
legacy `goatllm-canvas-board`, and if it has any panels or chat, wraps it as a notebook named
"Notebook" so the user's current work is preserved. The legacy key is then removed. If the legacy
board is empty/absent, start with zero notebooks (empty state invites creating one).

## Error handling

- Deleting the active notebook falls back to the most-recent remaining one, or the no-notebook
  empty state.
- `setActiveNotebookContents` is a no-op if there's no active notebook (guards against a race where
  the assistant streams into a just-deleted notebook).
- Malformed localStorage tolerated by sanitizers (returns `[]`), same as today.

## Testing

- `src/__tests__/canvas.test.ts` — unchanged assertions keep passing (pure helpers intact). Add
  cases for `createNotebook`, `sanitizeNotebook`, `sanitizeNotebooks`, and `migrateLegacyBoard`
  (legacy board with content → one notebook; empty legacy → none; existing notebooks → no
  migration).
- Build + typecheck must pass.
- Manual reload-cycle check (AGENTS.md persistence rule): create two notebooks, add panels, run
  code, switch between them, Cmd+Q, reopen → both restored, active one preserved, no stuck
  spinners or streaming cursors.
- Manual drag check: grab a panel by its header body → it moves. Grab by a toolbar button → it
  does not drag (button fires its action).

## Components / boundaries

- `lib/canvas.ts` — pure data model + helpers. No React, no store.
- `stores/chat.ts` — notebook collection state + persistence.
- `components/Sidebar.tsx` — `NotebookSidebar` (notebook CRUD UI).
- `components/NotebookView.tsx` — board rendering, drag/resize/run, assistant rail (visual rebuild
  + drag fix).
