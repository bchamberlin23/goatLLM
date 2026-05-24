import { describe, it, expect } from "vitest";
import {
  parsePptxSource,
  parseXlsxSource,
  exportDocxBlob,
  exportXlsxBlob,
} from "../lib/office-artifacts";
import { extractArtifactBlocks } from "../stores/chat";

describe("office artifact detection", () => {
  it("extracts docx, pptx, and xlsx blocks alongside HTML", () => {
    const content = `
### Resume
\`\`\`docx
# Jane Doe
Software engineer.
\`\`\`

### Q3 Deck
\`\`\`pptx
# Quarterly review
- Revenue up
\`\`\`

### Numbers
\`\`\`xlsx
| a | b |
| - | - |
| 1 | 2 |
\`\`\`
`;
    const blocks = extractArtifactBlocks(content);
    expect(blocks.map((b) => b.kind)).toEqual(["docx", "pptx", "xlsx"]);
    expect(blocks[0].title).toBe("Resume");
    expect(blocks[1].title).toBe("Q3 Deck");
    expect(blocks[2].title).toBe("Numbers");
  });
});

describe("pptx parser", () => {
  it("splits slides on --- and parses titles, bullets, notes", () => {
    const src = `# First
## Subtitle
- one
- two
Notes: speaker note here
---
# Second
- alpha`;
    const slides = parsePptxSource(src);
    expect(slides).toHaveLength(2);
    expect(slides[0].title).toBe("First");
    expect(slides[0].subtitle).toBe("Subtitle");
    expect(slides[0].bullets).toEqual(["one", "two"]);
    expect(slides[0].notes).toBe("speaker note here");
    expect(slides[1].title).toBe("Second");
    expect(slides[1].bullets).toEqual(["alpha"]);
  });

  it("handles a single slide with no divider", () => {
    const slides = parsePptxSource("# Only slide\n- bullet");
    expect(slides).toHaveLength(1);
    expect(slides[0].title).toBe("Only slide");
  });
});

describe("xlsx parser", () => {
  it("parses one sheet with no ## header", () => {
    const src = `| Name | Age |
| ---- | --- |
| Ada  | 36  |
| Bob  | 42  |`;
    const sheets = parseXlsxSource(src);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("Sheet1");
    expect(sheets[0].rows[0]).toEqual(["Name", "Age"]);
    // Numbers should be coerced.
    expect(sheets[0].rows[1]).toEqual(["Ada", 36]);
    expect(sheets[0].rows[2]).toEqual(["Bob", 42]);
  });

  it("splits on ## sheet headers", () => {
    const src = `## Revenue
| Q | $ |
| - | - |
| Q1 | 100 |

## Headcount
| Team | n |
| ---- | - |
| Eng  | 12 |`;
    const sheets = parseXlsxSource(src);
    expect(sheets.map((s) => s.name)).toEqual(["Revenue", "Headcount"]);
    expect(sheets[0].rows).toHaveLength(2);
    expect(sheets[1].rows[1]).toEqual(["Eng", 12]);
  });

  it("coerces numbers with commas and percent signs", () => {
    const src = `| metric | value |
| ------ | ----- |
| growth | 12.5% |
| revenue | 1,200,000 |`;
    const [sheet] = parseXlsxSource(src);
    expect(sheet.rows[1][1]).toBe(12.5);
    expect(sheet.rows[2][1]).toBe(1200000);
  });
});

describe("office exporters produce non-empty blobs", () => {
  it("exportDocxBlob returns a Blob with bytes", async () => {
    const blob = await exportDocxBlob("# Hello\n\nThis is a test.", "Test");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(100);
  });

  it("exportXlsxBlob returns a Blob with bytes", async () => {
    const blob = await exportXlsxBlob(
      `## Sheet1\n| a | b |\n| - | - |\n| 1 | 2 |`,
      "Test",
    );
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(100);
  });
});

describe("XML artifact tag extraction (design mode)", () => {
  it("extracts <artifact kind='html'> XML tags", () => {
    const content = `<artifact kind="html" id="abc" title="Coffee Shop Landing">
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Coffee Shop</title></head>
<body><h1>Welcome</h1></body>
</html>
</artifact>`;
    const blocks = extractArtifactBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("html");
    expect(blocks[0].title).toBe("Coffee Shop Landing");
    expect(blocks[0].code).toContain("<!doctype html>");
    expect(blocks[0].code).toContain("<h1>Welcome</h1>");
  });

  it("extracts XML artifact alongside markdown fence artifacts", () => {
    const content = `Here's a page:

<artifact kind="html" title="Hero Page">
<!doctype html><html><body><h1>Hero</h1></body></html>
</artifact>

And some python:

\`\`\`python
print("hello")
\`\`\``;
    const blocks = extractArtifactBlocks(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind).toBe("html");
    expect(blocks[0].title).toBe("Hero Page");
    expect(blocks[1].kind).toBe("python");
  });

  it("respects enabledKinds filter for XML artifacts", () => {
    const content = `<artifact kind="html" title="Page"><!doctype html></artifact>`;
    const blocks = extractArtifactBlocks(content, {
      enabledKinds: new Set(["python"]),
    });
    expect(blocks).toHaveLength(0);
  });

  it("falls back to first line when title attribute is missing", () => {
    const content = `<artifact kind="html">
<!doctype html>
<html><body><h1>Untitled</h1></body></html>
</artifact>`;
    const blocks = extractArtifactBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe("<!doctype html>");
  });

  it("skips empty XML artifacts", () => {
    const content = `<artifact kind="html" title="Empty"></artifact>`;
    const blocks = extractArtifactBlocks(content);
    expect(blocks).toHaveLength(0);
  });
});
