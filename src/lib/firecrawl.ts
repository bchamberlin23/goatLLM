import { browserFetch, validateBrowserUrl } from "./browser-fetch";

export interface ScrapedPage {
  url: string;
  title: string;
  content: string;
  source: "firecrawl" | "browser_fetch";
}

interface ScrapeOptions {
  apiKey?: string;
  maxChars?: number;
  timeoutMs?: number;
}

function truncateContent(content: string, maxChars?: number): string {
  if (!maxChars || content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n\n[Truncated to ${maxChars} characters.]`;
}

function titleFromContent(content: string, fallback: string): string {
  const firstLine = (content.split("\n").find((line) => line.trim()) ?? "").trim();
  return firstLine && firstLine.length <= 200 ? firstLine.replace(/^#+\s*/, "") : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function extractFirecrawlData(body: unknown, fallbackUrl: string): ScrapedPage | null {
  const root = isRecord(body) ? body : {};
  const data = isRecord(root.data) ? root.data : root;
  const content =
    stringField(data, "markdown")
      ?? stringField(data, "content")
      ?? stringField(data, "html")
      ?? "";
  if (!content.trim()) return null;
  const metadata = isRecord(data.metadata) ? data.metadata : {};
  const url = String(metadata.sourceURL ?? metadata.url ?? data.url ?? fallbackUrl);
  const title = String(metadata.title ?? data.title ?? titleFromContent(content, url));
  return { url, title, content, source: "firecrawl" };
}

export async function scrapeUrl(url: string, options: ScrapeOptions = {}): Promise<ScrapedPage> {
  const validation = validateBrowserUrl(url);
  if (!validation.ok) throw new Error(validation.error);

  const maxChars = options.maxChars;
  const apiKey = options.apiKey?.trim();
  if (apiKey) {
    const { getFetch } = await import("./fetch-adapter");
    const customFetch = getFetch() ?? globalThis.fetch.bind(globalThis);
    const resp = await customFetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: options.timeoutMs ?? 60_000,
      }),
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => "");
      throw new Error(`Firecrawl scrape error: ${resp.status}${err ? ` — ${err}` : ""}`);
    }
    const body: unknown = await resp.json();
    const scraped = extractFirecrawlData(body, url);
    if (!scraped) throw new Error("Firecrawl returned no markdown content.");
    return { ...scraped, content: truncateContent(scraped.content, maxChars) };
  }

  const fallback = await browserFetch({ url, mode: "text", timeoutMs: options.timeoutMs ?? 15_000 });
  const content = truncateContent(fallback.content, maxChars);
  return {
    url: fallback.url || url,
    title: titleFromContent(content, fallback.url || url),
    content,
    source: "browser_fetch",
  };
}

export function formatScrapedPage(page: ScrapedPage): string {
  const label = page.source === "firecrawl" ? "Firecrawl scrape" : "Web scrape";
  return `[${label}: ${page.title}]\nURL: ${page.url}\n\n${page.content}`;
}
