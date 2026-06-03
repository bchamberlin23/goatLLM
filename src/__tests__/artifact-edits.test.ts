import { describe, it, expect } from "vitest";
import {
  isEditArtifact,
  parseEditBlocks,
  applyEditBlocks,
} from "../lib/artifact-edits";

// ─── isEditArtifact ───────────────────────────────────────────────────────────

describe("isEditArtifact", () => {
  it("returns true when code contains <<<EDIT>>> markers", () => {
    const code = `<<<EDIT>>>
<<<OLD>>>
<h1>Hello</h1>
<<<NEW>>>
<h1>World</h1>
<<<END>>>`;
    expect(isEditArtifact(code)).toBe(true);
  });

  it("returns false for plain code without markers", () => {
    const code = `<!DOCTYPE html>
<html><body><h1>Hello</h1></body></html>`;
    expect(isEditArtifact(code)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isEditArtifact("")).toBe(false);
  });
});

// ─── parseEditBlocks ──────────────────────────────────────────────────────────

describe("parseEditBlocks", () => {
  it("parses a single edit block", () => {
    const code = `<<<EDIT>>>
<<<OLD>>>
<h1>Hello</h1>
<<<NEW>>>
<h1>World</h1>
<<<END>>>`;
    const edits = parseEditBlocks(code);
    expect(edits).toHaveLength(1);
    expect(edits[0].oldText).toBe("<h1>Hello</h1>");
    expect(edits[0].newText).toBe("<h1>World</h1>");
  });

  it("parses multiple edit blocks", () => {
    const code = `<<<EDIT>>>
<<<OLD>>>
color: blue;
<<<NEW>>>
color: red;
<<<END>>>

<<<EDIT>>>
<<<OLD>>>
font-size: 14px;
<<<NEW>>>
font-size: 16px;
<<<END>>>`;
    const edits = parseEditBlocks(code);
    expect(edits).toHaveLength(2);
    expect(edits[0].oldText).toBe("color: blue;");
    expect(edits[0].newText).toBe("color: red;");
    expect(edits[1].oldText).toBe("font-size: 14px;");
    expect(edits[1].newText).toBe("font-size: 16px;");
  });

  it("handles multi-line old/new text", () => {
    const code = `<<<EDIT>>>
<<<OLD>>>
<div class="header">
  <h1>Title</h1>
  <p>Subtitle</p>
</div>
<<<NEW>>>
<header class="main-header">
  <h1>New Title</h1>
  <p>New Subtitle</p>
</header>
<<<END>>>`;
    const edits = parseEditBlocks(code);
    expect(edits).toHaveLength(1);
    expect(edits[0].oldText).toContain('<div class="header">');
    expect(edits[0].oldText).toContain("</div>");
    expect(edits[0].newText).toContain('<header class="main-header">');
    expect(edits[0].newText).toContain("</header>");
  });

  it("handles empty new_text (deletion)", () => {
    const code = `<<<EDIT>>>
<<<OLD>>>
  /* remove this comment */
<<<NEW>>>
<<<END>>>`;
    const edits = parseEditBlocks(code);
    expect(edits).toHaveLength(1);
    expect(edits[0].oldText).toBe("  /* remove this comment */");
    expect(edits[0].newText).toBe("");
  });

  it("ignores prose around edit blocks", () => {
    const code = `Here is the change I'm making:

<<<EDIT>>>
<<<OLD>>>
old
<<<NEW>>>
new
<<<END>>>

I also updated this:

<<<EDIT>>>
<<<OLD>>>
before
<<<NEW>>>
after
<<<END>>>`;
    const edits = parseEditBlocks(code);
    expect(edits).toHaveLength(2);
    expect(edits[0].oldText).toBe("old");
    expect(edits[1].oldText).toBe("before");
  });

  it("skips malformed blocks (missing OLD marker)", () => {
    const code = `<<<EDIT>>>
<<<NEW>>>
something
<<<END>>>`;
    const edits = parseEditBlocks(code);
    expect(edits).toHaveLength(0);
  });

  it("skips malformed blocks (missing NEW marker)", () => {
    const code = `<<<EDIT>>>
<<<OLD>>>
something
<<<END>>>`;
    const edits = parseEditBlocks(code);
    expect(edits).toHaveLength(0);
  });

  it("returns empty for plain code", () => {
    expect(parseEditBlocks("<h1>Hello</h1>")).toHaveLength(0);
  });

  it("preserves internal whitespace/indentation", () => {
    const code = `<<<EDIT>>>
<<<OLD>>>
    padding: 10px;
    margin: 5px;
<<<NEW>>>
    padding: 20px;
    margin: 10px;
<<<END>>>`;
    const edits = parseEditBlocks(code);
    expect(edits).toHaveLength(1);
    expect(edits[0].oldText).toBe("    padding: 10px;\n    margin: 5px;");
    expect(edits[0].newText).toBe("    padding: 20px;\n    margin: 10px;");
  });
});

// ─── applyEditBlocks ──────────────────────────────────────────────────────────

describe("applyEditBlocks", () => {
  const original = `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <h1>Hello World</h1>
  <p style="color: blue;">Paragraph</p>
</body>
</html>`;

  it("applies a single edit", () => {
    const edits = [{ oldText: "<h1>Hello World</h1>", newText: "<h1>Goodbye World</h1>" }];
    const result = applyEditBlocks(original, edits);
    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(result.code).toContain("<h1>Goodbye World</h1>");
    expect(result.code).not.toContain("<h1>Hello World</h1>");
  });

  it("applies multiple edits sequentially", () => {
    const edits = [
      { oldText: "<h1>Hello World</h1>", newText: "<h1>New Title</h1>" },
      { oldText: "color: blue;", newText: "color: red;" },
    ];
    const result = applyEditBlocks(original, edits);
    expect(result.applied).toBe(2);
    expect(result.failed).toHaveLength(0);
    expect(result.code).toContain("<h1>New Title</h1>");
    expect(result.code).toContain("color: red;");
  });

  it("reports failed edits (text not found)", () => {
    const edits = [
      { oldText: "<h1>Hello World</h1>", newText: "<h1>New</h1>" },
      { oldText: "nonexistent text", newText: "replacement" },
    ];
    const result = applyEditBlocks(original, edits);
    expect(result.applied).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toBe("nonexistent text");
  });

  it("handles deletion (empty newText)", () => {
    const edits = [{ oldText: "  <p style=\"color: blue;\">Paragraph</p>\n", newText: "" }];
    const result = applyEditBlocks(original, edits);
    expect(result.applied).toBe(1);
    expect(result.code).not.toContain("Paragraph");
  });

  it("skips empty oldText", () => {
    const edits = [{ oldText: "", newText: "inserted" }];
    const result = applyEditBlocks(original, edits);
    expect(result.applied).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.code).toBe(original);
  });

  it("returns unchanged code when all edits fail", () => {
    const edits = [
      { oldText: "nope", newText: "yep" },
      { oldText: "also nope", newText: "also yep" },
    ];
    const result = applyEditBlocks(original, edits);
    expect(result.applied).toBe(0);
    expect(result.failed).toHaveLength(2);
    expect(result.code).toBe(original);
  });

  it("later edits see results of earlier edits", () => {
    const edits = [
      { oldText: "Hello World", newText: "Hello Universe" },
      { oldText: "Hello Universe", newText: "Hello Multiverse" },
    ];
    const result = applyEditBlocks(original, edits);
    expect(result.applied).toBe(2);
    expect(result.code).toContain("Hello Multiverse");
  });
});

// ─── End-to-end: parse + apply ────────────────────────────────────────────────

describe("end-to-end: parse + apply", () => {
  it("full flow: parse edit blocks then apply to original code", () => {
    const originalCode = `<html>
<head><title>My Page</title></head>
<body>
  <h1>Welcome</h1>
  <p>This is a test page.</p>
</body>
</html>`;

    const editFence = `<<<EDIT>>>
<<<OLD>>>
<h1>Welcome</h1>
<<<NEW>>>
<h1>Hello there!</h1>
<<<END>>>

<<<EDIT>>>
<<<OLD>>>
<p>This is a test page.</p>
<<<NEW>>>
<p>This is the new page content.</p>
<<<END>>>`;

    expect(isEditArtifact(editFence)).toBe(true);
    const edits = parseEditBlocks(editFence);
    expect(edits).toHaveLength(2);

    const result = applyEditBlocks(originalCode, edits);
    expect(result.applied).toBe(2);
    expect(result.code).toContain("<h1>Hello there!</h1>");
    expect(result.code).toContain("<p>This is the new page content.</p>");
    // Unchanged parts should still be there
    expect(result.code).toContain("<head><title>My Page</title></head>");
  });
});
