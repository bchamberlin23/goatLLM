/**
 * 5-dimensional self-critique helper for design-mode artifacts.
 *
 * The critique prompt asks the model to score the artifact 1–5 across:
 *   philosophy   — does the artifact have a coherent point of view?
 *   hierarchy    — is the most important thing the largest / most contrasted?
 *   execution    — typography, spacing, alignment, color discipline
 *   specificity  — real content, real numbers, no generic placeholders
 *   restraint    — anti-AI-slop: no purple gradients, no emoji icons, no fake stats
 *
 * Adapted from `nexu-io/open-design`'s discovery prompt (Apache-2.0,
 * apps/daemon/src/prompts/discovery.ts — 5-dim critique block). Runs
 * against the user's current model config; failures degrade gracefully
 * to "couldn't score".
 */

import { generateText } from "ai";
import { createModel } from "../model-factory";
import type { LlmConfig } from "../llm-types";

export interface CritiqueScores {
  philosophy: number;
  hierarchy: number;
  execution: number;
  specificity: number;
  restraint: number;
}

export interface CritiqueResult {
  scores: CritiqueScores;
  summary: string;
  /** Average score across the five dimensions, 1..5. */
  overall: number;
  /** Dimensions that scored below 3 — surfaces a regenerate affordance. */
  belowBar: (keyof CritiqueScores)[];
}

const CRITIQUE_PROMPT = `You are a senior design critic. Score the HTML artifact below 1-5 across five dimensions.

DIMENSIONS:
- philosophy: does it have a coherent point of view? Or does it read as generic?
- hierarchy: is the most important thing the largest or most contrasted? Never neither.
- execution: typography, spacing, alignment, color discipline. Are tokens applied consistently?
- specificity: real content, real numbers. Penalize "Lorem ipsum", invented metrics, fake testimonials.
- restraint: anti-AI-slop. Penalize purple→blue gradients, generic emoji icons, three-icon feature grids, glow halos, glassmorphism, second accent colors visible at once.

Respond with JSON only, this exact shape, no prose around it:
{
  "philosophy": 1-5,
  "hierarchy": 1-5,
  "execution": 1-5,
  "specificity": 1-5,
  "restraint": 1-5,
  "summary": "one sentence — what's working and what to fix first"
}`;

export async function runCritique(
  code: string,
  config: LlmConfig,
  signal?: AbortSignal,
): Promise<CritiqueResult | null> {
  // Cap the body at ~24KB so we don't blow the model's input budget on a
  // very long single-page render. The first 24KB usually carries the head,
  // tokens, hero, and a few sections — enough to score.
  const trimmed =
    code.length > 24_000
      ? code.slice(0, 12_000) +
        `\n\n…[middle ${code.length - 24_000} chars elided]…\n\n` +
        code.slice(code.length - 12_000)
      : code;

  const CRITIQUE_TIMEOUT_MS = 30_000;

  try {
    const model = await createModel(config);

    // Wrap generateText in a timeout so a hanging model doesn't block the
    // UI forever. The signal param already supports AbortController; we
    // layer a Promise.race on top for callers that don't pass one.
    const textPromise = generateText({
      model,
      system: CRITIQUE_PROMPT,
      prompt: `Score this artifact:\n\n${trimmed}`,
      maxOutputTokens: 400,
      temperature: 0.2,
      abortSignal: signal,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("critique timed out")), CRITIQUE_TIMEOUT_MS),
    );

    const result = await Promise.race([textPromise, timeoutPromise]);
    const parsed = parseCritiqueJson(result.text);
    if (!parsed) return null;
    const overall =
      (parsed.scores.philosophy +
        parsed.scores.hierarchy +
        parsed.scores.execution +
        parsed.scores.specificity +
        parsed.scores.restraint) /
      5;
    const belowBar = (Object.keys(parsed.scores) as (keyof CritiqueScores)[]).filter(
      (k) => parsed.scores[k] < 3,
    );
    return { ...parsed, overall, belowBar };
  } catch {
    return null;
  }
}

function parseCritiqueJson(
  text: string,
): { scores: CritiqueScores; summary: string } | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const dims: (keyof CritiqueScores)[] = [
      "philosophy",
      "hierarchy",
      "execution",
      "specificity",
      "restraint",
    ];
    const scores = {} as CritiqueScores;
    for (const d of dims) {
      const v = Number(obj[d]);
      if (!Number.isFinite(v) || v < 1 || v > 5) return null;
      scores[d] = Math.round(v);
    }
    const summary =
      typeof obj.summary === "string" && obj.summary.length > 0
        ? obj.summary
        : "No summary provided.";
    return { scores, summary };
  } catch {
    return null;
  }
}
