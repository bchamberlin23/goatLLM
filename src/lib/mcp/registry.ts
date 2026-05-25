/**
 * MCP registry — manages active MCP server connections and integrates MCP
 * tools into the global ToolSet.
 *
 * Responsibilities:
 * - Hold per-server configs (persisted to localStorage).
 * - Connect/disconnect servers on startup/config change.
 * - Expose active MCP tools as Vercel AI SDK tool() definitions.
 * - Route tools/call through withApproval (per D3=B default-deny).
 * - Pre-flight path-like-arg inspection (per D15 reframed).
 * - Per-server allowed-subdirs enforcement.
 * - Per-server trusted toggle + readOnlyHint (T12).
 */
import type { ToolSet } from "ai";
import type { McpServerConfig, MCPClient, McpToolInfo } from "./client";
import { withApproval } from "../tools/approval";

const MCP_SERVERS_KEY = "goatllm-mcp-servers";

interface ActiveServer {
  config: McpServerConfig;
  client: MCPClient;
  tools: McpToolInfo[];
  connected: boolean;
}

const activeServers = new Map<string, ActiveServer>();

export function getMcpServers(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(MCP_SERVERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveMcpServers(servers: McpServerConfig[]): void {
  localStorage.setItem(MCP_SERVERS_KEY, JSON.stringify(servers));
}

/**
 * Build a Vercel AI SDK ToolSet from all active MCP servers' tools.
 * Tool names are prefixed as `mcp_<serverId>_<toolName>`.
 */
export function buildMcpToolSet(): ToolSet {
  const tools: ToolSet = {};
  for (const [serverId, server] of activeServers) {
    if (!server.connected) continue;
    const allowlist = server.config.toolAllowlist;
    const filtered = allowlist?.length
      ? server.tools.filter((t) => allowlist.includes(t.name))
      : server.tools;

    for (const mcpTool of filtered) {
      const fullName = `mcp_${serverId}_${mcpTool.name}`;
      tools[fullName] = {
        description: mcpTool.description ?? `MCP tool: ${mcpTool.name}`,
        parameters: mcpTool.inputSchema,
        execute: async (args: any) => {
          return executeMcpTool(serverId, mcpTool.name, args, server.config);
        },
      } as any;
    }
  }
  return tools;
}

/**
 * Execute a single MCP tool with approval gate + denylist check + path inspection.
 */
async function executeMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  config: McpServerConfig,
): Promise<unknown> {
  const server = activeServers.get(serverId);
  if (!server || !server.connected) {
    throw new Error(`MCP server '${serverId}' is not connected`);
  }

  // Pre-flight path inspection for untrusted servers.
  if (!config.trusted) {
    const pathIssues = inspectArgsForPaths(args);
    if (pathIssues.length > 0) {
      throw new Error(
        `Path inspection failed for MCP tool '${toolName}': ${pathIssues.join("; ")}`,
      );
    }
  }

  // Check if this tool can skip approval due to trust + readOnlyHint (D3=B).
  const toolInfo = server.tools.find((t) => t.name === toolName);
  const isReadOnly = toolInfo?.annotations?.readOnlyHint === true;
  const canSkipApproval = config.trusted && isReadOnly;

  const toolCallId = `mcp_${serverId}_${toolName}_${Date.now()}`;

  if (canSkipApproval) {
    // Trusted server + readOnlyHint: execute directly, skip withApproval.
    const res = await server.client.callTool(toolName, args);
    const textParts = res.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);
    if (res.isError) {
      throw new Error(textParts.join("\n") || "MCP tool returned an error");
    }
    return textParts.join("\n");
  }

  // MCP tool execution wraps withApproval (default-deny per D3=B).
  const result = await withApproval(toolCallId, async () => {
    const res = await server.client.callTool(toolName, args);
    // Extract text from content blocks for the model.
    const textParts = res.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);
    if (res.isError) {
      throw new Error(textParts.join("\n") || "MCP tool returned an error");
    }
    return textParts.join("\n");
  });

  return result;
}

// ── Path-like-arg inspection (D15 reframed, D19=B) ───────────────────

const PATHY_KEY_NAMES = new Set([
  "path", "file", "cwd", "directory", "dest", "target", "output", "input",
]);

const SQL_SUBSTRING_GUARD_KEYS = new Set(["query", "sql", "statement"]);

const DENYLIST_GLOBS = [
  "**/.env",
  "**/.git/credentials",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa",
  "**/.ssh/**",
  "**/secrets/**",
];

function isPathLike(value: string): boolean {
  return /^\//.test(value) || /^~\//.test(value) || /^[A-Z]:\\/i.test(value) || /^file:\/\//i.test(value);
}

function matchesDenylist(path: string): boolean {
  const normalized = path.replace(/^file:\/\//, "");
  for (const pattern of DENYLIST_GLOBS) {
    if (minimatchPath(normalized, pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Minimal glob matching for denylist patterns.
 * Supports **, *, and literal segments.
 */
function minimatchPath(path: string, pattern: string): boolean {
  const segs = path.split("/").filter(Boolean);
  const patSegs = pattern.split("/").filter(Boolean);

  // DP: dp[i][j] = true if segs[0..i] matches patSegs[0..j]
  const n = segs.length;
  const m = patSegs.length;
  const dp: boolean[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(false));
  dp[0][0] = true;

  // Leading ** can match zero segments.
  for (let j = 1; j <= m; j++) {
    if (patSegs[j - 1] === "**") {
      dp[0][j] = dp[0][j - 1];
    } else {
      break;
    }
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const p = patSegs[j - 1];
      const s = segs[i - 1];

      if (p === "**") {
        // ** matches zero segments (dp[i][j-1]) or one+ segments (dp[i-1][j]).
        dp[i][j] = dp[i][j - 1] || dp[i - 1][j];
      } else if (matchSegment(s, p)) {
        dp[i][j] = dp[i - 1][j - 1];
      }
    }
  }

  return dp[n][m];
}

function matchSegment(segment: string, pattern: string): boolean {
  if (pattern === "*") return true;
  // Simple glob: literal match with optional extensions via **
  const regexStr = "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, "[^/]*") + "$";
  try {
    return new RegExp(regexStr).test(segment);
  } catch {
    return segment === pattern;
  }
}

export interface InspectArgsIssue {
  path: string;
  reason: string;
}

export function inspectArgsForPaths(
  args: unknown,
  depth: number = 0,
): InspectArgsIssue[] {
  if (depth > 20) return [];

  if (typeof args === "string") {
    if (isPathLike(args) && matchesDenylist(args)) {
      return [{ path: args, reason: "Matches denylist pattern" }];
    }
    return [];
  }

  if (Array.isArray(args)) {
    const issues: InspectArgsIssue[] = [];
    for (const item of args) {
      issues.push(...inspectArgsForPaths(item, depth + 1));
    }
    return issues;
  }

  if (args && typeof args === "object") {
    const issues: InspectArgsIssue[] = [];
    const record = args as Record<string, unknown>;

    for (const [key, value] of Object.entries(record)) {
      // SQL substring guard: skip query/sql/statement UNLESS the value
      // begins with a path scheme (which means it's not actually a SQL query).
      if (SQL_SUBSTRING_GUARD_KEYS.has(key) && typeof value === "string") {
        if (!isPathLike(value)) continue;
        // Fall through — treat path-shaped SQL keys as paths.
      }

      // Pathy key with string value.
      if (PATHY_KEY_NAMES.has(key) && typeof value === "string") {
        if (isPathLike(value) && matchesDenylist(value)) {
          issues.push({ path: value, reason: `Key '${key}' matches denylist` });
        }
        continue;
      }

      // A bare string value in SQL guard context that is path-like.
      if (typeof value === "string" && isPathLike(value) && matchesDenylist(value)) {
        issues.push({ path: value, reason: `Key '${key}' matches denylist` });
        continue;
      }

      // Recurse into nested objects.
      if (typeof value === "object" && value !== null) {
        issues.push(...inspectArgsForPaths(value, depth + 1));
      }
    }
    return issues;
  }

  return [];
}
