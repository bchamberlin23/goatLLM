/**
 * spawn_subagent — delegate a complex task to a child agent loop.
 *
 * The tool is created via a factory function (`createSpawnSubagent`) that
 * captures the current depth, abort signals, config, and permission mode
 * in a closure. Each invocation of `agentLoop` gets a fresh instance with
 * the right context — no global state mutation.
 *
 * Subagent tools:
 * - manual mode:  READ_ONLY_TOOLS only
 * - auto / yolo:  READ_ONLY_TOOLS + WRITE_TOOLS
 * - Depth < 2:    also injects spawn_subagent (recursive, one more level)
 *
 * All subagent write tools auto-execute via the approval bypass flag set
 * by withSubagentBypass() around the child agentLoop call. No approval
 * cards appear in the parent UI during subagent execution.
 */
import { tool } from "ai";
import { z } from "zod";
import { useChatStore } from "../../../stores/chat";
import { agentLoop } from "../../agentLoop";
import { withSubagentBypass } from "../approval";
import { READ_ONLY_TOOLS } from "./read";
import { WRITE_TOOLS } from "./write";
import type { LlmConfig, LlmMessage, StreamCallbacks } from "../../llm-types";
import type {
  SubagentToolCall,
  SubagentTranscriptEntry,
} from "../../llm-types";
import type { ToolSet } from "ai";

// ── Tool whitelist ─────────────────────────────────────────────────

function getSubagentTools(hasWrite: boolean): ToolSet {
  const base: ToolSet = { ...READ_ONLY_TOOLS };
  if (hasWrite) Object.assign(base, WRITE_TOOLS);
  return base;
}

// ── System prompt ──────────────────────────────────────────────────

function buildSubagentSystemPrompt(task: string): string {
  return [
    "You are a specialized subagent operating inside goatLLM. Your task:",
    task,
    "",
    "You have access to tools — work autonomously to complete the task and",
    "return a clear, concise summary of your findings. The parent agent will",
    "use your output to continue its work.",
  ].join("\n");
}

// ── Locate tool call in store (mirrors approval.ts) ────────────────

function locateToolCallInStore(toolCallId: string): {
  conversationId: string;
  messageId: string;
} {
  const store = useChatStore.getState();
  for (const [cid, msgs] of Object.entries(store.messages)) {
    for (const m of msgs) {
      if (m.toolCalls?.some((tc) => tc.toolCallId === toolCallId)) {
        return { conversationId: cid, messageId: m.id };
      }
    }
  }
  return { conversationId: "", messageId: "" };
}

// ── Factory ────────────────────────────────────────────────────────

export interface SpawnSubagentContext {
  depth: number;
  parentSignal?: AbortSignal;
  abortSignal?: AbortSignal;
  config: LlmConfig;
  maxToolRounds?: number;
}

export function createSpawnSubagent(ctx: SpawnSubagentContext) {
  return tool({
    description:
      "Spawn a subagent to handle a complex, self-contained task autonomously. " +
      "The subagent runs in its own context with its own tool calls and returns a " +
      "summary. Use for parallelizable research, multi-step code exploration, or " +
      "operations that don't need interactive user approval. Max depth: 2 " +
      "(subagent can spawn at most one more level).",
    inputSchema: z.object({
      task: z
        .string()
        .describe(
          "Detailed description of what the subagent should do. Be specific about " +
            "expected outputs and what constitutes success.",
        ),
      max_tool_rounds: z
        .number()
        .optional()
        .describe("Max tool-call rounds before stopping (default 15, max 30)."),
    }),
    execute: async ({ task, max_tool_rounds }, { toolCallId }) => {
      // ── Depth cap ──────────────────────────────────────────
      if (ctx.depth >= 2) {
        return "Error: maximum subagent depth (2) reached. Cannot spawn further subagents.";
      }

      const store = useChatStore.getState();
      const permissionMode = store.permissionMode;
      // Plan mode restricts the parent to read-only + todo tools. Subagents
      // inherit the same restriction — no write tools, regardless of permission mode.
      const isPlanMode = store.planMode;
      const hasWrite = permissionMode !== "manual" && !isPlanMode;
      const subagentTools = getSubagentTools(hasWrite);

      // Inject recursive spawn_subagent when depth allows
      if (ctx.depth + 1 < 2) {
        (subagentTools as Record<string, unknown>).spawn_subagent =
          createSpawnSubagent({
            ...ctx,
            depth: ctx.depth + 1,
          });
      }

      // ── Transcript ─────────────────────────────────────────
      const transcript: SubagentTranscriptEntry[] = [];
      const assistantTools: SubagentToolCall[] = [];

      transcript.push({ role: "user", content: task });
      const assistantEntry: SubagentTranscriptEntry = {
        role: "assistant",
        content: "",
        toolCalls: assistantTools,
      };
      transcript.push(assistantEntry);

      let fullText = "";

      // ── Messages ────────────────────────────────────────────
      const messages: LlmMessage[] = [{ role: "user", content: task }];

      // ── Callbacks ───────────────────────────────────────────
      const callbacks: StreamCallbacks = {
        onToken: (token) => {
          fullText += token;
          assistantEntry.content += token;
        },
        onToolCall: (tc) => {
          assistantTools.push({
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input: tc.input,
            state: "done",
          });
        },
        onToolResult: (tr) => {
          const found = assistantTools.find(
            (t) => t.toolCallId === tr.toolCallId,
          );
          if (found) found.output = tr.output;
        },
        onToolError: (te) => {
          const found = assistantTools.find(
            (t) => t.toolCallId === te.toolCallId,
          );
          if (found) {
            found.state = "error";
            found.output = te.error;
          }
        },
        onDone: () => {},
        onError: (err) => {
          fullText = `Subagent error: ${err.message}`;
          assistantEntry.content = fullText;
        },
      };

      // ── Run subagent ───────────────────────────────────────
      try {
        await withSubagentBypass(() =>
          agentLoop(messages, buildSubagentSystemPrompt(task), ctx.config, callbacks, {
            depth: ctx.depth + 1,
            parentSignal: ctx.parentSignal,
            abortSignal: ctx.abortSignal,
            tools: subagentTools,
            maxToolRounds: Math.min(max_tool_rounds ?? 15, 30),
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          ctx.parentSignal?.aborted ||
          ctx.abortSignal?.aborted ||
          /abort|cancel/i.test(msg)
        ) {
          return "Subagent cancelled.";
        }
        return `Subagent failed: ${msg}`;
      }

      // ── Store transcript ───────────────────────────────────
      const { conversationId, messageId } = locateToolCallInStore(toolCallId);
      if (conversationId && messageId) {
        useChatStore
          .getState()
          .updateToolCallTranscript(conversationId, messageId, toolCallId, transcript);
      }

      const summary = fullText.trim()
        ? fullText
        : "Subagent completed but produced no text output.";

      return summary;
    },
  });
}
