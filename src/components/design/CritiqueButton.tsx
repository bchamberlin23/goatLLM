import { useState } from "react";
import { useChatStore } from "../../stores/chat";
import { runCritique, type CritiqueResult } from "../../lib/design/critique";
import { Sparkles, AlertTriangle } from "lucide-react";

/**
 * Optional critique button surfaced in the artifact panel when the user is
 * in design mode. Clicking it runs a 5-dimensional self-critique against
 * the active model and shows the scores inline.
 *
 * User-initiated, not automatic. Auto-running every turn would burn tokens
 * silently; making it a button means the user opts in only when they
 * actually want a second opinion.
 */
export function CritiqueButton({ code }: { code: string }) {
  const getActiveLlmConfig = useChatStore((s) => s.getActiveLlmConfig);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CritiqueResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (running) return;
    setError(null);
    const cfg = getActiveLlmConfig();
    if (!cfg) {
      setError("No model selected.");
      return;
    }
    setRunning(true);
    try {
      const r = await runCritique(code, cfg);
      if (!r) setError("Couldn't score this artifact.");
      else setResult(r);
    } catch {
      setError("Critique failed.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        disabled={running}
        title={running ? "Scoring…" : "Run 5-dim critique"}
        aria-label="Run critique"
        className="flex items-center gap-1 px-2 h-7 rounded-md text-[11.5px] font-medium text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/[0.06] disabled:opacity-60 transition-colors"
      >
        <Sparkles size={12} strokeWidth={2} aria-hidden />
        <span>{running ? "Scoring…" : result ? `${result.overall.toFixed(1)}/5` : "Critique"}</span>
      </button>
      {error && (
        <div className="absolute top-full right-0 mt-1.5 w-[260px] rounded-lg bg-[#2a2a2c] border border-[#f87171]/30 px-3 py-2 z-50 text-[11.5px] text-[#f87171] shadow-lg shadow-black/40">
          {error}
        </div>
      )}
      {result && !error && <CritiquePopover result={result} onClose={() => setResult(null)} />}
    </div>
  );
}

function CritiquePopover({
  result,
  onClose,
}: {
  result: CritiqueResult;
  onClose: () => void;
}) {
  const dims: { key: keyof typeof result.scores; label: string }[] = [
    { key: "philosophy", label: "Philosophy" },
    { key: "hierarchy", label: "Hierarchy" },
    { key: "execution", label: "Execution" },
    { key: "specificity", label: "Specificity" },
    { key: "restraint", label: "Restraint" },
  ];
  return (
    <div
      role="dialog"
      aria-label="Critique scores"
      className="absolute top-full right-0 mt-1.5 w-[300px] rounded-xl bg-[#2a2a2c] border border-white/[0.08] shadow-lg shadow-black/40 z-50 animate-[fadeIn_120ms_ease] overflow-hidden"
    >
      <div className="px-3.5 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-[#888] font-semibold">
          Critique
        </span>
        <span className="font-mono text-[12px] tabular-nums text-[#ececec]">
          {result.overall.toFixed(1)} / 5
        </span>
      </div>
      <dl className="px-3.5 py-2.5 space-y-1.5 text-[12px]">
        {dims.map(({ key, label }) => {
          const score = result.scores[key];
          const low = score < 3;
          return (
            <div key={key} className="flex items-baseline justify-between gap-3">
              <dt className={low ? "text-[#f87171]" : "text-[#a0a0a0]"}>
                {label}
              </dt>
              <dd className="flex items-center gap-2">
                <span aria-hidden className="inline-flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span
                      key={n}
                      className="block w-1.5 h-3 rounded-sm"
                      style={{
                        background:
                          n <= score
                            ? low
                              ? "#f87171"
                              : "#f59e42"
                            : "rgba(255,255,255,0.08)",
                      }}
                    />
                  ))}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[#ececec] w-3 text-right">
                  {score}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="px-3.5 pb-3 pt-1 text-[11px] text-[#a0a0a0] leading-relaxed">
        {result.summary}
      </div>
      {result.belowBar.length > 0 && (
        <div className="px-3.5 py-2 border-t border-white/[0.06] bg-[#f87171]/[0.04] flex items-start gap-1.5 text-[10.5px] text-[#f87171]">
          <AlertTriangle size={11} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
          <span>
            {result.belowBar.length} dimension{result.belowBar.length === 1 ? "" : "s"} below the
            bar — ask the model to regenerate.
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-2 right-2 text-[10px] text-[#888] hover:text-[#ececec]"
      >
        ✕
      </button>
    </div>
  );
}
