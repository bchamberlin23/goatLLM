/**
 * Tests for URL extraction + YouTube ID parsing.
 *
 * The actual fetch path hits the network, so we don't test that here;
 * the parsers are pure and worth pinning down so a regression doesn't
 * silently break auto-fetch on send.
 */
import { describe, it, expect } from "vitest";
import { extractUrls, youtubeVideoId } from "../lib/url-fetch";

describe("extractUrls()", () => {
  it("finds a single URL in prose", () => {
    expect(extractUrls("check out https://example.com/page")).toEqual([
      "https://example.com/page",
    ]);
  });

  it("finds multiple URLs and dedupes", () => {
    const urls = extractUrls(
      "see https://a.com/x and https://b.org/y, also https://a.com/x",
    );
    expect(urls).toEqual(["https://a.com/x", "https://b.org/y"]);
  });

  it("strips trailing punctuation", () => {
    expect(extractUrls("read https://example.com/a.")).toEqual([
      "https://example.com/a",
    ]);
    expect(extractUrls("yes (https://example.com/a)?")).toEqual([
      "https://example.com/a",
    ]);
  });

  it("ignores non-URL text", () => {
    expect(extractUrls("nothing here, maybe foo.com but no scheme")).toEqual([]);
  });

  it("returns empty for empty input", () => {
    expect(extractUrls("")).toEqual([]);
  });
});

describe("youtubeVideoId()", () => {
  it("extracts from watch?v= URLs", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(
      youtubeVideoId("https://youtube.com/watch?v=abc123xyz&t=10s"),
    ).toBe("abc123xyz");
  });

  it("extracts from youtu.be short URLs", () => {
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ?si=xyz")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("extracts from /shorts/ and /embed/", () => {
    expect(youtubeVideoId("https://www.youtube.com/shorts/aBcDeFg1234")).toBe(
      "aBcDeFg1234",
    );
    expect(youtubeVideoId("https://www.youtube.com/embed/aBcDeFg1234")).toBe(
      "aBcDeFg1234",
    );
  });

  it("returns null for non-YouTube URLs", () => {
    expect(youtubeVideoId("https://example.com/video")).toBeNull();
    expect(youtubeVideoId("https://www.youtube.com/")).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(youtubeVideoId("not a url")).toBeNull();
  });
});
