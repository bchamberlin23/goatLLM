# Model-Invoked Web Search Design

## Goal

Make web search an ordinary capability of the language model: it remains available throughout a chat, the model decides when a question needs fresh or external evidence, and each search returns usable source content rather than a thin list of snippets.

## Product behavior

- There is no user-facing web-search on/off mode for normal chat. A configured search backend makes the `web_search` tool available by default.
- The model decides whether to call the tool for current, uncertain, niche, or context-dependent questions. It should not announce a search before calling it.
- `web_search` receives the model's query. It does not make a second LLM call to rewrite the query; the model is already the appropriate query planner.
- One call searches the configured backend, removes duplicate URLs, then reads the highest-ranked pages concurrently. It returns compact evidence packets with title, URL, original snippet, extracted text, and source type.
- If a page cannot be read, its search snippet stays in the result. A failed source never discards the other evidence.
- Search result sources register as normal chat citations, so the model can cite the sources it actually used.
- Deep Research remains a separate opt-in workflow for iterative multi-query investigation. It is not required for ordinary, model-initiated search.

## Architecture

`src/lib/web-search.ts` will own bounded, dependency-injected enrichment of backend results. It preserves result order, deduplicates URLs, limits concurrent scraping, and treats snippets as the safe fallback. `READ_ONLY_TOOLS.web_search` will keep backend selection in `read.ts`, then call the enrichment helper before registering citations and returning JSON.

`scrapeUrl` will retain Firecrawl as the preferred markdown reader but fall back to the existing SSRF-protected browser fetch when Firecrawl fails, not only when it is unconfigured. The browser fetch implementation remains the sole URL-validation boundary.

## Limits and failure behavior

- Enrich at most the top three unique HTTP(S) results per search call, with at most three concurrent requests and 6,000 characters per source.
- Keep a per-turn ceiling of three model-initiated searches to prevent runaway tool loops. This is an internal safety budget, not a user-controlled mode.
- Backend errors remain actionable tool output. Individual scrape failures are non-fatal and return the associated snippet.

## Testing

Unit tests will prove deduplication, order preservation, bounded concurrency, source fallback, Firecrawl-to-browser fallback, enriched citation registration, and the revised per-turn allowance. Existing web-search, browser-fetch, prompt, and focused UI tests will run alongside the new tests.
