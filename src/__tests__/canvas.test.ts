import { describe, expect, it } from "vitest";
import {
  applyAppend,
  applyReplace,
  applyRewrite,
  createBoard,
  createCanvasMessage,
  createCanvasTools,
  createPanel,
  nextPanelPosition,
  nextZ,
  sanitizeBoard,
  sanitizeCanvasMessages,
  sanitizePanels,
  type CanvasBoard,
  type CanvasPanel,
  type CanvasToolDeps,
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

describe("canvas — assistant tools", () => {
  function harness(initial: CanvasPanel[] = []) {
    const board: CanvasBoard = { panels: [...initial], chat: [] };
    const edits: string[] = [];
    const deps: CanvasToolDeps = {
      getBoard: () => board,
      setPanelContent: (id, content) => {
        const p = board.panels.find((x) => x.id === id);
        if (p) p.content = content;
      },
      addPanel: (kind, title, content) => {
        const p = createPanel(kind, { title, content }, board.panels.length + 1);
        board.panels.push(p);
        return p.id;
      },
      recordEdit: (summary) => edits.push(summary),
    };
    return { board, edits, tools: createCanvasTools(deps) };
  }

  it("rewrite_panel writes content and records the edit", async () => {
    const { board, edits, tools } = harness([docPanel({ content: "old" })]);
    const out = await tools.rewrite_panel.execute!(
      { panel_id: "p1", content: "brand new" },
      {} as never,
    );
    expect(board.panels[0].content).toBe("brand new");
    expect(edits).toHaveLength(1);
    expect(out).toMatch(/OK/);
  });

  it("replace_in_panel reports a miss without mutating", async () => {
    const { board, edits, tools } = harness([docPanel({ content: "stable" })]);
    const out = await tools.replace_in_panel.execute!(
      { panel_id: "p1", find: "absent", replace: "x" },
      {} as never,
    );
    expect(board.panels[0].content).toBe("stable");
    expect(edits).toHaveLength(0);
    expect(out).toMatch(/No change/);
  });

  it("returns a helpful error listing ids when the panel is missing", async () => {
    const { tools } = harness([docPanel()]);
    const out = await tools.append_to_panel.execute!(
      { panel_id: "nope", text: "x" },
      {} as never,
    );
    expect(out).toMatch(/No panel with id/);
    expect(out).toContain("p1");
  });

  it("create_panel adds a panel to the board", async () => {
    const { board, tools } = harness();
    const out = await tools.create_panel.execute!(
      { kind: "doc", title: "Email", content: "Hi" },
      {} as never,
    );
    expect(board.panels).toHaveLength(1);
    expect(board.panels[0].title).toBe("Email");
    expect(out).toMatch(/Created/);
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
