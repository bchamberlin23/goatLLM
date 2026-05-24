/**
 * Tests for the attachment cache + read/search slice helpers.
 *
 * The actual `read_attachment` / `search_attachment` tools just wrap these
 * helpers, so testing the helpers directly covers the dispatch logic
 * without spinning up the AI SDK.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  putAttachmentText,
  getAttachmentText,
  listAttachments,
  hasAttachments,
  clearConversation,
  readSlice,
  searchAttachment,
  buildPreview,
  _resetForTests,
} from "../lib/attachment-cache";

beforeEach(() => _resetForTests());

describe("attachment-cache", () => {
  it("stores and retrieves full text by conversation + filename", () => {
    putAttachmentText("c1", "notes.pdf", "PDF", "line1\nline2\nline3");
    const got = getAttachmentText("c1", "notes.pdf");
    expect(got?.fullText).toBe("line1\nline2\nline3");
    expect(got?.totalLines).toBe(3);
    expect(getAttachmentText("c2", "notes.pdf")).toBeUndefined();
  });

  it("lists all attachments for a conversation", () => {
    putAttachmentText("c1", "a.pdf", "PDF", "a");
    putAttachmentText("c1", "b.docx", "Word", "b");
    putAttachmentText("c2", "c.pdf", "PDF", "c");
    expect(listAttachments("c1").map((x) => x.filename).sort()).toEqual(["a.pdf", "b.docx"]);
    expect(hasAttachments("c1")).toBe(true);
    expect(hasAttachments("c3")).toBe(false);
  });

  it("clears a conversation's cache", () => {
    putAttachmentText("c1", "a.pdf", "PDF", "a");
    putAttachmentText("c2", "b.pdf", "PDF", "b");
    clearConversation("c1");
    expect(getAttachmentText("c1", "a.pdf")).toBeUndefined();
    expect(getAttachmentText("c2", "b.pdf")?.fullText).toBe("b");
  });

  it("reads a slice by line offset and limit", () => {
    const body = Array.from({ length: 50 }, (_, i) => `line${i + 1}`).join("\n");
    const entry = putAttachmentText("c1", "big.pdf", "PDF", body);
    const slice = readSlice(entry, 10, 5);
    expect(slice.startLine).toBe(10);
    expect(slice.endLine).toBe(14);
    expect(slice.content).toBe("line10\nline11\nline12\nline13\nline14");
    expect(slice.truncated).toBe(true);
  });

  it("clamps offsets and limits to safe ranges", () => {
    const body = "one\ntwo\nthree";
    const entry = putAttachmentText("c1", "tiny.pdf", "PDF", body);
    // limit:0 falls back to default; offset:0 clamps to 1.
    const a = readSlice(entry, 0, 0);
    expect(a.startLine).toBe(1);
    expect(a.content).toBe("one\ntwo\nthree");
    expect(a.truncated).toBe(false);
    // Offset past EOF returns empty content cleanly.
    const b = readSlice(entry, 100, 10);
    expect(b.startLine).toBe(100);
    expect(b.content).toBe("");
  });

  it("finds case-insensitive substring matches with context", () => {
    const body = "Alpha\nbeta gamma\nDELTA epsilon\nbeta again";
    const entry = putAttachmentText("c1", "doc.pdf", "PDF", body);
    const hits = searchAttachment(entry, "beta", { contextLines: 1 });
    expect(hits.length).toBe(2);
    expect(hits[0].line).toBe(2);
    expect(hits[0].context).toEqual(["Alpha", "beta gamma", "DELTA epsilon"]);
    expect(hits[1].line).toBe(4);
  });

  it("supports /regex/flags form", () => {
    const body = "foo123\nfoobar\n123baz";
    const entry = putAttachmentText("c1", "doc.pdf", "PDF", body);
    const hits = searchAttachment(entry, "/^foo/i");
    expect(hits.map((h) => h.line)).toEqual([1, 2]);
  });

  it("falls back to substring match when regex is invalid", () => {
    const body = "hello world\nbye world";
    const entry = putAttachmentText("c1", "doc.pdf", "PDF", body);
    const hits = searchAttachment(entry, "/[/");
    // Invalid regex; substring match for "/[/" finds nothing — that's fine,
    // we just want it to not throw.
    expect(Array.isArray(hits)).toBe(true);
  });

  it("builds a preview that includes outline + head + tail for big docs", () => {
    const head = Array.from({ length: 200 }, (_, i) => `head line ${i + 1}`).join("\n");
    const middle = Array.from({ length: 5000 }, () => "x".repeat(80)).join("\n");
    const tail = Array.from({ length: 100 }, (_, i) => `tail line ${i + 1}`).join("\n");
    const body = `# Chapter 1\n${head}\n\n## Section 2\n${middle}\n\n# Chapter 2\n${tail}`;
    const entry = putAttachmentText("c1", "book.pdf", "PDF", body);
    const preview = buildPreview(entry);
    expect(preview).toContain("Outline:");
    expect(preview).toContain("# Chapter 1");
    expect(preview).toContain("# Chapter 2");
    expect(preview).toContain("--- Beginning");
    expect(preview).toContain("--- End ---");
    expect(preview).toContain("middle elided");
    expect(preview).toContain("read_attachment");
  });

  it("inlines the full body in a preview when document is small enough", () => {
    const entry = putAttachmentText("c1", "tiny.pdf", "PDF", "just three\nshort\nlines");
    const preview = buildPreview(entry);
    expect(preview).toContain("just three");
    expect(preview).not.toContain("middle elided");
  });
});
