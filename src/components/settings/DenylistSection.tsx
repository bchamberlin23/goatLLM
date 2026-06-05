import { useState, useEffect, useCallback } from "react";
import { Shield, Plus, X } from "lucide-react";
import { useChatStore } from "../../stores/chat";

const BUILT_IN_DENY_PATTERNS = [
  "**/.env",
  "**/.git/credentials",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa",
  "**/.ssh/**",
  "**/secrets/**",
];

export function DenylistSection() {
  const workspacePath = useChatStore((s) => s.workspacePath);
  const [patterns, setPatterns] = useState<string[]>([]);
  const [newPattern, setNewPattern] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!workspacePath) return;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const existing = await invoke<string[]>("get_workspace_denylist", { path: workspacePath });
        setPatterns(existing);
      } catch { /* use empty */ }
      setLoaded(true);
    })();
  }, [workspacePath]);

  const persist = useCallback(async (updated: string[]) => {
    setPatterns(updated);
    if (!workspacePath) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_workspace_denylist", { path: workspacePath, patterns: updated });
    } catch { /* */ }
  }, [workspacePath]);

  const handleAdd = useCallback(() => {
    const trimmed = newPattern.trim();
    if (!trimmed || patterns.includes(trimmed)) return;
    setNewPattern("");
    persist([...patterns, trimmed]);
  }, [newPattern, patterns, persist]);

  const handleRemove = useCallback((pattern: string) => {
    persist(patterns.filter((p) => p !== pattern));
  }, [patterns, persist]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAdd();
  }, [handleAdd]);

  if (!workspacePath) {
    return (
      <div className="p-3.5 bg-surface-3 border border-white/5 rounded-xl text-[12px] text-text-3">
        Select a workspace to configure its file denylist.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="p-3.5 bg-surface-3 border border-white/5 rounded-xl flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Shield size={13} strokeWidth={1.75} className="text-text-3" />
          <span className="text-[12px] text-text-2">Always enforced</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {BUILT_IN_DENY_PATTERNS.map((p) => (
            <span key={p} className="px-2 py-0.5 bg-white/5 rounded-md text-[11px] font-mono text-text-3">
              {p}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          type="text"
          aria-label="New denylist pattern"
          className="flex-1 h-[32px] px-2.5 bg-surface-2 border border-white/5 rounded-md text-[12px] text-text-1 font-mono outline-none focus:border-white/15"
          placeholder="Add pattern (e.g. **/*.log)"
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className="shrink-0 h-[32px] w-[32px] flex items-center justify-center rounded-md bg-white/5 text-text-2 hover:bg-white/10 hover:text-text-1 transition-colors"
          onClick={handleAdd}
          aria-label="Add denylist pattern"
        >
          <Plus size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {patterns.length > 0 ? (
        <div className="flex flex-col gap-1">
          {patterns.map((p) => (
            <div key={p} className="flex items-center justify-between gap-2 p-2.5 bg-surface-3 border border-white/5 rounded-lg">
              <span className="text-[12px] font-mono text-text-2">{p}</span>
              <button
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-text-3 hover:text-error hover:bg-red-500/10 transition-colors"
                onClick={() => handleRemove(p)}
                aria-label={`Remove pattern ${p}`}
              >
                <X size={11} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : loaded ? (
        <p className="text-[11px] text-text-3 px-1">No custom patterns configured for this workspace.</p>
      ) : null}
    </div>
  );
}
