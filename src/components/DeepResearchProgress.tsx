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
import { useElapsedLabel } from "./ThinkingIndicator";

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

function metric(value: string | number | undefined, label: string) {
  if (value === undefined || value === null || value === "") return null;
  const text = label ? `${value} ${label}` : String(value);
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.035] px-2 py-1 text-[11px] text-text-3 tabular-nums">
      <span className="font-medium text-text-1">{text}</span>
    </span>
  );
}

export function DeepResearchProgress({ state }: { state: DeepResearchState }) {
  const elapsed = useElapsedLabel(state.startedAt, state.phase !== "done" && state.phase !== "error");
  const Icon = PHASE_ICON[state.phase] ?? Telescope;
  const recentEvents = state.events.slice(-5);

  return (
    <section
      aria-label="Deep Research progress"
      className="my-1.5 w-full rounded-xl border border-white/[0.07] bg-[#212122] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
            <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="m-0 text-[13.5px] font-semibold leading-5 text-text-1">Deep Research</h3>
              <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[10.5px] text-text-3 tabular-nums">
                {elapsed}
              </span>
            </div>
            <p className="m-0 mt-0.5 text-[12px] leading-5 text-text-2">{PHASE_LABEL[state.phase]}</p>
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
                : "bg-accent animate-pulse"
          }`}
          aria-hidden="true"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {metric(state.round ? `Round ${state.round}` : undefined, "")}
        {metric(state.queries, "queries")}
        {metric(state.sourceCount, state.sourceCount === 1 ? "source" : "sources")}
        {metric(state.findingCount, state.findingCount === 1 ? "finding" : "findings")}
      </div>

      {state.currentSource && (
        <div className="mt-3 rounded-lg border border-white/[0.055] bg-[#161618]/70 px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-text-4">
            <BookOpen size={12} strokeWidth={1.7} aria-hidden="true" />
            Current source
          </div>
          <div className="mt-1 truncate text-[12.5px] font-medium text-text-2">
            {state.currentSource.title || state.currentSource.url}
          </div>
        </div>
      )}

      {state.error && (
        <div className="mt-3 rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-[12px] text-error">
          {state.error}
        </div>
      )}

      {recentEvents.length > 0 && (
        <ol className="mt-3 space-y-1.5">
          {recentEvents.map((event) => (
            <li key={event.id} className="flex min-w-0 items-start gap-2 text-[12px] leading-5 text-text-3">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-white/20" aria-hidden="true" />
              <span className="min-w-0 truncate">{event.message}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
