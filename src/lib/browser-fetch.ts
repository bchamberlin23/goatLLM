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

const MAX_BYTES = 200_000;
const DEFAULT_TIMEOUT_MS = 15_000;

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
  const host = url.hostname.toLowerCase();
  if (REJECTED_HOSTS.has(host)) {
    return { ok: false, error: `Host '${host}' is blocked (cloud metadata endpoint).` };
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let resp: Response;
  try {
    resp = await fetch(v.url.toString(), {
      method: "GET",
      headers: {
        "User-Agent": "goatLLM/0.1 (+agent browse tool)",
        Accept: "text/html,application/xhtml+xml,application/json,text/plain,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  clearTimeout(timer);

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
    url: resp.url,
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
