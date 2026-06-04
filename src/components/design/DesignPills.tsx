import { useEffect, useState } from "react";
import { Palette, Check, X } from "lucide-react";
import { useChatStore } from "../../stores/chat";
import {
  DESIGN_SYSTEMS,
  listDesignSystemsByCategory,
  type DesignSystem,
  type DesignSystemCategory,
} from "../../lib/design/systems";
import { listDirections, type Direction } from "../../lib/design/directions";
import { SurfacePill } from "./SurfacePill";

/**
 * Two pills the user sees in design mode, sitting where AgentPill lives in
 * agent mode. Surface = which skill (web prototype, deck, dashboard, etc.).
 * Visual style = which DESIGN.md the model reads OR which OKLch palette +
 * font stack to bind into :root. One picker, both choices.
 *
 * Visual contract: same surface vocabulary as AgentPill — pill height,
 * hairline border, amber when active.
 */

export function DesignPills() {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <SurfacePill />
      <VisualStylePill />
    </div>
  );
}

// ── VisualStylePill ─────────────────────────────────────────────────────

function VisualStylePill() {
  const activeSystemId = useChatStore((s) => s.activeDesignSystemId);
  const activeDirectionId = useChatStore((s) => s.activeDirectionId);
  const setActiveSystem = useChatStore((s) => s.setActiveDesignSystem);
  const setActiveDirection = useChatStore((s) => s.setActiveDirection);
  const [open, setOpen] = useState(false);

  const grouped = listDesignSystemsByCategory();
  const activeSystem = grouped.starter
    .concat(...Object.values(grouped))
    .find((s) => s.id === activeSystemId);

  const directions = listDirections();
  const activeDirection = directions.find((d) => d.id === activeDirectionId);

  const hasActive = activeSystem != null || activeDirection != null;
  const label = activeSystem?.name ?? activeDirection?.name.split(" — ")[0] ?? "Visual style";

  const handlePickSystem = (id: string) => {
    setActiveSystem(id);
    setActiveDirection(null);
    setOpen(false);
  };

  const handlePickDirection = (id: string) => {
    setActiveDirection(id);
    setActiveSystem(null);
    setOpen(false);
  };

  const handleClear = () => {
    setActiveSystem(null);
    setActiveDirection(null);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Visual style — ${hasActive ? label : "none (model auto-picks)"}`}
        className={`flex items-center gap-1.5 px-2 h-7 rounded-full border text-[12px] font-medium transition-colors shrink-0 ${
          hasActive
            ? "bg-[#f59e42]/[0.08] border-[#f59e42]/30 text-[#ececec] hover:bg-[#f59e42]/[0.12]"
            : "control-pill"
        }`}
      >
        {hasActive ? (
          activeSystem ? (
            <span
              className="inline-flex h-3.5 w-3.5 rounded-sm overflow-hidden border border-white/10"
              aria-hidden
            >
              <span style={{ background: activeSystem.swatches[0], width: "25%" }} />
              <span style={{ background: activeSystem.swatches[1], width: "25%" }} />
              <span style={{ background: activeSystem.swatches[2], width: "25%" }} />
              <span style={{ background: activeSystem.swatches[3], width: "25%" }} />
            </span>
          ) : activeDirection ? (
            <span
              className="inline-flex h-3.5 w-3.5 rounded-sm overflow-hidden border border-white/10"
              aria-hidden
            >
              <span style={{ background: activeDirection.palette.bg, width: "25%" }} />
              <span style={{ background: activeDirection.palette.surface, width: "25%" }} />
              <span style={{ background: activeDirection.palette.accent, width: "25%" }} />
              <span style={{ background: activeDirection.palette.fg, width: "25%" }} />
            </span>
          ) : null
        ) : (
          <Palette size={12} strokeWidth={2} aria-hidden />
        )}
        <span className="max-w-[140px] truncate">{label}</span>
      </button>
      {open && (
        <VisualStylePopover
          activeSystemId={activeSystemId}
          activeDirectionId={activeDirectionId}
          onPickSystem={handlePickSystem}
          onPickDirection={handlePickDirection}
          onClear={handleClear}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// ── VisualStylePopover ──────────────────────────────────────────────────

const SYSTEM_CATEGORY_LABELS: Record<DesignSystemCategory, string> = {
  starter: "Starters",
  ai: "AI & LLM",
  devtools: "Developer tools",
  productivity: "Productivity",
  fintech: "Fintech",
  media: "Media",
  automotive: "Automotive",
  style: "Vibe & Style",
  other: "Other",
};

function VisualStylePopover({
  activeSystemId,
  activeDirectionId,
  onPickSystem,
  onPickDirection,
  onClear,
  onClose,
}: {
  activeSystemId: string | null;
  activeDirectionId: string | null;
  onPickSystem: (id: string) => void;
  onPickDirection: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const grouped = listDesignSystemsByCategory();
  const directions = listDirections();
  const hasActive = activeSystemId != null || activeDirectionId != null;

  const order: DesignSystemCategory[] = [
    "starter",
    "devtools",
    "ai",
    "productivity",
    "fintech",
    "media",
    "automotive",
    "style",
    "other",
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-[fadeIn_120ms_ease]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Pick a visual style"
        className="relative w-full max-w-[760px] max-h-[85vh] overflow-y-auto rounded-2xl bg-[#1c1c1e] border border-white/[0.08] shadow-2xl shadow-black/60 m-4 animate-[fadeIn_150ms_ease]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-[#1c1c1e] border-b border-white/[0.06] rounded-t-2xl">
          <div>
            <h1 className="text-[18px] font-medium text-[#ececec]">
              Visual style
            </h1>
            <p className="mt-1 text-[12px] text-[#a0a0a0]">
              {DESIGN_SYSTEMS.length} design systems + {directions.length} quick directions. Design systems include full palettes, type scales, and motion; directions are lightweight palette + font picks for when you want something fast.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasActive && (
              <button
                type="button"
                onClick={onClear}
                className="text-[12px] text-[#a0a0a0] hover:text-[#ececec] transition-colors px-2"
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-2 rounded-lg text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/[0.06] transition-colors"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {/* Design systems section */}
          <div className="mb-2 px-1 pt-1 pb-2.5 text-[10px] uppercase tracking-[0.12em] text-[#888] font-semibold">
            Design systems
          </div>
          {order.map((cat) => {
            const list = grouped[cat];
            if (!list || list.length === 0) return null;
            return (
              <section key={cat} className="mb-3">
                <div className="px-1 pt-1 pb-2 text-[10px] uppercase tracking-[0.10em] text-[#666] font-medium">
                  {SYSTEM_CATEGORY_LABELS[cat]}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {list.map((s) => (
                    <SystemRow
                      key={s.id}
                      system={s}
                      active={activeSystemId === s.id}
                      onPick={() => onPickSystem(s.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {/* Divider */}
          <div className="my-5 border-t border-white/[0.06]" />

          {/* Directions section */}
          <div className="mb-3 px-1 pt-1 pb-2.5 text-[10px] uppercase tracking-[0.12em] text-[#888] font-semibold">
            Quick directions
          </div>
          <div className="grid grid-cols-1 gap-2">
            {directions.map((d) => (
              <DirectionRow
                key={d.id}
                direction={d}
                active={activeDirectionId === d.id}
                onPick={() => onPickDirection(d.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────

function SystemRow({
  system,
  active,
  onPick,
}: {
  system: DesignSystem;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
        active
          ? "bg-[#f59e42]/[0.10] border border-[#f59e42]/30"
          : "hover:bg-white/[0.06] border border-transparent"
      }`}
    >
      <span className="inline-flex h-5 w-5 rounded shrink-0 overflow-hidden border border-white/10" aria-hidden>
        <span style={{ background: system.swatches[0], width: "25%", height: "100%" }} />
        <span style={{ background: system.swatches[1], width: "25%", height: "100%" }} />
        <span style={{ background: system.swatches[2], width: "25%", height: "100%" }} />
        <span style={{ background: system.swatches[3], width: "25%", height: "100%" }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-[#ececec] font-medium truncate">{system.name}</span>
        <span className="block text-[10.5px] text-[#888] truncate">{system.tagline}</span>
      </span>
      {active && <Check size={12} strokeWidth={2.5} className="text-[#f59e42] shrink-0" aria-hidden />}
    </button>
  );
}

function DirectionRow({
  direction,
  active,
  onPick,
}: {
  direction: Direction;
  active: boolean;
  onPick: () => void;
}) {
  const { palette } = direction;
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex items-stretch gap-3 p-2 rounded-lg text-left transition-colors ${
        active
          ? "bg-[#f59e42]/[0.08] border border-[#f59e42]/30"
          : "hover:bg-white/[0.05] border border-transparent"
      }`}
    >
      <span className="inline-flex w-12 h-12 rounded-md overflow-hidden border border-white/10 shrink-0" aria-hidden>
        <span style={{ background: palette.bg, width: "25%" }} />
        <span style={{ background: palette.surface, width: "25%" }} />
        <span style={{ background: palette.accent, width: "25%" }} />
        <span style={{ background: palette.fg, width: "25%" }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[12.5px] text-[#ececec] font-medium">{direction.name}</span>
          {active && <Check size={11} strokeWidth={2.5} className="text-[#f59e42]" aria-hidden />}
        </span>
        <span className="block mt-0.5 text-[11px] text-[#a0a0a0] line-clamp-2">{direction.mood}</span>
      </span>
    </button>
  );
}
