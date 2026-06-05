import { memo } from "react";
import type { SubagentTranscriptEntry } from "../lib/llm-types";
import type { ToolCallEntry } from "../stores/chat";
import { InlineToolCall } from "./InlineToolCall";

interface SubagentTranscriptViewProps {
  transcript: SubagentTranscriptEntry[];
}

export const SubagentTranscriptView = memo(function SubagentTranscriptView({
  transcript,
}: SubagentTranscriptViewProps) {
  return (
    <div className="soft-card ml-5 mt-2 rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-white/[0.035] border-b border-white/5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-4">
          Subagent conversation
        </span>
      </div>

      <div className="p-3 flex flex-col gap-3 max-h-[500px] overflow-auto">
        {transcript.map((entry, i) => (
          <div key={i}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-4 mb-1.5">
              {entry.role === "user" ? "Task" : "Subagent"}
            </div>

            {entry.content && (
              <div className="text-[12.5px] text-text-2 leading-relaxed whitespace-pre-wrap">
                {entry.content}
              </div>
            )}

            {entry.toolCalls?.map((stc) => {
              const tcEntry: ToolCallEntry = {
                toolCallId: stc.toolCallId,
                toolName: stc.toolName,
                input: stc.input,
                output: stc.output,
                state: stc.state,
              };

              return (
                <div key={stc.toolCallId} className="ml-1 mt-1">
                  <InlineToolCall tc={tcEntry} />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});
