import { generateText } from "ai";
import { createModel } from "./model-factory";
import type { LlmConfig } from "./llm-types";

export interface ResearchProgress {
  phase: "planning" | "searching" | "reading" | "analyzing" | "writing" | "done" | "error" | "warning";
  round?: number;
  queries?: number;
  query_preview?: string;
  url?: string;
  title?: string;
  current_source?: { url: string; title?: string };
  new_sources?: number;
  total_sources?: number;
  total_findings?: number;
  sources?: string[];
  findings?: string[];
  message?: string;
}

export interface DeepResearchOptions {
  maxUrlsPerRound?: number;
  maxContentChars?: number;
  extractionConcurrency?: number;
  minRounds?: number;
  maxEmptyRounds?: number;
  synthesisWindow?: number;
  maxReportTokens?: number;
}

interface ResearchFinding {
  url: string;
  title?: string;
  rational?: string;
  evidence?: string;
  summary?: string;
}

// ---------------------------------------------------------------------------
// Date context helper
// ---------------------------------------------------------------------------
function currentDateContext(): string {
  const now = new Date();
  const formatOptions: Intl.DateTimeFormatOptions = { month: "long", day: "numeric", year: "numeric" };
  const dateStr = now.toLocaleDateString("en-US", formatOptions);
  const isoStr = now.toISOString().slice(0, 10);
  const yearStr = now.getFullYear().toString();
  return (
    `Today's date is ${dateStr} (${isoStr}). ` +
    `When a search query needs a year or refers to 'latest'/'current'/'this year', ` +
    `use ${yearStr} or relative wording — never a year inferred from training data.\n\n`
  );
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
const RESEARCH_PLAN_PROMPT = `You are a research strategist. Before searching, analyze this question and create a research plan.

**Question:** {question}

Break this question down:
1. What are the key sub-topics that need to be covered for a comprehensive answer?
2. What specific data points, facts, or perspectives should we look for?
3. What would a complete, high-quality answer include?

Return a JSON object with:
- "sub_questions": Array of 3-6 specific sub-questions to investigate
- "key_topics": Array of key topics/angles to cover
- "success_criteria": One sentence describing what a complete answer looks like

Example:
{
  "sub_questions": ["What is the cost of living in X?", "How is the healthcare system?"],
  "key_topics": ["economy", "healthcare", "safety", "culture"],
  "success_criteria": "A balanced comparison covering cost, quality of life, and practical considerations."
}
`;

const QUERY_GEN_PROMPT = `You are a research assistant planning web searches.

**Original question:** {question}

**Research plan:**
{research_plan}

**What we know so far:**
{report}

**Round:** {round_num}

Generate {num_queries} focused search queries that will help answer the question.
{round_instruction}

Return ONLY a JSON array of query strings, nothing else.
Example: ["query one", "query two", "query three"]
`;

const EXTRACTOR_PROMPT = `Please process the following webpage content and user goal to extract relevant information:

## **Webpage Content**
{webpage_content}

## **User Goal**
{goal}

## **Task Guidelines**
1. **Content Scanning for Rational**: Locate the **specific sections/data** directly related to the user's goal within the webpage content
2. **Key Extraction for Evidence**: Identify and extract the **most relevant information** from the content, you never miss any important information, output the **full original context** of the content as far as possible, it can be more than three paragraphs.
3. **Summary Output for Summary**: Organize into a concise paragraph with logical flow, prioritizing clarity and judge the contribution of the information to the goal.

**Final Output Format using JSON format has "rational", "evidence", "summary" fields**

Example output:
{
    "rational": "This section discusses X which directly relates to the goal of understanding Y",
    "evidence": "Full quotes and context from the page...",
    "summary": "Concise summary of how this information answers the goal"
}
`;

const SYNTHESIZE_PROMPT = `You are updating an evolving research report.

**Original question:** {question}

**Current report:**
{report}

**New findings from this round:**
{new_findings}

Integrate the new findings into the existing report. Produce an updated, well-organized report that answers the original question as completely as possible given all evidence so far. Remove redundancy, resolve contradictions, and maintain logical flow. Keep source URLs as inline citations where relevant.

Write only the updated report — no preamble or meta-commentary.
`;

const STOP_PROMPT = `You are deciding whether a research report is comprehensive enough.

**Original question:** {question}

**Current report:**
{report}

**Rounds completed:** {round_num}

Based on the report so far, do we have enough information to answer the question comprehensively? Consider:
- Are the key aspects of the question addressed?
- Are there obvious gaps or unanswered sub-questions?
- Is the evidence sufficient and from multiple sources?

Reply with ONLY "YES" or "NO" followed by a brief one-sentence reason.
Example: "YES — The report covers all major aspects with evidence from multiple sources."
Example: "NO — We still lack information about the economic impact."
`;

const FINAL_REPORT_PROMPT = `Write a **long, detailed, comprehensive** research report answering this question:

**Question:** {question}

**All collected evidence and analysis:**
{report}

Requirements:
- Write at MINIMUM 1500 words — this should be a thorough, magazine-quality article
- Use clear ## headings and ### subheadings to organize into logical sections
- Each section should have multiple detailed paragraphs, not just bullet points
- Synthesize and analyze the information — explain WHY things matter, draw comparisons, provide context
- Include specific data points, numbers, and statistics from the evidence
- Include source URLs as inline citations [like this](url)
- Note where sources agree and where they disagree
- Add a brief executive summary at the top
- End with a clear conclusion that directly answers the question
- Write in an engaging, informative style — not dry or robotic
`;

const CATEGORY_PROMPTS: Record<string, string> = {
  product: `IMPORTANT FORMAT OVERRIDE — this is a PRODUCT research report:
- Structure as a RANKED LIST of products/options (best first)
- For EACH product include: name as ### heading, approximate price, 2-3 sentence summary, **Pros:** bullet list, **Cons:** bullet list, **Where to buy:** URLs as links
- Start with a quick-compare markdown table of top picks (columns: Name, Price, Best For, Rating)
- End with a ## Verdict section picking Best Overall and Best Value
- Still include source citations inline`,

  comparison: `IMPORTANT FORMAT OVERRIDE — this is a COMPARISON report:
- Create a ## Comparison Table as a markdown table comparing ALL options across key criteria (rows = criteria, columns = options)
- Use checkmarks, ratings, or short values in cells
- Write a ## section per option with its strengths, weaknesses, and ideal use case
- End with ## Best For verdicts (e.g., "**Best for small teams:** Option A because...")
- Include a ## Shared Considerations section for things that apply to all options`,

  howto: `IMPORTANT FORMAT OVERRIDE — this is a HOW-TO guide:
- Start with ## Quick Guide — a super concise numbered list (one line per step, no details, just the action). Example: 1. Install X  2. Run Y  3. Configure Z
- Then ## Prerequisites listing what's needed before starting
- Then the detailed steps: ## Step 1: ..., ## Step 2: ...
- Each step should have a clear heading and detailed instructions
- Use blockquotes (> ) for tips and warnings: > **Tip:** ... or > **Warning:** ...
- End with ## Common Mistakes section
- Add estimated time and difficulty level near the top`,

  factcheck: `IMPORTANT FORMAT OVERRIDE — this is a FACT-CHECK report:
- Start with ## The Claim restating what's being checked
- Create ## Evidence For and ## Evidence Against sections
- Each piece of evidence should be a ### with source name, what it found, and how strong the evidence is
- Include a ## Verdict section with one of: **Supported**, **Mixed Evidence**, or **Unsupported**
- End with ## Nuance & Caveats for important context and limitations
- Be balanced and cite sources for every claim`,
};

// ---------------------------------------------------------------------------
// JSON Parsing helpers
// ---------------------------------------------------------------------------
function cleanCodeBlock(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "");
    cleaned = cleaned.replace(/\s*```$/, "");
  }
  return cleaned.trim();
}

export function parseJsonArray(text: string): string[] {
  const cleaned = cleanCodeBlock(text);
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item));
    }
  } catch {
    // Fallbacks below.
  }

  const lastStart = cleaned.lastIndexOf("[");
  if (lastStart !== -1 && !cleaned.slice(lastStart).includes("]")) {
    const completeItems = Array.from(cleaned.slice(lastStart).matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g));
    if (completeItems.length > 0) {
      return completeItems.map((m) => {
        try {
          return JSON.parse(m[0]);
        } catch {
          return m[1];
        }
      });
    }
  }

  // Models often echo the prompt's Example: [...] before the real array.
  // Keep the last parseable array so those examples do not become searches.
  let lastParsed: unknown[] | null = null;
  for (const match of cleaned.matchAll(/\[[\s\S]*?\]/g)) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) lastParsed = parsed;
    } catch {
      // Keep scanning.
    }
  }
  if (lastParsed) return lastParsed.map((item) => String(item));

  if (lastStart !== -1) {
    const completeItems = Array.from(cleaned.slice(lastStart).matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g));
    if (completeItems.length > 0) {
      return completeItems.map((m) => {
        try {
          return JSON.parse(m[0]);
        } catch {
          return m[1];
        }
      });
    }
  }
  return [];
}

export function parseJsonObject(text: string): any {
  const cleaned = cleanCodeBlock(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {}
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// LLM generation helper
// ---------------------------------------------------------------------------
async function callLlm(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
  config: LlmConfig,
  temperature = 0.3,
  maxOutputTokens = 4096,
  abortSignal?: AbortSignal
): Promise<string> {
  const model = await createModel(config);
  const response = await generateText({
    model,
    messages,
    temperature,
    maxOutputTokens,
    abortSignal,
  });
  return response.text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function formatFindings(findings: ResearchFinding[]): string {
  return findings
    .map((f, i) => {
      const title = f.title || f.url || "Source";
      const content = f.summary || f.evidence || "(no content)";
      return `**Finding ${i + 1}** — [${title}](${f.url})\n${content}`;
    })
    .join("\n\n");
}

function fallbackReport(question: string, findings: ResearchFinding[]): string {
  return (
    `# ${question}\n\n` +
    `_Automatic synthesis did not complete, so this report lists the ` +
    `${findings.length} finding(s) gathered during Deep Research._\n\n` +
    formatFindings(findings)
  );
}

// ---------------------------------------------------------------------------
// Main Research orchestrator
// ---------------------------------------------------------------------------
export async function runDeepResearch(
  question: string,
  config: LlmConfig,
  rawOnProgress: (p: ResearchProgress) => void,
  abortSignal?: AbortSignal,
  maxRounds = 4,
  maxTimeSeconds = 300,
  options: DeepResearchOptions = {}
): Promise<string> {
  const startTime = Date.now();
  
  const onProgress = (p: ResearchProgress) => {
    rawOnProgress({
      ...p,
      sources: Array.from(urlsFetched),
      findings: findings.map((f) => f.summary || f.evidence || ""),
    });
  };
  const maxUrlsPerRound = clampInt(options.maxUrlsPerRound ?? 3, 1, 20);
  const maxContentChars = clampInt(options.maxContentChars ?? 15000, 2000, 100000);
  const extractionConcurrency = clampInt(options.extractionConcurrency ?? 3, 1, 12);
  const minRounds = clampInt(options.minRounds ?? 2, 1, maxRounds);
  const maxEmptyRounds = clampInt(options.maxEmptyRounds ?? 2, 1, maxRounds);
  const synthesisWindow = clampInt(options.synthesisWindow ?? 10, 1, 50);
  const maxReportTokens = clampInt(options.maxReportTokens ?? 4096, 1024, 32000);
  const urlsFetched = new Set<string>();
  const queriesUsed = new Set<string>();
  const findings: ResearchFinding[] = [];
  let report = "";
  let researchPlan = "";
  let category: string | null = null;
  let consecutiveEmptyRounds = 0;
  let lastSearchError = "";

  const isTimeExceeded = () => {
    return (Date.now() - startTime) / 1000 > maxTimeSeconds;
  };

  // 1. PLANNING
  onProgress({ phase: "planning" });
  try {
    const planPrompt = currentDateContext() + RESEARCH_PLAN_PROMPT.replace("{question}", question);
    const planResponse = await callLlm([{ role: "user", content: planPrompt }], config, 0.3, 1024, abortSignal);
    const parsedPlan = parseJsonObject(planResponse);
    if (parsedPlan) {
      const parts: string[] = [];
      if (parsedPlan.sub_questions) parts.push("Sub-questions: " + parsedPlan.sub_questions.join("; "));
      if (parsedPlan.key_topics) parts.push("Key topics: " + parsedPlan.key_topics.join(", "));
      if (parsedPlan.success_criteria) parts.push("Success: " + parsedPlan.success_criteria);
      researchPlan = parts.join("\n") || planResponse;
    } else {
      researchPlan = planResponse;
    }
  } catch (e) {
    console.warn("Planning failed:", e);
    onProgress({ phase: "warning", message: "Planning step failed, proceeding to direct search." });
    researchPlan = "(No plan - search broadly.)";
  }

  // 2. CLASSIFY CATEGORY
  try {
    const valid = Object.keys(CATEGORY_PROMPTS).join(", ");
    const classPrompt = `Classify this research question into exactly ONE category.
Categories: ${valid}
If none fit well, respond with: general

Question: ${question}

Respond with ONLY the category name, nothing else.`;
    const classResponse = await callLlm([{ role: "user", content: classPrompt }], config, 0.0, 20, abortSignal);
    const catClean = classResponse.trim().toLowerCase().replace(/[.,"'`#\-]+/g, "");
    if (catClean in CATEGORY_PROMPTS) {
      category = catClean;
    } else {
      for (const k of Object.keys(CATEGORY_PROMPTS)) {
        if (catClean.includes(k)) {
          category = k;
          break;
        }
      }
    }
  } catch (e) {
    console.warn("Classification failed:", e);
  }

  // 3. ITERATIVE ROUNDS LOOP
  for (let roundNum = 1; roundNum <= maxRounds; roundNum++) {
    if (abortSignal?.aborted || isTimeExceeded()) break;

    onProgress({ phase: "searching", round: roundNum, total_sources: urlsFetched.size, total_findings: findings.length });

    const numQueries = roundNum === 1 ? 4 : 3;
    const roundInstruction = roundNum === 1
      ? "This is the first round — generate broad, diverse queries that explore the key facets of the question."
      : "We already have partial findings. Generate targeted follow-up queries to fill gaps, verify claims, or explore specific aspects that the report doesn't yet cover well.";

    const queryPrompt = currentDateContext() + QUERY_GEN_PROMPT
      .replace("{question}", question)
      .replace("{research_plan}", researchPlan)
      .replace("{report}", report || "(No findings yet.)")
      .replace("{round_num}", String(roundNum))
      .replace("{num_queries}", String(numQueries))
      .replace("{round_instruction}", roundInstruction);

    let queries: string[] = [];
    try {
      const queryResponse = await callLlm([{ role: "user", content: queryPrompt }], config, 0.5, 2048, abortSignal);
      queries = parseJsonArray(queryResponse).map((q) => q.trim()).filter(Boolean);
    } catch (e) {
      console.error("Query generation failed:", e);
      onProgress({ phase: "warning", message: `Query generation failed in round ${roundNum}.` });
    }

    const newQueries = queries.filter((q) => !queriesUsed.has(q));
    newQueries.forEach((q) => queriesUsed.add(q));

    if (newQueries.length === 0) {
      lastSearchError = `no new URLs or search queries generated in round ${roundNum}`;
      onProgress({ phase: "warning", round: roundNum, message: lastSearchError });
      consecutiveEmptyRounds++;
      if (consecutiveEmptyRounds >= maxEmptyRounds && findings.length === 0) {
        const message = `Search unavailable: ${lastSearchError}`;
        onProgress({ phase: "error", round: roundNum, message });
        return message;
      }
      break;
    }

    onProgress({
      phase: "searching",
      round: roundNum,
      queries: newQueries.length,
      query_preview: newQueries[0],
      total_sources: urlsFetched.size,
      total_findings: findings.length,
    });

    const searchResults = await Promise.all(newQueries.map(async (query) => {
      try {
        const { READ_ONLY_TOOLS } = await import("./tools/registry");
        if (!READ_ONLY_TOOLS.web_search.execute) {
          throw new Error("web_search tool has no execute function");
        }
        const resultsJson = await READ_ONLY_TOOLS.web_search.execute({ query, maxResults: 10 }, {} as any);
        if (typeof resultsJson !== "string") {
          throw new Error("Expected string response from web_search");
        }
        const parsed = JSON.parse(resultsJson);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        lastSearchError = `no results for "${query}"`;
        return [];
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        lastSearchError = `${query}: ${detail}`;
        console.warn(`Search failed for query "${query}":`, e);
        return [];
      }
    }));

    const urlsToFetch: { url: string; title: string }[] = [];
    for (const res of searchResults) {
      for (const item of res) {
        const url = item?.url;
        if (url && !urlsFetched.has(url)) {
          urlsFetched.add(url);
          urlsToFetch.push({ url, title: item.title || url });
        }
        if (urlsToFetch.length >= maxUrlsPerRound * newQueries.length) break;
      }
    }

    const targets = urlsToFetch.slice(0, maxUrlsPerRound * newQueries.length);
    if (targets.length === 0) {
      consecutiveEmptyRounds++;
      const message = `No new URLs found in round ${roundNum}${lastSearchError ? ` (${lastSearchError})` : ""}.`;
      onProgress({ phase: "warning", round: roundNum, message, total_sources: urlsFetched.size, total_findings: findings.length });
      if (consecutiveEmptyRounds >= maxEmptyRounds && findings.length === 0) {
        const errorMessage = `Search unavailable: ${message}`;
        onProgress({ phase: "error", round: roundNum, message: errorMessage });
        return errorMessage;
      }
      continue;
    }

    const activeFindings: ResearchFinding[] = [];
    const extracted = await mapWithConcurrency(targets, extractionConcurrency, async (target) => {
      if (abortSignal?.aborted) return null;
      const displayTitle = target.title || target.url;
      onProgress({
        phase: "reading",
        round: roundNum,
        url: target.url,
        title: displayTitle,
        current_source: { url: target.url, title: displayTitle },
        total_sources: urlsFetched.size,
        total_findings: findings.length,
      });

      try {
        const { browserFetch } = await import("./browser-fetch");
        const fetchRes = await browserFetch({ url: target.url, mode: "text" });
        if (!fetchRes?.content) return null;

        let content = fetchRes.content;
        if (content.length > maxContentChars) {
          const truncated = content.slice(0, maxContentChars);
          const lastPara = truncated.lastIndexOf("\n\n");
          content = lastPara > maxContentChars * 0.8 ? truncated.slice(0, lastPara) : truncated;
        }

        const extractPrompt = EXTRACTOR_PROMPT
          .replace("{webpage_content}", content)
          .replace("{goal}", question);

        const extractResponse = await callLlm([{ role: "user", content: extractPrompt }], config, 0.2, 2048, abortSignal);
        const parsedExtract = parseJsonObject(extractResponse);
        if (parsedExtract) {
          return {
            ...parsedExtract,
            url: target.url,
            title: target.title || fetchRes.url || target.url,
          } as ResearchFinding;
        }
        return {
          url: target.url,
          title: target.title || fetchRes.url || target.url,
          rational: "Raw LLM extraction",
          evidence: extractResponse.slice(0, 3000),
          summary: extractResponse.slice(0, 500),
        };
      } catch (e) {
        console.warn(`Extraction failed for ${target.url}:`, e);
        return null;
      }
    });

    activeFindings.push(...extracted.filter((f): f is ResearchFinding => !!f));

    if (activeFindings.length > 0) {
      findings.push(...activeFindings);
      consecutiveEmptyRounds = 0;
      onProgress({
        phase: "reading",
        round: roundNum,
        new_sources: activeFindings.length,
        total_sources: urlsFetched.size,
        total_findings: findings.length,
      });
    } else {
      consecutiveEmptyRounds++;
      const message = `No findings extracted in round ${roundNum}.`;
      onProgress({ phase: "warning", round: roundNum, message, total_sources: urlsFetched.size, total_findings: findings.length });
      if (consecutiveEmptyRounds >= maxEmptyRounds && findings.length === 0) {
        const errorMessage = `Search unavailable: ${message}`;
        onProgress({ phase: "error", round: roundNum, message: errorMessage });
        return errorMessage;
      }
    }

    if (findings.length > 0) {
      onProgress({
        phase: "analyzing",
        round: roundNum,
        total_sources: urlsFetched.size,
        total_findings: findings.length,
      });

      const windowedFindings = findings.slice(-synthesisWindow);
      const formattedFindings = windowedFindings
        .map((f, i) => `Finding #${i + 1} from [${f.title || f.url}](${f.url}):\nSummary: ${f.summary || ""}\nEvidence: ${f.evidence || ""}`)
        .join("\n\n---\n\n");

      const synthPrompt = SYNTHESIZE_PROMPT
        .replace("{question}", question)
        .replace("{report}", report || "(First round — no report yet.)")
        .replace("{new_findings}", formattedFindings);

      try {
        const nextReport = await callLlm([{ role: "user", content: synthPrompt }], config, 0.3, maxReportTokens, abortSignal);
        if (nextReport.trim()) report = nextReport;
      } catch (e) {
        console.error("Synthesis failed:", e);
        onProgress({ phase: "warning", round: roundNum, message: "Synthesis failed, keeping gathered findings." });
      }
    }

    if (roundNum >= minRounds) {
      const stopPrompt = STOP_PROMPT
        .replace("{question}", question)
        .replace("{report}", report || formatFindings(findings))
        .replace("{round_num}", String(roundNum));

      try {
        const stopResponse = await callLlm([{ role: "user", content: stopPrompt }], config, 0.1, 128, abortSignal);
        const decisionClean = stopResponse.trim().toUpperCase().replace(/^[\s*_`"\'>#\-]+/, "");
        if (decisionClean.startsWith("YES")) {
          console.log(`LLM decided to stop after round ${roundNum}: ${decisionClean}`);
          break;
        }
      } catch (e) {
        console.warn("Stop decision prompt failed:", e);
      }
    }
  }

  // 4. FINAL MAGAZINE-QUALITY REPORT
  onProgress({ phase: "writing", total_sources: urlsFetched.size, total_findings: findings.length });

  if (!report && findings.length > 0) {
    report = fallbackReport(question, findings);
  }

  let finalPrompt = FINAL_REPORT_PROMPT
    .replace("{question}", question)
    .replace("{report}", report || "No detailed evidence collected.");

  if (category) {
    const extra = CATEGORY_PROMPTS[category];
    if (extra) {
      finalPrompt += "\n\n" + extra;
    }
  }

  let finalReport = "";
  try {
    finalReport = await callLlm([{ role: "user", content: finalPrompt }], config, 0.3, maxReportTokens, abortSignal);

    const wordCount = finalReport.split(/\s+/).length;
    if (wordCount < 400 && !abortSignal?.aborted) {
      onProgress({ phase: "writing", message: "Expanding report..." });
      finalReport = await callLlm([
        { role: "user", content: finalPrompt },
        { role: "assistant", content: finalReport },
        {
          role: "user",
          content:
            "This report is too brief. Please expand it significantly:\n" +
            "- Add detailed paragraphs for each section (not just bullet points)\n" +
            "- Include specific data, numbers, and comparisons from the evidence\n" +
            "- Explain context and significance — don't just list facts\n" +
            "- Use ## headings and ### subheadings\n" +
            "- Target at least 1000 words\n" +
            "Write the full expanded report now."
        }
      ], config, 0.4, maxReportTokens, abortSignal);
    }
  } catch (e) {
    console.error("Final report generation failed:", e);
    finalReport = report || "Failed to generate Deep Research report.";
  }

  // Format visual findings layout
  const elapsed = (Date.now() - startTime) / 1000;
  const stats = `**Duration:** ${elapsed.toFixed(1)}s | **Queries:** ${queriesUsed.size} | **URLs Analyzed:** ${urlsFetched.size}`;
  
  const sourceLines = Array.from(new Set(findings.map((f) => `- [${f.title}](${f.url})`))).join("\n");
  const sourcesSection = sourceLines ? `\n### Sources\n\n${sourceLines}\n` : "";

  const rawFindings = findings
    .map((f, i) => `**${i+1}. [${f.title}](${f.url})**\n\n${f.summary || f.evidence || "(no summary)"}`)
    .join("\n\n");

  const collectedSection = rawFindings
    ? `\n<details>\n<summary><strong>Raw collected findings (${findings.length} sources)</strong></summary>\n\n${rawFindings}\n</details>\n`
    : "";

const finalOutput = `---

## Deep Research Summary

${stats}

---

${finalReport}

${sourcesSection}
${collectedSection}
---

**The AI has analyzed all Deep Research findings above. Ask me anything about: "${question}"**
`;

  onProgress({ phase: "done", total_sources: urlsFetched.size, total_findings: findings.length });
  return finalOutput;
}
