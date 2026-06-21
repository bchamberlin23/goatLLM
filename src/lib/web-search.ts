export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
}

export const MAX_WEB_SEARCH_CALLS_PER_TURN = 3;

export interface ScrapedWebPage {
  url: string;
  title: string;
  content: string;
  source: "firecrawl" | "browser_fetch";
}

export interface WebSearchEvidence extends WebSearchResult {
  snippet: string;
  fetched: boolean;
  source: "firecrawl" | "browser_fetch" | "snippet";
}

interface CollectWebSearchEvidenceOptions {
  scrape: (url: string, options: { maxChars: number }) => Promise<ScrapedWebPage>;
  maxSources?: number;
  maxContentChars?: number;
  concurrency?: number;
}

function uniqueResults(results: WebSearchResult[], maxSources: number): WebSearchResult[] {
  const urls = new Set<string>();
  const unique: WebSearchResult[] = [];
  for (const result of results) {
    if (!result.url || urls.has(result.url)) continue;
    urls.add(result.url);
    unique.push(result);
    if (unique.length === maxSources) break;
  }
  return unique;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Math.max(1, concurrency));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      output[index] = await map(items[index]);
    }
  }));

  return output;
}

export async function collectWebSearchEvidence(
  results: WebSearchResult[],
  options: CollectWebSearchEvidenceOptions,
): Promise<WebSearchEvidence[]> {
  const maxSources = Math.max(1, options.maxSources ?? 3);
  const maxContentChars = Math.max(1, options.maxContentChars ?? 6_000);
  const targets = uniqueResults(results, maxSources);

  return mapWithConcurrency(targets, options.concurrency ?? 3, async (result) => {
    const snippet = result.content;
    try {
      const page = await options.scrape(result.url, { maxChars: maxContentChars });
      const content = page.content.trim();
      if (!content) throw new Error("Scraper returned no content");
      return {
        ...result,
        title: page.title || result.title,
        url: page.url || result.url,
        snippet,
        content,
        fetched: true,
        source: page.source,
      };
    } catch {
      return {
        ...result,
        snippet,
        content: snippet,
        fetched: false,
        source: "snippet",
      };
    }
  });
}
