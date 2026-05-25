/**
 * MCP transport implementations.
 *
 * HTTP: StreamableHTTPClientTransport from the SDK — used directly.
 * Stdio: Rust spawns the child process, frames JSON-RPC over stdin/stdout,
 *        and emits Tauri events keyed by serverId. JS subscribes, pushing
 *        messages into an in-memory transport that satisfies the SDK's
 *        Transport interface.
 */
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { invoke } from "../tools/_helpers";

type MessageHandler = (message: JSONRPCMessage) => void;

/**
 * Create a Transport that bridges Rust stdio MCP server messages via Tauri events.
 * The Rust side emits mcp-stdio-message events keyed by serverId; this transport
 * subscribes, frames the JSON-RPC, and pipes into the SDK Client.
 */
export function createStdioTransport(serverId: string): Transport {
  let onMessage: MessageHandler | undefined;
  let onClose: (() => void) | undefined;
  let onError: ((error: Error) => void) | undefined;
  let unlisten: (() => void) | undefined;

  const transport: Transport = {
    async start(): Promise<void> {
      const { listen } = await import("@tauri-apps/api/event");

      const unlistenFn = await listen<{ serverId: string; message: JSONRPCMessage }>(
        `mcp-stdio-message:${serverId}`,
        (event) => {
          if (event.payload.serverId === serverId && onMessage) {
            onMessage(event.payload.message);
          }
        },
      );

      const unlistenError = await listen<{ serverId: string; error: string }>(
        `mcp-stdio-error:${serverId}`,
        (event) => {
          if (event.payload.serverId === serverId && onError) {
            onError(new Error(event.payload.error));
          }
        },
      );

      const unlistenClose = await listen<{ serverId: string }>(
        `mcp-stdio-close:${serverId}`,
        (event) => {
          if (event.payload.serverId === serverId) {
            onClose?.();
          }
        },
      );

      unlisten = () => {
        unlistenFn();
        unlistenError();
        unlistenClose();
      };
    },

    async send(message: JSONRPCMessage): Promise<void> {
      await invoke("mcp_stdio_send", { serverId, message });
    },

    async close(): Promise<void> {
      unlisten?.();
      await invoke("mcp_stdio_disconnect", { serverId }).catch(() => {});
      onClose?.();
    },

    set onmessage(handler: MessageHandler | undefined) {
      onMessage = handler;
    },

    set onclose(handler: (() => void) | undefined) {
      onClose = handler;
    },

    set onerror(handler: ((error: Error) => void) | undefined) {
      onError = handler;
    },
  };

  return transport;
}
