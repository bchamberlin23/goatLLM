import { useCallback } from "react";
import { useChatStore } from "../stores/chat";
import { MessageCircle, Bot, Palette } from "lucide-react";

/**
 * Three side-by-side toggle buttons:  [ Chat ] [ Agent ] [ Design ]
 *
 * Pure mode switch — the per-mode permission picker (Agent) and the
 * design-system / direction pickers (Design) live elsewhere in the
 * InputBar footer, so the user can configure them without scrolling
 * back up to the empty-state row.
 */
export function ModeToggle() {
  const agentMode = useChatStore((s) => s.agentMode);
  const designMode = useChatStore((s) => s.designMode);
  const setAgentMode = useChatStore((s) => s.setAgentMode);
  const setDesignMode = useChatStore((s) => s.setDesignMode);

  const handleChat = useCallback(() => {
    setAgentMode(false);
    setDesignMode(false);
  }, [setAgentMode, setDesignMode]);
  const handleAgent = useCallback(() => setAgentMode(true), [setAgentMode]);
  const handleDesign = useCallback(() => setDesignMode(true), [setDesignMode]);

  const chatActive = !agentMode && !designMode;
  const optionClass = (active: boolean) =>
    `flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[12px] font-medium transition-[background,border-color,color,box-shadow] ${
      active
        ? "bg-accent/10 border-accent/25 text-text-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]"
        : "border-transparent text-text-3 hover:text-text-1 hover:bg-white/[0.055] hover:border-white/[0.08]"
    }`;

  return (
    <div
      role="radiogroup"
      aria-label="Conversation mode"
      className="segmented-shell flex items-center gap-1 p-0.5 rounded-lg shrink-0"
    >
      <button
        type="button"
        role="radio"
        aria-checked={chatActive}
        onClick={handleChat}
        title="Chat mode — no tools, just conversation."
        className={optionClass(chatActive)}
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
        className={optionClass(agentMode)}
      >
        <Bot size={12} strokeWidth={2} aria-hidden="true" />
        <span>Agent</span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={designMode}
        onClick={handleDesign}
        title="Design mode — skill + design-system driven artifact generation."
        className={optionClass(designMode)}
      >
        <Palette size={12} strokeWidth={2} aria-hidden="true" />
        <span>Design</span>
      </button>
    </div>
  );
}
