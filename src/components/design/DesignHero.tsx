import { useMemo } from "react";
import { useChatStore } from "../../stores/chat";
import {
  listSkillsByScenario,
  type Skill,
  type SkillScenario,
} from "../../lib/design/skills";
import {
  Layout,
  Megaphone,
  Activity,
  Code,
  Lightbulb,
  Wallet,
  Users,
  User,
  Sparkles,
  Tag,
  GraduationCap,
} from "lucide-react";

/**
 * Design-mode empty state. Replaces the welcome message hero when the user
 * has no active conversation but is in design mode. Cards are grouped by
 * scenario; clicking one selects the skill and persists the choice. The
 * actual brief gets typed into the InputBar afterwards.
 */
export function DesignHero() {
  const activeSkillId = useChatStore((s) => s.activeSkillId);
  const setActiveSkill = useChatStore((s) => s.setActiveSkill);

  const grouped = useMemo(() => listSkillsByScenario(), []);

  // Order scenarios by what most users will reach for first.
  const scenarioOrder: SkillScenario[] = [
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

  const scenarioMeta: Record<SkillScenario, { label: string; Icon: typeof Layout }> = {
    design: { label: "Design", Icon: Layout },
    marketing: { label: "Marketing", Icon: Megaphone },
    product: { label: "Product", Icon: Lightbulb },
    operation: { label: "Operations", Icon: Activity },
    engineering: { label: "Engineering", Icon: Code },
    finance: { label: "Finance", Icon: Wallet },
    hr: { label: "HR", Icon: Users },
    sales: { label: "Sales", Icon: Tag },
    education: { label: "Education", Icon: GraduationCap },
    personal: { label: "Personal", Icon: User },
  };

  return (
    <div className="motion-surface-in w-full max-w-[920px] mx-auto px-6 py-10">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-[22px] font-medium text-text-1">
            Pick a surface to design.
          </h1>
          <p className="mt-1.5 text-[13px] text-text-3 max-w-[60ch]">
            Each skill ships a seed template, brand checklist, and anti-slop
            rules the model reads before it draws a single pixel. Pick one,
            then type the brief.
          </p>
        </div>
        {activeSkillId && (
          <span className="text-[11px] text-text-4 uppercase tracking-wider">
            <Sparkles size={11} strokeWidth={2} className="inline mr-1 -mt-px text-accent" aria-hidden />
            Skill selected
          </span>
        )}
      </header>

      <div className="space-y-6">
        {scenarioOrder.map((scenario) => {
          const skills = grouped[scenario];
          if (!skills || skills.length === 0) return null;
          const { label, Icon } = scenarioMeta[scenario];
          return (
            <section key={scenario} aria-labelledby={`design-hero-${scenario}`}>
              <h2
                id={`design-hero-${scenario}`}
                className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.12em] font-semibold text-text-4 mb-2.5"
              >
                <Icon size={11} strokeWidth={2} aria-hidden />
                {label}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {skills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    active={activeSkillId === skill.id}
                    onSelect={() => setActiveSkill(skill.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

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
      {/* Tiny visual rhythm — no real preview yet, just a uniform card-sized
          sketch hinting at the layout the skill ships. The skill's actual
          render aspect ratio (e.g. 9/19.5 for a phone) is honored *inside*
          the SVG sketch, not on the card itself, so cards stay a consistent
          height across the grid. */}
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

/**
 * Tiny SVG sketch hinting at the skill's layout. Not a real preview —
 * just enough for a card to feel like a "thing" instead of an empty box.
 * Stays in goatLLM's neutral surface vocabulary, no color leakage.
 */
function SkillPreviewSketch({ skill }: { skill: Skill }) {
  const stroke = "rgba(255,255,255,0.16)";
  const fill = "rgba(255,255,255,0.04)";

  if (skill.mode === "image") {
    return (
      <svg width="100%" height="100%" viewBox="0 0 160 100" preserveAspectRatio="none" aria-hidden>
        <rect x="10" y="10" width="100" height="80" rx="4" fill={fill} stroke={stroke} />
        <circle cx="130" cy="50" r="12" fill="none" stroke={stroke} strokeWidth="1.5" />
        <path d="M122 40l8 10h-16l4-6 4 4z" fill={stroke} />
        <rect x="10" y="10" width="100" height="16" rx="4" fill="rgba(255,255,255,0.08)" />
      </svg>
    );
  }

  if (skill.mode === "video") {
    return (
      <svg width="100%" height="100%" viewBox="0 0 160 100" preserveAspectRatio="none" aria-hidden>
        <rect x="20" y="16" width="120" height="68" rx="4" fill={fill} stroke={stroke} />
        <polygon points="78,38 78,62 98,50" fill={stroke} />
        <rect x="20" y="84" width="120" height="4" rx="1" fill="rgba(255,255,255,0.12)" />
      </svg>
    );
  }

  if (skill.mode === "audio") {
    return (
      <svg width="100%" height="100%" viewBox="0 0 160 100" preserveAspectRatio="none" aria-hidden>
        <circle cx="80" cy="50" r="30" fill={fill} stroke={stroke} />
        <path d="M68 38v24M74 32v36M80 28v44M86 32v36M92 38v24" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (skill.mode === "design-system") {
    return (
      <svg width="100%" height="100%" viewBox="0 0 160 100" preserveAspectRatio="none" aria-hidden>
        {[10, 56, 102].map((x) => (
          <g key={x}>
            <rect x={x} y="30" width="40" height="40" rx="4" fill={fill} stroke={stroke} />
            <rect x={x + 4} y="24" width="32" height="3" fill={stroke} />
          </g>
        ))}
        <rect x="6" y="76" width="60" height="8" rx="2" fill={fill} stroke={stroke} />
        <rect x="72" y="76" width="60" height="8" rx="2" fill={fill} stroke={stroke} />
      </svg>
    );
  }

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

  // single-page
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
