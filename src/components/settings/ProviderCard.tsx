import { useState, useEffect, useCallback, useMemo } from "react";
import { ChevronDown, Check, EyeOff, Eye, Search, X, RefreshCw, Loader2 } from "lucide-react";
import { CLOUD_PROVIDER_MODELS, useChatStore } from "../../stores/chat";
import { mergeDiscoveredModels } from "../../lib/providers";
import { isZenFreeModel, ZEN_FREE_PROVIDER_ID } from "../../lib/zen-credentials";
import { useShallow } from "zustand/react/shallow";

export function ProviderCard({
  provider,
  config,
  onSave,
  onRemove,
  onSetEnabled,
}: {
  provider: {
    id: string;
    name: string;
    baseUrl: string;
    noKey?: boolean;
    /** If true, expose a "Discover" button that hits the provider's
     *  /v1/models endpoint and merges the result with the curated
     *  catalog. Set in `src/lib/model-registry.ts`. */
    supportsDiscovery?: boolean;
  };
  config: { apiKey: string; enabledModels?: string[] } | null;
  onSave: (apiKey: string) => void;
  onRemove: () => void;
  onSetEnabled: (modelIds: string[]) => void;
}) {
  const hasKey = !!config?.apiKey || !!provider.noKey;
  // Merge the curated catalog with any /v1/models result the user has
  // already pulled. The registry wins on conflict; new entries append
  // in provider order. Same precedence as `mergeDiscoveredModels` in
  // the chat store's getModels() path — keeping the two aligned so the
  // Settings card and the picker show the same list.
  const { discoveredModels, discoveryStatus, discoverCloudModels } = useChatStore(
    useShallow((s) => ({
      discoveredModels: s.discoveredModels,
      discoveryStatus: s.discoveryStatus,
      discoverCloudModels: s.discoverCloudModels,
    })),
  );
  const curated = CLOUD_PROVIDER_MODELS[provider.id] ?? [];
  const discovered = provider.supportsDiscovery ? discoveredModels[provider.id] ?? [] : [];
  const zenFreeModels = provider.id === "opencode-go"
    ? (discoveredModels[ZEN_FREE_PROVIDER_ID] ?? []).filter(isZenFreeModel)
    : [];
  const allModels = mergeDiscoveredModels(
    mergeDiscoveredModels(curated, discovered),
    zenFreeModels,
  );
  const enabled = config?.enabledModels;
  const enabledCount = enabled === undefined ? allModels.length : enabled.length;
  const isDiscovering = provider.supportsDiscovery && discoveryStatus[provider.id] === "loading";
  const canDiscover = !!provider.supportsDiscovery && hasKey && !isDiscovering;

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
    <div className={`soft-card rounded-xl overflow-hidden transition-all ${hasKey ? "border-green-500/20" : ""}`}>
      <div
        className={`flex items-center gap-2.5 px-3 py-2.5 ${hasKey ? "cursor-pointer hover:bg-white/5" : ""} transition-colors`}
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
            className={`shrink-0 text-text-4 transition-transform ${expanded ? "" : "-rotate-90"}`}
            aria-hidden="true"
          />
        )}
        <span className="text-[13px] font-medium text-text-1">{provider.name}</span>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasKey ? "bg-success" : "bg-text-4"}`} />
        {hasKey && allModels.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-4 font-mono">
            {enabledCount}/{allModels.length}
          </span>
        )}
        {justSaved && (
          <span className="motion-reveal text-[10px] text-success font-medium">Saved</span>
        )}
        {provider.supportsDiscovery && hasKey && (
          <button
            className={`control-pill px-2 py-1 text-[11px] font-medium rounded-md transition-colors flex items-center gap-1 ${canDiscover ? "" : "opacity-45 cursor-not-allowed"}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!canDiscover) return;
              void Promise.all([
                discoverCloudModels(provider.id),
                ...(provider.id === "opencode-go" ? [discoverCloudModels(ZEN_FREE_PROVIDER_ID)] : []),
              ]);
            }}
            disabled={!canDiscover}
            aria-label={`Discover ${provider.name} models`}
            title={hasKey ? `Hit ${provider.baseUrl}/models to refresh the catalog` : "Add an API key first"}
            data-testid={`discover-${provider.id}`}
          >
            {isDiscovering ? (
              <Loader2 size={10} strokeWidth={2} className="animate-spin" />
            ) : (
              <RefreshCw size={10} strokeWidth={2} />
            )}
            <span>Discover</span>
          </button>
        )}
        <div className="flex-1" />
        {!provider.noKey && (
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {!hasKey && !showKeyInput ? (
              <button
                className="control-pill px-2 py-1 text-[11px] font-medium rounded-md transition-colors"
                onClick={() => setShowKeyInput(true)}
              >
                Add Key
              </button>
            ) : showKeyInput || (!provider.noKey && hasKey) ? (
              <div className="flex items-center gap-1">
                <input
                  type={showKey ? "text" : "password"}
                  className="w-[160px] h-[26px] px-2 bg-white/5 border border-white/10 rounded text-[11px] text-text-1 placeholder:text-text-4 font-mono outline-none focus:border-accent/45 focus:ring-1 focus:ring-accent/20"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  onPaste={handlePasteKey}
                  onKeyDown={handleKeyDown}
                  placeholder="Paste API key…"
                  autoFocus={showKeyInput}
                  aria-label={`${provider.name} API key`}
                />
                <button
                  className={`control-icon w-6 h-6 flex items-center justify-center rounded transition-colors ${canSaveKey ? "text-success hover:bg-success/10" : "opacity-45 cursor-not-allowed"}`}
                  onClick={handleSaveKey}
                  disabled={!canSaveKey}
                  aria-label="Save key"
                  title="Save (Enter)"
                >
                  <Check size={12} strokeWidth={2.2} />
                </button>
                <button
                  className="control-icon w-6 h-6 flex items-center justify-center rounded transition-colors"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? "Hide" : "Show"}
                >
                  {showKey ? <EyeOff size={12} strokeWidth={1.5} /> : <Eye size={12} strokeWidth={1.5} />}
                </button>
                <button
                  className="control-icon w-6 h-6 flex items-center justify-center rounded hover:text-error hover:bg-red-500/10 transition-colors"
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
        <div className="motion-expand-content border-t border-hairline px-3 py-2.5 flex flex-col gap-1.5 bg-black/10">
          {allModels.length > 6 && (
            <div className="flex items-center gap-1.5">
              <div className="flex-1 flex items-center gap-1.5 px-2 h-[26px] bg-white/5 border border-white/10 rounded">
                <Search size={10} strokeWidth={2} className="text-text-4 shrink-0" />
                <input
                  type="text"
                  className="flex-1 bg-transparent text-[11px] text-text-1 placeholder:text-text-4 outline-none border-0"
                  placeholder="Filter…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
          )}
          <div className="soft-card flex flex-col max-h-[180px] overflow-y-auto rounded-lg">
            {filteredModels.map((m) => {
              const checked = isEnabled(m.id);
              return (
                <label
                  key={m.id}
                  className="motion-row flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-white/[0.03] border-b border-hairline last:border-b-0 transition-colors"
                >
                  <span
                    className={`w-3.5 h-3.5 rounded shrink-0 flex items-center justify-center transition-colors ${
                      checked
                        ? "bg-accent border border-accent"
                        : "border border-white/15 bg-white/[0.02]"
                    }`}
                  >
                    {checked && <Check size={9} strokeWidth={3} className="motion-pop-in text-bg" />}
                  </span>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => toggleModel(m.id)}
                  />
                  <span className="text-[11.5px] text-text-2 truncate">{m.name}</span>
                  <span className="text-[10px] font-mono text-text-4 truncate ml-auto">{m.id}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
