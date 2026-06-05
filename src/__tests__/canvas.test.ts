import { describe, expect, it } from "vitest";
import {
  applyAppend,
  applyEdits,
  applyReplace,
  applyRewrite,
  createBoard,
  createCanvasMessage,
  createNotebookTools,
  createNotebook,
  createPanel,
  deriveCanvasAction,
  migrateLegacyBoard,
  nextPanelPosition,
  nextZ,
  resolveActionResult,
  sanitizeBoard,
  sanitizeCanvasMessages,
  sanitizeNotebook,
  sanitizeNotebooks,
  sanitizePanels,
  DEFAULT_NOTEBOOK_NAME,
  type CanvasBoard,
  type CanvasPanel,
  type NotebookToolDeps,
} from "../lib/canvas";

const docPanel = (overrides: Partial<CanvasPanel> = {}): CanvasPanel =>
  createPanel("doc", { id: "p1", title: "Notes", content: "Hello world", ...overrides }, 1000);

describe("canvas — pure edit operations", () => {
  it("rewrite replaces the whole body and labels draft vs rewrite", () => {
    const empty = applyRewrite(docPanel({ content: "" }), "Fresh text");
    expect(empty.ok).toBe(true);
    expect(empty.content).toBe("Fresh text");
    expect(empty.summary).toMatch(/Drafted/);

    const filled = applyRewrite(docPanel({ content: "Old" }), "New body");
    expect(filled.content).toBe("New body");
    expect(filled.summary).toMatch(/Rewrote/);
  });

  it("replace fails cleanly on a miss and leaves content untouched", () => {
    const panel = docPanel({ content: "the quick brown fox" });
    const miss = applyReplace(panel, "lazy dog", "sleepy cat");
    expect(miss.ok).toBe(false);
    expect(miss.content).toBe("the quick brown fox");
    expect(miss.summary).toMatch(/Couldn't find/);
  });

  it("replace swaps the first exact match on a hit", () => {
    const panel = docPanel({ content: "one two two three" });
    const hit = applyReplace(panel, "two", "TWO");
    expect(hit.ok).toBe(true);
    // Only the first occurrence is replaced.
    expect(hit.content).toBe("one TWO two three");
  });

  it("replace rejects empty search text", () => {
    const result = applyReplace(docPanel(), "", "x");
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/Empty search/);
  });

  it("append adds to the end with a blank line, trimming trailing space first", () => {
    expect(applyAppend(docPanel({ content: "Intro\n\n" }), "Body").content).toBe("Intro\n\nBody");
    // Appending to an empty panel just sets the text.
    expect(applyAppend(docPanel({ content: "" }), "First").content).toBe("First");
  });

  it("applyEdits applies a batch in order and fails atomically on a miss", () => {
    const ok = applyEdits(docPanel({ content: "one two three" }), [
      { oldText: "one", newText: "1" },
      { oldText: "three", newText: "3" },
    ]);
    expect(ok.ok).toBe(true);
    expect(ok.content).toBe("1 two 3");

    const miss = applyEdits(docPanel({ content: "one two three" }), [
      { oldText: "one", newText: "1" },
      { oldText: "absent", newText: "x" },
    ]);
    expect(miss.ok).toBe(false);
    expect(miss.content).toBe("one two three"); // nothing applied

    expect(applyEdits(docPanel(), []).ok).toBe(false);
  });
});

describe("canvas — layout helpers", () => {
  it("cascades new panel positions down-and-right as the board fills", () => {
    const board = createBoard();
    const first = nextPanelPosition(board, "doc");
    expect(first).toMatchObject({ x: 32, y: 32 });

    board.panels.push(createPanel("doc", {}, 1));
    const second = nextPanelPosition(board, "doc");
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it("nextZ returns one above the current top panel", () => {
    const board: CanvasBoard = {
      panels: [createPanel("doc", { z: 3 }, 1), createPanel("code", { z: 7 }, 2)],
      chat: [],
    };
    expect(nextZ(board)).toBe(8);
    expect(nextZ(createBoard())).toBe(1);
  });
});

describe("canvas — hydration sanitizers", () => {
  it("settles a running code panel that captured output to done, else idle", () => {
    const cleaned = sanitizePanels([
      { id: "a", kind: "code", title: "a.py", content: "print(1)", layout: { x: 0, y: 0, w: 1, h: 1 }, status: "running", output: "1", z: 1, updatedAt: 1 },
      { id: "b", kind: "code", title: "b.py", content: "print(2)", layout: { x: 0, y: 0, w: 1, h: 1 }, status: "running", output: "", z: 1, updatedAt: 1 },
      { id: "c", kind: "doc", title: "c", content: "x", layout: { x: 0, y: 0, w: 1, h: 1 }, status: "idle", z: 1, updatedAt: 1 },
    ]);
    expect(cleaned[0].status).toBe("done");
    expect(cleaned[0].output).toBe("1");
    expect(cleaned[1].status).toBe("idle");
    expect(cleaned[2].status).toBe("idle");
  });

  it("clears streaming flags on chat messages during hydrate", () => {
    const cleaned = sanitizeCanvasMessages([
      { id: "m1", role: "assistant", content: "partial", streaming: true, createdAt: 1 },
      { id: "m2", role: "user", content: "hi", createdAt: 2 },
    ]);
    expect(cleaned[0].streaming).toBe(false);
    expect(cleaned[0].content).toBe("partial");
    expect(cleaned[1].streaming).toBeUndefined();
  });

  it("sanitizeBoard tolerates malformed storage and settles nested state", () => {
    expect(sanitizeBoard(null)).toEqual({ panels: [], chat: [] });
    expect(sanitizeBoard("oops")).toEqual({ panels: [], chat: [] });

    const board = sanitizeBoard({
      panels: [
        null,
        5,
        { id: "ok", kind: "code", title: "ok.py", content: "x", layout: { x: 0, y: 0, w: 1, h: 1 }, status: "running", output: "done", z: 1, updatedAt: 1 },
      ],
      chat: [{ id: "m", role: "assistant", content: "c", streaming: true, createdAt: 1 }],
    });
    expect(board.panels).toHaveLength(1);
    expect(board.panels[0].status).toBe("done");
    expect(board.chat[0].streaming).toBe(false);
  });
});

describe("canvas — notebook agent tools", () => {
  function harness(initial: CanvasPanel[] = []) {
    const board: CanvasBoard = { panels: [...initial], chat: [] };
    let seq = board.panels.length;
    const deps: NotebookToolDeps = {
      getBoard: () => board,
      createPanel: (kind, title, content) => {
        const p = createPanel(kind, { title, content }, ++seq);
        board.panels.push(p);
        return p.id;
      },
      setPanelContent: (id, content) => {
        const p = board.panels.find((x) => x.id === id);
        if (p) p.content = content;
      },
      setPanelTitle: (id, title) => {
        const p = board.panels.find((x) => x.id === id);
        if (p) p.title = title;
      },
    };
    return { board, tools: createNotebookTools(deps) };
  }

  it("list_panels reports id, title, type and size", async () => {
    const { tools } = harness([docPanel({ content: "hello" })]);
    const out = (await tools.list_panels.execute!({}, {} as never)) as string;
    expect(out).toContain("p1");
    expect(out).toContain("Notes");
    expect(out).toContain("doc");
  });

  it("read_panel returns full content, or an error for a missing id", async () => {
    const { tools } = harness([docPanel({ content: "the body" })]);
    const ok = (await tools.read_panel.execute!({ panel_id: "p1" }, {} as never)) as string;
    expect(ok).toContain("the body");
    const miss = (await tools.read_panel.execute!({ panel_id: "nope" }, {} as never)) as string;
    expect(miss).toMatch(/No panel with id/);
  });

  it("write_panel replaces content; edit_panel does single and multi edits", async () => {
    const { board, tools } = harness([docPanel({ content: "old body" })]);
    await tools.write_panel.execute!({ panel_id: "p1", content: "brand new" }, {} as never);
    expect(board.panels[0].content).toBe("brand new");

    await tools.edit_panel.execute!({ panel_id: "p1", old_text: "brand", new_text: "shiny" }, {} as never);
    expect(board.panels[0].content).toBe("shiny new");

    await tools.edit_panel.execute!(
      { panel_id: "p1", edits: [{ oldText: "shiny", newText: "very" }, { oldText: "new", newText: "old" }] },
      {} as never,
    );
    expect(board.panels[0].content).toBe("very old");
  });

  it("edit_panel reports a miss without mutating", async () => {
    const { board, tools } = harness([docPanel({ content: "stable" })]);
    const out = (await tools.edit_panel.execute!(
      { panel_id: "p1", old_text: "absent", new_text: "x" },
      {} as never,
    )) as string;
    expect(board.panels[0].content).toBe("stable");
    expect(out).toMatch(/No change/);
  });

  it("append_panel adds to the end and lists ids on a missing panel", async () => {
    const { board, tools } = harness([docPanel({ content: "Intro" })]);
    await tools.append_panel.execute!({ panel_id: "p1", text: "More" }, {} as never);
    expect(board.panels[0].content).toBe("Intro\n\nMore");

    const miss = (await tools.append_panel.execute!({ panel_id: "nope", text: "x" }, {} as never)) as string;
    expect(miss).toMatch(/No panel with id/);
    expect(miss).toContain("p1");
  });

  it("create_panel adds a panel and returns its id", async () => {
    const { board, tools } = harness();
    const out = (await tools.create_panel.execute!(
      { kind: "doc", title: "Email", content: "Hi" },
      {} as never,
    )) as string;
    expect(board.panels).toHaveLength(1);
    expect(board.panels[0].title).toBe("Email");
    expect(out).toMatch(/Created/);
  });

  it("rename_panel changes the title and no-ops on empty/unchanged", async () => {
    const { board, tools } = harness([docPanel({ title: "Draft" })]);
    const out = (await tools.rename_panel.execute!({ panel_id: "p1", title: "Final" }, {} as never)) as string;
    expect(board.panels[0].title).toBe("Final");
    expect(out).toMatch(/Renamed/);

    expect(await tools.rename_panel.execute!({ panel_id: "p1", title: "  " }, {} as never)).toMatch(/No change/);
    expect(await tools.rename_panel.execute!({ panel_id: "p1", title: "Final" }, {} as never)).toMatch(/No change/);
    expect(board.panels[0].title).toBe("Final");
  });
});

describe("canvas — message factory", () => {
  it("creates messages with role, content, and an id", () => {
    const m = createCanvasMessage("user", "hello", 42);
    expect(m.role).toBe("user");
    expect(m.content).toBe("hello");
    expect(m.id).toContain("cv-42-");
    expect(m.createdAt).toBe(42);
  });
});

describe("canvas — live action feedback", () => {
  const board: CanvasBoard = {
    panels: [createPanel("doc", { id: "p1", title: "Outreach email", content: "hi" }, 1)],
    chat: [],
  };

  it("derives a create action with the right kind, title, and panel kind", () => {
    expect(deriveCanvasAction("create_panel", { kind: "code", title: "run.py" }, board)).toEqual({
      kind: "create",
      panelKind: "code",
      title: "run.py",
    });
    // Missing title falls back to a sensible default per kind.
    expect(deriveCanvasAction("create_panel", { kind: "doc" }, board)).toMatchObject({
      kind: "create",
      title: "Untitled",
    });
  });

  it("resolves an edit action's target title from the board by id", () => {
    expect(deriveCanvasAction("edit_panel", { panel_id: "p1" }, board)).toEqual({
      kind: "replace",
      title: "Outreach email",
      panelKind: "doc",
    });
    expect(deriveCanvasAction("read_panel", { panel_id: "p1" }, board)).toMatchObject({
      kind: "read",
      title: "Outreach email",
    });
    // Rename uses the new title, not the current one.
    expect(deriveCanvasAction("rename_panel", { panel_id: "p1", title: "Cold email" }, board)).toMatchObject({
      kind: "rename",
      title: "Cold email",
    });
  });

  it("returns null for orientation/non-edit tools", () => {
    expect(deriveCanvasAction("list_panels", {}, board)).toBeNull();
    expect(deriveCanvasAction("done", { summary: "x" }, board)).toBeNull();
    expect(deriveCanvasAction("web_search", { query: "x" }, board)).toBeNull();
  });

  it("resolves a tool result to done/error with a short detail", () => {
    expect(resolveActionResult("OK — rewrote outreach email. It now has 1,280 characters.")).toEqual({
      status: "done",
      detail: "1,280 chars",
    });
    expect(resolveActionResult('Created doc panel "Email" with id p9.')).toEqual({ status: "done" });
    expect(resolveActionResult('No panel with id "x". Existing panel ids: p1.')).toEqual({
      status: "error",
      detail: "Panel not found",
    });
    expect(resolveActionResult('No change: Couldn\'t find "lazy dog". Use rewrite_panel…').status).toBe("error");
  });

  it("settles a running action to done on hydrate (no stuck spinner)", () => {
    const cleaned = sanitizeCanvasMessages([
      {
        id: "m1",
        role: "assistant",
        content: "Working",
        streaming: true,
        actions: [
          { id: "t1", kind: "rewrite", title: "a", status: "running" },
          { id: "t2", kind: "create", title: "b", status: "done" },
        ],
        createdAt: 1,
      },
    ]);
    expect(cleaned[0].streaming).toBe(false);
    expect(cleaned[0].actions?.[0].status).toBe("done");
    expect(cleaned[0].actions?.[1].status).toBe("done");
  });
});

describe("canvas — notebook collection", () => {
  it("createNotebook starts empty with a default name, honoring a custom one", () => {
    const blank = createNotebook(undefined, 100);
    expect(blank.name).toBe(DEFAULT_NOTEBOOK_NAME);
    expect(blank.panels).toEqual([]);
    expect(blank.chat).toEqual([]);
    expect(blank.id).toContain("nb-100-");
    expect(blank.createdAt).toBe(100);
    expect(blank.updatedAt).toBe(100);

    const named = createNotebook("  Research  ", 100);
    expect(named.name).toBe("Research"); // trimmed

    // Blank/whitespace names fall back to the default.
    expect(createNotebook("   ", 100).name).toBe(DEFAULT_NOTEBOOK_NAME);
  });

  it("sanitizeNotebook backfills missing fields and settles inner state", () => {
    expect(sanitizeNotebook(null)).toBeNull();
    expect(sanitizeNotebook("nope")).toBeNull();

    const cleaned = sanitizeNotebook({
      // id/name/timestamps intentionally missing
      panels: [
        null,
        { id: "p", kind: "code", title: "p.py", content: "x", layout: { x: 0, y: 0, w: 1, h: 1 }, status: "running", output: "ok", z: 1, updatedAt: 1 },
      ],
      chat: [{ id: "m", role: "assistant", content: "hi", streaming: true, createdAt: 1 }],
    });
    expect(cleaned).not.toBeNull();
    expect(cleaned!.id).toMatch(/^nb-/);
    expect(cleaned!.name).toBe(DEFAULT_NOTEBOOK_NAME);
    expect(typeof cleaned!.createdAt).toBe("number");
    expect(cleaned!.updatedAt).toBe(cleaned!.createdAt); // backfilled from createdAt
    // Inner sanitizers ran: running panel with output → done, streaming flag cleared.
    expect(cleaned!.panels).toHaveLength(1);
    expect(cleaned!.panels[0].status).toBe("done");
    expect(cleaned!.chat[0].streaming).toBe(false);
  });

  it("sanitizeNotebook preserves a valid id/name/timestamps", () => {
    const cleaned = sanitizeNotebook({
      id: "nb-keep",
      name: "Keep me",
      panels: [],
      chat: [],
      createdAt: 5,
      updatedAt: 9,
    });
    expect(cleaned).toMatchObject({ id: "nb-keep", name: "Keep me", createdAt: 5, updatedAt: 9 });
  });

  it("sanitizeNotebooks drops non-objects and tolerates malformed storage", () => {
    expect(sanitizeNotebooks(null)).toEqual([]);
    expect(sanitizeNotebooks("oops")).toEqual([]);

    const cleaned = sanitizeNotebooks([
      null,
      7,
      { id: "nb-a", name: "A", panels: [], chat: [], createdAt: 1, updatedAt: 1 },
    ]);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].id).toBe("nb-a");
  });

  it("migrateLegacyBoard folds a populated legacy board into one notebook", () => {
    const legacy: CanvasBoard = {
      panels: [createPanel("doc", { id: "p1", content: "hi" }, 1)],
      chat: [createCanvasMessage("user", "hello", 1)],
    };
    const migrated = migrateLegacyBoard(legacy, null, 500);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].name).toBe("Notebook");
    expect(migrated[0].panels).toHaveLength(1);
    expect(migrated[0].chat).toHaveLength(1);
    expect(migrated[0].id).toContain("nb-500-");
  });

  it("migrateLegacyBoard returns nothing for an empty legacy board", () => {
    expect(migrateLegacyBoard(createBoard(), null)).toEqual([]);
    expect(migrateLegacyBoard(null, null)).toEqual([]);
  });

  it("migrateLegacyBoard is a no-op when notebooks already exist", () => {
    const existing = [{ id: "nb-x", name: "Existing", panels: [], chat: [], createdAt: 1, updatedAt: 1 }];
    const legacy: CanvasBoard = {
      panels: [createPanel("doc", { id: "p1", content: "hi" }, 1)],
      chat: [],
    };
    const result = migrateLegacyBoard(legacy, existing);
    // Existing notebooks are returned untouched; the legacy board is ignored.
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("nb-x");
  });
});
