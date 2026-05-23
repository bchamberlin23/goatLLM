/**
 * System prompt builder.
 *
 * Generates a prompt that tells the model what tools are available,
 * how to use them effectively, and what the workspace context is.
 * Modeled after pi agent's proven prompt structure.
 */

export interface ToolPromptInfo {
  name: string;
  description: string;
  guidelines?: string[];
}

export interface SystemPromptOptions {
  tools: ToolPromptInfo[];
  workspacePath?: string | null;
  guidelines?: string[];
}

/**
 * Build the system prompt for agent mode — includes tool list,
 * usage guidelines, and workspace context.
 */
export function buildAgentSystemPrompt(options: SystemPromptOptions): string {
  const { tools, workspacePath } = options;

  const toolsList = tools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");

  const guidelines = [
    "Be concise in your responses",
    "Show file paths clearly when working with files",
    "Use read_file to examine files instead of bash cat or sed.",
    "Use edit_file for precise changes — old_text must match exactly once.",
    "Use write_file only for new files or complete rewrites.",
    "Use bash for shell operations like ls, grep, find, cargo, npm.",
    "Use search_content to find code patterns.",
  ];
  const guidelinesText = guidelines.map((g) => `- ${g}`).join("\n");

  const workspaceLine = workspacePath
    ? `\nCurrent workspace: ${workspacePath}`
    : "\nNo workspace selected. Select a workspace to enable full tool access.";

  return `You are an expert coding agent operating inside goatLLM. You have access to the workspace filesystem and can read, write, edit, and execute code. Always explain what you're doing before using write/edit/bash tools, and wait for user approval before making changes.

Available tools:
${toolsList}

Guidelines:
${guidelinesText}
${workspaceLine}`;
}

/**
 * Build a minimal system prompt for chat mode — no tool list,
 * just the user's custom instructions if any.
 */
export function buildChatSystemPrompt(userPrompt?: string): string {
  const base = "You are a helpful AI assistant. Be concise, thoughtful, and direct.";
  if (userPrompt) {
    return `${base}\n\n<user_instructions>\n${userPrompt}\n</user_instructions>`;
  }
  return base;
}

/**
 * Build the tool prompt info for all goatLLM tools.
 */
export function getGoatLLMToolInfo(): ToolPromptInfo[] {
  return [
    {
      name: "read_file",
      description:
        "Read file contents. Supports text files. Output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.",
      guidelines: [
        "Use read_file to examine files instead of bash cat or sed.",
      ],
    },
    {
      name: "list_dir",
      description:
        "List files and directories in a workspace path. Returns array of {name, is_dir, size} sorted with directories first.",
    },
    {
      name: "search_content",
      description:
        "Search for a regex pattern in workspace files. Returns array of {file, line, content} matches (max 100). Skips node_modules, .git, target, dist, and files >1MB.",
      guidelines: [
        "Use search_content to find code patterns instead of bash grep.",
      ],
    },
    {
      name: "git_status",
      description: "Run git status --porcelain in the workspace.",
    },
    {
      name: "web_search",
      description:
        "Search the web using Tavily. Returns up to 5 results with title, URL, and content. Use for current information, fact-checking, or recent events beyond your knowledge cutoff.",
      guidelines: [
        "Use web_search for current events, recent updates, or information not in the workspace.",
      ],
    },
    {
      name: "write_file",
      description:
        "Write or create a file. Creates parent directories if needed. Use for new files or complete rewrites. For targeted changes, prefer edit_file.",
      guidelines: [
        "Use write_file only for new files or complete rewrites.",
      ],
    },
    {
      name: "edit_file",
      description:
        "Make precise text replacements in a file. old_text must appear exactly once and match uniquely. Include enough surrounding context to make old_text unique. Do not pad with large unchanged regions.",
      guidelines: [
        "Use edit_file for precise changes — the old_text must match exactly once in the file.",
        "Keep old_text as small as possible while still being unique in the file.",
        "When changing multiple locations, use multiple edit_file calls or merge nearby changes into one.",
      ],
    },
    {
      name: "bash",
      description:
        "Execute a shell command in the workspace directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.",
      guidelines: [
        "Use bash for file operations like ls, grep, find.",
        "Use bash to run build commands, tests, git operations.",
      ],
    },
    {
      name: "diff_file",
      description:
        "Show uncommitted git diff for a specific file. Returns unified diff format or '(no changes)'.",
    },
    {
      name: "read_lints",
      description:
        "Run static analysis on the workspace. Runs cargo check for Rust projects or tsc --noEmit for TypeScript/JavaScript projects.",
    },
  ];
}
