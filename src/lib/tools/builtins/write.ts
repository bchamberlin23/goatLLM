/**
 * Write-capable built-in tools — every call routes through withApproval()
 * so the user sees a card and clicks Approve / Deny before the operation
 * runs (unless permission mode is auto/yolo).
 *
 * Filesystem mutation: write_file, edit_file, diff_file (read-only but
 *   needs approval because shows uncommitted changes).
 * Shell: bash, exec_command (deprecated alias).
 * Git mutation: git_branch, git_commit, git_push.
 * Static analysis with side-effectful runners: read_lints, run_tests.
 * Network with side effects: browser_fetch, browser_extract,
 *   browser_session_open, browser_session_navigate, browser_session_close,
 *   index_workspace.
 *
 * Lifted out of src/lib/tools.ts during the registry split. Helpers come
 * from ../_helpers; the approval gate is in ../approval.
 */
import { tool } from "ai";
import { z } from "zod";
import { useChatStore, type ArtifactKind } from "../../../stores/chat";
import { browserFetch, browserExtract } from "../../browser-fetch";
import { indexWorkspace } from "../../semantic-index";
import {
  openSession as openBrowserSession,
  closeSession as closeBrowserSession,
  navigate as navigateSession,
  listSessions as listBrowserSessions,
} from "../../browser-session";
import { truncateTail, truncationFooter } from "../../truncate";
import { withFileMutationQueue } from "../../file-mutation-queue";
import { getWorkspace, normalizePath, invoke, spillToTempFile } from "../_helpers";
import { withApproval } from "../approval";

export const WRITE_TOOLS = {
  write_file: tool({
    description:
      "Write or create a file in the workspace. Creates parent directories if needed. Use for new files or complete rewrites. For targeted changes, prefer edit_file. ⚠️ Requires user approval before writing.",
    inputSchema: z.object({
      path: z.string().describe("Path relative to workspace root"),
      content: z.string().describe("Full file content to write"),
    }),
    execute: async ({ path, content }, { toolCallId }) => {
      const workspace = getWorkspace();
      return withApproval(toolCallId, async () => {
        const absKey = `${workspace}/${normalizePath(path)}`;
        return withFileMutationQueue(absKey, () =>
          invoke<string>("write_file", { workspace, path: normalizePath(path), content })
        );
      });
    },
  }),

  edit_file: tool({
    description:
      "Make precise text replacements in an existing file. Each old_text must appear exactly once and match uniquely — include enough surrounding context. For multiple changes in the same file, pass an edits array with multiple {{old_text, new_text}} objects. Each edit is matched against the original file, not incrementally. Do not pad with large unchanged regions. Merge nearby changes into one edit. ⚠️ Requires user approval.",
    inputSchema: z.object({
      path: z.string().describe("Path to the file to edit (relative to workspace root)"),
      old_text: z.string().optional().describe("Exact text to replace (must appear exactly once). Use for single edits."),
      new_text: z.string().optional().describe("Replacement text. Use for single edits."),
      edits: z.array(z.object({
        oldText: z.string().describe("Exact text for one targeted replacement"),
        newText: z.string().describe("Replacement text for this edit"),
      })).optional().describe("Array of replacements for multi-edit. Each oldText must match uniquely in the original file."),
    }),
    execute: async (input, { toolCallId }) => {
      const workspace = getWorkspace();
      return withApproval(toolCallId, async () => {
        const args: Record<string, unknown> = {
          workspace,
          path: normalizePath(input.path),
        };
        if (input.edits && input.edits.length > 0) {
          args.edits = input.edits;
        } else if (input.old_text && input.new_text !== undefined) {
          args.oldText = input.old_text;
          args.newText = input.new_text;
        }
        const absKey = `${workspace}/${normalizePath(input.path)}`;
        return withFileMutationQueue(absKey, () => invoke<string>("edit_file", args));
      });
    },
  }),

  edit_artifact: tool({
    description:
      "Make precise text replacements in an existing artifact (the side-panel canvas). Finds the artifact by kind and title (case-insensitive match), then applies targeted edits to its current code — just like edit_file does for workspace files. ALWAYS prefer this over emitting a brand-new artifact fence when the user asks to change, fix, or extend an artifact you already created — re-emitting a full fence with a different title spawns a confusing duplicate tab. Each old_text must appear exactly once in the artifact's current code. Runs immediately (no approval needed) — the canvas keeps full version history so edits are reversible.",
    inputSchema: z.object({
      kind: z
        .enum(["html", "latex", "python", "docx", "pptx", "xlsx", "deck", "react-component", "markdown-document", "svg", "diagram", "code-snippet", "mini-app", "design-system"])
        .describe("Artifact kind (must match the existing artifact's kind)"),
      title: z.string().describe("Title of the artifact to edit (matched case- and whitespace-insensitively)"),
      old_text: z.string().optional().describe("Exact text to replace (must appear exactly once in the artifact's current code). Use for single edits."),
      new_text: z.string().optional().describe("Replacement text. Use for single edits."),
      edits: z.array(z.object({
        oldText: z.string().describe("Exact text for one targeted replacement"),
        newText: z.string().describe("Replacement text for this edit"),
      })).optional().describe("Array of replacements for multi-edit. Each oldText must match uniquely in the artifact's current code."),
    }),
    execute: async (input) => {
      const store = useChatStore.getState();
      const activeConvId = store.activeId;
      if (!activeConvId) return "No active conversation. Open a conversation first.";

      const edits: { oldText: string; newText: string }[] = [];
      if (input.edits && input.edits.length > 0) {
        edits.push(...input.edits);
      } else if (input.old_text !== undefined && input.new_text !== undefined) {
        edits.push({ oldText: input.old_text, newText: input.new_text });
      } else {
        return "Provide either old_text + new_text, or an edits array.";
      }

      const result = store.editArtifactByKindAndTitle(
        activeConvId,
        input.kind as ArtifactKind,
        input.title,
        edits,
      );
      if (!result) {
        return `No artifact found with kind="${input.kind}" and title="${input.title}" in the current conversation. Use a full artifact fence to create one first.`;
      }
      return `Edited artifact "${input.title}" (${input.kind}). ${edits.length} replacement(s) applied.`;
    },
  }),

  bash: tool({
    description:
      "Execute a shell command in the workspace directory and return stdout/stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds. ⚠️ Requires user approval. Prefer dedicated tools when available: search_content for grep, list_dir for ls, read_file for cat, git_status/git_log/git_blame for read-only git — fall back to bash only for build commands, test runners, package managers, and grep flags search_content doesn't expose (-l, -c, -v, --include/--exclude).",
    inputSchema: z.object({
      command: z.string().describe("Shell command to execute (runs in bash -c)"),
      timeout_ms: z
        .number()
        .optional()
        .describe("Timeout in milliseconds (default 30000)"),
    }),
    execute: async ({ command, timeout_ms }, { toolCallId }) => {
      const workspace = getWorkspace();
      return withApproval(toolCallId, async () => {
        const out = await invoke<string>("exec_command", {
          workspace,
          command,
          timeoutMs: timeout_ms ?? null,
        });
        const t = truncateTail(out);
        if (!t.truncated) return out;
        const fullPath = await spillToTempFile("goatllm-bash", out);
        return t.content + truncationFooter(t, { fullOutputPath: fullPath });
      });
    },
  }),

  exec_command: tool({
    description:
      "[DEPRECATED: use bash instead] Run a shell command in the workspace directory. Returns stdout and stderr. ⚠️ Requires user approval before execution. Max 30s timeout.",
    inputSchema: z.object({
      command: z.string().describe("Shell command to execute (bash)"),
      timeout_ms: z
        .number()
        .optional()
        .describe("Timeout in milliseconds (default 30000)"),
    }),
    execute: async ({ command, timeout_ms }, { toolCallId }) => {
      const workspace = getWorkspace();
      return withApproval(toolCallId, async () => {
        const out = await invoke<string>("exec_command", {
          workspace,
          command,
          timeoutMs: timeout_ms ?? null,
        });
        const t = truncateTail(out);
        if (!t.truncated) return out;
        const fullPath = await spillToTempFile("goatllm-bash", out);
        return t.content + truncationFooter(t, { fullOutputPath: fullPath });
      });
    },
  }),

  diff_file: tool({
    description:
      "Show uncommitted git diff for a specific file in the workspace. ⚠️ Requires user approval.",
    inputSchema: z.object({
      path: z.string().describe("Path relative to workspace root to diff"),
    }),
    execute: async ({ path }, { toolCallId }) => {
      const workspace = getWorkspace();
      return withApproval(toolCallId, async () => {
        return invoke<string>("diff_file", { workspace, path: normalizePath(path) });
      });
    },
  }),

  git_branch: tool({
    description:
      "Manage git branches in the workspace. Actions: list (show all branches), current (show current branch), create (create and switch to new branch), switch (switch to existing branch). ⚠️ Requires user approval.",
    inputSchema: z.object({
      action: z.enum(["list", "current", "create", "switch"]).describe("Branch action to perform"),
      name: z.string().optional().describe("Branch name (required for create and switch)"),
    }),
    execute: async (input, { toolCallId }) => {
      const workspace = getWorkspace();
      return withApproval(toolCallId, async () => {
        return invoke<string>("git_branch", {
          workspace,
          action: input.action,
          name: input.name ?? null,
        });
      });
    },
  }),

  git_commit: tool({
    description:
      "Stage files and create a git commit in the workspace. If no files are specified, stages all changes (git add -A). Always requires a commit message. ⚠️ Requires user approval.",
    inputSchema: z.object({
      message: z.string().describe("Commit message"),
      files: z.array(z.string()).optional().describe("Specific files to stage. If omitted, stages all changes."),
    }),
    execute: async (input, { toolCallId }) => {
      const workspace = getWorkspace();
      return withApproval(toolCallId, async () => {
        return invoke<string>("git_commit", {
          workspace,
          message: input.message,
          files: input.files ?? null,
        });
      });
    },
  }),

  git_push: tool({
    description:
      "Push commits to a remote repository. Defaults to pushing the current branch to 'origin'. Use force=true with caution (force-pushes are classified as destructive). ⚠️ Requires user approval.",
    inputSchema: z.object({
      remote: z.string().optional().describe("Remote name (default 'origin')"),
      branch: z.string().optional().describe("Branch to push (default: current branch)"),
      force: z.boolean().optional().describe("Force push (default false). Destructive — overwrites remote history."),
    }),
    execute: async (input, { toolCallId }) => {
      const workspace = getWorkspace();
      return withApproval(toolCallId, async () => {
        return invoke<string>("git_push", {
          workspace,
          remote: input.remote ?? null,
          branch: input.branch ?? null,
          force: input.force ?? false,
        });
      });
    },
  }),

  run_tests: tool({
    description:
      "Run the project's test suite. Auto-detects the test runner: cargo test for Rust projects, npm test/vitest for TypeScript projects. ⚠️ Requires user approval.",
    inputSchema: z.object({
      filter: z.string().optional().describe("Optional test name filter (passed to the test runner)"),
    }),
    execute: async ({ filter }, { toolCallId }) => {
      const workspace = getWorkspace();
      return withApproval(toolCallId, async () => {
        const hasCargo = await invoke<{ name: string; is_dir: boolean; size: number }[]>(
          "list_dir", { workspace, path: "" }
        ).then((entries) => entries.some((e) => e.name === "Cargo.toml")).catch(() => false);

        const hasPackageJson = !hasCargo && await invoke<{ name: string; is_dir: boolean; size: number }[]>(
          "list_dir", { workspace, path: "" }
        ).then((entries) => entries.some((e) => e.name === "package.json")).catch(() => false);

        let command: string;
        if (hasCargo) {
          command = filter ? `cargo test "${filter}"` : "cargo test";
        } else if (hasPackageJson) {
          command = filter
            ? `npx vitest run -t "${filter}" 2>/dev/null || npm test -- --filter="${filter}"`
            : "npx vitest run 2>/dev/null || npm test";
        } else {
          return "No test configuration found (Cargo.toml or package.json required).";
        }

        return invoke<string>("exec_command", {
          workspace,
          command,
          timeoutMs: 120000,
        });
      });
    },
  }),

  read_lints: tool({
    description:
      "Run static analysis on the workspace. Runs cargo check for Rust projects or tsc --noEmit for TypeScript projects. ⚠️ Requires user approval.",
    inputSchema: z.object({}),
    execute: async (_, { toolCallId }) => {
      const workspace = getWorkspace();
      return withApproval(toolCallId, async () => {
        return invoke<string>("read_lints", { workspace });
      });
    },
  }),

  browser_fetch: tool({
    description:
      "Fetch a web page and return its content. Use for reading documentation, blog posts, API responses, or any HTTP(S) resource the agent needs to inspect. Output is capped at 200KB. mode='text' (default) strips HTML and returns extracted text; mode='html' returns raw HTML. Cloud metadata endpoints and non-http(s) schemes are blocked. ⚠️ Requires user approval.",
    inputSchema: z.object({
      url: z.string().describe("Absolute http or https URL"),
      mode: z
        .enum(["text", "html"])
        .optional()
        .describe("'text' (default) extracts readable text; 'html' returns raw HTML"),
      timeout_ms: z
        .number()
        .optional()
        .describe("Timeout in milliseconds (default 15000)"),
    }),
    execute: async ({ url, mode, timeout_ms }, { toolCallId }) => {
      return withApproval(toolCallId, async () => {
        try {
          const result = await browserFetch({
            url,
            mode: mode ?? "text",
            timeoutMs: timeout_ms ?? undefined,
          });
          const header =
            `URL: ${result.url}\n` +
            `Status: ${result.status}\n` +
            `Content-Type: ${result.contentType}\n` +
            `Bytes: ${result.bytes}${result.truncated ? " (truncated to 200KB)" : ""}\n` +
            `\n---\n\n`;
          return header + result.content;
        } catch (e) {
          return `browser_fetch failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      });
    },
  }),

  index_workspace: tool({
    description:
      "Build (or rebuild) the local semantic search index over the active workspace. Walks the workspace, chunks files, embeds each chunk via Ollama (nomic-embed-text), and stores embeddings in the local SQLite. Wipes any existing index for this workspace first. Slow on first run (depends on workspace size and embedding model speed). Requires Ollama running with nomic-embed-text pulled. ⚠️ Requires user approval.",
    inputSchema: z.object({}),
    execute: async (_, { toolCallId }) => {
      const workspace = getWorkspace();
      const { ollamaUrl, embeddingModel } = useChatStore.getState();
      return withApproval(toolCallId, async () => {
        try {
          const result = await indexWorkspace({
            workspace,
            ollamaUrl: ollamaUrl || undefined,
            model: embeddingModel || undefined,
          });
          if (result.chunksTotal === 0) {
            return "No indexable files found in the workspace.";
          }
          return `Indexed ${result.chunksIndexed} chunks in ${(result.durationMs / 1000).toFixed(1)}s. Use search_semantic to query.`;
        } catch (e) {
          return `index_workspace failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      });
    },
  }),

  browser_session_open: tool({
    description:
      "Open a stateful HTTP browsing session. Returns a session_id you pass to browser_session_navigate. Sessions hold cookies across requests, follow redirects manually, and support form POSTs — useful for login flows, multi-step forms, and any flow that requires session persistence. Sessions auto-close after 10 minutes idle. Limit 8 concurrent. Cannot run JavaScript — for SPAs that hydrate client-side, the static HTML is what you'll see. ⚠️ Requires user approval.",
    inputSchema: z.object({}),
    execute: async (_, { toolCallId }) => {
      return withApproval(toolCallId, async () => {
        const id = openBrowserSession();
        return `Opened session ${id}. Use browser_session_navigate({session_id: "${id}", url: "..."}) to begin.`;
      });
    },
  }),

  browser_session_navigate: tool({
    description:
      "Navigate within an open browser session. Carries cookies forward, follows redirects (max 5 hops), and supports POST with form_data for form submissions. mode 'text' (default) extracts readable text; 'html' returns raw HTML; selector (optional CSS) further narrows the result. Output capped at 200KB. ⚠️ Requires user approval per call (URLs may differ each time).",
    inputSchema: z.object({
      session_id: z.string().describe("Session id from browser_session_open"),
      url: z.string().describe("Absolute http or https URL"),
      method: z.enum(["GET", "POST"]).optional().describe("HTTP method (default GET)"),
      form_data: z
        .record(z.string())
        .optional()
        .describe("Form fields to send (only used with POST). Encoded as application/x-www-form-urlencoded."),
      selector: z
        .string()
        .optional()
        .describe("Optional CSS selector to narrow the response to specific elements"),
      mode: z.enum(["text", "html"]).optional().describe("'text' (default) or 'html'"),
      timeout_ms: z.number().optional().describe("Timeout in milliseconds (default 15000)"),
    }),
    execute: async ({ session_id, url, method, form_data, selector, mode, timeout_ms }, { toolCallId }) => {
      return withApproval(toolCallId, async () => {
        try {
          const result = await navigateSession({
            sessionId: session_id,
            url,
            method: method ?? "GET",
            formData: form_data,
            selector,
            mode: mode ?? "text",
            timeoutMs: timeout_ms ?? undefined,
          });
          const header =
            `Session: ${result.sessionId}\n` +
            `URL: ${result.url}\n` +
            `Status: ${result.status}\n` +
            `Content-Type: ${result.contentType}\n` +
            `Bytes: ${result.bytes}${result.truncated ? " (truncated to 200KB)" : ""}\n` +
            `Cookies in jar: ${result.cookieCount}\n` +
            (result.redirects.length > 0
              ? `Redirects: ${result.redirects.join(" → ")}\n`
              : "") +
            `\n---\n\n`;
          return header + result.content;
        } catch (e) {
          return `browser_session_navigate failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      });
    },
  }),

  browser_session_close: tool({
    description:
      "Close a browser session and discard its cookie jar. Call this when you're done with a multi-step flow. Sessions also auto-close after 10 minutes idle, so this is optional but tidy.",
    inputSchema: z.object({
      session_id: z.string().describe("Session id from browser_session_open"),
    }),
    execute: async ({ session_id }) => {
      const closed = closeBrowserSession(session_id);
      const remaining = listBrowserSessions().length;
      return closed
        ? `Closed session ${session_id}. ${remaining} session(s) remain.`
        : `Session ${session_id} not found (already closed or expired).`;
    },
  }),

  browser_extract: tool({
    description:
      "Fetch a web page and extract elements matching a CSS selector. Use after browser_fetch shows the page is bigger than you need — selector lets you grab just 'main', 'article', '.post-content', 'pre code', or any querySelectorAll-compatible expression. Returns up to max_matches elements (default 10). Mode 'text' returns text content only (much smaller); 'html' includes outerHTML. ⚠️ Requires user approval.",
    inputSchema: z.object({
      url: z.string().describe("Absolute http or https URL"),
      selector: z
        .string()
        .describe("CSS selector — anything querySelectorAll accepts, e.g. 'main', 'h1, h2', 'article p', '.post-content', '[role=main]', 'pre code'"),
      mode: z
        .enum(["text", "html"])
        .optional()
        .describe("'text' (default) returns text content; 'html' returns outerHTML for each match"),
      max_matches: z
        .number()
        .optional()
        .describe("Cap on returned matches (1-50, default 10)"),
      timeout_ms: z
        .number()
        .optional()
        .describe("Timeout in milliseconds (default 15000)"),
    }),
    execute: async ({ url, selector, mode, max_matches, timeout_ms }, { toolCallId }) => {
      return withApproval(toolCallId, async () => {
        try {
          const result = await browserExtract({
            url,
            selector,
            mode: mode ?? "text",
            maxMatches: max_matches ?? undefined,
            timeoutMs: timeout_ms ?? undefined,
          });
          if (result.matches.length === 0) {
            return `No elements matched '${selector}' on ${result.url}.`;
          }
          const header =
            `URL: ${result.url}\n` +
            `Selector: ${result.selector}\n` +
            `Matches: ${result.matches.length}${result.truncated ? ` (of ${result.totalMatched}, truncated)` : ""}\n` +
            `\n---\n\n`;
          const body = result.matches
            .map((m, i) => {
              const heading = `[match ${i + 1}]`;
              if (mode === "html") {
                return `${heading}\n${m.html ?? m.text}`;
              }
              return `${heading}\n${m.text}`;
            })
            .join("\n\n---\n\n");
          return header + body;
        } catch (e) {
          return `browser_extract failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      });
    },
  }),

  run_python: tool({
    description:
      "Execute a short Python 3 snippet and return stdout. Useful in chat for math, plotting (returns figure size info), data parsing, and quick scratch computation. Requires Python 3 on PATH. ~30s timeout. ⚠️ Requires user approval.",
    inputSchema: z.object({
      code: z.string().describe("Python 3 source. Use `print()` for output."),
    }),
    execute: async ({ code }, { toolCallId }) => {
      return withApproval(toolCallId, async () => {
        try {
          return await invoke<string>("run_python", { code });
        } catch (e) {
          return `run_python failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      });
    },
  }),

  run_javascript: tool({
    description:
      "Evaluate a short JavaScript expression in a sandbox and return the result as JSON. Use for arithmetic, string/array manipulation, JSON parsing/transformation. No network, no DOM, no Node APIs — just plain JS. Globals available: Math, Date, JSON, Array, Object, Number, String, Map, Set, Intl. ⚠️ Requires user approval.",
    inputSchema: z.object({
      expression: z.string().describe("A JavaScript expression OR a series of statements ending in `return <value>`."),
    }),
    execute: async ({ expression }, { toolCallId }) => {
      return withApproval(toolCallId, async () => {
        try {
          // Wrap so users can either pass an expression or a multi-statement
          // body with a `return`. Empty/undefined results render as "undefined".
          const body = /\breturn\b/.test(expression) ? expression : `return (${expression});`;
          // eslint-disable-next-line no-new-func
          const fn = new Function(
            "Math", "Date", "JSON", "Array", "Object", "Number", "String", "Map", "Set", "Intl",
            `"use strict"; ${body}`,
          );
          const out = fn(Math, Date, JSON, Array, Object, Number, String, Map, Set, Intl);
          if (out === undefined) return "undefined";
          if (typeof out === "string") return out;
          try {
            return JSON.stringify(out, null, 2);
          } catch {
            return String(out);
          }
        } catch (e) {
          return `run_javascript failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      });
    },
  }),

  manage_memory: tool({
    description:
      "Manage the assistant's long-term memory. Actions: 'add' (args: text, category), 'delete' (args: id), 'list' (args: category filter), 'search' (args: query). Valid categories: 'fact', 'contact', 'preference', 'task'.",
    inputSchema: z.object({
      action: z.enum(["add", "delete", "list", "search"]),
      text: z.string().optional().describe("Text of the memory to add"),
      category: z.string().optional().describe("Category of the memory to add (default 'fact')"),
      id: z.string().optional().describe("Unique ID of the memory to delete"),
      query: z.string().optional().describe("Query to search memories with"),
    }),
    execute: async ({ action, text, category, id, query }) => {
      const { addMemory, deleteMemory, listMemories, searchMemories } = await import("../../memory");
      
      try {
        if (action === "add") {
          if (!text) return "Error: 'text' parameter is required for 'add' action.";
          const cat = category || "fact";
          await addMemory(text, cat);
          return `Successfully remembered: [${cat}] ${text}`;
        }
        
        if (action === "delete") {
          if (!id) return "Error: 'id' parameter is required for 'delete' action.";
          await deleteMemory(id);
          return `Successfully deleted memory with ID: ${id}`;
        }
        
        if (action === "list") {
          const memories = await listMemories(category);
          if (memories.length === 0) {
            return category ? `No memories found in category '${category}'.` : "No memories found.";
          }
          return JSON.stringify(
            memories.map((m) => ({
              id: m.id,
              category: m.category,
              text: m.text,
              uses: m.uses,
              created_at: new Date(m.created_at * 1000).toISOString().slice(0, 10),
            })),
            null,
            2
          );
        }
        
        if (action === "search") {
          if (!query) return "Error: 'query' parameter is required for 'search' action.";
          const results = await searchMemories(query);
          if (results.length === 0) {
            return `No memories matched query: "${query}"`;
          }
          return JSON.stringify(
            results.map((r) => ({
              id: r.id,
              category: r.category,
              text: r.text,
              score: Number(r.score.toFixed(3)),
              uses: r.uses,
            })),
            null,
            2
          );
        }
        
        return "Error: Unknown action.";
      } catch (e) {
        return `manage_memory failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),
};
