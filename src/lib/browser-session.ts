/**
 * Stateful HTTP browsing sessions.
 *
 * Real interactive browsing without spinning up a hidden webview:
 *   - Per-session cookie jar (RFC 6265 simplified — name/value/domain/path/expires)
 *   - Session can navigate (GET), submit forms (POST), follow links across hosts
 *   - Reuses browser-fetch's URL validation and cloud-metadata blocklist
 *
 * What this does NOT do (limits documented in tool descriptions):
 *   - Run JavaScript. SPAs that hydrate via JS won't show their content.
 *   - Honor SameSite or third-party cookie restrictions (we're a tool, not a UA).
 *   - Persist sessions to disk. They live in memory and die with the page.
 */

import { validateBrowserUrl, extractText, extractBySelector } from "./browser-fetch";

const MAX_BYTES = 200_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_SESSIONS = 8;
const SESSION_IDLE_MS = 10 * 60_000; // 10 minutes
const MAX_REDIRECTS = 5;

interface CookieRecord {
  name: string;
  value: string;
  domain: string;     // host the cookie applies to (lowercased)
  path: string;       // prefix path
  expiresAt?: number; // ms epoch; undefined = session cookie
  secure: boolean;
}

interface Session {
  id: string;
  jar: CookieRecord[];
  createdAt: number;
  lastUsedAt: number;
  /** Last URL navigated to. Used to resolve relative links/actions. */
  lastUrl?: string;
}

const sessions = new Map<string, Session>();

function pruneIdleSessions(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastUsedAt > SESSION_IDLE_MS) sessions.delete(id);
  }
}

function newSessionId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function openSession(): string {
  pruneIdleSessions();
  if (sessions.size >= MAX_SESSIONS) {
    // Evict the oldest by lastUsedAt.
    let oldestId: string | null = null;
    let oldestUsed = Infinity;
    for (const [id, s] of sessions) {
      if (s.lastUsedAt < oldestUsed) { oldestUsed = s.lastUsedAt; oldestId = id; }
    }
    if (oldestId) sessions.delete(oldestId);
  }
  const id = newSessionId();
  const now = Date.now();
  sessions.set(id, { id, jar: [], createdAt: now, lastUsedAt: now });
  return id;
}

export function closeSession(id: string): boolean {
  return sessions.delete(id);
}

export function listSessions(): { id: string; createdAt: number; lastUsedAt: number; lastUrl?: string; cookies: number }[] {
  return Array.from(sessions.values()).map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
    lastUrl: s.lastUrl,
    cookies: s.jar.length,
  }));
}

// ── Cookie jar ─────────────────────────────────────────────────────────────

/**
 * Parse a Set-Cookie header value (one cookie per call). Multi-cookie headers
 * must be split before calling. Returns null on garbage input.
 */
export function parseSetCookie(raw: string, requestUrl: URL): CookieRecord | null {
  const parts = raw.split(";").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const [nv, ...attrs] = parts;
  const eqIdx = nv.indexOf("=");
  if (eqIdx < 1) return null;
  const name = nv.slice(0, eqIdx).trim();
  const value = nv.slice(eqIdx + 1).trim();
  if (!name) return null;

  const cookie: CookieRecord = {
    name,
    value,
    domain: requestUrl.hostname.toLowerCase(),
    path: "/",
    secure: false,
  };

  for (const attr of attrs) {
    const eq = attr.indexOf("=");
    const key = (eq < 0 ? attr : attr.slice(0, eq)).trim().toLowerCase();
    const v = (eq < 0 ? "" : attr.slice(eq + 1).trim());
    switch (key) {
      case "domain": {
        // Strip leading dot per RFC 6265 4.1.2.3.
        const d = v.replace(/^\./, "").toLowerCase();
        if (d) cookie.domain = d;
        break;
      }
      case "path":
        if (v) cookie.path = v;
        break;
      case "expires": {
        const t = Date.parse(v);
        if (!Number.isNaN(t)) cookie.expiresAt = t;
        break;
      }
      case "max-age": {
        const sec = parseInt(v, 10);
        if (!Number.isNaN(sec)) cookie.expiresAt = Date.now() + sec * 1000;
        break;
      }
      case "secure":
        cookie.secure = true;
        break;
      // HttpOnly, SameSite ignored — we're not enforcing browser-level scopes.
    }
  }
  return cookie;
}

/** Domain-match per RFC 6265 5.1.3 (subdomain match). */
function domainMatches(cookieDomain: string, host: string): boolean {
  host = host.toLowerCase();
  cookieDomain = cookieDomain.toLowerCase();
  if (cookieDomain === host) return true;
  return host.endsWith("." + cookieDomain);
}

/** Path-match per RFC 6265 5.1.4 (prefix match with boundary). */
function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (cookiePath === requestPath) return true;
  if (requestPath.startsWith(cookiePath)) {
    if (cookiePath.endsWith("/")) return true;
    return requestPath[cookiePath.length] === "/";
  }
  return false;
}

export function buildCookieHeader(jar: CookieRecord[], url: URL): string {
  const now = Date.now();
  const isHttps = url.protocol === "https:";
  const hits: string[] = [];
  for (const c of jar) {
    if (c.expiresAt !== undefined && c.expiresAt < now) continue;
    if (c.secure && !isHttps) continue;
    if (!domainMatches(c.domain, url.hostname)) continue;
    if (!pathMatches(c.path, url.pathname)) continue;
    hits.push(`${c.name}=${c.value}`);
  }
  return hits.join("; ");
}

export function storeCookies(
  jar: CookieRecord[],
  setCookieHeaders: string[],
  requestUrl: URL,
): CookieRecord[] {
  const next = [...jar];
  for (const raw of setCookieHeaders) {
    const c = parseSetCookie(raw, requestUrl);
    if (!c) continue;
    // Remove any existing same-name+domain+path cookie before setting the new one.
    const idx = next.findIndex(
      (x) => x.name === c.name && x.domain === c.domain && x.path === c.path,
    );
    if (idx >= 0) next.splice(idx, 1);
    // Expired-on-set is a delete signal.
    if (c.expiresAt !== undefined && c.expiresAt <= Date.now()) continue;
    next.push(c);
  }
  return next;
}

// ── Navigation ──────────────────────────────────────────────────────────────

export interface NavResult {
  sessionId: string;
  url: string;
  status: number;
  contentType: string;
  bytes: number;
  truncated: boolean;
  redirects: string[];
  cookieCount: number;
  content: string;
}

export interface NavOptions {
  sessionId: string;
  url: string;
  method?: "GET" | "POST";
  formData?: Record<string, string>;
  selector?: string;
  mode?: "text" | "html";
  timeoutMs?: number;
}

function getSession(id: string): Session {
  pruneIdleSessions();
  const s = sessions.get(id);
  if (!s) throw new Error(`Session '${id}' not found or expired. Open a new session.`);
  s.lastUsedAt = Date.now();
  return s;
}

/** Collect Set-Cookie headers. Standard fetch's Headers folds them into a comma
 *  list, which is wrong for cookies. We use getSetCookie() where supported,
 *  else fall back to a best-effort split. */
function readSetCookies(headers: Headers): string[] {
  const h = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const single = headers.get("set-cookie");
  if (!single) return [];
  // Best-effort split: split on ", " followed by a token that looks like a
  // cookie name. Imperfect but better than nothing.
  return single.split(/,(?=\s*[a-zA-Z0-9!#$%&'*+\-.^_`|~]+=)/);
}

export async function navigate(opts: NavOptions): Promise<NavResult> {
  const session = getSession(opts.sessionId);
  const v = validateBrowserUrl(opts.url);
  if (!v.ok) throw new Error(v.error);

  const method = opts.method ?? "GET";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const redirects: string[] = [];

  let currentUrl = v.url;
  let resp: Response | null = null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const cookieHeader = buildCookieHeader(session.jar, currentUrl);
    const headers: Record<string, string> = {
      "User-Agent": "goatLLM/0.1 (+agent browse session)",
      Accept: "text/html,application/xhtml+xml,application/json,text/plain,*/*;q=0.8",
    };
    if (cookieHeader) headers.Cookie = cookieHeader;

    let body: string | undefined;
    if (hop === 0 && method === "POST" && opts.formData) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(opts.formData).toString();
    }

    let r: Response;
    try {
      r = await fetch(currentUrl.toString(), {
        method: hop === 0 ? method : "GET",
        headers,
        body: hop === 0 ? body : undefined,
        signal: controller.signal,
        // We follow manually so we can carry cookies + observe hops.
        redirect: "manual",
      });
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw new Error(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    clearTimeout(timer);

    // Persist Set-Cookie regardless of status.
    const setCookies = readSetCookies(r.headers);
    if (setCookies.length > 0) {
      session.jar = storeCookies(session.jar, setCookies, currentUrl);
    }

    // Handle redirects manually so cookies stick across hops.
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers.get("location");
      if (!loc) { resp = r; break; }
      let next: URL;
      try {
        next = new URL(loc, currentUrl);
      } catch {
        resp = r;
        break;
      }
      const okScheme = next.protocol === "http:" || next.protocol === "https:";
      if (!okScheme) { resp = r; break; }
      redirects.push(next.toString());
      currentUrl = next;
      // Drain body so the connection can be reused.
      try { await r.text(); } catch { /* ignore */ }
      if (hop === MAX_REDIRECTS) {
        throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
      }
      continue;
    }

    resp = r;
    break;
  }

  if (!resp) throw new Error("No response captured");

  const contentType = resp.headers.get("content-type") ?? "";
  const raw = await resp.text();
  const bytes = raw.length;
  const truncatedRaw = raw.length > MAX_BYTES ? raw.slice(0, MAX_BYTES) : raw;

  let content: string;
  if (opts.selector) {
    const r = extractBySelector(truncatedRaw, opts.selector, { mode: opts.mode ?? "text" });
    if (r.matches.length === 0) {
      content = `(no elements matched '${opts.selector}')`;
    } else {
      content = r.matches.map((m, i) => `[match ${i + 1}]\n${opts.mode === "html" ? (m.html ?? m.text) : m.text}`).join("\n\n---\n\n");
    }
  } else if (opts.mode === "html" || !contentType.includes("html")) {
    content = truncatedRaw;
  } else {
    content = extractText(truncatedRaw);
    if (content.length > MAX_BYTES) content = content.slice(0, MAX_BYTES);
  }

  session.lastUrl = currentUrl.toString();

  return {
    sessionId: session.id,
    url: currentUrl.toString(),
    status: resp.status,
    contentType,
    bytes,
    truncated: bytes > MAX_BYTES,
    redirects,
    cookieCount: session.jar.length,
    content,
  };
}
