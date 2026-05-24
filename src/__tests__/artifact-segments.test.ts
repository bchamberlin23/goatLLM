import { describe, it, expect } from "vitest";
import { splitContentByArtifacts, type ContentSegment } from "../lib/artifact-segments";

describe("splitContentByArtifacts", () => {
  it("returns one text segment when there is no fence", () => {
    const out = splitContentByArtifacts("hello there");
    expect(out).toEqual([{ type: "text", text: "hello there" }]);
  });

  it("strips an artifact fence and emits a card segment", () => {
    const src = `Here's a deck.

### Q3 Deck
\`\`\`pptx
# Slide 1
- one
\`\`\`

Anything else?`;
    const out = splitContentByArtifacts(src);
    expect(out).toEqual([
      { type: "text", text: "Here's a deck." },
      { type: "artifact", kind: "pptx", title: "Q3 Deck", complete: true, code: "# Slide 1\n- one" },
      { type: "text", text: "Anything else?" },
    ]);
  });

  it("does not strip non-artifact code blocks", () => {
    const src = `Here is some shell:

\`\`\`bash
ls -la
\`\`\`

Done.`;
    const out = splitContentByArtifacts(src);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("text");
    expect((out[0] as { text: string }).text).toContain("```bash");
  });

  it("emits an incomplete artifact when the closing fence is missing", () => {
    const src = `Working on it.

### Resume
\`\`\`docx
# Jane Doe
Software engineer.`;
    const out = splitContentByArtifacts(src);
    expect(out[out.length - 1]).toEqual({
      type: "artifact",
      kind: "docx",
      title: "Resume",
      complete: false,
      code: "# Jane Doe\nSoftware engineer.",
    });
  });

  it("uses an empty title when no heading precedes the fence", () => {
    const src = `\`\`\`xlsx
| a | b |
| - | - |
| 1 | 2 |
\`\`\``;
    const out = splitContentByArtifacts(src);
    expect(out).toEqual([
      { type: "artifact", kind: "xlsx", title: "", complete: true, code: "| a | b |\n| - | - |\n| 1 | 2 |" },
    ]);
  });

  it("handles multiple artifacts interleaved with text", () => {
    const src = `## Section

### Doc
\`\`\`docx
# A
\`\`\`

middle

### Sheet
\`\`\`xlsx
| x | y |
| - | - |
| 1 | 2 |
\`\`\``;
    const out = splitContentByArtifacts(src);
    const types = out.map((p) => p.type);
    expect(types).toEqual(["text", "artifact", "text", "artifact"]);
  });

  it("recognizes word/excel/powerpoint as kind aliases", () => {
    const src = `\`\`\`word
# Hi
\`\`\`

\`\`\`excel
| a | b |
| - | - |
\`\`\`

\`\`\`powerpoint
# Slide
\`\`\``;
    const out = splitContentByArtifacts(src);
    const kinds = out
      .filter((p): p is Extract<ContentSegment, { type: "artifact" }> => p.type === "artifact")
      .map((p) => p.kind);
    expect(kinds).toEqual(["docx", "xlsx", "pptx"]);
  });
});
