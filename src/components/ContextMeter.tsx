import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useChatStore } from "../stores/chat";
import { estimateTotalTokens, summarizeWithLlm } from "../lib/context-manager";
import {
  getContextWindow,
  formatTokens,
} from "../lib/context-window";

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

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const tokens = useMemo(
    () => (messages ? estimateTotalTokens(messages) : 0),
    [messages],
  );

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

  const messageCount = messages?.length ?? 0;
  const activeModel = useMemo(
    () => (selectedModelId ? getModels().find((m) => m.id === selectedModelId) : undefined),
    [selectedModelId, getModels],
  );
  const modelName =
    activeModel?.name ??
    selectedModelId?.split(":").slice(1).join(":") ??
    null;

  // Color the ring by pressure level.
  // <70% → neutral, 70–90% → amber accent, ≥90% → red.
  const ringColor =
    ratio >= 0.9
      ? "#f87171"
      : ratio >= 0.7
        ? "#f59e42"
        : "#a0a0a0";
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
        className="flex items-center justify-center p-1 mt-[3px] rounded-md text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/[0.06] transition-colors"
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
            style={{ transition: "stroke-dasharray 240ms ease, stroke 240ms ease" }}
          />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Context window details"
          className="absolute top-full left-0 mt-1.5 w-[260px] rounded-xl bg-[#2a2a2c] border border-white/[0.08] shadow-lg shadow-black/40 z-50 animate-[fadeIn_100ms_ease] overflow-hidden"
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
                className="absolute inset-0 flex items-center justify-center text-[11px] font-mono tabular-nums text-[#ececec]"
                style={{ letterSpacing: "-0.02em" }}
              >
                {pct}%
              </div>
            </div>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-[12.5px] font-medium text-[#ececec]">
                Context window
              </div>
              <div className="mt-0.5 text-[11.5px] text-[#a0a0a0] truncate">
                {modelName ?? "No model selected"}
              </div>
            </div>
          </div>

          <div className="h-px bg-white/[0.06] mx-3" />

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
          </dl>

          <div className="px-3.5 pb-2 pt-1 text-[10.5px] text-[#888] leading-relaxed">
            {!windowKnown
              ? "Window size estimated — no authoritative size was found for this model. You can set an explicit value in the model's gear menu."
              : ratio >= 0.9
                ? "Near the limit. Older messages will be summarized on next send."
                : ratio >= 0.7
                  ? "Getting full. Consider starting a new chat for unrelated topics."
                  : source === "user-override"
                    ? "Window size set by you. Pinned messages are always kept."
                    : "Tokens estimated at ~4 chars each. Pinned messages are always kept."}
          </div>

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
      <dt className="text-[#a0a0a0]">{label}</dt>
      <dd className="font-mono tabular-nums text-[#ececec] text-[11.5px]">
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

  const handleCompact = useCallback(async () => {
    const config = getActiveLlmConfig();
    if (!config) return;

    setCompacting(true);
    try {
      const messages = useChatStore.getState().messages[conversationId] ?? [];
      // Keep only the last 4 messages + pinned, summarize the rest
      const pinned = messages.filter((m) => m.pinned);
      const recent = messages.slice(-4);
      const toSummarize = messages.slice(0, -4).filter((m) => !m.pinned);

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
      );

      // Replace old messages with summary + recent
      const summaryMsg = {
        id: `compact-${Date.now()}`,
        conversationId,
        role: "system" as const,
        content: summary,
        createdAt: Date.now(),
        pinned: true,
      };

      useChatStore.setState((s) => {
        return {
          messages: {
            ...s.messages,
            [conversationId]: [summaryMsg, ...pinned.filter((m) => !recent.includes(m)), ...recent],
          },
        };
      });

      setExpanded(false);
      setInstructions("");
    } catch (e) {
      console.error("Manual compaction failed:", e);
    } finally {
      setCompacting(false);
    }
  }, [conversationId, instructions, getActiveLlmConfig]);

  return (
    <div className="px-3.5 pb-3">
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="w-full py-1.5 rounded-md text-[11.5px] font-medium text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.1] transition-colors"
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
            className="w-full px-2.5 py-1.5 rounded-md bg-white/[0.06] border border-white/10 text-[11.5px] text-[#ececec] placeholder:text-[#6a6a6a] outline-none focus:border-[#f59e42]/50"
            onKeyDown={(e) => { if (e.key === "Enter") handleCompact(); }}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setExpanded(false); setInstructions(""); }}
              className="flex-1 py-1.5 rounded-md text-[11.5px] text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/[0.06] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCompact}
              disabled={compacting}
              className="flex-1 py-1.5 rounded-md text-[11.5px] font-medium bg-[#f59e42] text-black hover:bg-[#f0903a] disabled:opacity-50 transition-colors"
            >
              {compacting ? "Compacting…" : "Compact"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
