import { tool } from "ai";
import { z } from "zod";
import { useChatStore } from "../stores/chat";
import { logApproval } from "./event-log";

// ── Helpers ──

function getWorkspace(): string {
  const ws = useChatStore.getState().workspacePath;
  if (!ws) throw new Error("No workspace selected");
  return ws;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

// ── Approval Gate Registry ──

type DeferredOperation = () => Promise<unknown>;

interface PendingApproval {
  resolveApproval: (approved: boolean) => void;
  operation: DeferredOperation;
  conversationId: string;
  messageId: string;
}

const pendingApprovals = new Map<string, PendingApproval>();

/** Check if a tool name requires user approval before execution. */
export function isWriteTool(name: string): boolean {
  return WRITE_TOOL_NAMES.has(name);
}

const WRITE_TOOL_NAMES = new Set([
  "write_file",
  "edit_file",
  "bash",
  "exec_command",
  "diff_file",
  "read_lints",
  "run_tests",
]);

/** Tools that "auto" mode can run without prompting. Shell-style commands are
 * intentionally NOT in this set: bash and exec_command can do anything to the
 * machine, so they always require explicit approval unless mode is "yolo". */
const AUTO_MODE_SAFE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "diff_file",
  "read_lints",
  "run_tests",
]);

export type PermissionMode = "manual" | "auto" | "yolo";

/** Whether a write-tool call should bypass the approval gate under the given mode. */
export function shouldAutoApprove(toolName: string, mode: PermissionMode): boolean {
  if (mode === "yolo") return true;
  if (mode === "auto") return AUTO_MODE_SAFE_TOOLS.has(toolName);
  return false;
}

/**
 * Approve a pending tool execution. Called from the UI (MessageBubble).
 * Transitions tool call state to "running" and resolves the promise.
 */
export function approveExecution(toolCallId: string): void {
  const pending = pendingApprovals.get(toolCallId);
  if (!pending) return;
  // Update UI state to running
  const store = useChatStore.getState();
  store.updateToolCallState(
    pending.conversationId,
    pending.messageId,
    toolCallId,
    "running"
  );
  // Log approval
  const tc = findToolCall(toolCallId);
  logApproval(pending.conversationId, toolCallId, tc?.toolName ?? "unknown", true);
  pending.resolveApproval(true);
}

/**
 * Deny a pending tool execution. Called from the UI (MessageBubble).
 * Transitions tool call state to "done" with a denial message and resolves the promise.
 */
export function denyExecution(toolCallId: string): void {
  const pending = pendingApprovals.get(toolCallId);
  if (!pending) return;
  const store = useChatStore.getState();
  store.completeToolCall(
    pending.conversationId,
    pending.messageId,
    toolCallId,
    "❌ Operation denied by user."
  );
  // Log denial
  const tc = findToolCall(toolCallId);
  logApproval(pending.conversationId, toolCallId, tc?.toolName ?? "unknown", false);
  pending.resolveApproval(false);
}

/** Find a tool call entry in the store by toolCallId. */
function findToolCall(toolCallId: string): { toolName: string } | undefined {
  const store = useChatStore.getState();
  for (const msgs of Object.values(store.messages)) {
    for (const m of msgs) {
      const tc = m.toolCalls?.find((t) => t.toolCallId === toolCallId);
      if (tc) return tc;
    }
  }
  return undefined;
}

// ── Read-only tools (execute immediately) ──

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
        path,
        offset: offset ?? null,
        limit: limit ?? null,
      });
      return result;
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
        { workspace, path: path ?? "" }
      );
      return JSON.stringify(result, null, 2);
    },
  }),

  search_content: tool({
    description:
      "Search for a regex pattern in workspace files. Returns array of {file, line, content} matches (max 100). Skips node_modules, .git, target, dist, and files >1MB.",
    inputSchema: z.object({
      pattern: z.string().describe("Regex pattern to search for"),
      filePattern: z
        .string()
        .optional()
        .describe("Glob pattern to filter files (e.g. '*.ts', '*.rs')"),
    }),
    execute: async ({ pattern, filePattern }) => {
      const workspace = getWorkspace();
      const result = await invoke<
        { file: string; line: number; content: string }[]
      >("search_content", {
        workspace,
        pattern,
        filePattern: filePattern ?? null,
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

  web_search: tool({
    description:
      "Search the web using Tavily. Returns up to 5 results with title, URL, and content snippet. Use for current information, fact-checking, or researching topics beyond your knowledge cutoff. Requires a Tavily API key in Settings.",
    inputSchema: z.object({
      query: z.string().describe("The search query"),
      maxResults: z.number().optional().describe("Max results to return (1-10, default 5)"),
    }),
    execute: async ({ query, maxResults }) => {
      const apiKey = useChatStore.getState().tavilyApiKey;
      if (!apiKey) {
        return "Error: Tavily API key not configured. Add it in Settings.";
      }

      try {
        const resp = await fetch("https://api.tavily.com/search", {
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

// ── Write tools (require user approval) ──

/** Shared approval gate for write tools. */
async function withApproval(
  toolCallId: string,
  operation: DeferredOperation,
): Promise<unknown> {
  // Find conversation/message context from the store
  const store = useChatStore.getState();

  // Look up the tool name early so we can apply the per-mode bypass rules.
  const tcEarly = findToolCall(toolCallId);
  const toolName = tcEarly?.toolName ?? "unknown";

  // If the current permission mode lets this tool run without a prompt, skip the gate.
  if (shouldAutoApprove(toolName, store.permissionMode)) {
    let conversationId = "";
    let messageId = "";
    for (const [cid, msgs] of Object.entries(store.messages)) {
      for (const m of msgs) {
        if (m.toolCalls?.some((tc) => tc.toolCallId === toolCallId)) {
          conversationId = cid;
          messageId = m.id;
          break;
        }
      }
      if (conversationId) break;
    }
    store.updateToolCallState(conversationId, messageId, toolCallId, "running");
    logApproval(conversationId, toolCallId, toolName, true);
    return operation();
  }

  let conversationId = "";
  let messageId = "";
  for (const [cid, msgs] of Object.entries(store.messages)) {
    for (const m of msgs) {
      if (m.toolCalls?.some((tc) => tc.toolCallId === toolCallId)) {
        conversationId = cid;
        messageId = m.id;
        break;
      }
    }
    if (conversationId) break;
  }

  const approved = await new Promise<boolean>((resolve) => {
    pendingApprovals.set(toolCallId, {
      resolveApproval: resolve,
      operation,
      conversationId,
      messageId,
    });
  });

  if (!approved) {
    pendingApprovals.delete(toolCallId);
    return "❌ Operation denied by user.";
  }

  const op = pendingApprovals.get(toolCallId)?.operation;
  pendingApprovals.delete(toolCallId);
  if (!op) return "Operation expired.";
  return op();
}

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
        return invoke<string>("write_file", { workspace, path, content });
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
          path: input.path,
        };
        if (input.edits && input.edits.length > 0) {
          args.edits = input.edits;
        } else if (input.old_text && input.new_text !== undefined) {
          args.oldText = input.old_text;
          args.newText = input.new_text;
        }
        return invoke<string>("edit_file", args);
      });
    },
  }),

  bash: tool({
    description:
      "Execute a shell command in the workspace directory and return stdout/stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds. ⚠️ Requires user approval.",
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
        return invoke<string>("exec_command", {
          workspace,
          command,
          timeoutMs: timeout_ms ?? null,
        });
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
        return invoke<string>("exec_command", {
          workspace,
          command,
          timeoutMs: timeout_ms ?? null,
        });
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
        return invoke<string>("diff_file", { workspace, path });
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
        // Detect project type
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
          // Check for vitest first, fall back to npm test
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
};

// ── Combined tool set ──

/**
 * Full tool set available when a workspace is active.
 * Read-only tools execute immediately; write tools require user approval.
 */
export const ALL_TOOLS = {
  ...READ_ONLY_TOOLS,
  ...WRITE_TOOLS,
};
