import { Check, Wand2, X } from "lucide-react";
import type { Skill } from "../../lib/skills";

interface SkillPickerProps {
  open: boolean;
  activeId: string | null;
  activeSkillNames: string[];
  pendingSkills: string[];
  skillsForCurrentMode: Skill[];
  discoveredSkillCount: number;
  disabledSkills: Set<string>;
  agentMode: boolean;
  showChips?: boolean;
  onPendingSkillsChange: (next: string[] | ((current: string[]) => string[])) => void;
  onConversationSkillsChange: (conversationId: string, skillNames: string[]) => void;
  onClose: () => void;
}

export function SkillPicker({ open, activeId, activeSkillNames, pendingSkills, skillsForCurrentMode, discoveredSkillCount, disabledSkills, agentMode, showChips = true, onPendingSkillsChange, onConversationSkillsChange, onClose }: SkillPickerProps) {
  const displayedSkills = activeId ? activeSkillNames : pendingSkills;

  return (
    <>
      {showChips && displayedSkills.length > 0 && (
        <div className="mb-2 flex items-center gap-1.5 flex-wrap">
          {displayedSkills.map((name) => (
            <span key={name} className="inline-flex items-center gap-1.5 pl-1.5 pr-1 py-0.5 rounded-full bg-accent/10 border border-accent/25 text-[12px] text-[#d4944a] shadow-[inset_0_1px_0_rgba(245,158,66,0.08)]">
              <Wand2 size={10} strokeWidth={1.75} className="shrink-0 opacity-80" aria-hidden="true" />
              <span>{name}</span>
              <button onClick={() => { if (activeId) onConversationSkillsChange(activeId, activeSkillNames.filter((skillName) => skillName !== name)); else onPendingSkillsChange((current) => current.filter((skillName) => skillName !== name)); }} className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full hover:bg-accent/20 transition-colors text-[#d4944a]/60 hover:text-[#d4944a]" aria-label={"Remove " + name + " skill"} type="button"><X size={9} strokeWidth={2.5} /></button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-[80]" onClick={onClose} />
          <div className="popover-surface motion-popover-in absolute bottom-full left-0 mb-2 w-72 rounded-xl p-1.5 z-[90] origin-bottom-left">
            <div className="flex items-center gap-2 px-2.5 py-2 mb-0.5"><Wand2 size={13} strokeWidth={1.75} className="text-accent shrink-0" aria-hidden="true" /><span className="text-[12px] font-semibold text-text-1">Choose skills</span></div>
            {skillsForCurrentMode.filter((skill) => !disabledSkills.has(skill.name)).map((skill) => {
              const selected = pendingSkills.includes(skill.name);
              const modeColor = skill.mode === "agent" ? "text-[#d4944a] bg-[#f59e42]/10 border-[#f59e42]/20" : skill.mode === "chat" ? "text-[#7eb8f7] bg-[#3b82f6]/10 border-[#3b82f6]/20" : "text-[#b4a0f7] bg-[#8b5cf6]/10 border-[#8b5cf6]/20";
              return (
                <button key={skill.name} onClick={() => onPendingSkillsChange((current) => selected ? current.filter((name) => name !== skill.name) : [...current, skill.name])} className={["motion-row flex items-start gap-2.5 w-full px-2.5 py-2 rounded-md text-[13px] transition-colors duration-[120ms] text-left", selected ? "bg-white/[0.06] text-text-1" : "text-[#ececec] hover:bg-white/[0.065]"].join(" ")} type="button">
                  <span className={["shrink-0 mt-0.5 w-3.5 h-3.5 rounded flex items-center justify-center transition-all duration-150", selected ? "bg-accent border border-accent/60" : "border border-white/20"].join(" ")}>{selected && <Check size={9} strokeWidth={3} className="motion-pop-in text-[#1a1a1c]" />}</span>
                  <div className="flex-1 min-w-0"><div className="flex items-center gap-1.5 truncate"><span className="truncate">{skill.name}</span><span className={["shrink-0 text-[9px] px-1 py-0.5 rounded border font-medium", modeColor].join(" ")}>{skill.mode}</span></div><div className="text-[11px] text-[#b4b4b4] truncate leading-tight mt-0.5">{skill.description.slice(0, 80)}</div></div>
                </button>
              );
            })}
            {skillsForCurrentMode.length === 0 && <div className="px-2.5 py-3 text-[13px] text-[#a0a0a0]">{discoveredSkillCount > 0 ? "No skills available in " + (agentMode ? "agent" : "chat") + " mode. Switch modes to see other skills." : "No skills discovered. Add skills in Settings."}</div>}
            <div className="border-t border-white/[0.06] mt-1 pt-1"><button onClick={() => { if (activeId) onConversationSkillsChange(activeId, pendingSkills); onClose(); }} className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors bg-accent/15 hover:bg-accent/25 border border-accent/30 text-[#d4944a]" type="button"><Check size={13} strokeWidth={2.5} />Done</button></div>
          </div>
        </>
      )}
    </>
  );
}
