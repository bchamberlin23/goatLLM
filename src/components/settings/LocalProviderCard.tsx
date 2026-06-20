import { useState, useEffect, useCallback, useMemo } from "react";
import { ChevronDown, Check, Search, RefreshCw, AlertCircle, X } from "lucide-react";
import { useChatStore } from "../../stores/chat";

export function LocalProviderCard({
  providerId,
  name,
  defaultBaseUrl,
  docs,
}: {
  providerId: string;
  name: string;
  defaultBaseUrl: string;
  docs: string;
}) {
  const config = useChatStore((s) => s.providerConfigs[providerId] ?? null);
  const configureProvider = useChatStore((s) => s.configureProvider);
  const removeProvider = useChatStore((s) => s.removeProvider);
  const setEnabledModels = useChatStore((s) => s.setEnabledModels);
  const discoveredModels = useChatStore((s) => s.discoveredModels[providerId] ?? []);
  const status = useChatStore((s) => s.discoveryStatus[providerId] ?? "idle");
  const errorMsg = useChatStore((s) => s.discoveryError[providerId] ?? null);
  const discoverLocalModels = useChatStore((s) => s.discoverLocalModels);

  const enabled = config?.enabledModels;
  const baseUrl = config?.baseUrl ?? defaultBaseUrl;
  const isConfigured = config !== null;
  const enabledCount = enabled === undefined ? discoveredModels.length : enabled.length;

  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState(baseUrl);

  useEffect(() => { setUrlDraft(baseUrl); }, [baseUrl]);

  useEffect(() => {
    if (!isConfigured) {
      configureProvider(providerId, { apiKey: "", baseUrl: defaultBaseUrl });
      return;
    }
    if (status === "idle") {
      void discoverLocalModels(providerId);
    }
  }, [isConfigured, status, providerId, defaultBaseUrl, configureProvider, discoverLocalModels]);

  const isEnabled = useCallback(
    (modelId: string) => (enabled === undefined ? true : enabled.includes(modelId)),
    [enabled],
  );

  const toggleModel = useCallback(
    (modelId: string) => {
      const current = enabled === undefined ? discoveredModels.map((m) => m.id) : enabled;
      const next = current.includes(modelId)
        ? current.filter((id) => id !== modelId)
        : [...current, modelId];
      setEnabledModels(providerId, next);
    },
    [enabled, discoveredModels, setEnabledModels, providerId],
  );

  const filteredModels = useMemo(() => {
    if (!query.trim()) return discoveredModels;
    const q = query.toLowerCase();
    return discoveredModels.filter(
      (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    );
  }, [discoveredModels, query]);

  const commitUrl = useCallback(() => {
    const trimmed = urlDraft.trim() || defaultBaseUrl;
    if (trimmed !== baseUrl) {
      configureProvider(providerId, { apiKey: "", baseUrl: trimmed });
    }
    setEditingUrl(false);
    void discoverLocalModels(providerId);
  }, [urlDraft, baseUrl, defaultBaseUrl, configureProvider, providerId, discoverLocalModels]);

  const handleRefresh = useCallback(() => {
    void discoverLocalModels(providerId);
  }, [discoverLocalModels, providerId]);

  const handleResetUrl = useCallback(() => {
    configureProvider(providerId, { apiKey: "", baseUrl: defaultBaseUrl });
    setUrlDraft(defaultBaseUrl);
    setEditingUrl(false);
    void discoverLocalModels(providerId);
  }, [configureProvider, providerId, defaultBaseUrl, discoverLocalModels]);

  const handleRemove = useCallback(() => {
    removeProvider(providerId);
  }, [removeProvider, providerId]);

  const isOnline = status === "ok" && discoveredModels.length > 0;
  const isLoading = status === "loading";
  const isError = status === "error";

  return (
    <div className={`soft-card rounded-xl overflow-hidden transition-all ${isOnline ? "border-green-500/20" : isError ? "border-accent/25" : ""}`}>
      <div
        className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest("input, button")) return;
          setExpanded((v) => !v);
        }}
      >
        <ChevronDown
          size={12}
          strokeWidth={2}
          className={`shrink-0 text-text-4 transition-transform ${expanded ? "" : "-rotate-90"}`}
          aria-hidden="true"
        />
        <span className="text-[13px] font-medium text-text-1">{name}</span>
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            isLoading ? "bg-text-3 animate-pulse" :
            isOnline ? "bg-success" :
            isError ? "bg-accent" :
            "bg-text-4"
          }`}
        />
        {isOnline && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-4 font-mono">
            {enabledCount}/{discoveredModels.length}
          </span>
        )}
        {isError && (
          <span className="text-[10.5px] text-accent font-medium">Not reachable</span>
        )}
        <div className="flex-1" />
        <span className="shrink-0 text-[10.5px] text-text-4" onClick={(e) => e.stopPropagation()}>{docs}</span>
      </div>

      {expanded && (
        <div className="motion-expand-content border-t border-hairline px-3 py-2.5 flex flex-col gap-2.5 bg-black/10">
          <div className="flex flex-col gap-1">
            <label className="text-[10.5px] font-semibold text-text-4 uppercase tracking-wider">Base URL</label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                className={`flex-1 h-[28px] px-2.5 bg-white/5 border rounded text-[12px] text-text-1 placeholder:text-text-4 font-mono outline-none transition-colors ${
                  editingUrl ? "border-accent/45 ring-1 ring-accent/20" : "border-white/10 hover:border-white/15"
                }`}
                value={urlDraft}
                onChange={(e) => { setUrlDraft(e.target.value); setEditingUrl(true); }}
                onBlur={commitUrl}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") { setUrlDraft(baseUrl); setEditingUrl(false); }
                }}
                placeholder={defaultBaseUrl}
                aria-label={`${name} base URL`}
                spellCheck={false}
              />
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className="control-icon shrink-0 w-7 h-7 flex items-center justify-center rounded disabled:opacity-50 transition-colors"
                aria-label={`Refresh ${name} models`}
                title="Refresh models"
              >
                <RefreshCw size={12} strokeWidth={1.75} className={isLoading ? "animate-spin" : ""} />
              </button>
              {urlDraft.trim() !== defaultBaseUrl && (
                <button
                  onClick={handleResetUrl}
                  className="control-pill shrink-0 px-2 h-7 rounded text-[10.5px] font-medium transition-colors"
                  title="Reset to default"
                >
                  Reset
                </button>
              )}
              {isConfigured && (
                <button
                  onClick={handleRemove}
                  className="control-icon shrink-0 w-7 h-7 flex items-center justify-center rounded hover:text-error hover:bg-red-500/10 transition-colors"
                  aria-label={`Forget ${name}`}
                  title="Forget this provider"
                >
                  <X size={12} strokeWidth={2} />
                </button>
              )}
            </div>
          </div>

          {isError && errorMsg && (
            <div className="motion-reveal flex items-start gap-2 px-2.5 py-2 bg-accent/[0.06] border border-accent/15 rounded text-[11.5px] text-accent leading-relaxed">
              <AlertCircle size={12} strokeWidth={1.75} className="shrink-0 mt-px text-accent" />
              <span>{errorMsg}</span>
            </div>
          )}
          {isLoading && (
            <div className="motion-reveal flex items-center gap-2 px-2.5 py-2 text-[11.5px] text-text-3">
              <span className="w-1.5 h-1.5 rounded-full bg-text-3 animate-pulse" />
              Looking for models…
            </div>
          )}
          {!isLoading && status === "ok" && discoveredModels.length === 0 && (
            <div className="motion-reveal px-2.5 py-2 text-[11.5px] text-text-3 leading-relaxed">
              {name} is reachable, but no models are installed yet. Pull one to see it here.
            </div>
          )}
          {!isLoading && discoveredModels.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {discoveredModels.length > 6 && (
                <div className="flex items-center gap-1.5 px-2 h-[26px] bg-white/5 border border-white/10 rounded">
                  <Search size={10} strokeWidth={2} className="text-text-4 shrink-0" />
                  <input
                    type="text"
                    className="flex-1 bg-transparent text-[11px] text-text-1 placeholder:text-text-4 outline-none border-0"
                    placeholder="Filter…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              )}
              <div className="soft-card flex flex-col max-h-[200px] overflow-y-auto rounded-lg">
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
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
