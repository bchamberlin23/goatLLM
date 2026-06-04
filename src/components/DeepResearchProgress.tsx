import { useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Brain,
  CheckCircle,
  FileText,
  Search,
  Telescope,
} from "lucide-react";
import type { DeepResearchPhase, DeepResearchState } from "../stores/chat";
import { Shimmer, useElapsedLabel } from "./ThinkingIndicator";
import { DeepResearchDetailPane } from "./DeepResearchDetailPane";

const PHASE_LABEL: Record<DeepResearchPhase, string> = {
  planning: "Planning strategy",
  searching: "Searching web",
  reading: "Reading sources",
  analyzing: "Analyzing findings",
  writing: "Writing report",
  warning: "Needs attention",
  error: "Deep Research stopped",
  done: "Deep Research complete",
};

const PHASE_ICON: Record<DeepResearchPhase, typeof Telescope> = {
  planning: Telescope,
  searching: Search,
  reading: BookOpen,
  analyzing: Brain,
  writing: FileText,
  warning: AlertTriangle,
  error: AlertTriangle,
  done: CheckCircle,
};

const PHASE_PERCENT: Record<DeepResearchPhase, number> = {
  planning: 15,
  searching: 35,
  reading: 60,
  analyzing: 80,
  writing: 95,
  done: 100,
  error: 100,
  warning: 50,
};

export function DeepResearchProgress({ state }: { state: DeepResearchState }) {
  const isWorking = state.phase !== "done" && state.phase !== "error";
  const elapsed = useElapsedLabel(state.startedAt, isWorking);
  const Icon = PHASE_ICON[state.phase] ?? Telescope;
  const recentEvents = state.events.slice(-5);
  const [detailTab, setDetailTab] = useState<"sources" | "findings" | null>(null);

  const sources = state.sources ?? [];
  const findings = state.findings ?? [];

  function metric(value: string | number | undefined, label: string, onClick?: () => void) {
    if (value === undefined || value === null || value === "") return null;
    const text = label ? `${value} ${label}` : String(value);
    
    if (onClick) {
      return (
        <button
          onClick={onClick}
          className="inline-flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.035] px-2 py-1 text-[11px] text-text-3 tabular-nums hover:bg-white/[0.07] hover:border-white/[0.1] active:bg-white/[0.05] transition-colors cursor-pointer"
        >
          <span className="font-medium text-text-1">{text}</span>
        </button>
      );
    }
    
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.035] px-2 py-1 text-[11px] text-text-3 tabular-nums">
        <span className="font-medium text-text-1">{text}</span>
      </span>
    );
  }

  const progressPercent = PHASE_PERCENT[state.phase] ?? 0;

  return (
    <>
      <section
        aria-label="Deep Research progress"
        className={`my-1.5 w-full rounded-xl border border-white/[0.05] bg-[#0f0f10] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] ${
          isWorking ? "dr-active-card" : ""
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.02] text-text-2">
              <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="m-0 text-[13.5px] font-semibold leading-5 text-text-1">Deep Research</h3>
                <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[10.5px] text-text-3 tabular-nums">
                  {elapsed}
                </span>
              </div>
              <div className="m-0 mt-0.5 text-[12px] leading-5 text-text-2">
                {isWorking ? (
                  <Shimmer text={PHASE_LABEL[state.phase]} />
                ) : (
                  <span>{PHASE_LABEL[state.phase]}</span>
                )}
              </div>
              {state.query && (
                <p className="m-0 mt-1 max-w-[62ch] truncate text-[11.5px] leading-5 text-text-4">
                  {state.query}
                </p>
              )}
            </div>
          </div>
          <span
            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
              state.phase === "error"
                ? "bg-error"
                : state.phase === "done"
                  ? "bg-success"
                  : "bg-white/40 animate-pulse"
            }`}
            aria-hidden="true"
          />
        </div>

        {/* Progress Bar */}
        <div className="mt-3.5 h-0.5 w-full overflow-hidden rounded-full bg-white/[0.03]">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isWorking ? "dr-progress-bar bg-white/40" : "bg-success"
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Metric Chips */}
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {metric(state.round ? `Round ${state.round}` : undefined, "")}
          {metric(state.queries, "queries")}
          {metric(
            state.sourceCount,
            state.sourceCount === 1 ? "source" : "sources",
            sources.length > 0 ? () => setDetailTab("sources") : undefined
          )}
          {metric(
            state.findingCount,
            state.findingCount === 1 ? "finding" : "findings",
            findings.length > 0 ? () => setDetailTab("findings") : undefined
          )}
        </div>

        {/* Current Source (Active/Loading) */}
        {state.currentSource && (
          <div className="skeleton-sheen mt-3 rounded-lg border border-white/[0.055] bg-white/[0.015] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-4">
              <BookOpen size={11} strokeWidth={1.7} aria-hidden="true" />
              Reading source
            </div>
            <div className="mt-1 truncate text-[12px] font-medium text-text-2">
              {isWorking ? (
                <Shimmer text={state.currentSource.title || state.currentSource.url} className="font-medium text-text-2" />
              ) : (
                state.currentSource.title || state.currentSource.url
              )}
            </div>
          </div>
        )}

        {state.error && (
          <div className="mt-3 rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-[12px] text-error">
            {state.error}
          </div>
        )}

        {/* Timeline Events */}
        {recentEvents.length > 0 && (
          <div className="mt-4 border-l border-white/[0.04] pl-3.5 space-y-3">
            {recentEvents.map((event, index) => {
              const isLast = index === recentEvents.length - 1;
              const isCurrentTask = isLast && isWorking;
              return (
                <div
                  key={event.id}
                  className="dr-event-enter relative flex min-w-0 items-start text-[11.5px] leading-relaxed text-text-3"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  {/* Custom dot indicator */}
                  <span
                    className={`absolute -left-[18.5px] top-[5px] h-1.5 w-1.5 rounded-full border border-[#0f0f10] ${
                      event.phase === "error"
                        ? "bg-error"
                        : event.phase === "done"
                          ? "bg-success"
                          : isCurrentTask
                            ? "bg-white animate-pulse"
                            : "bg-text-4"
                    }`}
                    aria-hidden="true"
                  />
                  {isCurrentTask ? (
                    <Shimmer text={event.message} className="min-w-0 truncate font-normal text-text-2" />
                  ) : (
                    <span className="min-w-0 truncate">{event.message}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Slide-out detail pane */}
      {detailTab && (
        <DeepResearchDetailPane
          sources={sources}
          findings={findings}
          initialTab={detailTab}
          onClose={() => setDetailTab(null)}
        />
      )}
    </>
  );
}
