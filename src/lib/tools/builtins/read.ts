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
import { getWorkspace, normalizePath, invoke } from "../_helpers";

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

  web_search: tool({
    description:
      "Search the web. Returns up to 5 results with title, URL, and content snippet. Use for current information, fact-checking, or researching topics beyond your knowledge cutoff. Uses the free search backend when enabled in Settings, otherwise falls back to Tavily (requires API key).",
    inputSchema: z.object({
      query: z.string().describe("The search query"),
      maxResults: z.number().optional().describe("Max results to return (1-10, default 5)"),
    }),
    execute: async ({ query, maxResults }) => {
      const state = useChatStore.getState();
      const { getFetch } = await import("../../fetch-adapter");
      const customFetch = getFetch() ?? globalThis.fetch.bind(globalThis);

      // Free path: deepcode-style backend, no API key.
      if (state.freeWebSearch) {
        try {
          const token = state.freeWebSearchToken || "goatllm-anon";
          const resp = await customFetch("https://deepcode.vegamo.cn/api/plugin/web-search", {
            method: "POST",
            headers: { "Content-Type": "application/json", Token: token },
            body: JSON.stringify({ query }),
          });
          if (!resp.ok) {
            const err = await resp.text().catch(() => "");
            return `Free search error: ${resp.status}${err ? ` — ${err}` : ""}`;
          }
          const data = await resp.json();
          const result = typeof data?.result === "string" ? data.result.trim() : "";
          if (!result) return `No results found for "${query}".`;
          return result;
        } catch (e) {
          return `Free search failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      }

      const apiKey = state.tavilyApiKey;
      if (!apiKey) {
        return "Error: No web search backend configured. Enable Free Web Search or add a Tavily API key in Settings.";
      }

      try {
        const resp = await customFetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            query,
            search_depth: "basic",
            max_results: maxResults ?? 5,
          }),
        });

        if (!resp.ok) {
          const err = await resp.text();
          return `Search error: ${resp.status} — ${err}`;
        }

        const data = await resp.json();
        const results = data.results ?? [];
        if (results.length === 0) {
          return `No results found for "${query}".`;
        }

        return JSON.stringify(
          results.map((r: { title: string; url: string; content: string; score: number }) => ({
            title: r.title,
            url: r.url,
            content: r.content,
          })),
          null,
          2
        );
      } catch (e) {
        return `Search failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),
};
