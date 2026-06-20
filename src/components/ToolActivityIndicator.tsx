import { useMemo } from "react";
import { useChatStore } from "../stores/chat";
import { presentTool } from "./InlineToolCall";
import { Shimmer } from "./ThinkingIndicator";
import { shouldShowToolCall } from "../lib/tool-visibility";

/** Stable empty array reference to avoid re-renders. */
const EMPTY_ARRAY: never[] = [];

/**
 * Floating status bar that shows what the agent is currently doing.
 * Appears above the input bar when a tool is running in agent or design mode.
 * Shows present tense ("Writing...", "Reading...") while running,
 * and past tense ("Wrote", "Read") briefly after completion.
 */
export function ToolActivityIndicator() {
  const activeId = useChatStore((s) => s.activeId);
  const agentMode = useChatStore((s) => s.agentMode);
  const designMode = useChatStore((s) => s.designMode);
  const isStreaming = useChatStore((s) => activeId ? s.isConversationStreaming(activeId) : false);

  // Get the latest message count to detect changes without subscribing to the full array
  const messageCount = useChatStore((s) => {
    if (!activeId) return 0;
    return (s.messages[activeId] ?? EMPTY_ARRAY).length;
  });

  // Get the latest tool call state directly from the store in the render
  // This avoids subscribing to the entire messages array
  const activity = useMemo(() => {
    if (!isStreaming || !activeId || messageCount === 0) return null;
    if (!agentMode && !designMode) return null;
    const renderMode = designMode ? "design" : agentMode ? "agent" : "chat";

    // Read directly from store to avoid stale closure
    const msgs = useChatStore.getState().messages[activeId] ?? EMPTY_ARRAY;

    // Find the most recent running tool call across all messages
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i];
      if (!msg.toolCalls) continue;

      // Check tool calls in reverse order (most recent first)
      for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
        const tc = msg.toolCalls[j];
        if (tc.state === "running" && shouldShowToolCall(tc, renderMode)) {
          const pres = presentTool(tc);
          const label = pres.target
            ? `${pres.runningVerb} ${pres.target}`
            : pres.runningVerb;
          return { label, icon: pres.icon, isRunning: true };
        }
      }
    }

    return null;
    // messageCount changes when messages are added/removed, which is when we need to re-check
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageCount, isStreaming, agentMode, designMode, activeId]);

  if (!activity) return null;

  return (
    <div className="motion-status-in flex w-full max-w-[720px] items-center justify-center px-1 py-1.5">
      <div className="liquid-surface flex items-center gap-2.5 px-4 py-1.5 rounded-full shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
        </span>
        <span className="shrink-0 text-text-3">{activity.icon}</span>
        <Shimmer text={activity.label} className="text-[12.5px] font-medium text-text-2" />
      </div>
    </div>
  );
}
