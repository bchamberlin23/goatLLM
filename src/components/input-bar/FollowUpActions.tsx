import type { ChangeEvent, RefObject } from "react";
import { ListChecks, Mic, StopCircle } from "lucide-react";
import { AgentPill } from "../AgentPill";
import { DesignPills } from "../design/DesignPills";

interface FollowUpActionsProps {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFilesChange: (event: ChangeEvent<HTMLInputElement>) => void;
  showMic: boolean;
  speechListening: boolean;
  onToggleMic: () => void;
  designMode: boolean;
  activeId: string | null;
  agentMode: boolean;
  planMode: boolean;
  onDisablePlanMode: () => void;
}

export function FollowUpActions({ fileInputRef, onFilesChange, showMic, speechListening, onToggleMic, designMode, activeId, agentMode, planMode, onDisablePlanMode }: FollowUpActionsProps) {
  return (
    <>
      <input ref={fileInputRef} type="file" className="hidden" onChange={onFilesChange} multiple tabIndex={-1} />
      {showMic && (
        <button onClick={onToggleMic} className={["control-icon p-1.5 rounded-md transition-colors", speechListening ? "text-[#f59e42] bg-[#f59e42]/10 border-[#f59e42]/25" : ""].join(" ")} aria-label={speechListening ? "Stop dictation" : "Start dictation"} aria-pressed={speechListening} title={speechListening ? "Stop listening" : "Dictate"} type="button">
          {speechListening ? <StopCircle size={15} strokeWidth={1.75} aria-hidden="true" /> : <Mic size={15} strokeWidth={1.75} aria-hidden="true" />}
        </button>
      )}
      {designMode ? (!activeId && <DesignPills />) : <AgentPill />}
      {agentMode && planMode && (
        <button type="button" onClick={onDisablePlanMode} title="Plan mode — read-only investigation. Click to turn off." className="flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-[#f59e42]/10 hover:bg-[#f59e42]/15 border border-[#f59e42]/30 text-[12px] font-medium text-[#f59e42] transition-colors shrink-0">
          <ListChecks size={12} strokeWidth={2} aria-hidden="true" />
          <span>Plan</span>
        </button>
      )}
    </>
  );
}
