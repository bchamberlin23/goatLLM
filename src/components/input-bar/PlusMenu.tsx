import type { LucideIcon } from "lucide-react";
import { Image as ImageIcon, ListChecks, Plus, Target, Telescope, Upload, Wand2 } from "lucide-react";
import type { PlusMenuVisibility, ProductFeatureFlags } from "../../stores/chat";

type ModeKey = "chat" | "design" | "agent";

interface MenuOption {
  icon: LucideIcon;
  label: string;
  description?: string;
  active?: boolean;
  onClick: () => void;
}

interface PlusMenuProps {
  open: boolean;
  activeModeKey: ModeKey;
  agentMode: boolean;
  designMode: boolean;
  featureFlags: ProductFeatureFlags;
  plusMenuVisibility: PlusMenuVisibility;
  pursueGoalMode: boolean;
  planMode: boolean;
  researchMode: boolean;
  searchAvailable: boolean;
  showSkills: boolean;
  onOpenChange: (open: boolean) => void;
  onAttach: () => void;
  onTogglePursueGoal: () => void;
  onOpenImageGen: () => void;
  onTogglePlanMode: () => void;
  onToggleResearchMode: () => void;
  onOpenSkills: () => void;
}

export function PlusMenu({ open, activeModeKey, agentMode, designMode, featureFlags, plusMenuVisibility, pursueGoalMode, planMode, researchMode, searchAvailable, showSkills, onOpenChange, onAttach, onTogglePursueGoal, onOpenImageGen, onTogglePlanMode, onToggleResearchMode, onOpenSkills }: PlusMenuProps) {
  if (designMode) return null;

  const closeThen = (action: () => void) => () => {
    onOpenChange(false);
    action();
  };

  const options: MenuOption[] = [
    ...(plusMenuVisibility[activeModeKey]?.upload !== false ? [{ icon: Upload, label: "Upload file", onClick: closeThen(onAttach) }] : []),
    ...(featureFlags.pursueGoal && plusMenuVisibility[activeModeKey]?.pursueGoal !== false ? [{ icon: Target, label: pursueGoalMode ? "Pursue Goal — on" : "Pursue Goal", description: pursueGoalMode ? "Your next message becomes an autonomous goal run." : "Plan, inspect, execute, iterate, and verify.", active: pursueGoalMode, onClick: closeThen(onTogglePursueGoal) }] : []),
    ...(featureFlags.imageGeneration && plusMenuVisibility[activeModeKey]?.image !== false ? [{ icon: ImageIcon, label: "Generate image", description: "Create image artifacts from a prompt.", onClick: closeThen(onOpenImageGen) }] : []),
    ...(agentMode && plusMenuVisibility[activeModeKey]?.plan !== false ? [{ icon: ListChecks, label: planMode ? "Plan mode — on" : "Plan mode", description: planMode ? "Read-only investigation. Toggle off to write." : "Read-only investigation, then a Build button.", active: planMode, onClick: closeThen(onTogglePlanMode) }] : []),
    ...(((agentMode || searchAvailable) && plusMenuVisibility[activeModeKey]?.research !== false) ? [{ icon: Telescope, label: researchMode ? "Deep Research — on" : "Deep Research", description: researchMode ? "Applies to your next message, then resets." : "Multi-step web research with citations.", active: researchMode, onClick: closeThen(onToggleResearchMode) }] : []),
    ...(showSkills && plusMenuVisibility[activeModeKey]?.skills !== false ? [{ icon: Wand2, label: "Choose skills", onClick: closeThen(onOpenSkills) }] : []),
  ];

  return (
    <>
      <button onClick={() => onOpenChange(!open)} className="control-icon w-7 h-7 rounded-full flex items-center justify-center transition-colors" aria-label="Attach or add" aria-expanded={open} type="button"><Plus size={16} strokeWidth={2} aria-hidden="true" /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-[80]" onClick={() => onOpenChange(false)} />
          <div className="popover-surface motion-popover-in absolute bottom-full left-0 mb-2 w-64 rounded-xl p-1.5 z-[90] origin-bottom-left">
            {options.map((option) => (
              <button key={option.label} onClick={option.onClick} className={["motion-row flex items-start gap-2.5 w-full px-2.5 py-2 rounded-md text-[13px] transition-colors duration-[120ms] text-left", option.active ? "bg-white/[0.06] text-text-1" : "text-[#ececec] hover:bg-white/[0.065]"].join(" ")} type="button">
                <option.icon size={14} strokeWidth={1.75} className={["shrink-0 mt-0.5", option.active ? "text-text-2" : "text-[#c9c9c9]"].join(" ")} />
                <div className="flex flex-col min-w-0 flex-1"><span className="truncate">{option.label}</span>{option.description && <span className="text-[11px] text-[#b4b4b4] truncate leading-tight mt-0.5">{option.description}</span>}</div>
                {option.active && <span aria-hidden className="motion-pop-in shrink-0 mt-1.5 h-1.5 w-1.5 rounded-full bg-accent" />}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
