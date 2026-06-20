import { useEffect, useMemo, useRef, useState } from "react";
import { Layout, X } from "lucide-react";
import { useChatStore } from "../../stores/chat";
import {
  listSkillsByScenario,
  type Skill,
  type SkillScenario,
} from "../../lib/design/skills";

/**
 * The full DesignHero skill-picker grid rendered inside a centered modal
 * when the user clicks the "Pick a surface" pill in the InputBar footer.
 *
 * Cards match the old DesignHero exactly — aspect-ratio blocks, tiny SVG
 * sketches hinting at the layout, scenario-grouped sections. The user
 * clicks a card, the modal closes, and the selected skill name appears in
 * the trigger pill.
 */
export function SurfacePill() {
  const activeId = useChatStore((s) => s.activeSkillId);
  const setActive = useChatStore((s) => s.setActiveSkill);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const grouped = useMemo(() => listSkillsByScenario(), []);
  const active = useMemo(() => {
    if (!activeId) return undefined;
    for (const list of Object.values(grouped)) {
      const hit = list.find((s) => s.id === activeId);
      if (hit) return hit;
    }
    return undefined;
  }, [activeId, grouped]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Surface — ${active?.name ?? "none picked"}`}
        className={`flex items-center gap-1.5 px-2 h-7 rounded-full border text-[12px] font-medium transition-colors shrink-0 ${
          active
            ? "bg-accent/[0.08] border-accent/30 text-text-1 hover:bg-accent/[0.12]"
            : "control-pill"
        }`}
      >
        <Layout size={12} strokeWidth={2} aria-hidden />
        <span className="max-w-[140px] truncate">
          {active?.name ?? "Pick a surface"}
        </span>
      </button>

      {open && (
        <div className="motion-reveal fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div
            role="dialog"
            aria-label="Pick a surface"
            className="modal-surface motion-surface-in relative w-full max-w-[960px] max-h-[85vh] overflow-y-auto rounded-2xl m-4"
          >
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-surface-3/90 backdrop-blur-xl border-b border-hairline rounded-t-2xl">
              <div>
                <h1 className="text-[18px] font-medium text-text-1">
                  Pick a surface to design.
                </h1>
                <p className="mt-1 text-[12px] text-text-3">
                  Each skill ships a seed template, brand checklist, and anti-slop rules.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="control-icon p-2 rounded-lg transition-colors"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>

            {/* Body — same grid as old DesignHero */}
            <div className="px-6 py-5">
              <SurfaceGrid
                activeSkillId={activeId}
                onPick={(id) => {
                  setActive(id);
                  setOpen(false);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Grid body (extracted from old DesignHero) ──

const SCENARIO_ORDER: SkillScenario[] = [
  "design",
  "marketing",
  "product",
  "operation",
  "engineering",
  "finance",
  "hr",
  "sales",
  "education",
  "personal",
];

const SCENARIO_META: Record<SkillScenario, { label: string }> = {
  design: { label: "Design" },
  marketing: { label: "Marketing" },
  product: { label: "Product" },
  operation: { label: "Operations" },
  engineering: { label: "Engineering" },
  finance: { label: "Finance" },
  hr: { label: "HR" },
  sales: { label: "Sales" },
  education: { label: "Education" },
  personal: { label: "Personal" },
};

function SurfaceGrid({
  activeSkillId,
  onPick,
}: {
  activeSkillId: string | null;
  onPick: (id: string) => void;
}) {
  const grouped = useMemo(() => listSkillsByScenario(), []);

  return (
    <div className="space-y-5">
      {SCENARIO_ORDER.map((scenario) => {
        const skills = grouped[scenario];
        if (!skills || skills.length === 0) return null;
        return (
          <section key={scenario} aria-labelledby={`surface-grid-${scenario}`}>
            <h2
              id={`surface-grid-${scenario}`}
              className="text-[10px] uppercase tracking-[0.12em] font-semibold text-text-4 mb-2.5"
            >
              {SCENARIO_META[scenario].label}
            </h2>
            <div className="grid grid-cols-3 gap-2.5">
              {skills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  active={activeSkillId === skill.id}
                  onSelect={() => onPick(skill.id)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ── Skill card (copied verbatim from old DesignHero) ──

function SkillCard({
  skill,
  active,
  onSelect,
}: {
  skill: Skill;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`soft-card group relative flex flex-col text-left rounded-xl overflow-hidden transition-all ${
        active
          ? "border-accent/60 bg-accent/[0.06] shadow-[0_14px_34px_-28px_rgba(var(--theme-accent-rgb),0.9)]"
          : "hover:border-hairline-strong hover:bg-white/5"
      }`}
    >
      <div
        className="relative w-full bg-sunken border-b border-hairline"
        style={{ aspectRatio: "16/10" }}
      >
        <SkillPreviewSketch skill={skill} />
      </div>
      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-text-1">
            {skill.name}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-text-4 font-mono">
            {skill.mode}
          </span>
        </div>
        <p className="mt-1 text-[11.5px] text-text-3 leading-snug line-clamp-2">
          {skill.description}
        </p>
      </div>
    </button>
  );
}

// ── SVG preview sketches ──

function SkillPreviewSketch({ skill }: { skill: Skill }) {
  const stroke = "rgba(255,255,255,0.16)";
  const fill = "rgba(255,255,255,0.04)";

  if (skill.preview.kind === "deck") {
    return (
      <svg width="100%" height="100%" viewBox="0 0 160 100" preserveAspectRatio="none" aria-hidden>
        <rect x="6" y="14" width="148" height="72" fill={fill} stroke={stroke} />
        <rect x="14" y="22" width="60" height="6" fill={stroke} />
        <rect x="14" y="34" width="100" height="3" fill={fill} />
        <rect x="14" y="40" width="80" height="3" fill={fill} />
        <text x="148" y="92" fill="rgba(255,255,255,0.28)" fontSize="6" fontFamily="monospace" textAnchor="end">01 / 12</text>
      </svg>
    );
  }

  if (skill.preview.kind === "multi-frame") {
    return (
      <svg width="100%" height="100%" viewBox="0 0 160 100" preserveAspectRatio="none" aria-hidden>
        {[10, 60, 110].map((x) => (
          <g key={x}>
            <rect x={x} y={14} width={40} height={72} rx={6} fill={fill} stroke={stroke} />
            <rect x={x + 4} y={20} width={32} height={3} fill={stroke} />
          </g>
        ))}
      </svg>
    );
  }

  return (
    <svg width="100%" height="100%" viewBox="0 0 160 100" preserveAspectRatio="none" aria-hidden>
      <rect x="6" y="6" width="148" height="6" fill={stroke} />
      <rect x="6" y="20" width="80" height="10" fill={stroke} />
      <rect x="6" y="34" width="120" height="3" fill={fill} />
      <rect x="6" y="40" width="100" height="3" fill={fill} />
      <rect x="6" y="52" width="44" height="22" fill={fill} stroke={stroke} />
      <rect x="56" y="52" width="44" height="22" fill={fill} stroke={stroke} />
      <rect x="106" y="52" width="44" height="22" fill={fill} stroke={stroke} />
    </svg>
  );
}
