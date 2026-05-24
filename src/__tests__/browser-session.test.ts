import { describe, it, expect, beforeEach } from "vitest";
import {
  parseSetCookie,
  buildCookieHeader,
  storeCookies,
  openSession,
  closeSession,
  listSessions,
} from "../lib/browser-session";

describe("parseSetCookie", () => {
  const url = new URL("https://example.com/foo");

  it("parses a basic name=value cookie", () => {
    const c = parseSetCookie("session=abc123", url);
    expect(c).not.toBeNull();
    expect(c!.name).toBe("session");
    expect(c!.value).toBe("abc123");
    expect(c!.domain).toBe("example.com");
    expect(c!.path).toBe("/");
    expect(c!.secure).toBe(false);
  });

  it("parses domain attribute and strips leading dot", () => {
    const c = parseSetCookie("a=1; Domain=.example.com", url);
    expect(c!.domain).toBe("example.com");
  });

  it("parses path attribute", () => {
    const c = parseSetCookie("a=1; Path=/api", url);
    expect(c!.path).toBe("/api");
  });

  it("parses Max-Age into expiresAt in ms", () => {
    const before = Date.now();
    const c = parseSetCookie("a=1; Max-Age=60", url);
    expect(c!.expiresAt).toBeGreaterThanOrEqual(before + 60_000 - 1000);
    expect(c!.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000 + 1000);
  });

  it("parses Expires (RFC 1123 date)", () => {
    const c = parseSetCookie("a=1; Expires=Wed, 09 Jun 2027 10:18:14 GMT", url);
    expect(c!.expiresAt).toBe(Date.parse("Wed, 09 Jun 2027 10:18:14 GMT"));
  });

  it("flags Secure", () => {
    const c = parseSetCookie("a=1; Secure", url);
    expect(c!.secure).toBe(true);
  });

  it("returns null for garbage", () => {
    expect(parseSetCookie("", url)).toBeNull();
    expect(parseSetCookie("=novalue", url)).toBeNull();
    expect(parseSetCookie("noequals", url)).toBeNull();
  });
});

describe("buildCookieHeader", () => {
  it("includes cookies that domain-match exactly", () => {
    const url = new URL("https://example.com/");
    const c = parseSetCookie("a=1", url)!;
    expect(buildCookieHeader([c], url)).toBe("a=1");
  });

  it("includes cookies that domain-match a subdomain", () => {
    const setUrl = new URL("https://example.com/");
    const c = parseSetCookie("a=1; Domain=example.com", setUrl)!;
    const reqUrl = new URL("https://api.example.com/v1");
    expect(buildCookieHeader([c], reqUrl)).toBe("a=1");
  });

  it("excludes cookies for unrelated hosts", () => {
    const c = parseSetCookie("a=1", new URL("https://example.com/"))!;
    expect(buildCookieHeader([c], new URL("https://other.org/"))).toBe("");
  });

  it("respects path scope", () => {
    const c = parseSetCookie("a=1; Path=/api", new URL("https://example.com/api"))!;
    expect(buildCookieHeader([c], new URL("https://example.com/api/x"))).toBe("a=1");
    expect(buildCookieHeader([c], new URL("https://example.com/other"))).toBe("");
  });

  it("excludes Secure cookies on http", () => {
    const c = parseSetCookie("a=1; Secure", new URL("https://example.com/"))!;
    expect(buildCookieHeader([c], new URL("http://example.com/"))).toBe("");
    expect(buildCookieHeader([c], new URL("https://example.com/"))).toBe("a=1");
  });

  it("excludes expired cookies", () => {
    const c = parseSetCookie("a=1; Max-Age=-1", new URL("https://example.com/"))!;
    expect(buildCookieHeader([c], new URL("https://example.com/"))).toBe("");
  });

  it("joins multiple matching cookies with '; '", () => {
    const url = new URL("https://example.com/");
    const a = parseSetCookie("a=1", url)!;
    const b = parseSetCookie("b=2", url)!;
    expect(buildCookieHeader([a, b], url)).toBe("a=1; b=2");
  });
});

describe("storeCookies", () => {
  it("appends new cookies", () => {
    const next = storeCookies([], ["a=1"], new URL("https://example.com/"));
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe("a");
  });

  it("replaces same-name cookies on same domain+path", () => {
    const url = new URL("https://example.com/");
    let jar = storeCookies([], ["a=1"], url);
    jar = storeCookies(jar, ["a=2"], url);
    expect(jar).toHaveLength(1);
    expect(jar[0].value).toBe("2");
  });

  it("expired-on-set acts as a delete", () => {
    const url = new URL("https://example.com/");
    let jar = storeCookies([], ["a=1"], url);
    jar = storeCookies(jar, ["a=; Max-Age=0"], url);
    expect(jar).toHaveLength(0);
  });
});

describe("session lifecycle", () => {
  beforeEach(() => {
    // Clear session state between tests by closing all known sessions.
    for (const s of listSessions()) closeSession(s.id);
  });

  it("opens a session with a unique id", () => {
    const a = openSession();
    const b = openSession();
    expect(a).not.toBe(b);
    expect(listSessions().map((s) => s.id)).toEqual(expect.arrayContaining([a, b]));
  });

  it("closes a session and removes it from the list", () => {
    const id = openSession();
    expect(closeSession(id)).toBe(true);
    expect(listSessions().find((s) => s.id === id)).toBeUndefined();
  });

  it("close on unknown id returns false", () => {
    expect(closeSession("does-not-exist")).toBe(false);
  });

  it("evicts oldest when over MAX_SESSIONS", () => {
    // MAX_SESSIONS is 8 in the implementation; open 9 and verify only 8 remain.
    const ids: string[] = [];
    for (let i = 0; i < 9; i++) ids.push(openSession());
    const remaining = listSessions().map((s) => s.id);
    expect(remaining.length).toBe(8);
    // The oldest (ids[0]) should have been evicted.
    expect(remaining).not.toContain(ids[0]);
    expect(remaining).toContain(ids[8]);
  });
});
