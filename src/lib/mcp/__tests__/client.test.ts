/**
 * MCP client tests — connect/handshake, listTools, callTool, disconnect,
 * version mismatch, timeout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the SDK modules before importing our client.
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  const MockClient = vi.fn();
  return { Client: MockClient };
});

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => {
  const MockTransport = vi.fn();
  return { StreamableHTTPClientTransport: MockTransport };
});

vi.mock("../transports", () => ({
  createStdioTransport: vi.fn(),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createStdioTransport } from "../transports";
import type { McpServerConfig, MCPClient } from "../client";
import { createMcpClient } from "../client";

type MockTransport = {
  onclose?: () => void;
  onerror?: (err: Error) => void;
  close: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};

function makeHttpConfig(overrides?: Partial<McpServerConfig>): McpServerConfig {
  return {
    id: "test-server-1",
    label: "Test Server",
    transport: "http",
    url: "http://localhost:3000/mcp",
    ...overrides,
  };
}

function makeStdioConfig(overrides?: Partial<McpServerConfig>): McpServerConfig {
  return {
    id: "test-server-2",
    label: "Test Server 2",
    transport: "stdio",
    command: "node",
    args: ["test-server.js"],
    ...overrides,
  };
}

describe("MCP client — HTTP transport", () => {
  let client: MCPClient;
  let sdkClient: any;
  let transport: MockTransport;

  beforeEach(() => {
    vi.clearAllMocks();

    // The SDK constructors assign callbacks to the transport object, so
    // the mock constructors must return the SAME reference the test holds.
    transport = {
      close: vi.fn(),
      start: vi.fn(),
      send: vi.fn(),
    };

    (StreamableHTTPClientTransport as unknown as ReturnType<typeof vi.fn>)
      .mockImplementation(function () { return transport; });

    sdkClient = {
      connect: vi.fn(),
      close: vi.fn(),
      listTools: vi.fn(),
      callTool: vi.fn(),
    };

    (Client as unknown as ReturnType<typeof vi.fn>)
      .mockImplementation(function () { return sdkClient; });

    client = createMcpClient(makeHttpConfig());
  });

  afterEach(async () => {
    await client.disconnect().catch(() => {});
  });

  it("connects successfully", async () => {
    sdkClient.connect.mockResolvedValue(undefined);
    await client.connect();
    expect(sdkClient.connect).toHaveBeenCalled();
  });

  it("lists tools after connect", async () => {
    await client.connect();
    sdkClient.listTools.mockResolvedValue({
      tools: [
        { name: "tool1", description: "First tool", inputSchema: { type: "object" } },
        { name: "tool2", description: "Second tool", inputSchema: { type: "object", properties: { x: { type: "string" } } } },
      ],
    });

    const tools = await client.listTools();
    expect(tools).toHaveLength(2);
    expect(tools[0]).toEqual({ name: "tool1", description: "First tool", inputSchema: { type: "object" } });
    expect(tools[1]).toEqual({ name: "tool2", description: "Second tool", inputSchema: { type: "object", properties: { x: { type: "string" } } } });
  });

  it("calls a tool with arguments", async () => {
    await client.connect();
    sdkClient.callTool.mockResolvedValue({
      content: [{ type: "text", text: "result" }],
      isError: false,
    });

    const result = await client.callTool("tool1", { key: "value" });
    expect(result.content[0]).toEqual({ type: "text", text: "result" });
    expect(result.isError).toBe(false);
    expect(sdkClient.callTool).toHaveBeenCalledWith({
      name: "tool1",
      arguments: { key: "value" },
    });
  });

  it("handles version mismatch gracefully via error hook", async () => {
    const errHandler = vi.fn();
    client.on("error", errHandler);
    await client.connect();

    const error = new Error("Unsupported protocol version");
    transport.onerror!(error);
    expect(errHandler).toHaveBeenCalledWith(error);
  });

  it("disconnects cleanly", async () => {
    await client.connect();
    await client.disconnect();
    expect(sdkClient.close).toHaveBeenCalled();
  });

  it("handles connect timeout", async () => {
    sdkClient.connect.mockRejectedValue(new Error("Connection timeout"));
    await expect(client.connect()).rejects.toThrow("Connection timeout");
  });

  it("emits close event on transport close", async () => {
    const closeHandler = vi.fn();
    client.on("close", closeHandler);
    await client.connect();
    transport.onclose!();
    expect(closeHandler).toHaveBeenCalled();
  });
});

describe("MCP client — stdio transport", () => {
  let client: MCPClient;
  let sdkClient: any;
  let transport: MockTransport;

  beforeEach(() => {
    vi.clearAllMocks();

    transport = {
      close: vi.fn(),
      start: vi.fn(),
      send: vi.fn(),
    };

    (createStdioTransport as unknown as ReturnType<typeof vi.fn>).mockReturnValue(transport);

    sdkClient = {
      connect: vi.fn(),
      close: vi.fn(),
      listTools: vi.fn(),
      callTool: vi.fn(),
    };

    (Client as unknown as ReturnType<typeof vi.fn>)
      .mockImplementation(function () { return sdkClient; });

    client = createMcpClient(makeStdioConfig());
  });

  afterEach(async () => {
    await client.disconnect().catch(() => {});
  });

  it("creates a stdio transport and connects", async () => {
    sdkClient.connect.mockResolvedValue(undefined);
    await client.connect();
    expect(createStdioTransport).toHaveBeenCalledWith("test-server-2");
    expect(sdkClient.connect).toHaveBeenCalledWith(transport);
  });

  it("lists tools via stdio", async () => {
    await client.connect();
    sdkClient.listTools.mockResolvedValue({
      tools: [{ name: "fs_read", description: "Read file", inputSchema: { type: "object" } }],
    });
    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("fs_read");
  });

  it("calls a tool via stdio", async () => {
    await client.connect();
    sdkClient.callTool.mockResolvedValue({
      content: [{ type: "text", text: "file contents here" }],
    });
    const result = await client.callTool("fs_read", { path: "/test/file.txt" });
    expect(result.content[0]).toEqual({ type: "text", text: "file contents here" });
  });

  it("disconnects stdio cleanly", async () => {
    await client.connect();
    await client.disconnect();
    expect(sdkClient.close).toHaveBeenCalled();
  });
});
