import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useChatStore, type Model, type Provider, type ModelOverride } from "../stores/chat";
import { getContextWindow } from "../lib/context-window";
import { generateText } from "ai";
import { createModel } from "../lib/model-factory";
import {
  Check,
  ChevronDown,
  Search,
  Cloud,
  HardDrive,
  AlertCircle,
  Settings as SettingsIcon,
  ArrowRight,
  X,
  GitCompareArrows,
  Loader2,
} from "lucide-react";

interface GroupedModels { provider: Provider; models: Model[]; }

interface ModelPickerProps {
  /**
   * Lets the zero-models empty state surface a 'Open Settings' CTA so the
   * dropdown matches the hero affordance instead of being a dead-end.
   */
  onOpenSettings?: () => void;
}

function ProviderIcon({ provider, size = 12 }: { provider: Provider; size?: number }) {
  if (provider.isBuiltIn) return <HardDrive size={size} strokeWidth={1.75} className="text-text-3" />;
  return <Cloud size={size} strokeWidth={1.75} className="text-text-3" />;
}

export function ModelPicker({ onOpenSettings }: ModelPickerProps = {}) {
  const getProviders = useChatStore((s) => s.getProviders);
  const getModels = useChatStore((s) => s.getModels);
  const selectedModelId = useChatStore((s) => s.selectedModelId);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const modelOverrides = useChatStore((s) => s.modelOverrides);
  const setModelOverride = useChatStore((s) => s.setModelOverride);
  const getActiveMessages = useChatStore((s) => s.getActiveMessages);

  const [isOpen, setIsOpen] = useState(false);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [settingsModelId, setSettingsModelId] = useState<string | null>(null);
  const [showCompare, setShowCompare] = useState(false);
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
      setSettingsModelId(null);
      setShowCompare(false);
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setPendingModelId(null);
      setSettingsModelId(null);
      setShowCompare(false);
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
  const providerOffline = selectedProvider?.healthChecked && !selectedProvider.isOnline;

  // Build a thorough aria-label that surfaces the offline state to screen
  // readers, not just the visual red dot. The trigger doubles as a status
  // indicator mid-session when a local provider drops, so the assistive
  // description has to keep up.
  const ariaLabel = (() => {
    if (!selectedModel) return "Select model";
    const base = `Model: ${selectedModel.name}.`;
    if (providerOffline && selectedProvider) {
      return `${base} ${selectedProvider.name} is offline. Click to change.`;
    }
    return `${base} Click to change.`;
  })();
  const triggerTitle = providerOffline && selectedProvider
    ? `${selectedProvider.name} · ${triggerLabel} (offline)`
    : selectedProvider
      ? `${selectedProvider.name} · ${triggerLabel}`
      : triggerLabel;

  return (
    <div className="relative min-w-0" ref={dropdownRef}>
      <button
        ref={triggerRef}
        onClick={() => setIsOpen((o) => !o)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`group flex min-w-0 items-center gap-1.5 px-2.5 py-1 rounded-md border text-[13px] transition-[background,border-color,color] max-w-[220px] max-[520px]:max-w-[calc(100vw-112px)] ${
          isOpen ? "bg-white/[0.065] border-white/[0.08]" : "border-transparent hover:bg-white/[0.055] hover:border-white/[0.07] active:bg-white/[0.09]"
        } ${selectedModel ? "text-text-1" : "text-text-3"}`}
        title={triggerTitle}
      >
        {selectedProvider && <ProviderIcon provider={selectedProvider} size={11} />}
        <span className="min-w-0 truncate">{triggerLabel}</span>
        {providerOffline && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-error shrink-0 animate-[dot-pulse_1.5s_ease-in-out_infinite]"
            role="status"
            aria-label={`${selectedProvider?.name ?? "Provider"} offline`}
            title={`${selectedProvider?.name ?? "Provider"} is offline`}
          />
        )}
        <ChevronDown
          size={11}
          strokeWidth={2}
          className={`shrink-0 text-text-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div
          className="popover-surface absolute bottom-full right-0 mb-2 w-[360px] max-w-[calc(100vw-32px)] rounded-xl z-[200] animate-[dropdownIn_110ms_ease] flex flex-col overflow-hidden"
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
                  className="primary-action flex-1 py-1.5 rounded-md text-[13px] font-medium transition-colors"
                  onClick={handleConfirmSwitch}
                >
                  Switch
                </button>
              </div>
            </div>
          ) : settingsModelId ? (
            <ModelSettingsPanel
              modelId={settingsModelId}
              models={models}
              overrides={modelOverrides[settingsModelId] ?? {}}
              onSave={(override) => {
                setModelOverride(settingsModelId, override);
                setSettingsModelId(null);
              }}
              onClose={() => setSettingsModelId(null)}
            />
          ) : showCompare ? (
            <CompareModelsPanel
              models={models.filter((m) => m.isAvailable)}
              onClose={() => setShowCompare(false)}
            />
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
                        <Search size={18} className="text-text-4" aria-hidden="true" />
                        <p className="text-[12.5px] text-text-3">No models match "{query}"</p>
                      </>
                    ) : (
                      <>
                        <AlertCircle size={18} className="text-text-4" aria-hidden="true" />
                        <p className="text-[12.5px] text-text-2">No models configured yet.</p>
                        <p className="text-[11.5px] text-text-3 leading-relaxed max-w-[240px]">
                          Add an API key in Settings to start chatting.
                        </p>
                        {onOpenSettings && (
                          <button
                            onClick={() => {
                              setIsOpen(false);
                              onOpenSettings();
                            }}
                            className="group mt-1 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/25 text-accent text-[12.5px] font-medium hover:bg-accent/20 hover:border-accent/40 transition-colors"
                            aria-label="Open Settings to add a provider"
                          >
                            <SettingsIcon size={13} strokeWidth={2} aria-hidden="true" />
                            Open Settings
                            <ArrowRight
                              size={13}
                              strokeWidth={2}
                              className="transition-transform group-hover:translate-x-0.5"
                              aria-hidden="true"
                            />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  grouped.map(({ provider, models: providerModels }) => (
                    <div key={provider.id} className="mb-1 last:mb-0">
                      <div className="px-3 pt-2 pb-1 flex items-center justify-between sticky top-0 bg-[#2c2c2e]/92 backdrop-blur-md z-10">
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
                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                              {!model.isAvailable && (
                                <span className="text-[10px] px-1.5 py-0.5 bg-red-500/10 text-[#f87171] rounded font-semibold">
                                  Offline
                                </span>
                              )}
                              {model.isAvailable && (
                                <button
                                  className="p-0.5 rounded hover:bg-white/[0.08] text-text-3 hover:text-text-2 transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSettingsModelId(model.id);
                                  }}
                                  title="Model settings"
                                  aria-label={`Settings for ${model.name}`}
                                >
                                  <SettingsIcon size={12} strokeWidth={1.5} />
                                </button>
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
                <button
                  className="flex items-center gap-1.5 hover:text-[#ececec] transition-colors"
                  onClick={() => setShowCompare(true)}
                >
                  <GitCompareArrows size={12} strokeWidth={1.5} />
                  Compare models
                </button>
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

// ── Compare models panel ──

interface CompareModelsPanelProps {
  models: Model[];
  onClose: () => void;
}

interface CompareResult {
  modelId: string;
  modelName: string;
  response: string;
  latencyMs: number;
  tokens: { input: number; output: number };
  cost?: number;
}

function CompareModelsPanel({ models, onClose }: CompareModelsPanelProps) {
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<CompareResult[]>([]);
  const getLlmConfigForModel = useChatStore((s) => s.getLlmConfigForModel);
  const usageSettings = useChatStore((s) => s.usageSettings);

  const toggleModel = (modelId: string) => {
    setSelectedModelIds((prev) => {
      if (prev.includes(modelId)) {
        return prev.filter((id) => id !== modelId);
      }
      if (prev.length >= 4) {
        return prev;
      }
      return [...prev, modelId];
    });
  };

  const runComparison = async () => {
    if (selectedModelIds.length < 2 || !prompt.trim() || running) {
      return;
    }

    setRunning(true);
    setResults([]);

    const newResults: CompareResult[] = [];

    for (const modelId of selectedModelIds) {
      const model = models.find((m) => m.id === modelId);
      if (!model) continue;

      const startTime = performance.now();
      try {
        const config = getLlmConfigForModel(modelId);
        if (!config) {
          newResults.push({
            modelId,
            modelName: model.name,
            response: "Error: Model not configured",
            latencyMs: 0,
            tokens: { input: 0, output: 0 },
          });
          continue;
        }

        const llm = await createModel(config);
        const result = await generateText({
          model: llm,
          prompt: prompt,
        });

        const latencyMs = performance.now() - startTime;
        const tokens = {
          input: result.usage?.inputTokens ?? 0,
          output: result.usage?.outputTokens ?? 0,
        };

        // Calculate cost if price overrides exist
        let cost: number | undefined;
        const override = usageSettings.priceOverrides[modelId];
        if (override) {
          const inputCost = (tokens.input / 1_000_000) * (override.inputPerMillion ?? 0);
          const outputCost = (tokens.output / 1_000_000) * (override.outputPerMillion ?? 0);
          cost = inputCost + outputCost;
        }

        newResults.push({
          modelId,
          modelName: model.name,
          response: result.text,
          latencyMs,
          tokens,
          cost,
        });
      } catch (error) {
        newResults.push({
          modelId,
          modelName: model.name,
          response: `Error: ${error instanceof Error ? error.message : String(error)}`,
          latencyMs: performance.now() - startTime,
          tokens: { input: 0, output: 0 },
        });
      }
    }

    setResults(newResults);
    setRunning(false);
  };

  return (
    <div className="p-4 flex flex-col gap-3 max-h-[600px] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5 min-w-0">
          <p className="text-[13px] font-medium text-[#ececec] truncate">
            Compare Models
          </p>
          <p className="text-[11px] text-[#9a9a9a]">
            Select 2-4 models to compare responses
          </p>
        </div>
        <button
          className="p-1 rounded-md text-text-3 hover:text-text-2 hover:bg-white/[0.06] transition-colors shrink-0"
          onClick={onClose}
          aria-label="Close compare"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* Model selection */}
      <div className="flex flex-col gap-2">
        <label className="text-[11.5px] font-medium text-[#b4b4b4]">
          Select models ({selectedModelIds.length}/4)
        </label>
        <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto">
          {models.map((model) => {
            const isSelected = selectedModelIds.includes(model.id);
            return (
              <button
                key={model.id}
                onClick={() => toggleModel(model.id)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12px] transition-colors ${
                  isSelected
                    ? "bg-accent/20 border-accent/40 text-[#ececec]"
                    : "bg-white/[0.06] border-white/10 text-[#d5d5d5] hover:bg-white/[0.08]"
                } border`}
                disabled={!isSelected && selectedModelIds.length >= 4}
              >
                {isSelected && <Check size={12} className="text-accent shrink-0" />}
                <span className="truncate">{model.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Prompt input */}
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-medium text-[#b4b4b4]">Prompt</span>
        <textarea
          className="w-full px-2.5 py-2 rounded-md bg-white/[0.06] border border-white/10 text-[13px] text-[#ececec] placeholder:text-[#a0a0a0] outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 transition-colors resize-none"
          placeholder="Enter a prompt to test across all selected models..."
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>

      {/* Run button */}
      <button
        className="primary-action py-2 rounded-md text-[13px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={runComparison}
        disabled={selectedModelIds.length < 2 || !prompt.trim() || running}
      >
        {running ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Running comparison...
          </span>
        ) : (
          "Run Comparison"
        )}
      </button>

      {/* Results */}
      {results.length > 0 && (
        <div className="flex flex-col gap-3 mt-2">
          <div className="text-[11.5px] font-medium text-[#b4b4b4]">Results</div>
          <div className="grid grid-cols-1 gap-3">
            {results.map((result) => (
              <div
                key={result.modelId}
                className="flex flex-col gap-2 p-3 rounded-md bg-white/[0.04] border border-white/10"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className="text-[12px] font-medium text-[#ececec] truncate">
                      {result.modelName}
                    </span>
                    <div className="flex items-center gap-3 text-[10px] text-[#9a9a9a]">
                      <span>{Math.round(result.latencyMs)}ms</span>
                      <span>{result.tokens.input + result.tokens.output} tokens</span>
                      {result.cost !== undefined && (
                        <span>${result.cost.toFixed(6)}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-[12px] text-[#d5d5d5] whitespace-pre-wrap break-words max-h-[150px] overflow-y-auto">
                  {result.response}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Inline model-settings panel (shown when the gear icon is clicked) ──

interface ModelSettingsPanelProps {
  modelId: string;
  models: Model[];
  overrides: ModelOverride;
  onSave: (override: Partial<ModelOverride>) => void;
  onClose: () => void;
}

function ModelSettingsPanel({ modelId, models, overrides, onSave, onClose }: ModelSettingsPanelProps) {
  const model = models.find((m) => m.id === modelId);
  const [ctx, setCtx] = useState(overrides.contextWindow?.toString() ?? "");
  const [maxResp, setMaxResp] = useState(overrides.maxResponseTokens?.toString() ?? "");
  const [reasoning, setReasoning] = useState(overrides.reasoningEffort ?? "");

  // Resolve the true auto-detected context window (without user overrides).
  const autoDetectedCtx = useMemo(() => {
    if (!model) return 0;
    const [providerId, plainModelId] = (() => {
      const idx = model.id.indexOf(":");
      return idx < 0
        ? [model.providerId, model.id]
        : [model.id.slice(0, idx), model.id.slice(idx + 1)];
    })();
    return getContextWindow(providerId, plainModelId);
  }, [model]);

  const hasAnyOverride =
    ("contextWindow" in overrides && overrides.contextWindow !== undefined) ||
    (overrides.maxResponseTokens && overrides.maxResponseTokens > 0) ||
    !!overrides.reasoningEffort;

  const handleSave = () => {
    const patch: Partial<ModelOverride> = {};
    const parsedCtx = parseInt(ctx, 10);
    if (ctx.trim() !== "") patch.contextWindow = isNaN(parsedCtx) ? undefined : parsedCtx;
    else patch.contextWindow = undefined;
    const parsedMax = parseInt(maxResp, 10);
    if (maxResp.trim() !== "") patch.maxResponseTokens = isNaN(parsedMax) ? undefined : parsedMax;
    else patch.maxResponseTokens = undefined;
    if (reasoning) patch.reasoningEffort = reasoning;
    else patch.reasoningEffort = undefined;
    onSave(patch);
  };

  const handleClear = () => {
    onSave({ contextWindow: undefined, maxResponseTokens: undefined, reasoningEffort: undefined });
  };

  if (!model) return null;

  return (
    <div className="p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5 min-w-0">
          <p className="text-[13px] font-medium text-[#ececec] truncate">
            Settings: {model.name}
          </p>
          <p className="text-[11px] text-[#9a9a9a]">
            Override auto-detected values for this model
          </p>
        </div>
        <button
          className="p-1 rounded-md text-text-3 hover:text-text-2 hover:bg-white/[0.06] transition-colors shrink-0"
          onClick={onClose}
          aria-label="Close settings"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* Context Window */}
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-medium text-[#b4b4b4]">Context Window (tokens)</span>
        <input
          type="number"
          className="w-full px-2.5 py-1.5 rounded-md bg-white/[0.06] border border-white/10 text-[13px] text-[#ececec] placeholder:text-[#a0a0a0] outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 transition-colors"
          placeholder={
            autoDetectedCtx > 0
              ? `Auto-detected: ${autoDetectedCtx.toLocaleString()}`
              : model.contextWindow > 0
                ? `From provider: ${model.contextWindow.toLocaleString()}`
                : "Unknown"
          }
          value={ctx}
          onChange={(e) => setCtx(e.target.value)}
        />
        <span className="text-[10px] text-[#9a9a9a]">
          {autoDetectedCtx > 0
            ? `Auto-detected: ${autoDetectedCtx.toLocaleString()} tokens`
            : model.contextWindow > 0
              ? `Provider default: ${model.contextWindow.toLocaleString()} tokens`
              : "No auto-detected size available — set one manually"}
        </span>
      </label>

      {/* Max Response Tokens */}
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-medium text-[#b4b4b4]">Max Response Tokens</span>
        <input
          type="number"
          className="w-full px-2.5 py-1.5 rounded-md bg-white/[0.06] border border-white/10 text-[13px] text-[#ececec] placeholder:text-[#a0a0a0] outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 transition-colors"
          placeholder="Provider default"
          value={maxResp}
          onChange={(e) => setMaxResp(e.target.value)}
        />
      </label>

      {/* Reasoning Level */}
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-medium text-[#b4b4b4]">Reasoning Level</span>
        <select
          className="w-full px-2.5 py-1.5 rounded-md bg-white/[0.06] border border-white/10 text-[13px] text-[#ececec] outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 transition-colors appearance-none"
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
        >
          <option value="">Provider default</option>
          <option value="off">Off</option>
          <option value="minimal">Minimal</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="xhigh">X-High</option>
        </select>
      </label>

      {/* Actions */}
      <div className="flex gap-2 mt-1">
        {hasAnyOverride && (
          <button
            className="flex-1 py-1.5 rounded-md text-[12px] text-[#f87171] hover:bg-red-500/10 hover:text-[#fca5a5] transition-colors"
            onClick={handleClear}
          >
            Clear overrides
          </button>
        )}
        <button
          className="primary-action flex-1 py-1.5 rounded-md text-[13px] font-medium transition-colors"
          onClick={handleSave}
        >
          Done
        </button>
      </div>
    </div>
  );
}
