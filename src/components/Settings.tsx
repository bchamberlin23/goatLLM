import { useState, useCallback, useEffect, useMemo } from "react";
import { useChatStore, CLOUD_PROVIDER_MODELS } from "../stores/chat";
import { X, Plus, Eye, EyeOff, Shield, ChevronDown, Check, Search } from "lucide-react";

const CLOUD_PROVIDERS = [
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "opencode-go", name: "OpenCode Go", baseUrl: "https://opencode.ai/zen/go/v1" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
];

interface Props { onClose: () => void; }

export function Settings({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 backdrop-blur-sm animate-[fadeIn_150ms_ease]" onClick={onClose}>
      <div className="w-[600px] max-w-[92vw] h-[640px] max-h-[88vh] bg-[#2a2a2c] border border-white/10 rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden animate-[contextMenuIn_180ms_ease]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
          <h2 className="text-[15px] font-semibold text-[#ececec] tracking-[-0.015em]">Settings</h2>
          <button className="w-7 h-7 flex items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5 transition-colors" onClick={onClose} aria-label="Close settings" title="Close (Esc)">
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <SettingsContent />
      </div>
    </div>
  );
}

function SettingsContent() {
  const providerConfigs = useChatStore((s) => s.providerConfigs);
  const configureProvider = useChatStore((s) => s.configureProvider);
  const removeProvider = useChatStore((s) => s.removeProvider);
  const setEnabledModels = useChatStore((s) => s.setEnabledModels);
  const tavilyApiKey = useChatStore((s) => s.tavilyApiKey);
  const setTavilyApiKey = useChatStore((s) => s.setTavilyApiKey);

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold text-[#a0a0a0] uppercase tracking-wider">Providers & Models</h3>
        <p className="text-[13px] text-[#8e8e8e] leading-relaxed mb-2">
          Add an API key, then choose which models appear in the model picker. Keys are stored locally on your machine.
        </p>
        <div className="flex flex-col gap-2">
          {CLOUD_PROVIDERS.map((provider) => {
            const cfg = providerConfigs[provider.id] ?? null;
            return (
              <ProviderCard
                key={provider.id}
                provider={provider}
                config={cfg}
                onSave={(apiKey) => configureProvider(provider.id, { ...(cfg ?? {}), apiKey })}
                onRemove={() => removeProvider(provider.id)}
                onSetEnabled={(ids) => setEnabledModels(provider.id, ids)}
              />
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold text-[#a0a0a0] uppercase tracking-wider">Tool API Keys</h3>
        <p className="text-[13px] text-[#8e8e8e] leading-relaxed mb-2">
          API keys for agent tools like web search.
        </p>
        <TavilyKeyRow apiKey={tavilyApiKey} onSave={setTavilyApiKey} onRemove={() => setTavilyApiKey("")} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold text-[#a0a0a0] uppercase tracking-wider">System Prompt</h3>
        <p className="text-[13px] text-[#8e8e8e] leading-relaxed mb-2">
          A system prompt sets the model's behavior for the active conversation. Leave empty for default behavior.
        </p>
        <SystemPromptSection />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold text-[#a0a0a0] uppercase tracking-wider">File Denylist</h3>
        <p className="text-[13px] text-[#8e8e8e] leading-relaxed mb-2">
          Glob patterns that prevent the agent from reading or writing matching files in the active workspace. Built-in patterns (.env, credentials) are always enforced.
        </p>
        <DenylistSection />
      </section>
    </div>
  );
}

function ProviderCard({
  provider,
  config,
  onSave,
  onRemove,
  onSetEnabled,
}: {
  provider: { id: string; name: string; baseUrl: string };
  config: { apiKey: string; enabledModels?: string[] } | null;
  onSave: (apiKey: string) => void;
  onRemove: () => void;
  onSetEnabled: (modelIds: string[]) => void;
}) {
  const hasKey = !!config?.apiKey;
  const allModels = CLOUD_PROVIDER_MODELS[provider.id] ?? [];
  const enabled = config?.enabledModels;
  const enabledCount = enabled === undefined ? allModels.length : enabled.length;

  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");

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

  const handleSelectAll = useCallback(() => {
    onSetEnabled(allModels.map((m) => m.id));
  }, [allModels, onSetEnabled]);

  const handleDeselectAll = useCallback(() => {
    onSetEnabled([]);
  }, [onSetEnabled]);

  const filteredModels = useMemo(() => {
    if (!query.trim()) return allModels;
    const q = query.toLowerCase();
    return allModels.filter(
      (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    );
  }, [allModels, query]);

  return (
    <div className={`bg-[#212122] border rounded-xl transition-colors overflow-hidden ${hasKey ? "border-green-500/20" : "border-white/5"}`}>
      <ProviderKeyHeader
        provider={provider}
        config={config}
        hasKey={hasKey}
        enabledCount={enabledCount}
        totalCount={allModels.length}
        expanded={expanded}
        onToggleExpand={() => hasKey && setExpanded((v) => !v)}
        onSave={onSave}
        onRemove={onRemove}
      />

      {hasKey && expanded && (
        <div className="border-t border-white/5 p-3 flex flex-col gap-2 bg-black/10">
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-2.5 h-[30px] bg-[#2c2c2e] border border-white/5 rounded-md">
              <Search size={12} strokeWidth={2} className="text-[#a0a0a0] shrink-0" aria-hidden="true" />
              <input
                type="text"
                aria-label={`Search ${provider.name} models`}
                className="flex-1 bg-transparent text-[12.5px] text-[#ececec] placeholder:text-[#a0a0a0] outline-none border-0"
                placeholder="Search models…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  className="text-[10.5px] uppercase tracking-wider font-medium text-[#a0a0a0] hover:text-[#ececec] px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors"
                  onClick={() => setQuery("")}
                >
                  Clear
                </button>
              )}
            </div>
            <button
              className="shrink-0 px-2.5 h-[30px] text-[11.5px] font-medium text-[#b4b4b4] bg-white/5 rounded-md hover:bg-white/10 hover:text-[#ececec] transition-colors"
              onClick={handleSelectAll}
            >
              Select all
            </button>
            <button
              className="shrink-0 px-2.5 h-[30px] text-[11.5px] font-medium text-[#b4b4b4] bg-white/5 rounded-md hover:bg-white/10 hover:text-[#ececec] transition-colors"
              onClick={handleDeselectAll}
            >
              Deselect all
            </button>
          </div>

          <div className="flex flex-col max-h-[260px] overflow-y-auto rounded-md border border-white/5 bg-[#1a1a1c]">
            {filteredModels.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-[#a0a0a0]">
                No models match "{query}"
              </div>
            ) : (
              filteredModels.map((m) => {
                const checked = isEnabled(m.id);
                return (
                  <label
                    key={m.id}
                    className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-white/[0.03] border-b border-white/[0.03] last:border-b-0 transition-colors"
                  >
                    <span
                      className={`w-4 h-4 rounded shrink-0 flex items-center justify-center transition-colors ${
                        checked
                          ? "bg-[#f59e42] border border-[#f59e42]"
                          : "border border-white/15 bg-white/[0.02]"
                      }`}
                      aria-hidden="true"
                    >
                      {checked && <Check size={11} strokeWidth={3} className="text-black" />}
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => toggleModel(m.id)}
                      aria-label={`Enable ${m.name}`}
                    />
                    <div className="flex-1 min-w-0 flex flex-col">
                      <span className="text-[12.5px] text-[#ececec] truncate">{m.name}</span>
                      <span className="text-[10.5px] font-mono text-[#a0a0a0] truncate">{m.id}</span>
                    </div>
                  </label>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between text-[10.5px] text-[#a0a0a0] pt-1">
            <span>
              {enabledCount} of {allModels.length} model{allModels.length === 1 ? "" : "s"} enabled
            </span>
            {enabledCount === 0 && (
              <span className="text-[#f59e42]">No models will appear in the picker</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderKeyHeader({
  provider,
  config,
  hasKey,
  enabledCount,
  totalCount,
  expanded,
  onToggleExpand,
  onSave,
  onRemove,
}: {
  provider: { id: string; name: string; baseUrl: string };
  config: { apiKey: string } | null;
  hasKey: boolean;
  enabledCount: number;
  totalCount: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onSave: (apiKey: string) => void;
  onRemove: () => void;
}) {
  const [key, setKey] = useState(config?.apiKey ?? "");
  const [showKey, setShowKey] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    setKey(config?.apiKey ?? "");
  }, [config?.apiKey]);

  const handleSave = useCallback(() => {
    const trimmed = key.trim();
    if (trimmed) onSave(trimmed);
    setIsEditing(false);
  }, [key, onSave]);

  const handleRemove = useCallback(() => {
    setKey("");
    onRemove();
    setIsEditing(false);
  }, [onRemove]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSave();
      if (e.key === "Escape") {
        setKey(config?.apiKey ?? "");
        setIsEditing(false);
      }
    },
    [handleSave, config],
  );

  return (
    <div
      className={`flex items-center justify-between gap-3 p-3.5 ${hasKey ? "cursor-pointer hover:bg-white/[0.02]" : ""} transition-colors`}
      onClick={(e) => {
        if (!hasKey) return;
        const target = e.target as HTMLElement;
        if (target.closest("input, button")) return;
        onToggleExpand();
      }}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {hasKey && (
          <ChevronDown
            size={14}
            strokeWidth={2}
            className={`shrink-0 text-[#a0a0a0] transition-transform ${expanded ? "" : "-rotate-90"}`}
            aria-hidden="true"
          />
        )}
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[14px] font-medium text-[#ececec]">{provider.name}</span>
            <span className={`flex items-center gap-1.5 text-[11px] ${hasKey ? "text-[#34d399]" : "text-[#a0a0a0]"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${hasKey ? "bg-[#34d399]" : "bg-[#4a4a4a]"}`} />
              {hasKey ? "Configured" : "Not configured"}
            </span>
            {hasKey && totalCount > 0 && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/5 text-[#b4b4b4] font-mono">
                {enabledCount}/{totalCount}
              </span>
            )}
          </div>
          <span className="text-[11px] text-[#a0a0a0] font-mono truncate">{provider.baseUrl}</span>
        </div>
      </div>

      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        {!hasKey && !isEditing ? (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium text-[#b4b4b4] bg-white/5 rounded-lg hover:bg-white/10 hover:text-[#ececec] transition-colors"
            onClick={() => setIsEditing(true)}
          >
            <Plus size={12} strokeWidth={2} aria-hidden="true" />
            Add Key
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type={showKey ? "text" : "password"}
              className="w-[200px] h-[30px] px-2.5 bg-[#2c2c2e] border border-white/5 rounded-md text-[12px] text-[#ececec] font-mono outline-none focus:border-white/15"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              placeholder="Paste API key…"
              autoFocus={isEditing}
              aria-label={`${provider.name} API key`}
            />
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5 transition-colors"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? "Hide API key" : "Show API key"}
              title={showKey ? "Hide key" : "Show key"}
            >
              {showKey ? (
                <EyeOff size={14} strokeWidth={1.5} aria-hidden="true" />
              ) : (
                <Eye size={14} strokeWidth={1.5} aria-hidden="true" />
              )}
            </button>
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#f87171] hover:bg-red-500/10 transition-colors"
              onClick={handleRemove}
              aria-label="Remove API key"
              title="Remove key"
            >
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TavilyKeyRow({
  apiKey,
  onSave,
  onRemove,
}: {
  apiKey: string;
  onSave: (key: string) => void;
  onRemove: () => void;
}) {
  const [key, setKey] = useState(apiKey ?? "");
  const [showKey, setShowKey] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const hasKey = !!apiKey;

  const handleSave = useCallback(() => {
    const trimmed = key.trim();
    if (trimmed) onSave(trimmed);
    setIsEditing(false);
  }, [key, onSave]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") { setKey(apiKey ?? ""); setIsEditing(false); }
  }, [handleSave, apiKey]);

  return (
    <div className={`flex items-center justify-between gap-3 p-3.5 bg-[#212122] border rounded-xl transition-colors ${hasKey ? "border-green-500/20" : "border-white/5"}`}>
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="text-[14px] font-medium text-[#ececec]">Tavily Search</span>
          <span className={`flex items-center gap-1.5 text-[11px] ${hasKey ? "text-[#34d399]" : "text-[#a0a0a0]"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${hasKey ? "bg-[#34d399]" : "bg-[#4a4a4a]"}`} />
            {hasKey ? "Configured" : "Not configured"}
          </span>
        </div>
        <span className="text-[11px] text-[#a0a0a0] font-mono">api.tavily.com</span>
      </div>

      <div className="shrink-0">
        {!hasKey && !isEditing ? (
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium text-[#b4b4b4] bg-white/5 rounded-lg hover:bg-white/10 hover:text-[#ececec] transition-colors" onClick={() => setIsEditing(true)}>
            <Plus size={12} strokeWidth={2} />
            Add Key
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type={showKey ? "text" : "password"}
              className="w-[200px] h-[30px] px-2.5 bg-[#2c2c2e] border border-white/5 rounded-md text-[12px] text-[#ececec] font-mono outline-none focus:border-white/15"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              placeholder="tvly-..."
              autoFocus={isEditing}
            />
            <button className="w-7 h-7 flex items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/5 transition-colors" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Hide Tavily key" : "Show Tavily key"}>
              {showKey ? <EyeOff size={14} strokeWidth={1.5} aria-hidden="true" /> : <Eye size={14} strokeWidth={1.5} aria-hidden="true" />}
            </button>
            <button className="w-7 h-7 flex items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#f87171] hover:bg-red-500/10 transition-colors" onClick={() => { setKey(""); onRemove(); }} aria-label="Remove Tavily key">
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const BUILT_IN_DENY_PATTERNS = [
  "**/.env",
  "**/.git/credentials",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa",
  "**/.ssh/**",
  "**/secrets/**",
];

function SystemPromptSection() {
  const activeId = useChatStore((s) => s.activeId);
  const conversation = useChatStore((s) =>
    activeId ? s.conversations.find((c) => c.id === activeId) : null
  );
  const setSystemPrompt = useChatStore((s) => s.setSystemPrompt);
  const defaultSystemPrompt = useChatStore((s) => s.defaultSystemPrompt);
  const setDefaultSystemPrompt = useChatStore((s) => s.setDefaultSystemPrompt);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (activeId && conversation) {
      setDraft(conversation.systemPrompt ?? "");
    } else {
      setDraft(defaultSystemPrompt);
    }
    setSaved(false);
  }, [activeId, conversation?.systemPrompt, defaultSystemPrompt]);

  const handleSave = useCallback(() => {
    if (activeId) {
      setSystemPrompt(activeId, draft);
    } else {
      setDefaultSystemPrompt(draft);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [activeId, draft, setSystemPrompt, setDefaultSystemPrompt]);

  const label = activeId
    ? "System prompt for this conversation"
    : "Default system prompt for new conversations";

  return (
    <div className="flex flex-col gap-2">
      <textarea
        className="w-full bg-[#212122] border border-white/5 rounded-xl text-[13px] text-[#ececec] p-3.5 outline-none resize-none min-h-[80px] focus:border-white/10 placeholder:text-[#a0a0a0]"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="You are a helpful assistant…"
        rows={3}
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[#a0a0a0]">
          {label} · {draft.length > 0 ? `${draft.length} chars` : "Empty"}
        </span>
        <button
          onClick={handleSave}
          className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
            saved
              ? "bg-[#34d399]/10 text-[#34d399]"
              : "bg-white text-black hover:bg-[#e5e5e5]"
          }`}
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
    </div>
  );
}

function DenylistSection() {
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
      <div className="p-3.5 bg-[#212122] border border-white/5 rounded-xl text-[12px] text-[#a0a0a0]">
        Select a workspace to configure its file denylist.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="p-3.5 bg-[#212122] border border-white/5 rounded-xl flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Shield size={13} strokeWidth={1.75} className="text-[#a0a0a0]" />
          <span className="text-[12px] text-[#b4b4b4]">Always enforced</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {BUILT_IN_DENY_PATTERNS.map((p) => (
            <span key={p} className="px-2 py-0.5 bg-white/5 rounded-md text-[11px] font-mono text-[#a0a0a0]">
              {p}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          type="text"
          aria-label="New denylist pattern"
          className="flex-1 h-[32px] px-2.5 bg-[#2c2c2e] border border-white/5 rounded-md text-[12px] text-[#ececec] font-mono outline-none focus:border-white/15"
          placeholder="Add pattern (e.g. **/*.log)"
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className="shrink-0 h-[32px] w-[32px] flex items-center justify-center rounded-md bg-white/5 text-[#b4b4b4] hover:bg-white/10 hover:text-[#ececec] transition-colors"
          onClick={handleAdd}
          aria-label="Add denylist pattern"
        >
          <Plus size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {patterns.length > 0 ? (
        <div className="flex flex-col gap-1">
          {patterns.map((p) => (
            <div key={p} className="flex items-center justify-between gap-2 p-2.5 bg-[#212122] border border-white/5 rounded-lg">
              <span className="text-[12px] font-mono text-[#d5d5d5]">{p}</span>
              <button
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-[#a0a0a0] hover:text-[#f87171] hover:bg-red-500/10 transition-colors"
                onClick={() => handleRemove(p)}
                aria-label={`Remove pattern ${p}`}
              >
                <X size={11} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : loaded ? (
        <p className="text-[11px] text-[#a0a0a0] px-1">No custom patterns configured for this workspace.</p>
      ) : null}
    </div>
  );
}
