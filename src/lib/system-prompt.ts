/**
 * System prompt builder.
 *
 * Generates a prompt that tells the model what tools are available,
 * how to use them effectively, and what the workspace context is.
 * Modeled after pi agent's proven prompt structure.
 */
import type { ToolSet } from "ai";
import { ALL_TOOLS, formatToolsForPrompt } from "./tools/registry";

export interface ToolPromptInfo {
  name: string;
  description: string;
  guidelines?: string[];
}

export interface ProjectContextFile {
  path: string;
  content: string;
}

export interface SystemPromptOptions {
  /** Either an explicit list (legacy / tests) or a live ToolSet (preferred).
   *  Live ToolSet means the rendered prompt always matches what's actually
   *  registered — no drift between the model's tool list and reality. */
  tools: ToolPromptInfo[] | ToolSet;
  workspacePath?: string | null;
  guidelines?: string[];
  /** When true, prepend research-mode instructions: plan, parallel search, citations, synthesis. */
  researchMode?: boolean;
  /** When true, prepend plan-mode instructions: read-only investigation,
   *  produce a numbered build plan, end with the BUILD-PLAN-COMPLETE marker. */
  planMode?: boolean;
  /** Project-context files (e.g. GOAT.md, CLAUDE.md, AGENTS.md) auto-loaded from the workspace root. */
  projectContextFiles?: ProjectContextFile[];
  /** Current date in YYYY-MM-DD form. Defaults to today. */
  date?: string;
}

const RESEARCH_MODE_PREAMBLE = `[RESEARCH MODE]
You are operating as an autonomous research agent. Your job is to produce a thorough, well-cited answer — not a quick reply.

Workflow:
1. PLAN — Restate the question, identify the sub-questions you need to answer, and list the queries/URLs you'll start with. Output the plan before any tool calls.
2. GATHER — Use web_search, browser_fetch, browser_extract, search_semantic, search_content, and read_file to collect evidence. Issue parallel tool calls when sources are independent. Don't stop at the first result; cross-check claims across at least two sources where possible.
3. DRILL — When a search result looks promising, follow up with browser_extract on the specific page (using a CSS selector for 'main', 'article', or the relevant container) to get clean text. Don't paste full pages — extract.
4. SYNTHESIZE — Once you have enough evidence, write a structured answer with:
   - A direct answer at the top
   - Sections covering each sub-question
   - Inline citations as [1], [2], … with a Sources list at the end (title + URL)
   - An "Open questions" section for things you couldn't resolve
5. STOP — Do not keep searching once you have a confident answer. Recognize when you're done.

Rules:
- Prefer primary sources (official docs, original papers, vendor blogs) over aggregators.
- If two sources contradict, say so explicitly and explain which is more credible.
- Quote exact phrases when a precise wording matters; otherwise paraphrase.
- Never fabricate URLs or page contents. If a fetch fails, say so.

`;

const PLAN_MODE_PREAMBLE = `[PLAN MODE]
You are operating in a read-only planning phase. Your job is to investigate the codebase and produce a clear, ordered build plan that the user can review and execute. You CANNOT write files, edit files, or run shell commands — those tools are intentionally unavailable. Use only read_file, list_dir, search_content, search_semantic, git_status, git_log, git_blame, diff_file, read_lints, read_pdf, web_search, browser_fetch, and browser_extract.

Workflow:
1. INVESTIGATE — Use the read-only tools to understand the relevant code, conventions, and constraints. Read enough to be specific.
2. PROPOSE — Output a Markdown plan with this exact structure:
     ## Plan
     A 1–2 sentence summary of what you'll do and why.

     ### Steps
     1. Concrete, ordered action with the file path(s) it touches.
     2. …

     ### Files
     - \`path/to/file.ts\` — what changes and why
     - …

     ### Risks
     - Anything that might break, data migrations, irreversible operations, or open questions.

     ### Verification
     - How the user (or you, after Build) will confirm it works (tests, commands, manual checks).
3. STOP — End your reply with the literal marker \`BUILD-PLAN-COMPLETE\` on its own line. Do not start coding. The user clicks "Build" when they're ready, and you'll be re-invoked in normal write mode to execute the plan.

Rules:
- Be specific. "Update the auth flow" is not a step. "Add a \`requireAuth\` middleware in \`src/middleware/auth.ts\` and apply it to the \`/api/admin/*\` routes in \`src/server.ts\`" is.
- Don't ask the user clarifying questions unless the task is genuinely ambiguous — prefer making a defensible choice and noting the tradeoff under Risks.
- If the task is so small (a typo, a single rename) that a plan is overkill, output a one-line plan and the BUILD-PLAN-COMPLETE marker.

`;

/**
 * Build the system prompt for agent mode — includes tool list,
 * usage guidelines, and workspace context.
 */
export function buildAgentSystemPrompt(options: SystemPromptOptions): string {
  const { tools, workspacePath, researchMode, planMode, projectContextFiles, date } = options;

  const toolsList = Array.isArray(tools)
    ? tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")
    : formatToolsForPrompt(tools);

  const guidelines = [
    "Be concise in your responses",
    "Show file paths clearly when working with files",
    "Use read_file to examine files instead of bash cat or sed.",
    "Use edit_file for precise changes — old_text must match exactly once.",
    "Use write_file only for new files or complete rewrites.",
    "Use bash for build commands, test runners, package managers, and git operations.",
    // ---- Tool routing -------------------------------------------------
    // search_content is the structured grep replacement. Always reach for
    // it before bash for finding code; only fall back to bash for the few
    // grep flags it doesn't expose (-l, -c, -v, --include/--exclude).
    "Use search_content (not bash grep) for finding code patterns. It supports `context_lines` for ±N surrounding lines (like grep -A/-B/-C) and `case_insensitive` (like grep -i). Reach for it whenever the question is 'where is X' or 'show me lines matching Y'.",
    "Use search_semantic when search_content's exact-match misses (e.g. 'auth flow' should match 'login handler').",
    "Use list_dir instead of `bash ls` for directory listings. Use git_status/git_log/git_blame instead of shelling out to git for read-only inspection.",
  ];
  const guidelinesText = guidelines.map((g) => `- ${g}`).join("\n");

  const workspaceLine = workspacePath
    ? `\nCurrent workspace: ${workspacePath}`
    : "\nNo workspace selected. Select a workspace to enable full tool access.";

  const today = date ?? new Date().toISOString().slice(0, 10);

  let base = `You are an expert coding agent operating inside goatLLM. You have access to the workspace filesystem and can read, write, edit, and execute code. Always explain what you're doing before using write/edit/bash tools, and wait for user approval before making changes.

Available tools:
${toolsList}

Guidelines:
${guidelinesText}
${workspaceLine}
Current date: ${today}`;

  // Append project-context files (GOAT.md / CLAUDE.md / AGENTS.md) so the
  // model picks up project-specific conventions without having to discover
  // them via tool calls. We mirror pi's <project_context> wrapper so the
  // structure is recognizable across harnesses.
  if (projectContextFiles && projectContextFiles.length > 0) {
    base += "\n\n<project_context>\n\n";
    base += "Project-specific instructions and guidelines:\n\n";
    for (const { path, content } of projectContextFiles) {
      base += `<project_instructions path="${path}">\n${content}\n</project_instructions>\n\n`;
    }
    base += "</project_context>";
  }

  return researchMode ? RESEARCH_MODE_PREAMBLE + base : (planMode ? PLAN_MODE_PREAMBLE + base : base);
}

/**
 * Build a minimal system prompt for chat mode — no workspace tools,
 * just the user's custom instructions if any. When researchMode is on,
 * prepend the same research preamble used in agent mode so the model
 * plans/gathers/cites consistently across both modes.
 *
 * When hasWebSearch is true, append a short note telling the model that
 * a web_search tool is available so it can reach for it on current
 * events / fresh facts without needing the full research workflow.
 */
export function buildChatSystemPrompt(
  userPrompt?: string,
  researchMode?: boolean,
  hasWebSearch?: boolean,
  options?: { autoArtifacts?: boolean; officeArtifacts?: boolean },
): string {
  const autoArtifacts = options?.autoArtifacts ?? true;
  const officeArtifacts = options?.officeArtifacts ?? true;
  // Models trained months ago don't know what year/month it is, so they
  // confidently answer "current" questions with stale data. Always pin the
  // real date at the top of the system prompt so they can either answer
  // correctly or recognize they need to reach for web_search.
  const now = new Date();
  const dateLine = `Today is ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}. Use this as the authoritative current date — ignore any internal sense of "now" from your training data.`;
  const base = `You are a helpful AI assistant. Be concise, thoughtful, and direct.\n\n${dateLine}`;

  // Build the artifact guide piece by piece so toggles can drop sections
  // cleanly. When auto-artifacts is off entirely, we omit the guide and
  // tell the model to keep all code inline as regular fenced blocks.
  const artifactCoreGuide =
    "\n\n# Artifacts (the side-panel canvas)\n\nThe app has a side-panel canvas. Substantial outputs go there, NOT in the chat reply. Anything you put in an artifact fence is rendered/edited in the canvas; the chat shows only a small reference card pointing to it. The user can read, copy, edit, and download the code from the canvas itself.\n\n## When to use an artifact\n\nUse an artifact for self-contained, substantial outputs:\n- A full HTML page or interactive demo\n- A Python program / script you'd actually run\n- A LaTeX document" +
    (officeArtifacts ? "\n- A Word doc, PowerPoint deck, or Excel sheet" : "") +
    "\n\nDo NOT use an artifact for short snippets, one-liners, configs, examples, or fragments the user is just trying to read inline. For those, use a normal language fence like ```js, ```ts, ```bash, ```json — those stay in the chat where they belong. Rule of thumb: if the user could meaningfully open it in its own window, it's an artifact; if it's a 5–30 line illustration, it's an inline snippet.\n\n## How to author one\n\nName each artifact with a markdown heading on the line directly before the code fence:\n\n### Resume Page\n```html\n<!DOCTYPE html>...\n```\n\nThe heading becomes the artifact's title in the side panel.\n\n## Editing an existing artifact (very important)\n\nWhen the user asks for a change to an artifact you already produced — even a full rewrite — REUSE THE EXACT SAME HEADING with the same language fence. The new fence body REPLACES the old one in the canvas; previous versions are kept in the artifact's history so the user can undo. The match is case- and whitespace-insensitive.\n\nTo create a NEW artifact alongside the existing one, use a DIFFERENT heading. Multiple artifacts of the same kind can coexist in one conversation as long as their headings differ.\n\n## What the chat reply should look like\n\nThe chat reply that accompanies an artifact must be SHORT — one or two sentences at most. Describe what you built or what you changed; never restate the code itself.\n\nGood:\n> Updated the resume page to use a two-column layout and tighter typography.\n\nBad:\n> Here's the updated resume page. I changed the body to use flex with two columns, swapped the font to Inter, adjusted the spacing… [followed by the entire HTML again]\n\nNever:\n- Recap the artifact body in prose.\n- Repeat the code outside the artifact fence.\n- Paste a diff of the changes (the canvas has its own version history).\n- Wrap the same code in two fences (one artifact + one inline) — pick one.\n\nIf the user explicitly asks to see the code in chat, they can copy it from the canvas. Point them there instead of pasting.";

  const officeGuide =
    "\n\n## Office formats\n\nFor Word essays, PowerPoint decks, and Excel sheets, use the fence languages `docx`, `pptx`, `xlsx`. They render in the side panel as a real document/deck/spreadsheet, and the user can download a real .docx / .pptx / .xlsx file.\n\nWord (`docx`) — author in standard Markdown:\n```docx\n# Document title\n\n## Section\n\nParagraph text. **bold**, *italic*, `code` are supported.\n\n- bullet\n- bullet\n\n1. numbered\n2. numbered\n\n| Col | Col |\n| --- | --- |\n| a   | b   |\n```\n\nPowerPoint (`pptx`) — one slide per block, separated by `---` on its own line. Inside a slide use `# Title`, `## Subtitle`, `- bullet`, plain paragraphs, and `Notes:` for speaker notes:\n```pptx\n# Quarterly review\n## Fiscal Q3 2026\n- Revenue up 18%\n- Two new design partners\n- Hiring frozen until Q4\nNotes: Open with the revenue chart, then walk through partners.\n---\n# Next steps\n- Ship office-artifact preview\n- Pilot with three customers\n```\n\nExcel (`xlsx`) — one Markdown table per sheet, with `## SheetName` headers between sheets. Numbers are auto-detected:\n```xlsx\n## Revenue\n| Quarter | Revenue | Cost  |\n| ------- | ------- | ----- |\n| Q1      | 12000   | 4500  |\n| Q2      | 15000   | 5100  |\n\n## Headcount\n| Team    | People |\n| ------- | ------ |\n| Eng     | 12     |\n| Design  | 3      |\n```\n\nKeep office source short and well-structured — the renderer is faithful but not magic. Don't include raw XML, OOXML, or base64 — just the clean source above.";

  const inlineOnlyGuide =
    "\n\nWhen showing code, keep it inline in the chat as a normal fenced code block (```html, ```python, ```js, etc.). The user has turned off the side-panel canvas, so do not assume artifacts will render anywhere else.";

  const artifactGuide = autoArtifacts
    ? artifactCoreGuide + (officeArtifacts ? officeGuide : "")
    : inlineOnlyGuide;

  const webSearchGuide = hasWebSearch
    ? "\n\nA web_search tool is available. Use it whenever the user asks about current events, recent updates, prices, scores, releases, or any fact that may have changed after your training cutoff — or when you simply don't know. Don't announce that you'll search; just call the tool, then answer with the result.\n\nCRITICAL: You only get ONE search per turn. Read the user's request carefully, figure out exactly what they need, and craft a single optimized query. Do NOT search multiple angles or do follow-up searches — the tool will fail if you exceed the limit. Answer with whatever the one result gives you."
    : "";
  let body = base + artifactGuide + webSearchGuide;
  if (userPrompt) {
    body = `${body}\n\n<user_instructions>\n${userPrompt}\n</user_instructions>`;
  }
  return researchMode ? RESEARCH_MODE_PREAMBLE + body : body;
}

/**
 * Build the tool prompt info for all goatLLM tools.
 *
 * Derives from the live ALL_TOOLS registry so adding a tool in builtins/
 * auto-updates the prompt list — no more 15-tool drift between what's
 * registered and what the model is told exists. Kept exported for tests
 * and any caller that wants the structured ToolPromptInfo shape; live
 * call sites should pass the ToolSet directly to buildAgentSystemPrompt.
 */
export function getGoatLLMToolInfo(): ToolPromptInfo[] {
  return Object.entries(ALL_TOOLS).map(([name, def]) => ({
    name,
    description:
      (def as { description?: string } | undefined)?.description ?? "",
  }));
}
