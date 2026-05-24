/**
 * Tool registry — the composed sets that other modules consume.
 *
 * READ_ONLY_TOOLS and WRITE_TOOLS live in builtins/. This module just
 * combines them into the named bundles used by the system prompt and by
 * the agent loop:
 *
 * - ALL_TOOLS: full set when a workspace is active.
 * - PLAN_TOOLS: read-only workspace inspection (plan mode flips on Build).
 * - RESEARCH_TOOLS: chat-mode research (web_search + browser_*).
 * - CHAT_TOOLS: lightweight web_search only, when Tavily is configured.
 *
 * Lifted out of src/lib/tools.ts during the registry split. PR1 (MCP)
 * and PR2 (subagents) extend this surface without touching the builtins.
 */
import { READ_ONLY_TOOLS } from "./builtins/read";
import { WRITE_TOOLS } from "./builtins/write";
import type { ToolSet } from "ai";

export { READ_ONLY_TOOLS, WRITE_TOOLS };

/**
 * Render a ToolSet into the bullet list the system prompt embeds.
 *
 * Single source of truth for "what tools does the model see?" — both the
 * registered execute() surface AND the prompt list now derive from the
 * same `tool({...})` definitions, killing the drift bug where new tools
 * shipped without a matching prompt entry.
 *
 * Tools registered at runtime (PR1's MCP servers, PR2's spawn_subagent)
 * appear in the prompt the moment they're added to the active set —
 * `buildAgentSystemPrompt` calls this with whatever ToolSet is about to
 * be handed to streamText.
 */
export function formatToolsForPrompt(tools: ToolSet): string {
  return Object.entries(tools)
    .map(([name, def]) => {
      const description =
        (def as { description?: string } | undefined)?.description ?? "(no description)";
      return `- ${name}: ${description}`;
    })
    .join("\n");
}

/**
 * Full tool set available when a workspace is active.
 * Read-only tools execute immediately; write tools require user approval.
 */
export const ALL_TOOLS = {
  ...READ_ONLY_TOOLS,
  ...WRITE_TOOLS,
};

/**
 * Tools available to chat-mode research: web search + page fetch + selector
 * extract. No workspace tools — chat mode is workspace-less by definition.
 * Used by InputBar when researchMode is on without agent mode.
 */
export const RESEARCH_TOOLS = {
  web_search: READ_ONLY_TOOLS.web_search,
  browser_fetch: WRITE_TOOLS.browser_fetch,
  browser_extract: WRITE_TOOLS.browser_extract,
};

/**
 * Plan-mode tool set: read-only workspace inspection only. The agent can
 * navigate the codebase, run git status/log, and search semantically, but
 * cannot write files, edit files, or execute shell commands. The user
 * presses "Build" to flip the agent into normal write mode for execution.
 */
export const PLAN_TOOLS = {
  ...READ_ONLY_TOOLS,
};

/**
 * Lightweight chat-mode tool set: just web_search. Lets the model
 * opportunistically check the web (current events, fresh facts) without
 * the heavy research preamble or 30-round budget that RESEARCH_TOOLS implies.
 * Only attached when the user has a Tavily key configured.
 */
export const CHAT_TOOLS = {
  web_search: READ_ONLY_TOOLS.web_search,
};
