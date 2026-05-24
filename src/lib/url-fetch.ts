/**
 * URL auto-fetch on send.
 *
 * When the user types or pastes a URL in chat, fetch its readable content
 * and inline it the same way attachments are inlined. This is the right
 * answer to "summarize https://example.com/article" — the model gets the
 * actual page text instead of having to ask the user to paste it.
 *
 * Two paths:
 * - YouTube / youtu.be → pull the public timed-text transcript.
 * - Anything else http(s) → reuse `browserFetch` with mode="text" so
 *   readability extraction (title + main content) runs server-side.
 *
 * Fetched content is also written to the attachment cache so the
 * read_attachment / search_attachment tools work over it on later turns.
 *
 * Deduplication: we keep a per-conversation set of already-fetched URLs
 * so pasting the same link twice doesn't refetch (and doesn't bloat the
 * message). The cache key is conversation + URL.
 */
import { browserFetch, validateBrowserUrl } from "./browser-fetch";

/** Per-conversation set of URLs already fetched, so re-pasting the same
 *  link doesn't refetch. Cleared when a conversation is deleted (mirrors
 *  attachment-cache lifecycle). */
const fetchedByConversation = new Map<string, Set<string>>();

export function clearUrlFetchCache(conversationId: string): void {
  fetchedByConversation.delete(conversationId);
}

const URL_REGEX = /\bhttps?:\/\/[^\s<>"'`)]+[^\s<>"'`).,!?]/g;
const YOUTUBE_HOST_REGEX = /(?:^|\.)(youtube\.com|youtu\.be)$/i;

export function extractUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX) ?? [];
  // Dedupe while preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return YOUTUBE_HOST_REGEX.test(u.hostname);
  } catch {
    return false;
  }
}

/** Pull the YouTube video ID from any common URL form
 *  (watch?v=, /shorts/, youtu.be/, /embed/). Returns null if we can't
 *  identify a video id; caller falls back to plain page fetch. */
export function youtubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (/(?:^|\.)youtu\.be$/i.test(u.hostname)) {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return id || null;
    }
    if (/(?:^|\.)youtube\.com$/i.test(u.hostname)) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const m = /^\/(?:shorts|embed|live)\/([\w-]{6,})/.exec(u.pathname);
      if (m) return m[1];
    }
  } catch {
    // fall through
  }
  return null;
}

/** Fetch a YouTube transcript via the public timed-text endpoint. We try
 *  English first, then any auto-caption language. Returns the joined
 *  transcript text plus a best-effort title (parsed from the watch page).
 *  Throws on failure so the caller can fall back to plain page fetch. */
async function fetchYouTubeTranscript(videoId: string): Promise<{ title: string; transcript: string }> {
  // The watch page leaks a JSON blob with available caption tracks. Easier
  // and more reliable than scraping innerHTML structure.
  const watchResp = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`, {
    headers: { "User-Agent": "Mozilla/5.0 goatLLM/0.1" },
  });
  if (!watchResp.ok) throw new Error(`watch page returned ${watchResp.status}`);
  const html = await watchResp.text();

  const titleMatch =
    /<meta\s+name="title"\s+content="([^"]+)"/.exec(html) ??
    /<title>([^<]+)<\/title>/.exec(html);
  const title = titleMatch ? titleMatch[1].replace(/\s+-\s+YouTube\s*$/, "").trim() : `YouTube ${videoId}`;

  // captionTracks lives inside the ytInitialPlayerResponse blob.
  const tracksMatch = /"captionTracks":\s*(\[[^\]]+\])/.exec(html);
  if (!tracksMatch) {
    throw new Error("no caption tracks found (video may not have captions)");
  }
  // The JSON inside captionTracks is well-formed JSON, so parse directly.
  let tracks: Array<{ baseUrl: string; languageCode: string; kind?: string }>;
  try {
    tracks = JSON.parse(tracksMatch[1]);
  } catch (e) {
    throw new Error(`could not parse caption tracks: ${(e as Error).message}`);
  }
  if (!tracks.length) throw new Error("no caption tracks");
  // Prefer English manual, then English auto, then anything else.
  const pick =
    tracks.find((t) => t.languageCode === "en" && !t.kind) ??
    tracks.find((t) => t.languageCode === "en") ??
    tracks[0];

  const xmlResp = await fetch(pick.baseUrl);
  if (!xmlResp.ok) throw new Error(`transcript fetch returned ${xmlResp.status}`);
  const xml = await xmlResp.text();

  // Strip <text> wrappers and decode HTML entities.
  const lines: string[] = [];
  const textTagRegex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = textTagRegex.exec(xml))) {
    lines.push(decodeXmlEntities(m[1]).replace(/\s+/g, " ").trim());
  }
  const transcript = lines.filter(Boolean).join("\n");
  if (!transcript) throw new Error("transcript was empty");
  return { title, transcript };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x?(\w+);/g, (_, code: string) => {
      const n = code.startsWith("x") || code.startsWith("X")
        ? parseInt(code.slice(1), 16)
        : parseInt(code, 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : "";
    });
}

export interface FetchedUrl {
  url: string;
  /** Header label for the inline block: "Web" or "YouTube". */
  label: "Web" | "YouTube";
  /** Page title or video title for display. */
  title: string;
  /** Body text — readable page content or transcript. */
  body: string;
}

/** Fetch every new URL in `prose`, skipping ones already fetched in this
 *  conversation. Returns the fetched results so the caller can both inline
 *  them into displayContent and cache them for read_attachment. */
export async function fetchNewUrlsFromProse(
  prose: string,
  conversationId: string,
): Promise<FetchedUrl[]> {
  const urls = extractUrls(prose);
  if (urls.length === 0) return [];

  let already = fetchedByConversation.get(conversationId);
  if (!already) {
    already = new Set<string>();
    fetchedByConversation.set(conversationId, already);
  }

  const out: FetchedUrl[] = [];
  for (const url of urls) {
    if (already.has(url)) continue;
    const validation = validateBrowserUrl(url);
    if (!validation.ok) continue;
    already.add(url);
    try {
      if (isYouTubeUrl(url)) {
        const id = youtubeVideoId(url);
        if (id) {
          const { title, transcript } = await fetchYouTubeTranscript(id);
          out.push({ url, label: "YouTube", title, body: transcript });
          continue;
        }
        // Fall through to plain fetch when we can't extract an id.
      }
      const result = await browserFetch({ url, mode: "text", timeoutMs: 15_000 });
      // Try to parse a title from the readability output's first line.
      const firstLine = (result.content.split("\n").find((l) => l.trim()) ?? "").trim();
      const title = firstLine && firstLine.length <= 200 ? firstLine : url;
      out.push({ url, label: "Web", title, body: result.content });
    } catch (e) {
      // Surface as a fetch-failed entry so the user can see what happened
      // without it taking down the send.
      out.push({
        url,
        label: "Web",
        title: url,
        body: `(fetch failed: ${e instanceof Error ? e.message : String(e)})`,
      });
    }
  }
  return out;
}
