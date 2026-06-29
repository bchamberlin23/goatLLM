/**
 * Read-only built-in tools — execute immediately, no approval gate.
 *
 * These are the tools the agent can fire freely: filesystem reads, search,
 * git status/log/blame, PDF extraction, and (when configured) web search.
 * Anything that mutates the workspace, runs a shell command, or hits the
 * network with side effects lives in builtins/write.ts.
 *
 * Lifted out of src/lib/tools.ts during the registry split so MCP and
 * subagent code can compose tool surfaces without re-exporting everything.
 */
import { tool } from "ai";
import { z } from "zod";
import { useChatStore } from "../../../stores/chat";
import { searchSemantic, indexCount } from "../../semantic-index";
import { truncateHead, truncationFooter } from "../../truncate";
import {
  getAttachmentText,
  listAttachments,
  readSlice,
  searchAttachment as searchAttachmentText,
  snipForResult,
} from "../../attachment-cache";
import { scrapeUrl } from "../../firecrawl";
import { getWorkspace, normalizePath, invoke } from "../_helpers";
import {
  collectWebSearchEvidence,
  MAX_WEB_SEARCH_CALLS_PER_TURN,
  type WebSearchResult,
} from "../../web-search";
import {
  buildWorkspaceMap,
  formatWorkspaceMapForPrompt,
  shouldSkipWorkspaceMapPath,
  type WorkspaceMapFile,
} from "../../workspace-map";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function isDeepResearchContext(context: unknown): boolean {
  return isRecord(context) && context.deepResearch === true;
}

const WORKSPACE_MAP_MAX_FILES = 240;
const WORKSPACE_MAP_MAX_DEPTH = 5;

async function collectWorkspaceMapFiles(
  workspace: string,
  startPath = "",
): Promise<WorkspaceMapFile[]> {
  const files: WorkspaceMapFile[] = [];

  async function walk(path: string, depth: number): Promise<void> {
    if (files.length >= WORKSPACE_MAP_MAX_FILES || depth > WORKSPACE_MAP_MAX_DEPTH) return;
    let entries: { name: string; is_dir: boolean; size: number }[];
    try {
      entries = await invoke("list_dir", { workspace, path });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= WORKSPACE_MAP_MAX_FILES) break;
      const child = path ? `${path}/${entry.name}` : entry.name;
      if (shouldSkipWorkspaceMapPath(child, entry.size)) continue;
      if (entry.is_dir) {
        await walk(child, depth + 1);
        continue;
      }

      let content: string | undefined;
      if (entry.size <= 160_000) {
        try {
          content = await invoke("read_file", {
            workspace,
            path: child,
            offset: 0,
            limit: 260,
          });
        } catch {
          content = undefined;
        }
      }
      files.push({ path: child, size: entry.size, content });
    }
  }

  await walk(startPath, 0);
  return files;
}

export const READ_ONLY_TOOLS = {
  read_file: tool({
    description:
      "Read the contents of a file in the workspace. Returns the file text content.",
    inputSchema: z.object({
      path: z.string().describe("Path relative to workspace root"),
      offset: z
        .number()
        .optional()
        .describe("Line number to start reading from (0-indexed)"),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of lines to read"),
    }),
    execute: async ({ path, offset, limit }) => {
      const workspace = getWorkspace();
      const result = await invoke<string>("read_file", {
        workspace,
        path: normalizePath(path),
        offset: offset ?? null,
        limit: limit ?? null,
      });
      const t = truncateHead(result);
      if (!t.truncated) return result;
      const footer = truncationFooter(t);
      return t.firstLineExceedsLimit
        ? `(file's first line exceeds the ${t.maxBytes / 1024}KB byte limit; pass offset/limit to read it in chunks)`
        : t.content + footer;
    },
  }),

  list_dir: tool({
    description:
      "List files and directories in a workspace directory. Returns array of {name, is_dir, size} sorted with directories first.",
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe("Directory path relative to workspace root. Defaults to root."),
    }),
    execute: async ({ path }) => {
      const workspace = getWorkspace();
      const result = await invoke<{ name: string; is_dir: boolean; size: number }[]>(
        "list_dir",
        { workspace, path: path ? normalizePath(path) : "" }
      );
      return JSON.stringify(result, null, 2);
    },
  }),

  search_content: tool({
    description:
      "Search for a regex pattern in workspace files. Returns array of {file, line, content} matches (max 100). Skips node_modules, .git, target, dist, and files >1MB. Supports `context_lines` for ±N surrounding lines (max 20) and `case_insensitive` for case-insensitive matching. Prefer this over `bash grep` whenever possible — it's faster, respects ignores, and the result is structured.",
    inputSchema: z.object({
      pattern: z.string().describe("Regex pattern to search for"),
      filePattern: z
        .string()
        .optional()
        .describe("Glob pattern to filter files (e.g. '*.ts', '*.rs')"),
      context_lines: z
        .number()
        .optional()
        .describe(
          "Number of lines before AND after each match to include (like grep -A/-B/-C). Capped at 20.",
        ),
      case_insensitive: z
        .boolean()
        .optional()
        .describe(
          "Match case-insensitively (like grep -i). Composes safely with patterns that include inline (?i).",
        ),
    }),
    execute: async ({ pattern, filePattern, context_lines, case_insensitive }) => {
      const workspace = getWorkspace();
      const result = await invoke<
        { file: string; line: number; content: string; context_before?: string[]; context_after?: string[] }[]
      >("search_content", {
        workspace,
        pattern,
        filePattern: filePattern ?? null,
        contextLines: context_lines ?? null,
        caseInsensitive: case_insensitive ?? null,
      });
      return JSON.stringify(result, null, 2);
    },
  }),

  git_status: tool({
    description:
      "Run `git status --porcelain` in the workspace and return the output.",
    inputSchema: z.object({}),
    execute: async () => {
      const workspace = getWorkspace();
      const result = await invoke<string>("git_status", { workspace });
      return result;
    },
  }),

  search_semantic: tool({
    description:
      "Semantic code search across the workspace using local embeddings (Ollama + nomic-embed-text). Use when search_content's exact-match misses (e.g. 'auth flow' should match 'login handler'). Slower than search_content (~200ms). Requires the workspace to be indexed first; returns an error with instructions if not. Returns top-K chunks with file path, line range, and similarity score.",
    inputSchema: z.object({
      query: z.string().describe("Natural-language description of what you're looking for"),
      top_k: z
        .number()
        .optional()
        .describe("Max results to return (1-50, default 8)"),
    }),
    execute: async ({ query, top_k }) => {
      const workspace = getWorkspace();
      const { ollamaUrl, embeddingModel } = useChatStore.getState();
      try {
        const count = await indexCount(workspace);
        if (count === 0) {
          return "Workspace not indexed yet. Open Settings → Semantic Index and click 'Build index', or call the index_workspace tool.";
        }
        const hits = await searchSemantic(workspace, query, {
          topK: top_k ?? undefined,
          ollamaUrl: ollamaUrl || undefined,
          model: embeddingModel || undefined,
        });
        if (hits.length === 0) {
          return `No semantic matches for "${query}".`;
        }
        return JSON.stringify(
          hits.map((h) => ({
            file: h.file,
            lines: `${h.start_line}-${h.end_line}`,
            score: Number(h.score.toFixed(3)),
            content: h.content.length > 600 ? h.content.slice(0, 600) + "…" : h.content,
          })),
          null,
          2,
        );
      } catch (e) {
        return `search_semantic failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),

  workspace_map: tool({
    description:
      "Build a compact, deterministic map of the current workspace: project type, important files, top directories, likely entry points, package scripts, and cheap import hints. Use this before broad architecture/onboarding questions like 'understand this repo', 'where should I start?', or 'what are the main components?'",
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe("Optional subdirectory path relative to workspace root. Defaults to the workspace root."),
    }),
    execute: async ({ path }) => {
      const workspace = getWorkspace();
      const startPath = path ? normalizePath(path) : "";
      const files = await collectWorkspaceMapFiles(workspace, startPath);
      const map = buildWorkspaceMap(files);
      return formatWorkspaceMapForPrompt(map);
    },
  }),

  git_log: tool({
    description:
      "Show recent git commits in the workspace. Read-only. Optionally filter to a single file (uses --follow so renames don't break history). Returns at most 100 commits (default 20). Format: 'compact' (oneline, default), 'full' (author/committer/dates), or 'patch' (commit + diff).",
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe("Path relative to workspace root. Limits log to this file."),
      limit: z
        .number()
        .optional()
        .describe("Max commits to return (1-100, default 20)"),
      format: z
        .enum(["compact", "full", "patch"])
        .optional()
        .describe("Output format. 'patch' includes diffs and is verbose."),
    }),
    execute: async ({ path, limit, format }) => {
      const workspace = getWorkspace();
      return invoke<string>("git_log", {
        workspace,
        path: path ? normalizePath(path) : null,
        limit: limit ?? null,
        format: format ?? null,
      });
    },
  }),

  git_blame: tool({
    description:
      "Show line-by-line author and last-commit info for a tracked file. Use before refactoring to understand intent. Optionally restrict to a line range like '10-50' or '42'. Untracked or binary files return a clean error.",
    inputSchema: z.object({
      path: z.string().describe("Path relative to workspace root"),
      line_range: z
        .string()
        .optional()
        .describe("Line range like '10-50' or single line '42' (1-indexed)"),
    }),
    execute: async ({ path, line_range }) => {
      const workspace = getWorkspace();
      return invoke<string>("git_blame", {
        workspace,
        path: normalizePath(path),
        lineRange: line_range ?? null,
      });
    },
  }),

  read_pdf: tool({
    description:
      "Extract text from a PDF file in the workspace. Returns plain text with a brief header (file path, sizes). Output is capped at 200KB of extracted text; PDFs larger than 50MB are rejected. Encrypted or malformed PDFs return a clean error. Read-only.",
    inputSchema: z.object({
      path: z.string().describe("Path to a .pdf file relative to workspace root"),
    }),
    execute: async ({ path }) => {
      const workspace = getWorkspace();
      try {
        return await invoke<string>("read_pdf", {
          workspace,
          path: normalizePath(path),
        });
      } catch (e) {
        return `read_pdf failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),

  read_attachment: tool({
    description:
      "Read a slice of a user-uploaded chat attachment (PDF, Word, Slides, Excel, notebook, RTF, or text file) by line offset and limit. Use this when an attachment was inlined as a preview because it was too large to include in full — the preview shows an outline plus head and tail; this tool fetches any line range you need. Pass `filename` exactly as it appears in the attachment header. Default limit is 200 lines, max 2000.",
    inputSchema: z.object({
      filename: z.string().describe("Attachment filename, exactly as shown in the [Kind: filename] header"),
      offset: z.number().optional().describe("1-indexed line number to start reading from (default 1)"),
      limit: z.number().optional().describe("Max lines to return (default 200, max 2000)"),
    }),
    execute: async ({ filename, offset, limit }) => {
      const convId = useChatStore.getState().activeId;
      if (!convId) return "read_attachment failed: no active conversation";
      const entry = getAttachmentText(convId, filename);
      if (!entry) {
        const available = listAttachments(convId).map((a) => a.filename);
        return available.length === 0
          ? `No attachments cached for this conversation.`
          : `Attachment "${filename}" not found. Available: ${available.join(", ")}`;
      }
      const slice = readSlice(entry, offset ?? 1, limit ?? 200);
      const footer = slice.truncated
        ? `\n\n——\n[Showed lines ${slice.startLine}–${slice.endLine} of ${entry.totalLines}. Call read_attachment again with offset: ${slice.endLine + 1} to continue.]`
        : `\n\n——\n[Showed lines ${slice.startLine}–${slice.endLine} of ${entry.totalLines} (end of document).]`;
      return `[${entry.kindLabel}: ${entry.filename}]\n${slice.content}${footer}`;
    },
  }),

  search_attachment: tool({
    description:
      "Search inside a user-uploaded chat attachment for a substring or regex (use `/pattern/flags` form for regex). Returns matching lines with surrounding context, plus the line number you can pass to read_attachment to read more around the hit. Use this to locate a specific topic, term, or definition inside a long document like a textbook or paper.",
    inputSchema: z.object({
      filename: z.string().describe("Attachment filename, exactly as shown in the [Kind: filename] header"),
      query: z.string().describe("Substring (case-insensitive) or `/regex/flags` pattern"),
      max_results: z.number().optional().describe("Max matches to return (1-50, default 10)"),
      context_lines: z.number().optional().describe("Lines of context around each match (0-5, default 2)"),
    }),
    execute: async ({ filename, query, max_results, context_lines }) => {
      const convId = useChatStore.getState().activeId;
      if (!convId) return "search_attachment failed: no active conversation";
      const entry = getAttachmentText(convId, filename);
      if (!entry) {
        const available = listAttachments(convId).map((a) => a.filename);
        return available.length === 0
          ? `No attachments cached for this conversation.`
          : `Attachment "${filename}" not found. Available: ${available.join(", ")}`;
      }
      const hits = searchAttachmentText(entry, query, {
        maxResults: max_results,
        contextLines: context_lines,
      });
      if (hits.length === 0) {
        return `No matches for "${query}" in "${filename}". The document has ${entry.totalLines} lines; try a different term or use read_attachment to scan a specific section.`;
      }
      const blocks = hits.map((h) => {
        const ctx = h.context.join("\n");
        return `Line ${h.line}:\n${snipForResult(ctx, 600)}`;
      });
      return `Found ${hits.length} match${hits.length === 1 ? "" : "es"} in "${filename}":\n\n${blocks.join("\n\n---\n\n")}`;
    },
  }),

  web_search: tool({
    description:
      "Search the web for current or external information. Returns up to three citation-ready sources with title, URL, search snippet, and extracted page evidence. Use whenever fresh facts, a source, or context beyond your knowledge is useful. Uses the configured search backend in Settings.",
    inputSchema: z.object({
      query: z.string().describe("The search query"),
      maxResults: z.number().optional().describe("Max results to return (1-10, default 5)"),
    }),
    execute: async ({ query, maxResults }, options) => {
      const state = useChatStore.getState();
      const bypassSearchLimit = state.researchMode || isDeepResearchContext(options.experimental_context);

      // Register web results as citation sources (chat mode only) and stamp
      // each with the [n] number the model should cite inline. Agent/design
      // turns skip this — they surface sources as tool pills instead.
      const annotateCitations = (
        results: WebSearchResult[],
      ): (WebSearchResult & { cite?: string })[] => {
        const chatMode = !state.agentMode && !state.designMode;
        if (!chatMode || results.length === 0) return results;
        const registered = state.addCitationSources(
          results
            .filter((r) => r.url)
            .map((r) => ({
              type: "web" as const,
              title: r.title || r.url,
              url: r.url,
              snippet: r.content ? r.content.slice(0, 300) : undefined,
            })),
        );
        const byUrl = new Map(registered.map((c) => [c.url, c.index]));
        return results.map((r) => {
          const idx = byUrl.get(r.url);
          return idx ? { cite: `[${idx}]`, ...r } : r;
        });
      };

      if (!bypassSearchLimit && state.webSearchCount >= MAX_WEB_SEARCH_CALLS_PER_TURN) {
        return `Maximum web searches (${String(MAX_WEB_SEARCH_CALLS_PER_TURN)}) already used this turn. Answer with what you already know.`;
      }
      if (!bypassSearchLimit) {
        state.incrementWebSearchCount();
      }

      const { getFetch } = await import("../../fetch-adapter");
      const customFetch = getFetch() ?? globalThis.fetch.bind(globalThis);
      const limit = maxResults ?? 5;

      const enrichResults = async (results: WebSearchResult[]) => {
        const evidence = await collectWebSearchEvidence(results, {
          scrape: (url, options) => scrapeUrl(url, {
            apiKey: state.firecrawlApiKey,
            maxChars: options.maxChars,
          }),
        });
        return JSON.stringify(annotateCitations(evidence), null, 2);
      };

      const backend = state.searchBackend || "searxng";

      if (backend === "searxng") {
        try {
          const resp = await customFetch(
            `http://127.0.0.1:8080/search?q=${encodeURIComponent(query)}&format=json`
          );
          if (!resp.ok) {
            return `SearXNG search error: ${resp.status}. Please make sure local SearXNG is running.`;
          }
          const data: unknown = await resp.json();
          const rawResults = isRecord(data) && Array.isArray(data.results) ? data.results : [];
          const results = rawResults.slice(0, limit).map((result) => {
            const record = isRecord(result) ? result : {};
            return {
              title: textField(record, "title"),
              url: textField(record, "url"),
              content: textField(record, "content"),
            };
          });

          if (results.length === 0) {
            return `No results found for "${query}" via SearXNG.`;
          }
          return await enrichResults(results);
        } catch (e) {
          return `SearXNG search failed: ${e instanceof Error ? e.message : String(e)}. Check if the SearXNG Docker container is running.`;
        }
      }

      // Default to Tavily
      const apiKey = state.tavilyApiKey;
      if (!apiKey) {
        return "Error: No Tavily API key configured. Switch search backend in Settings.";
      }

      try {
        const resp = await customFetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            query,
            search_depth: "basic",
            max_results: limit,
          }),
        });

        if (!resp.ok) {
          const err = await resp.text();
          return `Search error: ${resp.status} — ${err}`;
        }

        const data: unknown = await resp.json();
        const rawResults = isRecord(data) && Array.isArray(data.results) ? data.results : [];
        const results: WebSearchResult[] = rawResults.map((result) => {
          const record = isRecord(result) ? result : {};
          return {
            title: textField(record, "title"),
            url: textField(record, "url"),
            content: textField(record, "content"),
          };
        });
        if (results.length === 0) {
          return `No results found for "${query}".`;
        }

        return await enrichResults(results);
      } catch (e) {
        return `Search failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),

  scrape_url: tool({
    description:
      "Read the full content of a specific web page as clean markdown/text. Use this after web_search returns a URL whose page body you need, or whenever the user asks to summarize/read a specific link. Uses Firecrawl when configured, otherwise falls back to the built-in browser text fetch.",
    inputSchema: z.object({
      url: z.string().describe("The http(s) URL to scrape/read"),
      maxChars: z.number().optional().describe("Maximum characters to return (default 60000)"),
    }),
    execute: async ({ url, maxChars }) => {
      const state = useChatStore.getState();
      try {
        const { scrapeUrl, formatScrapedPage } = await import("../../firecrawl");
        const page = await scrapeUrl(url, {
          apiKey: state.firecrawlApiKey,
          maxChars: maxChars ?? 60_000,
        });
        return formatScrapedPage(page);
      } catch (e) {
        return `scrape_url failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),

  load_skill: tool({
    description:
      "Load the full instructions for one of the skills listed in <available_skills>. Call this the moment the user's request matches a skill's description — it returns the complete SKILL.md body so you can follow it for the rest of the conversation. Pass the exact skill name.",
    inputSchema: z.object({
      name: z.string().describe("Exact skill name from <available_skills>"),
    }),
    execute: async ({ name }) => {
      const state = useChatStore.getState();
      const skill =
        state.discoveredSkills.find((s) => s.name === name) ??
        state.discoveredSkills.find((s) => s.aliases?.includes(name));
      if (!skill) {
        const names = state.discoveredSkills.map((s) => s.name).join(", ");
        return `No skill named "${name}". Available skills: ${names || "(none)"}.`;
      }
      let raw: string;
      try {
        raw = await invoke<string>("read_text_file_abs", { path: skill.filePath });
      } catch (e) {
        return `Failed to read skill "${skill.name}": ${e instanceof Error ? e.message : String(e)}`;
      }
      // Strip YAML frontmatter — the model already saw name/description in the
      // prompt; it only needs the body instructions.
      const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/^\n+/, "");

      // Mark the skill active on the current conversation so it shows a badge
      // and stays injected for subsequent turns (pi-style progressive
      // disclosure — the model loads once and keeps following it).
      const convId = state.activeId;
      if (convId) {
        const conv = state.conversations.find((c) => c.id === convId);
        const current = conv?.activeSkillNames ?? [];
        if (!current.includes(skill.name)) {
          state.setConversationSkills(convId, [...current, skill.name]);
        }
      }

      return `Loaded skill "${skill.name}". Follow these instructions:\n\n${body}`;
    },
  }),
};
