import { useMemo } from "react";
import { useChatStore } from "../stores/chat";
import { presentTool } from "./InlineToolCall";
import { Shimmer } from "./ThinkingIndicator";

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
  const messages = useChatStore((s) => (activeId ? s.messages[activeId] : []));
  const isStreaming = useChatStore((s) => activeId ? s.isConversationStreaming(activeId) : false);

  const activity = useMemo(() => {
    if (!isStreaming || !messages || messages.length === 0) return null;

    // Only show in agent or design mode
    if (!agentMode && !designMode) return null;

    // Find the most recent running tool call across all messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg.toolCalls) continue;

      // Check tool calls in reverse order (most recent first)
      for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
        const tc = msg.toolCalls[j];
        if (tc.state === "running") {
          const pres = presentTool(tc);
          const label = pres.target
            ? `${pres.runningVerb} ${pres.target}`
            : pres.runningVerb;
          return { label, isRunning: true };
        }
      }
    }

    return null;
  }, [messages, isStreaming, agentMode, designMode]);

  if (!activity) return null;

  return (
    <div className="flex items-center justify-center py-1.5 px-3">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#f59e42] opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#f59e42]" />
        </span>
        <Shimmer text={activity.label} className="text-[12.5px] font-medium text-[#d5d5d5]" />
      </div>
    </div>
  );
}
