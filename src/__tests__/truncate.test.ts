import { describe, it, expect } from "vitest";
import { truncateHead, truncateTail, truncateLine, truncationFooter } from "../lib/truncate";

describe("truncateHead", () => {
  it("returns input unchanged when under limits", () => {
    const r = truncateHead("hello\nworld\n");
    expect(r.truncated).toBe(false);
    expect(r.content).toBe("hello\nworld\n");
    expect(r.totalLines).toBe(2);
  });

  it("cuts at line limit", () => {
    const input = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
    const r = truncateHead(input, { maxLines: 3 });
    expect(r.truncated).toBe(true);
    expect(r.truncatedBy).toBe("lines");
    expect(r.outputLines).toBe(3);
    expect(r.content.startsWith("line0\nline1\nline2")).toBe(true);
  });

  it("cuts at byte limit, keeping whole lines", () => {
    const input = "a".repeat(100) + "\n" + "b".repeat(100) + "\n";
    const r = truncateHead(input, { maxBytes: 110 });
    expect(r.truncated).toBe(true);
    expect(r.truncatedBy).toBe("bytes");
    expect(r.outputLines).toBe(1);
  });

  it("flags first-line-too-big", () => {
    const r = truncateHead("X".repeat(1000), { maxBytes: 50 });
    expect(r.firstLineExceedsLimit).toBe(true);
    expect(r.content).toBe("");
  });
});

describe("truncateTail", () => {
  it("keeps the tail", () => {
    const input = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
    const r = truncateTail(input, { maxLines: 3 });
    expect(r.truncated).toBe(true);
    expect(r.outputLines).toBe(3);
    expect(r.content).toBe("line7\nline8\nline9");
  });

  it("returns partial last line when single line exceeds budget", () => {
    const r = truncateTail("X".repeat(1000), { maxBytes: 50 });
    expect(r.lastLinePartial).toBe(true);
    expect(r.content.length).toBe(50);
  });
});

describe("truncateLine", () => {
  it("appends [truncated] when line is too long", () => {
    const r = truncateLine("a".repeat(1000), 100);
    expect(r.wasTruncated).toBe(true);
    expect(r.text).toContain("[truncated]");
  });
});

describe("truncationFooter", () => {
  it("is empty when not truncated", () => {
    const r = truncateHead("ok", { maxBytes: 10 });
    expect(truncationFooter(r)).toBe("");
  });

  it("describes the cut reason", () => {
    const input = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
    const r = truncateHead(input, { maxLines: 3 });
    const footer = truncationFooter(r);
    expect(footer).toContain("3 line limit");
    expect(footer).toContain("kept 3/10");
  });

  it("mentions full output path when provided", () => {
    const r = truncateHead("a\nb\nc\nd", { maxLines: 1 });
    const footer = truncationFooter(r, { fullOutputPath: "/tmp/full.log" });
    expect(footer).toContain("/tmp/full.log");
  });
});
