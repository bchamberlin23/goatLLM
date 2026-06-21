# Model-Invoked Web Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the model autonomously use web search and receive citation-ready, scraped source evidence in one tool call.

**Architecture:** Add a small `web-search` enrichment module between backend search and the current tool output. The module deduplicates ranked URLs, scrapes a bounded selection concurrently, and keeps snippets when a source cannot be read. The tool will register the enriched packets as citations and the prompt will describe autonomous use without a forced one-search rule.

**Tech Stack:** TypeScript, Vercel AI tool definitions, Zustand chat store, Vitest, Firecrawl API, Tauri HTTP/browser fetch adapter.

---

### Task 1: Source-enrichment boundary

**Files:**
- Create: `src/lib/web-search.ts`
- Test: `src/__tests__/web-search-evidence.test.ts`

- [ ] Write tests that require `collectWebSearchEvidence` to deduplicate by first-seen URL, preserve search rank, cap the result count at three, preserve a snippet when scraping throws, and never exceed the configured scrape concurrency.
- [ ] Run `npm test -- src/__tests__/web-search-evidence.test.ts`; it must fail because the module does not exist.
- [ ] Implement `collectWebSearchEvidence(results, { scrape, maxSources, maxContentChars, concurrency })` with a local worker-pool helper. Its successful result contains `title`, `url`, `snippet`, `content`, `fetched: true`, and the scraper `source`; its fallback result contains the original result data, `snippet`, `content: snippet`, `fetched: false`, and `source: "snippet"`.
- [ ] Run `npm test -- src/__tests__/web-search-evidence.test.ts`; it must pass.

### Task 2: Firecrawl-to-browser fallback

**Files:**
- Modify: `src/lib/firecrawl.ts:50-90`
- Test: `src/__tests__/web-search.test.ts`

- [ ] Add a failing test that configures a Firecrawl key, makes Firecrawl return 503, mocks `browserFetch`, and expects `scrapeUrl` to return the browser body with `source: "browser_fetch"`.
- [ ] Run `npm test -- src/__tests__/web-search.test.ts`; it must fail with the Firecrawl error before falling back.
- [ ] Extract the existing Firecrawl request into a private helper and make `scrapeUrl` catch any Firecrawl request or parse error before calling the existing browser-fetch path. Keep `validateBrowserUrl` before either request.
- [ ] Run `npm test -- src/__tests__/web-search.test.ts`; it must pass.

### Task 3: Tool and prompt integration

**Files:**
- Modify: `src/lib/tools/builtins/read.ts:303-444`
- Modify: `src/lib/system-prompt.ts:303-306`
- Modify: `src/components/InputBar.tsx:1264-1270`
- Modify: `src/components/input-bar/hooks/useComposer.ts:1112-1118`
- Test: `src/__tests__/web-search.test.ts`
- Test: `src/__tests__/system-prompt.test.ts`

- [ ] Add a failing web-search tool test where a SearXNG response has duplicate URLs and scrapes produce readable bodies; it must expect three-or-fewer citation-labelled, `fetched: true` evidence packets, not backend snippets.
- [ ] Add a failing prompt test that requires the chat prompt to state that web search is autonomous and rejects the old `only get ONE search per turn` text.
- [ ] Run `npm test -- src/__tests__/web-search.test.ts src/__tests__/system-prompt.test.ts`; both new assertions must fail.
- [ ] After each SearXNG or Tavily backend result collection, call `collectWebSearchEvidence` with `scrapeUrl`, the active Firecrawl key, a three-source limit, and a 6,000-character cap. Register these packets as citations and return them as the tool JSON.
- [ ] Update the normal-chat prompt to tell the model to use `web_search` autonomously for fresh, uncertain, niche, or source-dependent claims; tell it that returned sources include extracted evidence and `scrape_url` is for a specific deeper read. Do not retain the one-search instruction.
- [ ] Align the tool and both UI tool-call guards with a three-search internal safety budget, preserving the Deep Research exemption.
- [ ] Run `npm test -- src/__tests__/web-search.test.ts src/__tests__/system-prompt.test.ts`; all tests must pass.

### Task 4: Integration verification and delivery

**Files:**
- Test: `src/__tests__/web-search-evidence.test.ts`
- Test: `src/__tests__/web-search.test.ts`
- Test: `src/__tests__/browser-fetch.test.ts`
- Test: `src/__tests__/system-prompt.test.ts`

- [ ] Run `npm test -- src/__tests__/web-search-evidence.test.ts src/__tests__/web-search.test.ts src/__tests__/browser-fetch.test.ts src/__tests__/system-prompt.test.ts` and require zero failures.
- [ ] Run `npm run typecheck && npm run lint && npm run build` and require all commands to exit successfully.
- [ ] Run `git diff --check` and stage only the two documentation files plus the web-search implementation and tests, preserving existing user changes in `src/__tests__/chat-store.test.ts`, `src/__tests__/provider-card.test.tsx`, `src/components/settings/ProviderCard.tsx`, `src/lib/zen-credentials.ts`, and `src/stores/chat.ts`.
- [ ] Commit with a Conventional Commit subject and push the verified `main` commit directly to `origin/main`.
