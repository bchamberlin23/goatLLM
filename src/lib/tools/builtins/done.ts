/**
 * done — signals that the agent has completed its task.
 *
 * The agent loop exits when this tool is called instead of relying on
 * ambiguous finishReason heuristics. The model MUST call this tool when
 * it has finished all work.
 */
import { tool } from "ai";
import { z } from "zod";

export const done = tool({
  description:
    "Call this when you have finished the task. Provide a brief summary of what was accomplished. " +
    "You MUST call this tool to end your turn — do not just stop generating.",
  inputSchema: z.object({
    summary: z.string().describe("Brief summary of what was accomplished."),
  }),
  execute: async ({ summary }: { summary: string }) => {
    return { done: true, summary };
  },
});
