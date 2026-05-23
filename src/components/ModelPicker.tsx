import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useChatStore, Model, Provider } from "../stores/chat";
import { Check, ChevronDown, Search, Cloud, HardDrive, AlertCircle } from "lucide-react";

interface GroupedModels { provider: Provider; models: Model[]; }

function ProviderIcon({ provider, size = 12 }: { provider: Provider; size?: number }) {
  if (provider.isBuiltIn) return <HardDrive size={size} strokeWidth={1.75} className="text-[#9aa0a6]" />;
  return <Cloud size={size} strokeWidth={1.75} className="text-[#9aa0a6]" />;
}

export function ModelPicker() {
  const getProviders = useChatStore((s) => s.getProviders);
  const getModels = useChatStore((s) => s.getModels);
  const selectedModelId = useChatStore((s) => s.selectedModelId);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const getActiveMessages = useChatStore((s) => s.getActiveMessages);

  const [isOpen, setIsOpen] = useState(false);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [listMaxHeight, setListMaxHeight] = useState<number>(380);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const providers = getProviders();
  const models = getModels();
  const selectedModel = models.find((m) => m.id === selectedModelId);
  const selectedProvider = selectedModel
    ? providers.find((p) => p.id === selectedModel.providerId)
    : null;
  const activeMessages = getActiveMessages();
  const hasMessages = activeMessages.length > 0;

  // Filter and group
  const filteredModels = useMemo(() => {
    if (!query.trim()) return models;
    const q = query.toLowerCase();
    return models.filter(
      (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    );
  }, [models, query]);

  const grouped: GroupedModels[] = useMemo(
    () =>
      providers
        .map((provider) => ({
          provider,
          models: filteredModels.filter((m) => m.providerId === provider.id),
        }))
        .filter((g) => g.models.length > 0),
    [providers, filteredModels],
  );

  const flatVisibleModels = useMemo(
    () => grouped.flatMap((g) => g.models.filter((m) => m.isAvailable)),
    [grouped],
  );

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setHighlightedId(selectedModelId ?? flatVisibleModels[0]?.id ?? null);
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setPendingModelId(null);
    }
  }, [isOpen]);

  // Size the dropdown so it never gets clipped above the trigger.
  // The dropdown opens upward, so the available space is from the top of the
  // viewport down to (trigger top - margin). Subtract chrome (search + footer + padding).
  useEffect(() => {
    if (!isOpen) return;
    const measure = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const margin = 16; // breathing room from window top
      const chrome = 44 /* search */ + 32 /* footer */ + 16 /* paddings */;
      const available = rect.top - margin - chrome;
      const clamped = Math.max(160, Math.min(440, available));
      setListMaxHeight(clamped);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isOpen]);

  // Click outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // Keep highlight in view
  useEffect(() => {
    if (!highlightedId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-model-id="${CSS.escape(highlightedId)}"]`,
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [highlightedId]);

  const handleModelSelect = useCallback(
    (modelId: string) => {
      if (modelId === selectedModelId) {
        setIsOpen(false);
        return;
      }
      if (hasMessages) setPendingModelId(modelId);
      else {
        setSelectedModel(modelId);
        setIsOpen(false);
      }
    },
    [selectedModelId, hasMessages, setSelectedModel],
  );

  const handleConfirmSwitch = useCallback(() => {
    if (pendingModelId) {
      setSelectedModel(pendingModelId);
      setPendingModelId(null);
      setIsOpen(false);
    }
  }, [pendingModelId, setSelectedModel]);

  const moveHighlight = useCallback(
    (dir: 1 | -1) => {
      if (flatVisibleModels.length === 0) return;
      const idx = flatVisibleModels.findIndex((m) => m.id === highlightedId);
      const next =
        idx === -1
          ? 0
          : (idx + dir + flatVisibleModels.length) % flatVisibleModels.length;
      setHighlightedId(flatVisibleModels[next].id);
    },
    [flatVisibleModels, highlightedId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
        return;
      }
      if (pendingModelId) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveHighlight(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveHighlight(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightedId) handleModelSelect(highlightedId);
      }
    },
    [moveHighlight, highlightedId, handleModelSelect, pendingModelId],
  );

  const triggerLabel = selectedModel ? selectedModel.name : "Select model";
  const totalAvailable = models.filter((m) => m.isAvailable).length;
  const providerOffline = selectedProvider?.healthChecked && !selectedProvider.isOnline;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen((o) => !o)}
        aria-label={selectedModel ? `Model: ${selectedModel.name}. Click to change.` : "Select model"}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-white/[0.06] active:bg-white/[0.09] text-[13px] transition-colors max-w-[220px] ${
          isOpen ? "bg-white/[0.06]" : ""
        } ${selectedModel ? "text-[#ececec]" : "text-[#a0a0a0]"}`}
        title={selectedProvider ? `${selectedProvider.name} · ${triggerLabel}` : triggerLabel}
      >
        {selectedProvider && <ProviderIcon provider={selectedProvider} size={11} />}
        <span className="truncate">{triggerLabel}</span>
        {providerOffline && (
          <span className="w-1.5 h-1.5 rounded-full bg-[#f87171] shrink-0" title="Provider offline" />
        )}
        <ChevronDown
          size={11}
          strokeWidth={2}
          className={`shrink-0 text-[#a0a0a0] transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div
          className="absolute bottom-full right-0 mb-2 w-[360px] max-w-[calc(100vw-32px)] bg-[#2c2c2e] border border-white/10 rounded-xl shadow-[0_24px_60px_rgba(0,0,0,0.6),0_2px_8px_rgba(0,0,0,0.4)] z-[200] animate-[dropdownIn_110ms_ease] flex flex-col overflow-hidden backdrop-blur-xl"
          onKeyDown={handleKeyDown}
        >
          {pendingModelId ? (
            <div className="p-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-[13px] font-medium text-[#ececec]">Switch models?</p>
                <p className="text-[12.5px] text-[#8e8e8e] leading-relaxed">
                  The new model will see the full conversation history.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="flex-1 py-1.5 rounded-md text-[13px] text-[#b4b4b4] hover:bg-white/5 hover:text-[#ececec] transition-colors"
                  onClick={() => setPendingModelId(null)}
                >
                  Cancel
                </button>
                <button
                  className="flex-1 py-1.5 rounded-md text-[13px] font-medium bg-[#ececec] text-black hover:bg-white transition-colors"
                  onClick={handleConfirmSwitch}
                >
                  Switch
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Search */}
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5 bg-white/[0.02]">
                <Search size={13} strokeWidth={2} className="text-[#9a9a9a] shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  className="flex-1 bg-transparent text-[13px] text-[#ececec] placeholder:text-[#a0a0a0] outline-none border-0"
                  placeholder="Search models…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    className="text-[#9a9a9a] hover:text-[#ececec] text-[10.5px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors"
                    onClick={() => setQuery("")}
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Model list */}
              <div
                ref={listRef}
                className="overflow-y-auto py-1"
                style={{ maxHeight: `${listMaxHeight}px` }}
              >
                {grouped.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8 px-4 text-center">
                    {query ? (
                      <>
                        <Search size={18} className="text-[#4a4a4a]" />
                        <p className="text-[12.5px] text-[#8e8e8e]">No models match "{query}"</p>
                      </>
                    ) : (
                      <>
                        <AlertCircle size={18} className="text-[#4a4a4a]" />
                        <p className="text-[12.5px] text-[#8e8e8e]">No models available</p>
                        <p className="text-[11.5px] text-[#a0a0a0] leading-relaxed">
                          Add an API key in Settings to start chatting.
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  grouped.map(({ provider, models: providerModels }) => (
                    <div key={provider.id} className="mb-1 last:mb-0">
                      <div className="px-3 pt-2 pb-1 flex items-center justify-between sticky top-0 bg-[#2c2c2e] z-10">
                        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[#9a9a9a]">
                          <ProviderIcon provider={provider} size={11} />
                          <span>{provider.name}</span>
                        </div>
                        <span
                          className={`flex items-center gap-1 text-[10px] ${
                            provider.healthChecked
                              ? provider.isOnline
                                ? "text-[#34d399]"
                                : "text-[#f87171]"
                              : "text-[#a0a0a0]"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              provider.healthChecked
                                ? provider.isOnline
                                  ? "bg-[#34d399]"
                                  : "bg-[#f87171]"
                                : "bg-[#a0a0a0] animate-[dot-pulse_1.5s_ease-in-out_infinite]"
                            }`}
                          />
                          {provider.healthChecked
                            ? provider.isOnline
                              ? "Online"
                              : "Offline"
                            : "Checking"}
                        </span>
                      </div>
                      {providerModels.map((model) => {
                        const isSelected = selectedModelId === model.id;
                        const isHighlighted = highlightedId === model.id;
                        return (
                          <button
                            key={model.id}
                            data-model-id={model.id}
                            className={`flex items-center justify-between w-full px-3 py-[7px] text-left text-[13px] transition-colors ${
                              !model.isAvailable ? "opacity-40 cursor-not-allowed" : ""
                            } ${
                              isHighlighted && model.isAvailable
                                ? "bg-white/[0.08] text-[#ececec]"
                                : isSelected
                                  ? "text-[#ececec] bg-white/[0.04]"
                                  : "text-[#d5d5d5] hover:bg-white/[0.05]"
                            }`}
                            onClick={() => model.isAvailable && handleModelSelect(model.id)}
                            onMouseEnter={() =>
                              model.isAvailable && setHighlightedId(model.id)
                            }
                            disabled={!model.isAvailable}
                          >
                            <span className="truncate flex-1">{model.name}</span>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              {!model.isAvailable && (
                                <span className="text-[10px] px-1.5 py-0.5 bg-red-500/10 text-[#f87171] rounded font-semibold">
                                  Offline
                                </span>
                              )}
                              {isSelected && <Check size={13} className="text-[#f59e42]" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="px-3 py-2 border-t border-white/5 bg-black/20 flex items-center justify-between text-[10.5px] text-[#9a9a9a]">
                <span>
                  {totalAvailable} model{totalAvailable === 1 ? "" : "s"} available
                </span>
                <span className="flex items-center gap-1.5">
                  <kbd className="font-mono text-[10px] px-1.5 py-px rounded bg-white/[0.06] border border-white/[0.06] text-[#9a9a9a]">
                    ↑↓
                  </kbd>
                  <span className="text-[#a0a0a0]">to navigate</span>
                  <kbd className="font-mono text-[10px] px-1.5 py-px rounded bg-white/[0.06] border border-white/[0.06] text-[#9a9a9a] ml-1">
                    ↵
                  </kbd>
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
