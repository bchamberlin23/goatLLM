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
import { TODO_TOOLS } from "./builtins/todo";
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
  ...TODO_TOOLS,
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
  read_attachment: READ_ONLY_TOOLS.read_attachment,
  search_attachment: READ_ONLY_TOOLS.search_attachment,
  load_skill: READ_ONLY_TOOLS.load_skill,
  manage_memory: WRITE_TOOLS.manage_memory,
};

/**
 * Plan-mode tool set: read-only workspace inspection only. The agent can
 * navigate the codebase, run git status/log, and search semantically, but
 * cannot write files, edit files, or execute shell commands. The user
 * presses "Build" to flip the agent into normal write mode for execution.
 */
export const PLAN_TOOLS = {
  ...READ_ONLY_TOOLS,
  ...TODO_TOOLS,
};

/**
 * Lightweight chat-mode tool set: web_search plus attachment navigation.
 * Lets the model opportunistically check the web (current events, fresh
 * facts) without the heavy research preamble or 30-round budget that
 * RESEARCH_TOOLS implies. Web search only attaches when a backend is
 * configured; the attachment tools are always available so a user who
 * uploads a 600-page book can have the model navigate it.
 */
export const CHAT_TOOLS = {
  web_search: READ_ONLY_TOOLS.web_search,
  read_attachment: READ_ONLY_TOOLS.read_attachment,
  search_attachment: READ_ONLY_TOOLS.search_attachment,
  load_skill: READ_ONLY_TOOLS.load_skill,
  manage_memory: WRITE_TOOLS.manage_memory,
};

/**
 * Attachment-navigation tools available to chat mode even when the user
 * has no web-search backend configured. Used so a model can always pull
 * sections from an uploaded book/paper without needing Tavily.
 */
export const ATTACHMENT_TOOLS = {
  read_attachment: READ_ONLY_TOOLS.read_attachment,
  search_attachment: READ_ONLY_TOOLS.search_attachment,
  load_skill: READ_ONLY_TOOLS.load_skill,
};

/**
 * Minimal bundle exposing just `load_skill` — attached in plain chat (no web
 * backend, no attachments) when there are model-invocable skills available,
 * so the model can pull a skill on demand (pi-style progressive disclosure).
 */
export const SKILL_TOOLS = {
  load_skill: READ_ONLY_TOOLS.load_skill,
};

/**
 * Code-execution tools surfaced in chat mode behind an explicit Settings
 * toggle. `run_python` shells to python3 (user must have it installed);
 * `run_javascript` runs in a sandboxed Function. Both gate on
 * withApproval so the user has to confirm each call.
 */
export const CODE_EXEC_TOOLS = {
  run_python: WRITE_TOOLS.run_python,
  run_javascript: WRITE_TOOLS.run_javascript,
};
