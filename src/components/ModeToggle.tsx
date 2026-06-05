import { useCallback } from "react";
import { useChatStore } from "../stores/chat";
import { MessageCircle, Bot, Palette, LayoutGrid } from "lucide-react";

/**
 * Four side-by-side toggle buttons:  [ Chat ] [ Agent ] [ Design ] [ Canvas ]
 *
 * Pure mode switch — the per-mode permission picker (Agent) and the
 * design-system / direction pickers (Design) live elsewhere in the
 * InputBar footer, so the user can configure them without scrolling
 * back up to the empty-state row.
 */
export function ModeToggle() {
  const agentMode = useChatStore((s) => s.agentMode);
  const designMode = useChatStore((s) => s.designMode);
  const notebookMode = useChatStore((s) => s.notebookMode);
  const setAgentMode = useChatStore((s) => s.setAgentMode);
  const setDesignMode = useChatStore((s) => s.setDesignMode);
  const setNotebookMode = useChatStore((s) => s.setNotebookMode);

  const handleChat = useCallback(() => {
    setAgentMode(false);
    setDesignMode(false);
    setNotebookMode(false);
  }, [setAgentMode, setDesignMode, setNotebookMode]);
  const handleAgent = useCallback(() => setAgentMode(true), [setAgentMode]);
  const handleDesign = useCallback(() => setDesignMode(true), [setDesignMode]);
  const handleNotebook = useCallback(() => setNotebookMode(true), [setNotebookMode]);

  const chatActive = !agentMode && !designMode && !notebookMode;
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
      <button
        type="button"
        role="radio"
        aria-checked={notebookMode}
        onClick={handleNotebook}
        title="Canvas mode — a freeform board of documents and runnable code with an AI assistant."
        className={optionClass(notebookMode)}
      >
        <LayoutGrid size={12} strokeWidth={2} aria-hidden="true" />
        <span>Canvas</span>
      </button>
    </div>
  );
}
