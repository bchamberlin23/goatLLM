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
  /** Artifacts already present in the side-panel canvas for this conversation.
   *  Injected so the model reuses an existing artifact's title/kind when asked
   *  to modify it (via edit_artifact or by re-emitting the same heading)
   *  instead of always spawning a duplicate. */
  existingArtifacts?: { kind: string; title: string }[];
}

/**
 * Render the "existing artifacts" inventory block. Empty string when there are
 * no artifacts yet (nothing to reuse).
 */
export function formatArtifactInventory(
  artifacts?: { kind: string; title: string }[],
): string {
  if (!artifacts || artifacts.length === 0) return "";
  // De-dupe on (kind, title) so version history doesn't list the same
  // artifact five times.
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const a of artifacts) {
    const key = `${a.kind}::${a.title.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- [${a.kind}] "${a.title}"`);
  }
  if (lines.length === 0) return "";
  return (
    "\n\n# Existing canvas artifacts\n\nYou have already created these artifacts in this conversation:\n" +
    lines.join("\n") +
    "\n\nWhen the user asks you to change, fix, update, extend, or rewrite one of these, you MUST modify the EXISTING artifact — never create a new one. Reuse its EXACT title and kind (the heading above the fence, or the `title`/`kind` arguments to edit_artifact). Inventing a new title for a change to an existing artifact creates a confusing duplicate tab, which is wrong. Only create a new artifact when the user genuinely wants a separate, additional deliverable.\n\nFor small, targeted changes prefer the <<<EDIT>>> syntax (described above) over rewriting the full artifact. It is faster and less error-prone."
  );
}

const RESEARCH_MODE_PREAMBLE = `[RESEARCH MODE]
You are operating as an autonomous research agent. Your job is to produce a thorough, well-cited answer — not a quick reply.

Workflow:
1. PLAN — Restate the question, identify the sub-questions you need to answer, and list the queries/URLs you'll start with. Output the plan before any tool calls.
2. GATHER — Use web_search to discover URLs, scrape_url or browser_fetch to read web pages, and browser_extract, search_semantic, search_content, and read_file to collect evidence. Issue parallel tool calls when sources are independent. Don't stop at the first result; cross-check claims across at least two sources where possible.
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
You are operating in a read-only planning phase. Your job is to investigate the codebase and produce a clear, ordered build plan that the user can review and execute. You CANNOT write files, edit files, or run shell commands — those tools are intentionally unavailable. Use only read_file, list_dir, search_content, search_semantic, git_status, git_log, git_blame, diff_file, read_lints, read_pdf, web_search, scrape_url, browser_fetch, and browser_extract.

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
  const { tools, workspacePath, researchMode, planMode, projectContextFiles, date, existingArtifacts } = options;

  const toolsList = Array.isArray(tools)
    ? tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")
    : formatToolsForPrompt(tools);

  const guidelines = [
    "Be concise in your responses",
    "Show file paths clearly when working with files",
    "Use read_file to examine files instead of bash cat or sed.",
    "Use edit_file for precise changes — old_text must match exactly once.",
    "Use write_file only for new files or complete rewrites.",
    "Use edit_artifact for targeted edits to existing side-panel artifacts (HTML, LaTeX, Python, etc.) instead of emitting a full artifact fence when you only changed part of the code. Find the artifact by kind + title and pass old_text/new_text or an edits array, just like edit_file. Alternatively, emit a fence with <<<EDIT>>> blocks (same heading/kind) for inline selective edits without a tool call.",
    "Use bash for build commands, test runners, package managers, and git operations.",
    // ---- Tool routing -------------------------------------------------
    // search_content is the structured grep replacement. Always reach for
    // it before bash for finding code; only fall back to bash for the few
    // grep flags it doesn't expose (-l, -c, -v, --include/--exclude).
    "Use search_content (not bash grep) for finding code patterns. It supports `context_lines` for ±N surrounding lines (like grep -A/-B/-C) and `case_insensitive` (like grep -i). Reach for it whenever the question is 'where is X' or 'show me lines matching Y'.",
    "Use search_semantic when search_content's exact-match misses (e.g. 'auth flow' should match 'login handler').",
    "Use list_dir instead of `bash ls` for directory listings. Use git_status/git_log/git_blame instead of shelling out to git for read-only inspection.",
    // ---- Completion ---------------------------------------------------
    "When you have finished the task, first send a brief message summarizing what you accomplished and suggesting possible next steps the user might want to take. Then call the `done` tool with a short summary. Do not just stop generating — you MUST call `done` to end your turn.",
    // ---- Subagent routing ----------------------------------------------
    "A spawn_subagent tool is available for delegating complex, self-contained tasks to a child agent loop. Use it for parallelizable research or multi-step operations that don't need user interaction. The subagent gets its own context and tools, and its transcript is visible in the UI for review.",
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

  base += formatArtifactInventory(existingArtifacts);

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
  options?: { autoArtifacts?: boolean; officeArtifacts?: boolean; advancedArtifacts?: boolean; existingArtifacts?: { kind: string; title: string }[] },
): string {
  const autoArtifacts = options?.autoArtifacts ?? true;
  const officeArtifacts = options?.officeArtifacts ?? true;
  const advancedArtifacts = options?.advancedArtifacts ?? true;
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
    "\n\n# Artifacts (the side-panel canvas)\n\nThe app has a side-panel canvas. Substantial outputs go there, NOT in the chat reply. Anything you put in an artifact fence is rendered/edited in the canvas; the chat shows only a small reference card pointing to it. The user can read, copy, edit, and download the code from the canvas itself.\n\n## When to use an artifact\n\nUse an artifact only for deliverables the user would open as a standalone file or page:\n- **HTML (`html`)** — ONLY when the user explicitly wants a website, web page, landing page, or browser UI mockup. Never use HTML for homework answers, study guides, essays, summaries, Q&A, tables, or general explanations.\n- A Python program / script you'd actually run (`python`)\n- A LaTeX document (`latex`)" +
    (officeArtifacts ? "\n- A Word doc (`docx`), PowerPoint deck (`pptx`), or Excel sheet (`xlsx`) — not HTML substitutes" : "") +
    "\n\nDo NOT use an artifact for short snippets, one-liners, configs, examples, or fragments the user is just trying to read inline. For those, use a normal language fence like ```js, ```ts, ```bash, ```json — those stay in the chat where they belong.\n\nFor PDF homework, multi-problem sets, or document Q&A: answer in the chat with markdown (headings, lists, math). Use office formats when the user asked for a downloadable document — not HTML.\n\nRule of thumb: HTML artifacts are for **sites/pages**, not for **answers**.\n\n## How to author one\n\nName each artifact with a markdown heading on the line directly before the code fence:\n\n### Resume Page\n```html\n<!DOCTYPE html>...\n```\n\nThe heading becomes the artifact's title in the side panel.\n\n## Editing an existing artifact (very important)\n\nWhen the user asks for a change to an artifact you already produced, you have two approaches. Pick whichever fits the size of the change:\n\n### Approach A — Selective edit (preferred for small changes)\n\nReuse the EXACT SAME HEADING and language fence, but instead of the full code, put `<<<EDIT>>>` blocks inside. Each block specifies the exact text to find and its replacement:\n\n### Resume Page\n```html\n<<<EDIT>>>\n<<<OLD>>>\n<h1>John Doe</h1>\n<<<NEW>>>\n<h1>Jane Smith</h1>\n<<<END>>>\n\n<<<EDIT>>>\n<<<OLD>>>\n  color: blue;\n<<<NEW>>>\n  color: red;\n<<<END>>>\n```\n\nRules for edit blocks:\n- `<<<OLD>>>` text must appear exactly once in the artifact's current code.\n- Include enough surrounding context in `<<<OLD>>>` so the match is unique.\n- You can have multiple `<<<EDIT>>>…<<<END>>>` blocks in one fence.\n- To delete code, leave the `<<<NEW>>>` section empty.\n- To insert code, put the insertion point's surrounding lines in `<<<OLD>>>` and include the new code plus those lines in `<<<NEW>>>`.\n\nUse this approach when you're changing a few specific parts and the rest stays the same. It's faster and avoids accidentally altering unchanged code.\n\n### Approach B — Full replacement (for large rewrites)\n\nReuse the EXACT SAME HEADING with the same language fence and put the complete new code inside. The new fence body REPLACES the old one in the canvas; previous versions are kept in the artifact's history so the user can undo.\n\nUse this when more than half the artifact is changing or when the user explicitly asks for a rewrite.\n\n### Creating a new artifact\n\nTo create a NEW artifact alongside the existing one, use a DIFFERENT heading. Multiple artifacts of the same kind can coexist in one conversation as long as their headings differ.\n\n## What the chat reply should look like\n\nThe chat reply that accompanies an artifact must be SHORT — one or two sentences at most. Describe what you built or what you changed; never restate the code itself.\n\nGood:\n> Updated the resume page to use a two-column layout and tighter typography.\n\nBad:\n> Here's the updated resume page. I changed the body to use flex with two columns, swapped the font to Inter, adjusted the spacing… [followed by the entire HTML again]\n\nNever:\n- Recap the artifact body in prose.\n- Repeat the code outside the artifact fence.\n- Paste a diff of the changes (the canvas has its own version history).\n- Wrap the same code in two fences (one artifact + one inline) — pick one.\n\nIf the user explicitly asks to see the code in chat, they can copy it from the canvas. Point them there instead of pasting.";

  const officeGuide =
    "\n\n## Office formats\n\nFor Word essays, PowerPoint decks, and Excel sheets, use the fence languages `docx`, `pptx`, `xlsx`. They render in the side panel as a real document/deck/spreadsheet, and the user can download a real .docx / .pptx / .xlsx file.\n\nWord (`docx`) — author in standard Markdown:\n```docx\n# Document title\n\n## Section\n\nParagraph text. **bold**, *italic*, `code` are supported.\n\n- bullet\n- bullet\n\n1. numbered\n2. numbered\n\n| Col | Col |\n| --- | --- |\n| a   | b   |\n```\n\nPowerPoint (`pptx`) — one slide per block, separated by `---` on its own line. Inside a slide use `# Title`, `## Subtitle`, `- bullet`, plain paragraphs, and `Notes:` for speaker notes:\n```pptx\n# Quarterly review\n## Fiscal Q3 2026\n- Revenue up 18%\n- Two new design partners\n- Hiring frozen until Q4\nNotes: Open with the revenue chart, then walk through partners.\n---\n# Next steps\n- Ship office-artifact preview\n- Pilot with three customers\n```\n\nExcel (`xlsx`) — one Markdown table per sheet, with `## SheetName` headers between sheets. Numbers are auto-detected:\n```xlsx\n## Revenue\n| Quarter | Revenue | Cost  |\n| ------- | ------- | ----- |\n| Q1      | 12000   | 4500  |\n| Q2      | 15000   | 5100  |\n\n## Headcount\n| Team    | People |\n| ------- | ------ |\n| Eng     | 12     |\n| Design  | 3      |\n```\n\nKeep office source short and well-structured — the renderer is faithful but not magic. Don't include raw XML, OOXML, or base64 — just the clean source above.";

  const inlineOnlyGuide =
    "\n\nWhen showing code, keep it inline in the chat as a normal fenced code block (```html, ```python, ```js, etc.). The user has turned off the side-panel canvas, so do not assume artifacts will render anywhere else.";

  // Inline widgets render LIVE in the reply (sandboxed iframe), independent of
  // the side-panel canvas — so this guidance is appended regardless of the
  // autoArtifacts toggle.
  const widgetGuide =
    "\n\n# Inline widgets (live in the reply)\n\nYou can embed a small, self-contained interactive or visual element that renders LIVE right inside your reply — not in the side panel. Use a ```widget fence:\n\n### Sales by quarter\n```widget\n<canvas id=\"c\" width=\"520\" height=\"260\"></canvas>\n<script>\n  const ctx = document.getElementById('c').getContext('2d');\n  const data = [12, 19, 8, 25];\n  const max = Math.max(...data);\n  data.forEach((v, i) => {\n    ctx.fillStyle = '#f59e42';\n    const h = (v / max) * 220;\n    ctx.fillRect(40 + i * 120, 240 - h, 80, h);\n  });\n</script>\n```\n\nHow widgets work:\n- The fence body is ONE self-contained HTML document fragment. Put all markup, `<style>`, and `<script>` inline in the same block. It runs in a sandboxed frame that auto-sizes to its content.\n- The heading on the line directly above the fence becomes the widget's title.\n- External libraries are fine via an https CDN `<script src=\"…\">` (e.g. a charting or animation library). Relative file paths and local imports will NOT resolve — keep everything inline or CDN-loaded.\n- The frame is isolated from the app: no access to your conversation, storage, or the page around it.\n\nGreat uses: data visualizations and charts, SVG/diagram drawings, animations, physics or math simulations, small calculators, interactive explainers, color/typography demos, anything that's clearer when the reader can see or poke at it rather than read a description.\n\nWhen NOT to use a widget:\n- For a full standalone web page, site, or app the user wants to open/edit/download — use an `html` artifact (the side-panel canvas) instead.\n- For plain data the reader just needs to scan — a Markdown table is lighter than a widget.\n- For code the user wants to read or copy — a normal fenced code block.\n\nKeep widgets focused and reasonably sized; tall content scrolls inside the frame. Write a short sentence of context around the widget, and never paste the same code again outside the fence.";

  const artifactGuide = autoArtifacts
    ? artifactCoreGuide + (officeArtifacts ? officeGuide : "") + formatArtifactInventory(options?.existingArtifacts)
    : inlineOnlyGuide;

  const webSearchGuide = hasWebSearch
    ? "\n\nA web_search tool is available. Use it whenever the user asks about current events, recent updates, prices, scores, releases, or any fact that may have changed after your training cutoff — or when you simply don't know. If a search result's snippet is not enough, call scrape_url on the specific URL to read the page. Don't announce that you'll search; just call the tool, then answer with the result.\n\nCRITICAL: You only get ONE search per turn. Read the user's request carefully, figure out exactly what they need, and craft a single optimized query. Do NOT search multiple angles or do follow-up searches — the tool will fail if you exceed the limit. Answer with whatever the one result gives you."
    : "";
  let body = base + artifactGuide + (advancedArtifacts ? widgetGuide : "") + webSearchGuide;
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
