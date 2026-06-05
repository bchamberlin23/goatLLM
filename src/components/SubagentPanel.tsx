import { useMemo } from "react";
import { useChatStore, type ToolCallEntry } from "../stores/chat";
import { InlineToolCall } from "./InlineToolCall";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ArrowLeft, Bot } from "lucide-react";

export function SubagentPanel() {
  const closeSubagentPanel = useChatStore((s) => s.closeSubagentPanel);
  const activeSubagentToolCallId = useChatStore((s) => s.activeSubagentToolCallId);
  const messages = useChatStore((s) => s.messages);

  // Find the transcript across all conversations
  const { transcript, toolCall } = useMemo(() => {
    let foundTc: ToolCallEntry | undefined;
    for (const msgs of Object.values(messages)) {
      for (const m of msgs) {
        const tc = m.toolCalls?.find(
          (t) => t.toolCallId === activeSubagentToolCallId,
        );
        if (tc) {
          foundTc = tc;
          break;
        }
      }
      if (foundTc) break;
    }
    return {
      transcript: foundTc?.subagentTranscript ?? [],
      toolCall: foundTc,
    };
  }, [messages, activeSubagentToolCallId]);

  const isRunning = toolCall?.state === "running";
  const taskText = transcript.find((e) => e.role === "user")?.content ?? "Task details not available";
  const summary = toolCall?.output != null ? String(toolCall.output) : null;

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      {/* Top bar with back arrow */}
      <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-hairline bg-white/[0.025]">
        <button
          className="control-pill flex items-center gap-1.5 px-2 py-1.5 -ml-2 rounded-md transition-colors"
          onClick={closeSubagentPanel}
          aria-label="Back to conversation"
        >
          <ArrowLeft size={15} strokeWidth={1.75} />
          <span className="text-[12.5px]">Back</span>
        </button>
        <div className="flex items-center gap-2 ml-1">
          <Bot size={15} strokeWidth={1.75} className="text-accent" />
          <span className="text-[13px] font-medium text-text-1">Subagent</span>
          {isRunning && (
            <span className="text-[10.5px] text-accent bg-accent/10 px-2 py-0.5 rounded-full font-medium animate-pulse">
              Running
            </span>
          )}
        </div>
        <span className="text-[12px] text-text-4 truncate ml-2 flex-1 min-w-0">
          {taskText}
        </span>
      </div>

      {/* Transcript body */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4 flex flex-col gap-4">
        {transcript.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-[13px] text-text-4">Waiting for subagent to start...</span>
          </div>
        ) : (
          transcript.map((entry, i) => (
            <div key={i} className="flex flex-col gap-2">
              {/* Role label */}
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-4">
                {entry.role === "user" ? "Task" : "Subagent"}
              </div>

              {/* Text content */}
              {entry.content && (
                <div className="text-[13px] text-text-2 leading-relaxed whitespace-pre-wrap">
                  {entry.role === "assistant" ? (
                    <MarkdownRenderer content={entry.content} />
                  ) : (
                    entry.content
                  )}
                </div>
              )}

              {/* Tool calls */}
              {entry.toolCalls?.map((stc) => {
                const tcEntry: ToolCallEntry = {
                  toolCallId: stc.toolCallId,
                  toolName: stc.toolName,
                  input: stc.input,
                  output: stc.output,
                  state: stc.state,
                };
                return (
                  <div key={stc.toolCallId} className="ml-1">
                    <InlineToolCall tc={tcEntry} />
                  </div>
                );
              })}

              {/* Show summary output at bottom */}
              {summary && i === transcript.length - 1 && entry.role === "assistant" && (
                <div className="mt-2 border-t border-hairline pt-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-accent mb-2">
                    Summary (sent to parent)
                  </div>
                  <div className="soft-card text-[12.5px] text-text-3 leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-auto rounded-lg p-3">
                    {summary}
                  </div>
                </div>
              )}
            </div>
          ))
        )}

        {/* Live shimmer when running and last entry is empty */}
        {isRunning && transcript.length > 0 && (() => {
          const last = transcript[transcript.length - 1];
          if (last.role === "assistant" && !last.content && (!last.toolCalls || last.toolCalls.length === 0)) {
            return (
              <div className="animate-pulse">
                <div className="h-3 bg-white/5 rounded w-3/4" />
              </div>
            );
          }
          return null;
        })()}
      </div>
    </div>
  );
}
