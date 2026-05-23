import { useCallback } from "react";
import { useChatStore } from "../stores/chat";
import { MessageCircle, Bot } from "lucide-react";

/**
 * Two side-by-side toggle buttons:  [ Chat ] [ Agent ]
 *
 * Pure mode switch — the per-mode permission picker lives on the AgentPill
 * inside the InputBar footer, so the user can change it without scrolling
 * back up to the empty-state row.
 */
export function ModeToggle() {
  const agentMode = useChatStore((s) => s.agentMode);
  const setAgentMode = useChatStore((s) => s.setAgentMode);

  const handleChat = useCallback(() => setAgentMode(false), [setAgentMode]);
  const handleAgent = useCallback(() => setAgentMode(true), [setAgentMode]);

  return (
    <div
      role="radiogroup"
      aria-label="Conversation mode"
      className="flex items-center gap-1.5 shrink-0"
    >
      <button
        type="button"
        role="radio"
        aria-checked={!agentMode}
        onClick={handleChat}
        title="Chat mode — no tools, just conversation."
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[12px] font-medium transition-colors ${
          !agentMode
            ? "bg-white/[0.09] border-white/10 text-[#ececec]"
            : "bg-white/[0.03] border-white/5 text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/[0.06]"
        }`}
      >
        <MessageCircle size={12} strokeWidth={2} aria-hidden="true" />
        <span>Chat</span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={agentMode}
        onClick={handleAgent}
        title="Agent mode — tool use enabled. Pick a permission level from the pill in the message bar."
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[12px] font-medium transition-colors ${
          agentMode
            ? "bg-white/[0.09] border-white/10 text-[#ececec]"
            : "bg-white/[0.03] border-white/5 text-[#a0a0a0] hover:text-[#ececec] hover:bg-white/[0.06]"
        }`}
      >
        <Bot size={12} strokeWidth={2} aria-hidden="true" />
        <span>Agent</span>
      </button>
    </div>
  );
}
