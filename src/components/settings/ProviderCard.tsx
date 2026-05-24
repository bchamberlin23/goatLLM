import { useState, useEffect, useCallback, useMemo } from "react";
import { ChevronDown, Check, EyeOff, Eye, Search, X } from "lucide-react";
import { CLOUD_PROVIDER_MODELS } from "../../stores/chat";

export function ProviderCard({
  provider,
  config,
  onSave,
  onRemove,
  onSetEnabled,
}: {
  provider: { id: string; name: string; baseUrl: string; noKey?: boolean };
  config: { apiKey: string; enabledModels?: string[] } | null;
  onSave: (apiKey: string) => void;
  onRemove: () => void;
  onSetEnabled: (modelIds: string[]) => void;
}) {
  const hasKey = !!config?.apiKey || !!provider.noKey;
  const allModels = CLOUD_PROVIDER_MODELS[provider.id] ?? [];
  const enabled = config?.enabledModels;
  const enabledCount = enabled === undefined ? allModels.length : enabled.length;

  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [key, setKey] = useState(config?.apiKey ?? "");
  const [showKey, setShowKey] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => { setKey(config?.apiKey ?? ""); }, [config?.apiKey]);

  const isEnabled = useCallback(
    (modelId: string) => (enabled === undefined ? true : enabled.includes(modelId)),
    [enabled],
  );

  const toggleModel = useCallback(
    (modelId: string) => {
      const current = enabled === undefined ? allModels.map((m) => m.id) : enabled;
      const next = current.includes(modelId)
        ? current.filter((id) => id !== modelId)
        : [...current, modelId];
      onSetEnabled(next);
    },
    [enabled, allModels, onSetEnabled],
  );

  const filteredModels = useMemo(() => {
    if (!query.trim()) return allModels;
    const q = query.toLowerCase();
    return allModels.filter(
      (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    );
  }, [allModels, query]);

  const trimmedKey = key.trim();
  const isDirty = trimmedKey !== (config?.apiKey ?? "");
  const canSaveKey = trimmedKey.length > 0 && isDirty;

  const handleSaveKey = useCallback(() => {
    const t = key.trim();
    if (!t) return;
    onSave(t);
    setShowKeyInput(false);
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 1200);
  }, [key, onSave]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleSaveKey(); }
    if (e.key === "Escape") { setKey(config?.apiKey ?? ""); setShowKeyInput(false); }
  }, [handleSaveKey, config]);

  const handlePasteKey = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text").trim();
    if (pasted && pasted !== (config?.apiKey ?? "")) {
      e.preventDefault();
      setKey(pasted);
      onSave(pasted);
      setShowKeyInput(false);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1200);
    }
  }, [config, onSave]);

  return (
    <div className={`bg-[#212122] border rounded-lg overflow-hidden transition-colors ${hasKey ? "border-green-500/15" : "border-white/5"}`}>
      <div
        className={`flex items-center gap-2.5 px-3 py-2 ${hasKey ? "cursor-pointer hover:bg-white/[0.02]" : ""} transition-colors`}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest("input, button")) return;
          if (hasKey) setExpanded((v) => !v);
        }}
      >
        {hasKey && (
          <ChevronDown
            size={12}
            strokeWidth={2}
            className={`shrink-0 text-[#666] transition-transform ${expanded ? "" : "-rotate-90"}`}
            aria-hidden="true"
          />
        )}
        <span className="text-[13px] font-medium text-[#ececec]">{provider.name}</span>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasKey ? "bg-[#34d399]" : "bg-[#4a4a4a]"}`} />
        {hasKey && allModels.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-[#888] font-mono">
            {enabledCount}/{allModels.length}
          </span>
        )}
        {justSaved && (
          <span className="text-[10px] text-[#34d399] font-medium animate-[fadeIn_180ms_ease-out]">Saved</span>
        )}
        <div className="flex-1" />
        {!provider.noKey && (
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {!hasKey && !showKeyInput ? (
              <button
                className="px-2 py-1 text-[11px] font-medium text-[#888] bg-white/5 rounded-md hover:bg-white/10 hover:text-[#ccc] transition-colors"
                onClick={() => setShowKeyInput(true)}
              >
                Add Key
              </button>
            ) : showKeyInput || (!provider.noKey && hasKey) ? (
              <div className="flex items-center gap-1">
                <input
                  type={showKey ? "text" : "password"}
                  className="w-[160px] h-[26px] px-2 bg-[#2c2c2e] border border-white/5 rounded text-[11px] text-[#ececec] font-mono outline-none focus:border-white/15"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onPaste={handlePasteKey}
                  onKeyDown={handleKeyDown}
                  placeholder="Paste API key…"
                  autoFocus={showKeyInput}
                  aria-label={`${provider.name} API key`}
                />
                <button
                  className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${canSaveKey ? "text-[#34d399] hover:bg-[#34d399]/10" : "text-[#3a3a3a] cursor-not-allowed"}`}
                  onClick={handleSaveKey}
                  disabled={!canSaveKey}
                  aria-label="Save key"
                  title="Save (Enter)"
                >
                  <Check size={12} strokeWidth={2.2} />
                </button>
                <button
                  className="w-6 h-6 flex items-center justify-center rounded text-[#666] hover:text-[#ccc] hover:bg-white/5 transition-colors"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? "Hide" : "Show"}
                >
                  {showKey ? <EyeOff size={12} strokeWidth={1.5} /> : <Eye size={12} strokeWidth={1.5} />}
                </button>
                <button
                  className="w-6 h-6 flex items-center justify-center rounded text-[#666] hover:text-[#f87171] hover:bg-red-500/10 transition-colors"
                  onClick={() => { setKey(""); onRemove(); setShowKeyInput(false); }}
                  aria-label="Remove"
                >
                  <X size={11} strokeWidth={2} />
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {hasKey && expanded && allModels.length > 0 && (
        <div className="border-t border-white/5 px-3 py-2 flex flex-col gap-1.5 bg-black/10">
          {allModels.length > 6 && (
            <div className="flex items-center gap-1.5">
              <div className="flex-1 flex items-center gap-1.5 px-2 h-[26px] bg-[#2c2c2e] border border-white/5 rounded">
                <Search size={10} strokeWidth={2} className="text-[#666] shrink-0" />
                <input
                  type="text"
                  className="flex-1 bg-transparent text-[11px] text-[#ececec] placeholder:text-[#666] outline-none border-0"
                  placeholder="Filter…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
          )}
          <div className="flex flex-col max-h-[180px] overflow-y-auto rounded border border-white/5 bg-[#1a1a1c]">
            {filteredModels.map((m) => {
              const checked = isEnabled(m.id);
              return (
                <label
                  key={m.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-white/[0.03] border-b border-white/[0.02] last:border-b-0 transition-colors"
                >
                  <span
                    className={`w-3.5 h-3.5 rounded shrink-0 flex items-center justify-center transition-colors ${
                      checked
                        ? "bg-[#f59e42] border border-[#f59e42]"
                        : "border border-white/15 bg-white/[0.02]"
                    }`}
                  >
                    {checked && <Check size={9} strokeWidth={3} className="text-black" />}
                  </span>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => toggleModel(m.id)}
                  />
                  <span className="text-[11.5px] text-[#d5d5d5] truncate">{m.name}</span>
                  <span className="text-[10px] font-mono text-[#666] truncate ml-auto">{m.id}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
