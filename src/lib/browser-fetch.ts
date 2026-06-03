/**
 * Fetch a web page on behalf of the agent.
 *
 * Lives in TypeScript (not Rust) because the existing fetch adapter already
 * routes through Tauri's HTTP plugin, which gives us:
 *   - bypassed CORS (Tauri's HTTP runs server-side from the webview's POV)
 *   - one less Rust dep (no ureq/reqwest)
 *   - same code path as web_search and provider calls
 *
 * Security model:
 *   - Only http/https schemes accepted. file://, chrome-extension://, blob:,
 *     data:, javascript: are hard-rejected before any network call.
 *   - URL host checked against a hard-coded reject list (loopback metadata
 *     endpoints used for SSRF: 169.254.169.254, [::1] cloud metadata, etc.).
 *   - Output capped at 200KB after extraction so a malicious page cannot
 *     blow up the agent's context window.
 *   - All callers go through the WRITE_TOOLS approval gate, so the user
 *     sees the URL before any request fires.
 */

import { initFetch } from "./fetch-adapter";

const MAX_BYTES = 200_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

const REJECTED_SCHEMES = new Set([
  "file:",
  "chrome-extension:",
  "moz-extension:",
  "blob:",
  "data:",
  "javascript:",
  "ftp:",
  "ws:",
  "wss:",
]);

const REJECTED_HOSTS = new Set([
  "169.254.169.254", // AWS/GCP/Azure instance metadata
  "metadata.google.internal",
  "metadata",
]);

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => {
    if (!/^\d{1,3}$/.test(p)) return Number.NaN;
    return Number(p);
  });
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isBlockedIpv4Parts(ip: number[]): boolean {
  const [a, b] = ip;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isBlockedIpv4(host: string): boolean {
  const ip = parseIpv4(host);
  return ip ? isBlockedIpv4Parts(ip) : false;
}

function parseMappedIpv4FromIpv6(host: string): number[] | null {
  const dotted = host.match(/(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return parseIpv4(dotted[1]);

  const prefix = host.startsWith("::ffff:")
    ? "::ffff:"
    : host.startsWith("0:0:0:0:0:ffff:")
      ? "0:0:0:0:0:ffff:"
      : null;
  if (!prefix) return null;

  const parts = host.slice(prefix.length).split(":");
  if (parts.length !== 2) return null;
  const words = parts.map((part) => (/^[0-9a-f]{1,4}$/i.test(part) ? parseInt(part, 16) : Number.NaN));
  if (words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) return null;
  return [words[0] >> 8, words[0] & 0xff, words[1] >> 8, words[1] & 0xff];
}

function isBlockedIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  const mappedIpv4 = parseMappedIpv4FromIpv6(normalized);
  if (mappedIpv4 && isBlockedIpv4Parts(mappedIpv4)) return true;
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    /^f[cd][0-9a-f]{0,2}:/i.test(normalized) ||
    /^fe[89ab][0-9a-f]?:/i.test(normalized)
  );
}

function blockedHostReason(hostname: string): string | null {
  const host = normalizeHostname(hostname);
  if (REJECTED_HOSTS.has(host)) {
    return `Host '${host}' is blocked (cloud metadata endpoint).`;
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    return `Host '${host}' is blocked (local/private network target).`;
  }
  if (isBlockedIpv4(host) || isBlockedIpv6(host)) {
    return `Host '${host}' is blocked (local/private network or metadata endpoint).`;
  }
  return null;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export interface BrowserFetchOptions {
  url: string;
  /** "text" returns plain extracted text; "html" returns raw HTML (still capped). */
  mode?: "text" | "html";
  timeoutMs?: number;
}

export interface BrowserFetchResult {
  url: string;
  status: number;
  contentType: string;
  bytes: number;
  truncated: boolean;
  content: string;
}

export function validateBrowserUrl(input: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: `Invalid URL: '${input}'. Must be an absolute http(s) URL.` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    if (REJECTED_SCHEMES.has(url.protocol)) {
      return { ok: false, error: `Scheme '${url.protocol}' is not allowed.` };
    }
    return { ok: false, error: `Only http and https URLs are allowed. Got '${url.protocol}'.` };
  }
  const reason = blockedHostReason(url.hostname);
  if (reason) {
    return { ok: false, error: reason };
  }
  return { ok: true, url };
}

/**
 * Strip script/style and collapse whitespace. Not a full HTML parser — that's
 * the next iteration with a hidden webview. This is "good enough" for reading
 * documentation pages, blog posts, and plain HTML APIs.
 */
export function extractText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function browserFetch(opts: BrowserFetchOptions): Promise<BrowserFetchResult> {
  const v = validateBrowserUrl(opts.url);
  if (!v.ok) throw new Error(v.error);

  const mode = opts.mode ?? "text";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let currentUrl = v.url;
  let resp: Response | null = null;
  const requestFetch = await initFetch();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let r: Response;
    try {
      r = await requestFetch(currentUrl.toString(), {
        method: "GET",
        headers: {
          "User-Agent": "goatLLM/0.1 (+agent browse tool)",
          Accept: "text/html,application/xhtml+xml,application/json,text/plain,*/*;q=0.8",
        },
        signal: controller.signal,
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

    if (isRedirectStatus(r.status)) {
      const loc = r.headers.get("location");
      if (!loc) {
        resp = r;
        break;
      }
      let next: URL;
      try {
        next = new URL(loc, currentUrl);
      } catch {
        resp = r;
        break;
      }
      const nextValidation = validateBrowserUrl(next.toString());
      if (!nextValidation.ok) {
        throw new Error(`Redirect blocked: ${nextValidation.error}`);
      }
      try { await r.text(); } catch { /* ignore body drain failures */ }
      if (hop === MAX_REDIRECTS) {
        throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
      }
      currentUrl = nextValidation.url;
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
  if (mode === "html" || !contentType.includes("html")) {
    content = truncatedRaw;
  } else {
    content = extractText(truncatedRaw);
    if (content.length > MAX_BYTES) content = content.slice(0, MAX_BYTES);
  }

  return {
    url: resp.url || currentUrl.toString(),
    status: resp.status,
    contentType,
    bytes,
    truncated: bytes > MAX_BYTES,
    content,
  };
}

// ── Targeted extraction (CSS selector → matched elements) ─────────────────

const DEFAULT_MAX_MATCHES = 10;

export interface BrowserExtractOptions {
  url: string;
  selector: string;
  mode?: "text" | "html";
  maxMatches?: number;
  timeoutMs?: number;
}

export interface BrowserExtractMatch {
  text: string;
  html?: string;
}

export interface BrowserExtractResult {
  url: string;
  selector: string;
  matches: BrowserExtractMatch[];
  totalMatched: number;
  truncated: boolean;
}

/**
 * Parse the HTML and run a CSS selector against it. Uses the platform
 * DOMParser, so the full CSS selector grammar works (descendants, classes,
 * attribute selectors, pseudo-classes — anything querySelectorAll supports).
 */
export function extractBySelector(
  html: string,
  selector: string,
  opts: { mode?: "text" | "html"; maxMatches?: number } = {},
): BrowserExtractResult {
  const mode = opts.mode ?? "text";
  const maxMatches = Math.max(1, Math.min(opts.maxMatches ?? DEFAULT_MAX_MATCHES, 50));

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch (e) {
    throw new Error(`Failed to parse HTML: ${e instanceof Error ? e.message : String(e)}`);
  }

  let nodes: NodeListOf<Element>;
  try {
    nodes = doc.querySelectorAll(selector);
  } catch (e) {
    throw new Error(
      `Invalid selector '${selector}': ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const total = nodes.length;
  const slice = Array.from(nodes).slice(0, maxMatches);
  const matches: BrowserExtractMatch[] = slice.map((el) => {
    const text = (el.textContent ?? "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (mode === "html") {
      return { text, html: el.outerHTML };
    }
    return { text };
  });

  return {
    url: "",
    selector,
    matches,
    totalMatched: total,
    truncated: total > maxMatches,
  };
}

export async function browserExtract(opts: BrowserExtractOptions): Promise<BrowserExtractResult> {
  // Always fetch as html mode so we get raw markup to parse, regardless of
  // what the caller asks the matches to look like.
  const fetched = await browserFetch({
    url: opts.url,
    mode: "html",
    timeoutMs: opts.timeoutMs,
  });
  const result = extractBySelector(fetched.content, opts.selector, {
    mode: opts.mode,
    maxMatches: opts.maxMatches,
  });
  result.url = fetched.url;
  return result;
}
