import { useEffect, useRef, useState } from "react";
import { Palette, Compass, Check } from "lucide-react";
import { useChatStore } from "../../stores/chat";
import {
  listDesignSystemsByCategory,
  type DesignSystem,
  type DesignSystemCategory,
} from "../../lib/design/systems";
import { listDirections, type Direction } from "../../lib/design/directions";
import { SurfacePill } from "./SurfacePill";

/**
 * Three pills the user sees in design mode, sitting where AgentPill lives in
 * agent mode. Surface = which skill (web prototype, deck, dashboard, etc.).
 * Design system = which DESIGN.md the model reads. Direction = which OKLch
 * palette + font stack to bind into :root.
 *
 * Visual contract: same surface vocabulary as AgentPill — pill height,
 * hairline border, amber when active.
 */

export function DesignPills() {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <SurfacePill />
      <DesignSystemPill />
      <DirectionPill />
    </div>
  );
}

// ── DesignSystemPill ────────────────────────────────────────────────────

function DesignSystemPill() {
  const activeId = useChatStore((s) => s.activeDesignSystemId);
  const setActive = useChatStore((s) => s.setActiveDesignSystem);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const grouped = listDesignSystemsByCategory();
  const active = grouped.starter
    .concat(...Object.values(grouped))
    .find((s) => s.id === activeId);

  useClickAway(ref, open, () => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Design system — ${active?.name ?? "none"}`}
        className="flex items-center gap-1.5 px-2 h-7 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] text-[12px] font-medium text-[#d5d5d5] transition-colors shrink-0"
      >
        {active ? (
          <span
            className="inline-flex h-3.5 w-3.5 rounded-sm overflow-hidden border border-white/10"
            aria-hidden
          >
            <span style={{ background: active.swatches[0], width: "25%" }} />
            <span style={{ background: active.swatches[1], width: "25%" }} />
            <span style={{ background: active.swatches[2], width: "25%" }} />
            <span style={{ background: active.swatches[3], width: "25%" }} />
          </span>
        ) : (
          <Palette size={12} strokeWidth={2} aria-hidden />
        )}
        <span className="max-w-[120px] truncate">{active?.name ?? "Design system"}</span>
      </button>
      {open && (
        <DesignSystemPopover
          activeId={activeId}
          onPick={(id) => {
            setActive(id);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

const SYSTEM_CATEGORY_LABELS: Record<DesignSystemCategory, string> = {
  starter: "Starters",
  ai: "AI & LLM",
  devtools: "Developer tools",
  productivity: "Productivity",
  fintech: "Fintech",
  media: "Media",
  automotive: "Automotive",
  other: "Other",
};

function DesignSystemPopover({
  activeId,
  onPick,
}: {
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  const grouped = listDesignSystemsByCategory();
  const order: DesignSystemCategory[] = [
    "starter",
    "devtools",
    "ai",
    "productivity",
    "fintech",
    "media",
    "automotive",
    "other",
  ];
  return (
    <div
      role="dialog"
      aria-label="Pick a design system"
      className="absolute bottom-full left-0 mb-2 w-[420px] max-h-[420px] overflow-y-auto rounded-xl bg-[#2a2a2c] border border-white/[0.08] shadow-lg shadow-black/40 z-50 animate-[fadeIn_120ms_ease]"
    >
      {order.map((cat) => {
        const list = grouped[cat];
        if (!list || list.length === 0) return null;
        return (
          <section key={cat} className="p-1.5">
            <div className="px-2.5 pt-1 pb-1.5 text-[10px] uppercase tracking-[0.12em] text-[#888] font-semibold">
              {SYSTEM_CATEGORY_LABELS[cat]}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {list.map((s) => (
                <SystemRow
                  key={s.id}
                  system={s}
                  active={activeId === s.id}
                  onPick={() => onPick(s.id)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

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

// ── DirectionPill ──────────────────────────────────────────────────────

function DirectionPill() {
  const activeId = useChatStore((s) => s.activeDirectionId);
  const setActive = useChatStore((s) => s.setActiveDirection);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const directions = listDirections();
  const active = directions.find((d) => d.id === activeId);

  useClickAway(ref, open, () => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Direction — ${active?.name ?? "auto (model picks)"}`}
        className={`flex items-center gap-1.5 px-2 h-7 rounded-full border text-[12px] font-medium transition-colors shrink-0 ${
          active
            ? "bg-[#f59e42]/[0.08] border-[#f59e42]/30 text-[#ececec] hover:bg-[#f59e42]/[0.12]"
            : "bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.06] hover:border-white/[0.12] text-[#d5d5d5]"
        }`}
      >
        {active ? (
          <span
            className="inline-flex h-3.5 w-3.5 rounded-sm overflow-hidden border border-white/10"
            aria-hidden
          >
            <span style={{ background: active.palette.bg, width: "25%" }} />
            <span style={{ background: active.palette.surface, width: "25%" }} />
            <span style={{ background: active.palette.accent, width: "25%" }} />
            <span style={{ background: active.palette.fg, width: "25%" }} />
          </span>
        ) : (
          <Compass size={12} strokeWidth={2} aria-hidden />
        )}
        <span className="max-w-[140px] truncate">
          {active ? active.name.split(" — ")[0] : "Direction"}
        </span>
      </button>
      {open && (
        <DirectionPopover
          activeId={activeId}
          onPick={(id) => {
            setActive(id);
            setOpen(false);
          }}
          onClear={() => {
            setActive(null);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function DirectionPopover({
  activeId,
  onPick,
  onClear,
}: {
  activeId: string | null;
  onPick: (id: Direction["id"]) => void;
  onClear: () => void;
}) {
  const directions = listDirections();
  return (
    <div
      role="dialog"
      aria-label="Pick a visual direction"
      className="absolute bottom-full left-0 mb-2 w-[460px] max-h-[420px] overflow-y-auto rounded-xl bg-[#2a2a2c] border border-white/[0.08] shadow-lg shadow-black/40 z-50 p-2 animate-[fadeIn_120ms_ease]"
    >
      <div className="flex items-center justify-between px-1.5 pb-1.5">
        <div className="text-[10px] uppercase tracking-[0.12em] text-[#888] font-semibold">
          Visual direction
        </div>
        {activeId && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10.5px] text-[#a0a0a0] hover:text-[#ececec] transition-colors"
          >
            Auto (let model decide)
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-1">
        {directions.map((d) => (
          <DirectionRow
            key={d.id}
            direction={d}
            active={activeId === d.id}
            onPick={() => onPick(d.id)}
          />
        ))}
      </div>
    </div>
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

// ── shared ─────────────────────────────────────────────────────────────

function useClickAway(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  fn: () => void,
) {
  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) fn();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") fn();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [active, fn, ref]);
}
