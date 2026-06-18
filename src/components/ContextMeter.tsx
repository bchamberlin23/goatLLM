import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useChatStore } from "../stores/chat";
import { estimateTotalTokens, summarizeWithLlm } from "../lib/context-manager";
import { createCompactionId, type CompactionEntry } from "../lib/compaction/types";
import {
  getContextWindow,
  formatTokens,
} from "../lib/context-window";
import { buildConversationUsage } from "../lib/product-workspace";

const EMPTY_COMPACTION_ENTRIES: CompactionEntry[] = [];

/**
 * Tiny circular meter that lives in the top bar and shows how full the
 * model's context window is for the active conversation. Click to expand
 * a popover with the underlying numbers.
 *
 * Resolution order for the window size:
 *   1. User override (set via the gear icon in the model picker).
 *   2. Local model discovery (Ollama / LM Studio — the user controls
 *      num_ctx at load time and no upstream catalog can know the tag).
 *   3. Auto-detected from the model catalog and name-based heuristics.
 *   4. Conservative fallback (128K) when nothing is known.
 *
 * Token math reuses the same estimator the compaction pipeline uses, so
 * the displayed % matches what compactMessages will see when the user
 * hits send.
 */
export function ContextMeter() {
  const activeId = useChatStore((s) => s.activeId);
  const messages = useChatStore((s) =>
    activeId ? s.messages[activeId] : undefined,
  );
  const selectedModelId = useChatStore((s) => s.selectedModelId);
  const getModels = useChatStore((s) => s.getModels);
  const modelOverrides = useChatStore((s) => s.modelOverrides);
  const usageSettings = useChatStore((s) => s.usageSettings);
  const compactionEntries = useChatStore((s) =>
    activeId ? s.compactionEntries[activeId] ?? EMPTY_COMPACTION_ENTRIES : EMPTY_COMPACTION_ENTRIES,
  );

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const lastActiveIdRef = useRef<string | null>(null);

  const estimateKey = useMemo(() => {
    if (!messages?.length) return "0";
    let total = messages.length;
    for (const m of messages) {
      total += m.content.length;
      if (m.thinkingContent) total += m.thinkingContent.length;
      if (m.toolCalls) total += m.toolCalls.length;
    }
    return String(total);
  }, [messages]);

  const [tokens, setTokens] = useState(0);

  useEffect(() => {
    if (!messages) {
      setTokens(0);
      return;
    }

    const switchedConversation = lastActiveIdRef.current !== activeId;
    lastActiveIdRef.current = activeId ?? null;

    if (switchedConversation) {
      setTokens(estimateTotalTokens(messages));
      return;
    }

    const timer = window.setTimeout(() => {
      setTokens(estimateTotalTokens(messages));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [activeId, estimateKey, messages]);

  // Resolve the effective context window for the currently selected model.
  const { windowTokens, windowKnown, source } = useMemo(() => {
    if (!selectedModelId) {
      return { windowTokens: 128_000, windowKnown: false, source: "fallback" as const };
    }

    const [providerId, modelId] = (() => {
      const idx = selectedModelId.indexOf(":");
      return idx < 0
        ? [selectedModelId, selectedModelId]
        : [selectedModelId.slice(0, idx), selectedModelId.slice(idx + 1)];
    })();

    // 1. User override (highest priority).
    const override = modelOverrides[selectedModelId]?.contextWindow;
    if (override && override > 0) {
      return { windowTokens: override, windowKnown: true, source: "user-override" as const };
    }

    // 2. Local model discovery (Ollama / LM Studio).
    const isLocal = providerId === "ollama" || providerId === "lmstudio";
    if (isLocal) {
      const activeModel = getModels().find((m) => m.id === selectedModelId);
      const discovered = activeModel && activeModel.contextWindow > 0
        ? activeModel.contextWindow
        : 0;
      if (discovered > 0) {
        return { windowTokens: discovered, windowKnown: true, source: "local-discovery" as const };
      }
    }

    // 3. Auto-detected (catalog + heuristic lookup).
    const auto = getContextWindow(providerId, modelId);
    if (auto > 0) {
      return { windowTokens: auto, windowKnown: true, source: "auto-detected" as const };
    }

    // 4. Conservative fallback.
    return { windowTokens: 128_000, windowKnown: false, source: "fallback" as const };
  }, [selectedModelId, modelOverrides, getModels]);

  const ratio = Math.min(1, tokens / Math.max(1, windowTokens));
  const pct = Math.round(ratio * 100);
  const remaining = Math.max(0, windowTokens - tokens);
  const compactionEnabled = usageSettings.compactionSettings.enabled;

  const messageCount = messages?.length ?? 0;
  const activeModel = useMemo(
    () => (selectedModelId ? getModels().find((m) => m.id === selectedModelId) : undefined),
    [selectedModelId, getModels],
  );
  const modelName =
    activeModel?.name ??
    selectedModelId?.split(":").slice(1).join(":") ??
    null;

  // Calculate cost information
  const usage = useMemo(() => {
    if (!messages?.length) return null;
    return buildConversationUsage(messages, {
      monthlyBudgetUsd: usageSettings.monthlyBudgetUsd,
      expensiveSessionUsd: usageSettings.expensiveSessionUsd,
      priceOverrides: usageSettings.priceOverrides,
      modelIdForMessage: (msg) => msg.modelId ?? selectedModelId ?? undefined,
    });
  }, [messages, usageSettings, selectedModelId]);

  const costUsd = usage?.totalCostUsd ?? 0;
  const budgetRatio = usage?.budgetStatus.ratio ?? 0;
  const budgetAlerts = usage?.alerts ?? [];

  // Color the ring by pressure level.
  // <70% → neutral, 70–90% → amber accent, ≥90% → red.
  const ringColor =
    ratio >= 0.9
      ? "var(--error)"
      : ratio >= 0.7
        ? "var(--accent)"
        : "var(--text-3)";
  const trackColor = "rgba(255,255,255,0.08)";

  // SVG geometry — small enough to nestle next to the assets menu.
  const size = 18;
  const stroke = 2.25;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * ratio;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!activeId) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="control-icon relative flex items-center justify-center p-1 mt-[3px] rounded-md transition-colors"
        aria-label={`Context window — ${pct}% full`}
        title={`Context: ${pct}% used`}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden
          style={{ display: "block" }}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={trackColor}
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={ringColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{
              transition:
                "stroke-dasharray var(--d-medium) var(--ease-out), stroke var(--d-medium) var(--ease-out)",
            }}
          />
        </svg>
        {compactionEntries.length > 1 && (
          <span
            className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent"
            aria-hidden="true"
          />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Context window details"
          className="popover-surface motion-popover-in absolute top-full left-0 mt-1.5 w-[260px] rounded-xl z-50 overflow-hidden"
        >
          <div className="px-3.5 pt-3 pb-2.5 flex items-start gap-3">
            {/* Larger ring inside the popover for legibility */}
            <div className="shrink-0 relative" style={{ width: 44, height: 44 }}>
              <svg width={44} height={44} viewBox="0 0 44 44" aria-hidden>
                <circle cx={22} cy={22} r={19} fill="none" stroke={trackColor} strokeWidth={3} />
                <circle
                  cx={22}
                  cy={22}
                  r={19}
                  fill="none"
                  stroke={ringColor}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 19 * ratio} ${2 * Math.PI * 19}`}
                  transform="rotate(-90 22 22)"
                />
              </svg>
              <div
                className="absolute inset-0 flex items-center justify-center text-[11px] font-mono tabular-nums text-text-1"
              >
                {pct}%
              </div>
            </div>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-[12.5px] font-medium text-text-1">
                Context window
              </div>
              <div className="mt-0.5 text-[11.5px] text-text-3 truncate">
                {modelName ?? "No model selected"}
              </div>
            </div>
          </div>

          <div className="h-px bg-white/5 mx-3" />

          <dl className="px-3.5 py-2.5 space-y-1.5 text-[12px]">
            <Row label="Used" value={`${formatTokens(tokens)} tok`} />
            <Row label="Remaining" value={`${formatTokens(remaining)} tok`} />
            <Row
              label="Window"
              value={
                windowKnown
                  ? `${formatTokens(windowTokens)} tok`
                  : `~${formatTokens(windowTokens)} tok (estimated)`
              }
            />
            <Row
              label="Messages"
              value={messageCount.toLocaleString()}
            />
            <Row
              label="Auto-compact"
              value={compactionEnabled ? "On" : "Off"}
            />
            {costUsd > 0 && (
              <>
                <div className="h-px bg-white/5 my-1" />
                <Row label="Cost" value={`$${costUsd.toFixed(4)}`} />
                {usageSettings.monthlyBudgetUsd > 0 && (
                  <Row 
                    label="Budget" 
                    value={`${Math.round(budgetRatio * 100)}% of $${usageSettings.monthlyBudgetUsd}`}
                  />
                )}
              </>
            )}
          </dl>

          {budgetAlerts.length > 0 && (
            <div className="px-3.5 pb-2">
              {budgetAlerts.map((alert, i) => (
                <div 
                  key={i}
                  className="text-[10.5px] text-accent bg-accent/10 border border-accent/20 rounded px-2 py-1 mb-1"
                >
                  {alert.message}
                </div>
              ))}
            </div>
          )}

          <div className="px-3.5 pb-2 pt-1 text-[10.5px] text-text-4 leading-relaxed">
            {!compactionEnabled
              ? "Auto-compaction is disabled in Settings. Manual compaction is still available."
              : !windowKnown
              ? "Window size estimated — no authoritative size was found for this model. You can set an explicit value in the model's gear menu."
              : ratio >= 0.9
                ? "Near the limit. Older messages will be summarized on next send."
                : ratio >= 0.7
                  ? "Getting full. Consider starting a new chat for unrelated topics."
                  : source === "user-override"
                    ? "Window size set by you. Pinned messages are always kept."
                    : "Tokens estimated at ~4 chars each. Pinned messages are always kept."}
          </div>

          {compactionEntries.length > 1 && (
            <div className="mx-3 mb-2 rounded-lg border border-hairline bg-white/[0.03] px-2.5 py-2">
              <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-3">
                Compaction history
              </div>
              <div className="space-y-1">
                {compactionEntries.slice(0, 4).map((entry, index) => (
                  <div key={entry.id} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="min-w-0 truncate text-text-2">
                      {index === 0 ? "Latest" : new Date(entry.createdAt).toLocaleString()}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-text-3">
                      {formatTokens(entry.tokensBefore)} tok
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manual compaction */}
          {ratio >= 0.5 && activeId && (
            <ManualCompactButton conversationId={activeId} />
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-text-3">{label}</dt>
      <dd className="font-mono tabular-nums text-text-1 text-[11.5px]">
        {value}
      </dd>
    </div>
  );
}

function ManualCompactButton({ conversationId }: { conversationId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [compacting, setCompacting] = useState(false);
  const getActiveLlmConfig = useChatStore((s) => s.getActiveLlmConfig);
  const addCompactionEntry = useChatStore((s) => s.addCompactionEntry);

  const handleCompact = useCallback(async () => {
    const config = getActiveLlmConfig();
    if (!config) return;

    setCompacting(true);
    try {
      const messages = useChatStore.getState().messages[conversationId] ?? [];
      // Keep only the last 4 messages + pinned, summarize the rest
      const recent = messages.slice(-4);
      const toSummarize = messages.slice(0, -4).filter((m) => !m.pinned);
      const latestEntry = useChatStore.getState().compactionEntries[conversationId]?.[0];

      if (toSummarize.length === 0) {
        setCompacting(false);
        setExpanded(false);
        return;
      }

      const summary = await summarizeWithLlm(
        toSummarize,
        config,
        undefined,
        instructions.trim() || undefined,
        latestEntry?.summary,
        {
          readFiles: latestEntry?.readFiles ?? [],
          modifiedFiles: latestEntry?.modifiedFiles ?? [],
        },
      );

      const firstKept = recent[0];
      if (!firstKept) return;
      addCompactionEntry({
        id: createCompactionId(),
        conversationId,
        firstKeptId: firstKept.id,
        summary,
        readFiles: latestEntry?.readFiles ?? [],
        modifiedFiles: latestEntry?.modifiedFiles ?? [],
        tokensBefore: estimateTotalTokens(messages),
        source: "manual",
        isSplitTurn: false,
        promptVersion: latestEntry ? "update" : "initial",
        createdAt: Date.now(),
        mode: useChatStore.getState().getActiveConversation()?.mode ?? "chat",
        modelId: useChatStore.getState().selectedModelId ?? undefined,
      });

      setExpanded(false);
      setInstructions("");
    } catch (e) {
      console.error("Manual compaction failed:", e);
    } finally {
      setCompacting(false);
    }
  }, [addCompactionEntry, conversationId, instructions, getActiveLlmConfig]);

  return (
    <div className="px-3.5 pb-3">
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="control-pill w-full py-1.5 rounded-md text-[11.5px] font-medium transition-colors"
        >
          Compact context…
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Optional: focus instructions (e.g., 'auth flow')"
            className="w-full px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 text-[11.5px] text-text-1 placeholder:text-text-4 outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
            onKeyDown={(e) => { if (e.key === "Enter") handleCompact(); }}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setExpanded(false); setInstructions(""); }}
              className="control-pill flex-1 py-1.5 rounded-md text-[11.5px] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCompact}
              disabled={compacting}
              className="primary-action flex-1 py-1.5 rounded-md text-[11.5px] font-medium disabled:opacity-50 transition-colors"
            >
              {compacting ? "Compacting…" : "Compact"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
