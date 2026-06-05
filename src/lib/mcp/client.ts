/**
 * MCP protocol client — wraps @modelcontextprotocol/sdk's Client with a
 * simplified interface shared across HTTP and stdio transports.
 *
 * Both transports satisfy the same MCPClient interface so the rest of the
 * code (registry, tool execution, Settings UI) doesn't care which transport
 * a server is using.
 *
 * HTTP transport: direct fetch through the SDK's StreamableHTTPClientTransport.
 * Stdio transport: Tauri event bridge (Rust spawns the child, JS subscribes
 *   to events keyed by serverId). Implemented in transports.ts.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult, Tool as McpSdkTool } from "@modelcontextprotocol/sdk/types.js";
import { createStdioTransport } from "./transports";

export interface McpServerConfig {
  id: string;
  label: string;
  transport: "http" | "stdio";
  /** HTTP: full URL. Stdio: command + args. */
  url?: string;
  command?: string;
  args?: string[];
  /** Per D3=B: trusted servers skip approval for readOnlyHint tools. */
  trusted?: boolean;
  /** Per-server allowed-subdirs glob list (default ["**"]). */
  allowedSubdirs?: string[];
  /** Per-tool allowlist. Empty = all tools allowed. */
  toolAllowlist?: string[];
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: McpSdkTool["inputSchema"];
  annotations?: McpSdkTool["annotations"];
}

export type McpToolCallResult = Pick<CallToolResult, "content" | "isError">;

export interface MCPClient {
  serverId: string;
  connect(): Promise<void>;
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult>;
  disconnect(): Promise<void>;
  on(event: McpClientEvent, cb: (...args: unknown[]) => void): void;
  off(event: McpClientEvent, cb: (...args: unknown[]) => void): void;
}

export type McpClientEvent = "error" | "close";

/**
 * HTTP-based MCP client. Thin wrapper over the SDK's Client +
 * StreamableHTTPClientTransport.
 */
class HttpMCPClient implements MCPClient {
  serverId: string;
  private client: Client;
  private transport: StreamableHTTPClientTransport;
  private listeners: Map<McpClientEvent, Set<(...args: unknown[]) => void>> = new Map();

  constructor(config: McpServerConfig) {
    this.serverId = config.id;
    const url = new URL(config.url!);
    this.transport = new StreamableHTTPClientTransport(url, {
      reconnectionOptions: {
        maxReconnectionDelay: 30000,
        initialReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 2,
      },
    });
    this.transport.onerror = (error) => this.emit("error", error);
    this.transport.onclose = () => this.emit("close");

    this.client = new Client(
      { name: "goatllm", version: "0.1.0" },
      { capabilities: {} },
    );
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = await this.client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const result = (await this.client.callTool({ name, arguments: args })) as CallToolResult;
    return {
      content: result.content,
      isError: result.isError,
    };
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }

  on(event: McpClientEvent, cb: (...args: unknown[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  off(event: McpClientEvent, cb: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(cb);
  }

  private emit(event: McpClientEvent, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((cb) => cb(...args));
  }
}

/**
 * Stdio-based MCP client — child process managed in Rust, messages bridged
 * over Tauri events. The transport is created in transports.ts.
 */
class StdioMCPClient implements MCPClient {
  serverId: string;
  private client: Client;
  private transport: Transport;
  private listeners: Map<McpClientEvent, Set<(...args: unknown[]) => void>> = new Map();

  constructor(config: McpServerConfig) {
    this.serverId = config.id;
    this.transport = createStdioTransport(config.id);
    this.transport.onerror = (error) => this.emit("error", error);
    this.transport.onclose = () => this.emit("close");

    this.client = new Client(
      { name: "goatllm", version: "0.1.0" },
      { capabilities: {} },
    );
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = await this.client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const result = (await this.client.callTool({ name, arguments: args })) as CallToolResult;
    return {
      content: result.content,
      isError: result.isError,
    };
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }

  on(event: McpClientEvent, cb: (...args: unknown[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  off(event: McpClientEvent, cb: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(cb);
  }

  private emit(event: McpClientEvent, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((cb) => cb(...args));
  }
}

/**
 * Factory: create the right client for a server config.
 */
export function createMcpClient(config: McpServerConfig): MCPClient {
  if (config.transport === "stdio") {
    return new StdioMCPClient(config);
  }
  return new HttpMCPClient(config);
}
