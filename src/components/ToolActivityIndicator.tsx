import { useMemo } from "react";
import { useChatStore } from "../stores/chat";
import { presentTool } from "./InlineToolCall";
import { Shimmer } from "./ThinkingIndicator";
import { shouldShowToolCall } from "../lib/tool-visibility";

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
  const renderMode = designMode ? "design" : agentMode ? "agent" : "chat";

  const runningToolSignature = useChatStore((s) => {
    if (!activeId || !isStreaming || (!agentMode && !designMode)) return "";
    const messages = s.messages[activeId] ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const toolCalls = messages[i].toolCalls;
      if (!toolCalls) continue;
      for (let j = toolCalls.length - 1; j >= 0; j--) {
        const tc = toolCalls[j];
        if (tc.state === "running" && shouldShowToolCall(tc, renderMode)) {
          return `${messages[i].id}:${tc.toolCallId}:${tc.toolName}`;
        }
      }
    }
    return "";
  });

  const activity = useMemo(() => {
    if (!runningToolSignature || !isStreaming || !activeId) return null;
    if (!agentMode && !designMode) return null;
    const msgs = useChatStore.getState().messages[activeId] ?? [];

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
          return { label, icon: pres.icon, iconColor: pres.iconColor, isRunning: true };
        }
      }
    }

    return null;
  }, [runningToolSignature, isStreaming, agentMode, designMode, activeId, renderMode]);

  if (!activity) return null;

  return (
    <div className="motion-status-in flex w-full max-w-[720px] items-center justify-center px-1 py-1.5">
      <div className="liquid-surface flex items-center gap-2 px-3 py-1.5 rounded-lg">
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
        </span>
        <span className={`shrink-0 ${activity.iconColor}`}>{activity.icon}</span>
        <Shimmer text={activity.label} className="text-[12.5px] font-medium text-text-2" />
      </div>
    </div>
  );
}
