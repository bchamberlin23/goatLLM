import { tool } from "ai";
import { z } from "zod";

import { useChatStore } from "../../../stores/chat";

export const THREAD_TOOLS = {
  create_agent_thread: tool({
    description:
      "Create a real agent conversation thread in the sidebar with a saved seed prompt. " +
      "Use ONLY when the user explicitly asks you to create, make, or spin up one or more thread(s). " +
      "Do not use this for ordinary delegation or parallel work; use spawn_subagent for that.",
    inputSchema: z.object({
      title: z
        .string()
        .optional()
        .describe("Short sidebar title for the new thread. If omitted, goatLLM derives one from the prompt."),
      prompt: z
        .string()
        .describe("The exact seed prompt to save as the new thread's first user message."),
      workspace_path: z
        .string()
        .optional()
        .describe("Optional workspace path for the thread. Defaults to the current agent workspace."),
    }),
    execute: ({ title, prompt, workspace_path }) => {
      try {
        const created = useChatStore.getState().createAgentThread({
          title,
          prompt,
          workspacePath: workspace_path,
        });
        return [
          `Created agent thread "${created.title}" (${created.conversationId}).`,
          `Workspace: ${created.workspacePath}`,
          "The seed prompt is saved as the first user message in that thread.",
        ].join("\n");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: ${message}`;
      }
    },
  }),
};
