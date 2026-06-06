import { useState, useEffect } from "react";
import {
  AlertTriangle,
  BookOpen,
  Brain,
  CheckCircle,
  FileText,
  Search,
  Telescope,
  RotateCw,
  Globe,
  Plus,
  Trash,
  Edit,
  Check,
} from "lucide-react";
import { useChatStore, type DeepResearchPhase, type DeepResearchState, type Message } from "../stores/chat";
import { useElapsedLabel } from "./ThinkingIndicator";
import { DeepResearchDetailPane } from "./DeepResearchDetailPane";
import { planResolvers } from "../lib/deep-research";

function TextShimmer({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`dr-text-shimmer ${className}`} aria-live="polite">
      {text}
    </span>
  );
}

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

export function DeepResearchProgress({ message, state }: { message: Message; state: DeepResearchState }) {
  const isWorking = state.phase !== "done" && state.phase !== "error";
  const elapsed = useElapsedLabel(state.startedAt, isWorking);
  const Icon = PHASE_ICON[state.phase] ?? Telescope;
  const recentEvents = state.events.slice(-5);
  const [detailTab, setDetailTab] = useState<"sources" | "findings" | null>(null);

  const sources = state.sources ?? [];
  const findings = state.findings ?? [];

  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedSteps, setEditedSteps] = useState<string[]>([]);
  const [timeLeft, setTimeLeft] = useState<number | null>(60);

  // Auto-start timer
  useEffect(() => {
    if (state.phase !== "planning" || state.planApproved || isEditing || timeLeft === null) {
      return;
    }
    if (timeLeft <= 0) {
      handleStart();
      return;
    }
    const timer = setTimeout(() => {
      setTimeLeft(timeLeft - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [state.phase, state.planApproved, isEditing, timeLeft]);

  const handleStart = () => {
    setTimeLeft(null);
    const steps = state.planSteps || [];
    useChatStore.getState().updateMessage(message.conversationId, message.id, {
      deepResearch: {
        ...state,
        planApproved: true,
        phase: "searching",
      }
    });
    const resolve = planResolvers.get(message.id);
    if (resolve) {
      resolve(steps);
      planResolvers.delete(message.id);
    }
  };

  const handleCancel = () => {
    setTimeLeft(null);
    const ac = useChatStore.getState().streamingAbortControllers[message.conversationId];
    if (ac) {
      ac.abort();
    }
  };

  const handleStartEdit = () => {
    setTimeLeft(null);
    setEditedTitle(state.planTitle || "");
    setEditedSteps([...(state.planSteps || [])]);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    const finalSteps = editedSteps.map(s => s.trim()).filter(Boolean);
    const stepsToSave = finalSteps.length > 0 ? finalSteps : ["Search broadly..."];
    const titleToSave = editedTitle.trim() || state.planTitle || "Research Goal";
    
    useChatStore.getState().updateMessage(message.conversationId, message.id, {
      deepResearch: {
        ...state,
        planTitle: titleToSave,
        planSteps: stepsToSave,
      }
    });
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <section
        aria-label="Edit Research Plan"
        className="my-1.5 w-full rounded-xl border border-white/[0.04] bg-[#0b0b0c] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] space-y-4"
      >
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-text-3 uppercase tracking-wider">
            Research Title
          </label>
          <input
            type="text"
            className="w-full bg-surface-1 text-text-1 border border-hairline rounded-md px-3 py-1.5 text-[13px] focus:border-hairline-strong focus:outline-none focus:ring-2 focus:ring-accent-soft"
            value={editedTitle}
            onChange={(e) => setEditedTitle(e.target.value)}
            placeholder="e.g. Undervalued stocks with high upside"
          />
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-semibold text-text-3 uppercase tracking-wider block">
            Steps to cover
          </label>
          <div className="space-y-2.5">
            {editedSteps.map((step, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  className="flex-1 bg-surface-1 text-text-1 border border-hairline rounded-md px-3 py-1.5 text-[12.5px] focus:border-hairline-strong focus:outline-none focus:ring-2 focus:ring-accent-soft"
                  value={step}
                  onChange={(e) => {
                    const newSteps = [...editedSteps];
                    newSteps[idx] = e.target.value;
                    setEditedSteps(newSteps);
                  }}
                  placeholder={`Step ${idx + 1}`}
                />
                <button
                  type="button"
                  onClick={() => {
                    const newSteps = editedSteps.filter((_, i) => i !== idx);
                    setEditedSteps(newSteps);
                  }}
                  className="p-1.5 rounded-md hover:bg-white/5 text-text-3 hover:text-error transition-colors cursor-pointer shrink-0"
                  title="Remove step"
                >
                  <Trash size={13} strokeWidth={1.8} />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setEditedSteps([...editedSteps, ""])}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-text-3 hover:text-accent transition-colors mt-1.5 cursor-pointer"
          >
            <Plus size={13} strokeWidth={2} />
            Add Step
          </button>
        </div>

        <div className="h-px bg-white/5 my-2" />

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleCancelEdit}
            className="rounded-md bg-white/5 text-text-2 hover:bg-white/10 px-3.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveEdit}
            className="rounded-md bg-accent text-bg hover:bg-accent-hover px-4 py-1.5 text-[12px] font-semibold transition-colors cursor-pointer"
          >
            Save Changes
          </button>
        </div>
      </section>
    );
  }

  if (state.phase === "planning" && !state.planApproved) {
    return (
      <section
        aria-label="Research Plan Draft"
        className="my-1.5 w-full rounded-xl border border-white/[0.04] bg-[#0b0b0c] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] space-y-4"
      >
        <div className="space-y-1">
          <div className="text-[10px] font-semibold text-accent uppercase tracking-widest">
            Draft Research Plan
          </div>
          <h4 className="m-0 text-[14px] font-semibold text-text-1">
            {state.planTitle || "Research Goal"}
          </h4>
        </div>

        <div className="space-y-2.5 my-3">
          {(state.planSteps || []).map((step, idx) => (
            <div key={idx} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-text-2">
              <span className="w-4 h-4 rounded-full border border-dashed border-text-4/40 shrink-0 mt-0.5 flex items-center justify-center text-[8.5px] text-text-4 font-mono font-bold" aria-hidden="true" />
              <span>{step}</span>
            </div>
          ))}
        </div>

        <div className="h-px bg-white/5" />

        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={handleStartEdit}
            className="rounded-md bg-white/5 text-text-2 hover:bg-white/10 px-3.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Edit size={12} strokeWidth={1.8} />
            Edit Plan
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md text-text-3 hover:text-text-1 hover:bg-white/5 px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleStart}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#ececec] text-[#1a1a1c] px-4.5 py-1.5 text-[12.5px] font-semibold hover:bg-white transition-all shadow-sm active:scale-[0.98] select-none cursor-pointer"
            >
              <span>Start</span>
              {timeLeft !== null && (
                <span className="flex items-center justify-center w-5 h-5 rounded-full border border-black/10 bg-black/10 text-[10.5px] font-mono font-bold tabular-nums ml-0.5">
                  {timeLeft}
                </span>
              )}
            </button>
          </div>
        </div>
      </section>
    );
  }

  function metric(
    value: string | number | undefined,
    label: string,
    Icon?: any,
    onClick?: () => void
  ) {
    if (value === undefined || value === null || value === "") return null;
    const text = label ? `${value} ${label}` : String(value);
    
    const content = (
      <>
        {Icon && <Icon size={11} className="text-text-3 shrink-0" />}
        <span className="font-medium text-text-1">{text}</span>
      </>
    );
    
    if (onClick) {
      return (
        <button
          onClick={onClick}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.035] px-2.5 py-1 text-[11px] text-text-3 tabular-nums backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/[0.07] hover:border-white/[0.1] active:bg-white/[0.05] transition-colors cursor-pointer"
        >
          {content}
        </button>
      );
    }
    
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.035] px-2.5 py-1 text-[11px] text-text-3 tabular-nums backdrop-blur-[8px] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        {content}
      </span>
    );
  }

  const progressPercent = PHASE_PERCENT[state.phase] ?? 0;

  // Render a clean, minimized finished summary card once research completes
  if (!isWorking) {
    const isError = state.phase === "error";
    const statusText = isError ? "Deep Research stopped" : "Deep Research complete";
    const StatusIcon = isError ? AlertTriangle : CheckCircle;
    const iconColor = isError ? "text-error" : "text-success";
    const borderColor = isError ? "border-error/20" : "border-white/[0.04]";

    return (
      <>
        <section
          aria-label="Deep Research results"
          className={`my-1.5 w-full rounded-xl border ${borderColor} bg-[#0b0b0c] px-3.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]`}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.02] ${iconColor}`}>
                <StatusIcon size={12} strokeWidth={2.2} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="m-0 text-[12.5px] font-semibold text-text-1">{statusText}</h4>
                  <span className="text-[10px] text-text-3 tabular-nums font-mono bg-white/5 px-1 py-0.5 rounded">
                    {elapsed}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {metric(state.queries, "queries", Search)}
              {metric(
                state.sourceCount,
                state.sourceCount === 1 ? "source" : "sources",
                Globe,
                sources.length > 0 ? () => setDetailTab("sources") : undefined
              )}
              {metric(
                state.findingCount,
                state.findingCount === 1 ? "finding" : "findings",
                FileText,
                findings.length > 0 ? () => setDetailTab("findings") : undefined
              )}
            </div>
          </div>
        </section>

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

  const steps = state.planSteps || [];
  let activeStepIdx = -1;
  if (state.phase === "done" || state.phase === "writing" || state.phase === "analyzing") {
    activeStepIdx = steps.length;
  } else if (state.round !== undefined) {
    activeStepIdx = Math.min(state.round - 1, steps.length - 1);
  }

  function getStepIcon(idx: number) {
    if (state.phase === "error") {
      return (
        <span className="w-4 h-4 rounded-full border border-dashed border-error/40 shrink-0 mt-0.5" />
      );
    }
    if (idx < activeStepIdx) {
      return (
        <span className="w-4 h-4 rounded-full bg-[#ececec] text-[#0b0b0c] flex items-center justify-center shrink-0 mt-0.5">
          <Check size={10} strokeWidth={3} />
        </span>
      );
    }
    if (idx === activeStepIdx) {
      return (
        <span className="w-4 h-4 rounded-full border-2 border-[#ececec] shrink-0 mt-0.5 animate-pulse" />
      );
    }
    return (
      <span className="w-4 h-4 rounded-full border border-dashed border-white/20 shrink-0 mt-0.5" />
    );
  }

  const statusLabel = state.phase === "searching" ? "Searching web..." :
                      state.phase === "reading" ? "Reading sources..." :
                      state.phase === "analyzing" ? "Analyzing findings..." :
                      state.phase === "writing" ? "Writing report..." :
                      "Researching...";

  const searchesLabel = state.queries ? `${state.queries} search${state.queries === 1 ? "" : "es"}` : "0 searches";

  return (
    <>
      <section
        aria-label="Deep Research progress"
        className="my-1.5 w-full rounded-xl border border-white/[0.04] bg-[#0b0b0c] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] space-y-4 animate-[fadeIn_150ms_ease]"
      >
        {/* Top Title Row */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-[10px] font-semibold text-accent uppercase tracking-widest">
              Researching Goal
            </div>
            <h4 className="m-0 text-[14px] font-semibold text-text-1">
              {state.planTitle || "Research Goal"}
            </h4>
          </div>
          <button
            type="button"
            onClick={handleStartEdit}
            className="rounded-full border border-hairline bg-white/5 text-text-2 hover:bg-white/10 px-3 py-1 text-[11.5px] font-semibold transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
          >
            <Edit size={11} strokeWidth={2} />
            Update
          </button>
        </div>

        {/* Steps checklist */}
        <div className="space-y-2.5 my-3">
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-text-2">
              {getStepIcon(idx)}
              <span className={idx < activeStepIdx ? "text-text-4 line-through decoration-white/25" : ""}>
                {step}
              </span>
            </div>
          ))}
        </div>

        <div className="h-px bg-white/5" />

        {/* Progress & Stop Row */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-[11.5px] text-text-3 font-medium">
            <TextShimmer text={statusLabel} />
            <span className="tabular-nums font-mono">{searchesLabel}</span>
          </div>

          <div className="flex items-center gap-3 w-full">
            <div className="flex-1 h-1 bg-white/[0.04] rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-500 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <button
              type="button"
              onClick={handleCancel}
              className="p-1 rounded-full hover:bg-white/5 text-text-3 hover:text-error transition-colors shrink-0 cursor-pointer"
              title="Stop Research"
            >
              <div className="w-5 h-5 rounded-full border border-white/20 flex items-center justify-center bg-white/5 hover:border-white/40">
                <div className="w-1.5 h-1.5 bg-[#ececec] rounded-sm" />
              </div>
            </button>
          </div>
        </div>

        {/* Metrics details drawer trigger & sources active snippet */}
        {(state.round || state.sourceCount || state.findingCount) && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {metric(state.round ? `Round ${state.round}` : undefined, "", RotateCw)}
            {metric(
              state.sourceCount,
              state.sourceCount === 1 ? "source" : "sources",
              Globe,
              sources.length > 0 ? () => setDetailTab("sources") : undefined
            )}
            {metric(
              state.findingCount,
              state.findingCount === 1 ? "finding" : "findings",
              FileText,
              findings.length > 0 ? () => setDetailTab("findings") : undefined
            )}
          </div>
        )}

        {state.currentSource && (
          <div className="skeleton-sheen mt-2.5 rounded-lg border border-white/[0.04] bg-white/[0.01] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.01)]">
            <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.08em] text-text-4">
              <BookOpen size={11} strokeWidth={1.7} aria-hidden="true" />
              Reading source
            </div>
            <div className="mt-1 truncate text-[11.5px] font-medium text-text-2">
              <TextShimmer text={state.currentSource.title || state.currentSource.url} className="font-medium text-text-2" />
            </div>
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
