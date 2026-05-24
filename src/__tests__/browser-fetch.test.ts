import { describe, it, expect } from "vitest";
import { validateBrowserUrl, extractText, extractBySelector } from "../lib/browser-fetch";

describe("validateBrowserUrl", () => {
  it("accepts plain http and https", () => {
    expect(validateBrowserUrl("http://example.com").ok).toBe(true);
    expect(validateBrowserUrl("https://example.com/path?q=1").ok).toBe(true);
  });

  it("rejects file://", () => {
    const r = validateBrowserUrl("file:///etc/passwd");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not allowed/);
  });

  it("rejects javascript:", () => {
    const r = validateBrowserUrl("javascript:alert(1)");
    expect(r.ok).toBe(false);
  });

  it("rejects data: and blob:", () => {
    expect(validateBrowserUrl("data:text/html,<h1>x</h1>").ok).toBe(false);
    expect(validateBrowserUrl("blob:https://example.com/abc").ok).toBe(false);
  });

  it("rejects chrome-extension://", () => {
    expect(validateBrowserUrl("chrome-extension://abc/def").ok).toBe(false);
  });

  it("rejects ws:// and ftp://", () => {
    expect(validateBrowserUrl("ws://example.com/socket").ok).toBe(false);
    expect(validateBrowserUrl("ftp://example.com/file").ok).toBe(false);
  });

  it("rejects garbage / non-URL input", () => {
    expect(validateBrowserUrl("not a url").ok).toBe(false);
    expect(validateBrowserUrl("").ok).toBe(false);
    expect(validateBrowserUrl("//example.com").ok).toBe(false);
  });

  it("blocks AWS/GCP metadata host 169.254.169.254", () => {
    const r = validateBrowserUrl("http://169.254.169.254/latest/meta-data/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/metadata/i);
  });

  it("blocks metadata.google.internal", () => {
    const r = validateBrowserUrl("http://metadata.google.internal/computeMetadata/v1/");
    expect(r.ok).toBe(false);
  });
});

describe("extractText", () => {
  it("strips script tags and their content", () => {
    const html = "<p>hi</p><script>alert('xss')</script><p>bye</p>";
    const text = extractText(html);
    expect(text).not.toMatch(/alert/);
    expect(text).toMatch(/hi/);
    expect(text).toMatch(/bye/);
  });

  it("strips style tags and their content", () => {
    const html = "<style>body { color: red }</style><p>visible</p>";
    expect(extractText(html)).not.toMatch(/color: red/);
    expect(extractText(html)).toMatch(/visible/);
  });

  it("decodes common HTML entities", () => {
    const html = "<p>Tom &amp; Jerry &lt;3 &quot;cheese&quot;</p>";
    expect(extractText(html)).toMatch(/Tom & Jerry <3 "cheese"/);
  });

  it("collapses whitespace", () => {
    const html = "<p>a    b\n\n\n\nc</p>";
    const text = extractText(html);
    expect(text).not.toMatch(/    /);
    expect(text).not.toMatch(/\n\n\n/);
  });

  it("inserts newlines for block-level elements", () => {
    const html = "<p>line1</p><p>line2</p>";
    expect(extractText(html)).toMatch(/line1.*\n.*line2/s);
  });

  it("strips comments", () => {
    const html = "<!-- secret --><p>visible</p>";
    expect(extractText(html)).not.toMatch(/secret/);
    expect(extractText(html)).toMatch(/visible/);
  });
});

describe("extractBySelector", () => {
  it("extracts by tag name", () => {
    const html = "<html><body><h1>Title</h1><p>body text</p></body></html>";
    const r = extractBySelector(html, "h1");
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].text).toBe("Title");
    expect(r.totalMatched).toBe(1);
  });

  it("extracts by class", () => {
    const html = `<div><span class="hit">A</span><span class="hit">B</span><span>C</span></div>`;
    const r = extractBySelector(html, ".hit");
    expect(r.matches).toHaveLength(2);
    expect(r.matches.map((m) => m.text)).toEqual(["A", "B"]);
  });

  it("extracts by descendant selector", () => {
    const html = `<article><h2>Outer</h2><div><h2>Inner</h2></div></article><h2>Sibling</h2>`;
    const r = extractBySelector(html, "article h2");
    expect(r.matches.map((m) => m.text)).toEqual(["Outer", "Inner"]);
  });

  it("extracts by attribute selector", () => {
    const html = `<a href="/x" data-role="primary">P</a><a href="/y">S</a>`;
    const r = extractBySelector(html, "a[data-role=primary]");
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].text).toBe("P");
  });

  it("returns html when mode is 'html'", () => {
    const html = `<main><p>hello</p></main>`;
    const r = extractBySelector(html, "main", { mode: "html" });
    expect(r.matches[0].html).toBe("<main><p>hello</p></main>");
    expect(r.matches[0].text).toBe("hello");
  });

  it("respects maxMatches and reports truncation", () => {
    const html = "<ul>" + Array.from({ length: 20 }, (_, i) => `<li>item ${i}</li>`).join("") + "</ul>";
    const r = extractBySelector(html, "li", { maxMatches: 5 });
    expect(r.matches).toHaveLength(5);
    expect(r.totalMatched).toBe(20);
    expect(r.truncated).toBe(true);
  });

  it("clamps maxMatches to [1, 50]", () => {
    const html = Array.from({ length: 80 }, () => "<p>x</p>").join("");
    const r = extractBySelector(html, "p", { maxMatches: 1000 });
    expect(r.matches).toHaveLength(50);
    expect(r.truncated).toBe(true);
  });

  it("returns empty matches array when nothing matches (not an error)", () => {
    const r = extractBySelector("<p>hi</p>", ".missing");
    expect(r.matches).toEqual([]);
    expect(r.totalMatched).toBe(0);
    expect(r.truncated).toBe(false);
  });

  it("throws on invalid selector syntax", () => {
    expect(() => extractBySelector("<p>hi</p>", "[[invalid")).toThrow(/Invalid selector/);
  });

  it("collapses internal whitespace in extracted text", () => {
    const html = `<main>line1\n\n\n\nline2     line3</main>`;
    const r = extractBySelector(html, "main");
    expect(r.matches[0].text).not.toMatch(/\n{3,}/);
    expect(r.matches[0].text).not.toMatch(/    /);
  });
});
