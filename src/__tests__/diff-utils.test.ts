import { describe, it, expect } from "vitest";
import { computeDiff, formatDiffPreview } from "../lib/diff-utils";

describe("computeDiff", () => {
  it("returns no changes for identical text", () => {
    const r = computeDiff("a\nb\nc", "a\nb\nc");
    expect(r.added).toBe(0);
    expect(r.removed).toBe(0);
    expect(r.lines.every((l) => l.type === "unchanged")).toBe(true);
  });

  it("detects added lines", () => {
    const r = computeDiff("a\nc", "a\nb\nc");
    expect(r.added).toBe(1);
    expect(r.removed).toBe(0);
    expect(r.lines.find((l) => l.type === "added")?.content).toBe("b");
  });

  it("detects removed lines", () => {
    const r = computeDiff("a\nb\nc", "a\nc");
    expect(r.added).toBe(0);
    expect(r.removed).toBe(1);
    expect(r.lines.find((l) => l.type === "removed")?.content).toBe("b");
  });

  it("counts adds and removes for full rewrites", () => {
    const r = computeDiff("a\nb\nc", "x\ny\nz");
    expect(r.added).toBe(3);
    expect(r.removed).toBe(3);
  });

  it("handles empty old text", () => {
    // "" splits to [""], so old has 1 empty line; new has 2 lines.
    // Diff shows the old empty line as unchanged with the new "a", and new "b" added.
    const r = computeDiff("", "a\nb");
    expect(r.added).toBeGreaterThanOrEqual(1);
  });

  it("handles empty new text", () => {
    const r = computeDiff("a\nb", "");
    expect(r.removed).toBeGreaterThanOrEqual(1);
  });

  it("preserves line numbers on unchanged lines", () => {
    const r = computeDiff("a\nb\nc", "a\nb\nc");
    expect(r.lines[0]).toMatchObject({ type: "unchanged", oldLine: 1, newLine: 1 });
    expect(r.lines[2]).toMatchObject({ type: "unchanged", oldLine: 3, newLine: 3 });
  });
});

describe("formatDiffPreview", () => {
  it("returns '(no changes)' when texts are identical", () => {
    expect(formatDiffPreview("foo", "foo")).toBe("(no changes)");
  });

  it("includes a hunk header", () => {
    const out = formatDiffPreview("a\nb\nc", "a\nB\nc");
    expect(out).toMatch(/^@@/);
  });

  it("prefixes added lines with +", () => {
    const out = formatDiffPreview("a", "a\nb");
    expect(out).toMatch(/\+b/);
  });

  it("prefixes removed lines with -", () => {
    const out = formatDiffPreview("a\nb", "a");
    expect(out).toMatch(/-b/);
  });
});
