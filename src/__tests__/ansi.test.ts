import { describe, it, expect } from "vitest";
import { ansiToHtml, hasAnsi } from "../lib/ansi";

describe("hasAnsi", () => {
  it("detects ANSI escape sequences", () => {
    expect(hasAnsi("\x1b[31mred\x1b[0m")).toBe(true);
    expect(hasAnsi("plain text")).toBe(false);
    expect(hasAnsi("")).toBe(false);
  });
});

describe("ansiToHtml", () => {
  it("returns empty string for empty input", () => {
    expect(ansiToHtml("")).toBe("");
  });

  it("escapes HTML entities in plain text", () => {
    expect(ansiToHtml("<div>&amp;</div>")).toBe("&lt;div&gt;&amp;amp;&lt;/div&gt;");
  });

  it("renders foreground color codes as styled spans", () => {
    const out = ansiToHtml("\x1b[31mred\x1b[0m");
    expect(out).toContain("color:");
    expect(out).toContain("red");
    expect(out).toContain("</span>");
  });

  it("renders bold codes", () => {
    const out = ansiToHtml("\x1b[1mbold\x1b[0m");
    expect(out).toContain("font-weight:bold");
  });

  it("closes span on reset", () => {
    const out = ansiToHtml("\x1b[31mred\x1b[0m plain");
    // Plain text after reset should not be inside a span
    expect(out).toMatch(/<\/span>\s*plain/);
  });

  it("strips unknown codes without crashing", () => {
    expect(() => ansiToHtml("\x1b[999mfoo\x1b[0m")).not.toThrow();
  });

  it("handles bare reset (\\x1b[m treated as 0)", () => {
    const out = ansiToHtml("\x1b[31mred\x1b[mplain");
    expect(out).toContain("plain");
  });

  it("preserves text without ANSI codes", () => {
    expect(ansiToHtml("hello world")).toBe("hello world");
  });

  it("handles bright colors (90-97)", () => {
    const out = ansiToHtml("\x1b[91mbright red\x1b[0m");
    expect(out).toContain("color:");
  });

  it("handles background colors", () => {
    const out = ansiToHtml("\x1b[41mred bg\x1b[0m");
    expect(out).toContain("background-color:");
  });

  it("does not produce nested spans for layered codes", () => {
    // "\x1b[31m\x1b[1mfoo" should produce one span with both styles
    const out = ansiToHtml("\x1b[31m\x1b[1mfoo\x1b[0m");
    // Count opening spans — should be 1
    const opens = (out.match(/<span/g) || []).length;
    const closes = (out.match(/<\/span>/g) || []).length;
    expect(opens).toBe(closes);
  });
});
