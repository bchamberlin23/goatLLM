/**
 * MCP Servers settings section.
 *
 * DESIGN.md compliance:
 * - Hairlines at rgba(255,255,255,0.06) default, 0.10 on hover/focus.
 * - Surfaces from token list: bg-surface-1 (#2a2a2c) for cards.
 * - Single accent #f59e42 for active states, toggles, primary actions.
 * - Text colors: text-1 (#ececec), text-2 (#b4b4b4), text-3 (#a0a0a0).
 * - No new accents, no decorative gradients.
 */
import { useState } from "react";
import { Plus, Trash2, Wifi, Terminal } from "lucide-react";
import type { McpServerConfig } from "../../lib/mcp/client";
import { getMcpServers, saveMcpServers } from "../../lib/mcp/registry";
import { formatTokenEstimate } from "../../lib/mcp/token-budget";

export function McpSettingsSection({ embedded = false }: { embedded?: boolean }) {
  const [servers, setServers] = useState<McpServerConfig[]>(() => getMcpServers());
  const [editingId, setEditingId] = useState<string | null>(null);

  function persist(updated: McpServerConfig[]) {
    setServers(updated);
    saveMcpServers(updated);
  }

  function addServer() {
    const id = `mcp-${Date.now()}`;
    persist([...servers, {
      id,
      label: "New MCP Server",
      transport: "http",
      url: "http://localhost:3000/mcp",
      trusted: false,
    }]);
    setEditingId(id);
  }

  function removeServer(id: string) {
    persist(servers.filter((s) => s.id !== id));
  }

  function updateServer(id: string, patch: Partial<McpServerConfig>) {
    persist(servers.map((s) => s.id === id ? { ...s, ...patch } : s));
  }

  const header = embedded ? (
    <div className="flex items-center justify-between">
      <span className="text-[12px] font-medium text-text-3">MCP servers</span>
      <button
        onClick={addServer}
        className="flex items-center gap-1.5 text-[12px] text-text-3 hover:text-text-1 transition-colors"
      >
        <Plus size={13} strokeWidth={2} />
        Add server
      </button>
    </div>
  ) : (
    <div className="flex items-center justify-between">
      <h3 className="text-[11px] font-semibold text-text-3 uppercase tracking-wider">
        MCP Servers
      </h3>
      <button
        onClick={addServer}
        className="flex items-center gap-1.5 text-[12px] text-text-3 hover:text-text-1 transition-colors"
      >
        <Plus size={13} strokeWidth={2} />
        Add server
      </button>
    </div>
  );

  const content = (
    <>
      {header}
      {!embedded && (
        <p className="text-[13px] text-text-3 leading-relaxed mb-2">
          Connect to Model Context Protocol servers to give the agent access to
          external tools. Trust servers only with workspaces you control.
        </p>
      )}

      {servers.length === 0 && (
        <div className="text-[13px] text-text-3 py-3 text-center border border-dashed border-white/5 rounded-lg">
          No MCP servers configured.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {servers.map((server) => (
          <McpServerCard
            key={server.id}
            server={server}
            isEditing={editingId === server.id}
            onToggleEdit={() => setEditingId(editingId === server.id ? null : server.id)}
            onUpdate={(patch) => updateServer(server.id, patch)}
            onRemove={() => removeServer(server.id)}
          />
        ))}
      </div>
    </>
  );

  if (embedded) {
    return <div className="flex flex-col gap-2">{content}</div>;
  }

  return (
    <section className="flex flex-col gap-2">
      {content}
    </section>
  );
}

interface McpServerCardProps {
  server: McpServerConfig;
  isEditing: boolean;
  onToggleEdit: () => void;
  onUpdate: (patch: Partial<McpServerConfig>) => void;
  onRemove: () => void;
}

function McpServerCard({ server, isEditing, onToggleEdit, onUpdate, onRemove }: McpServerCardProps) {
  const tokenEst = Math.max(
    // Cheap token estimate from the serialized config string.
    Math.ceil(JSON.stringify(server).length / 4),
    1,
  );

  return (
    <div className="bg-surface-1 border border-white/5 rounded-lg p-3">
      {isEditing ? (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={server.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
            className="bg-bg border border-white/10 rounded px-2 py-1 text-[13px] text-text-1 focus:outline-none focus:border-accent/50"
            placeholder="Server label"
          />
          <div className="flex gap-2">
            <button
              onClick={() => onUpdate({ transport: "http" })}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[12px] transition-colors ${
                server.transport === "http"
                  ? "bg-accent/15 text-accent border border-accent/30"
                  : "bg-white/5 text-text-3 border border-transparent hover:text-text-1"
              }`}
            >
              <Wifi size={12} />
              HTTP
            </button>
            <button
              onClick={() => onUpdate({ transport: "stdio" })}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[12px] transition-colors ${
                server.transport === "stdio"
                  ? "bg-accent/15 text-accent border border-accent/30"
                  : "bg-white/5 text-text-3 border border-transparent hover:text-text-1"
              }`}
            >
              <Terminal size={12} />
              Stdio
            </button>
          </div>

          {server.transport === "http" ? (
            <input
              type="text"
              value={server.url ?? ""}
              onChange={(e) => onUpdate({ url: e.target.value })}
              className="bg-bg border border-white/10 rounded px-2 py-1 text-[12px] text-text-1 focus:outline-none focus:border-accent/50 font-mono"
              placeholder="http://localhost:3000/mcp"
            />
          ) : (
            <div className="flex gap-1">
              <input
                type="text"
                value={server.command ?? ""}
                onChange={(e) => onUpdate({ command: e.target.value })}
                className="flex-1 bg-bg border border-white/10 rounded px-2 py-1 text-[12px] text-text-1 focus:outline-none focus:border-accent/50 font-mono"
                placeholder="command"
              />
              <input
                type="text"
                value={(server.args ?? []).join(" ")}
                onChange={(e) => onUpdate({ args: e.target.value.split(/\s+/).filter(Boolean) })}
                className="flex-1 bg-bg border border-white/10 rounded px-2 py-1 text-[12px] text-text-1 focus:outline-none focus:border-accent/50 font-mono"
                placeholder="args"
              />
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-1.5 text-[12px] text-text-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={server.trusted ?? false}
                onChange={(e) => onUpdate({ trusted: e.target.checked })}
                className="accent-accent"
              />
              Trusted (auto-approve read-only tools)
            </label>
            <span className="text-[11px] text-text-4">
              {formatTokenEstimate(tokenEst)}
            </span>
          </div>

          <div className="flex justify-between pt-1">
            <button
              onClick={onRemove}
              className="flex items-center gap-1 text-[12px] text-error/70 hover:text-error transition-colors"
            >
              <Trash2 size={12} />
              Remove
            </button>
            <button
              onClick={onToggleEdit}
              className="text-[12px] text-text-3 hover:text-text-1 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between cursor-pointer" onClick={onToggleEdit}>
          <div className="flex items-center gap-2">
            {server.transport === "http" ? <Wifi size={13} className="text-text-3" /> : <Terminal size={13} className="text-text-3" />}
            <div>
              <div className="text-[13px] text-text-1">{server.label}</div>
              <div className="text-[11px] text-text-3 font-mono">
                {server.transport === "http" ? server.url : (server.command ?? "")}
              </div>
            </div>
            {server.trusted && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
                trusted
              </span>
            )}
          </div>
          <span className="text-[11px] text-text-4">{formatTokenEstimate(tokenEst)}</span>
        </div>
      )}
    </div>
  );
}
