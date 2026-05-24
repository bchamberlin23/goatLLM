/**
 * Grep-routing eval suite (PR0).
 *
 * Tests that the system-prompt rewrite + new search_content flags actually
 * shifted model behavior: a grep-shaped prompt should produce a
 * `search_content` tool call as the model's first move, not `bash`.
 *
 * Manual / opt-in: skipped unless GOATLLM_EVAL=1 is set in the environment
 * and a reachable local provider is configured. Run on PR review, not on
 * every push:
 *
 *   GOATLLM_EVAL=1 pnpm vitest run src/__tests__/evals/grep-routing.eval.ts
 *
 * Defaults to LM Studio at http://localhost:1234 with the model id
 * "lmstudio". Override via env:
 *   GOATLLM_EVAL_PROVIDER=ollama
 *   GOATLLM_EVAL_BASE_URL=http://localhost:11434/v1
 *   GOATLLM_EVAL_MODEL_ID=llama3.1
 *
 * Pass criterion: model emits a tool-call chunk with the expected name
 * (and, for cases that test the new flags, the expected arg) before any
 * other tool-call. Token / latency / cost are not measured here.
 */
import { describe, it, expect } from "vitest";

import { agentLoop } from "../../lib/agentLoop";
import type { LlmConfig, LlmMessage, ToolCallInfo } from "../../lib/llm-types";
import { buildAgentSystemPrompt } from "../../lib/system-prompt";
import { ALL_TOOLS } from "../../lib/tools/registry";

const ENABLED = process.env.GOATLLM_EVAL === "1";
const PROVIDER = process.env.GOATLLM_EVAL_PROVIDER ?? "lmstudio";
const BASE_URL = process.env.GOATLLM_EVAL_BASE_URL ?? "http://localhost:1234/v1";
const MODEL_ID = process.env.GOATLLM_EVAL_MODEL_ID ?? "lmstudio";

interface EvalCase {
  name: string;
  prompt: string;
  /** Acceptable first tool calls. Pass if any matches. */
  expected: Array<{ tool: string; argSubstr?: string; argEquals?: Record<string, unknown> }>;
}

const CASES: EvalCase[] = [
  {
    name: "find all uses of handleClick",
    prompt: "find all uses of `handleClick` in this codebase",
    expected: [{ tool: "search_content" }],
  },
  {
    name: "case-insensitive search for TODO",
    prompt: "search case-insensitively for TODO",
    expected: [
      { tool: "search_content", argEquals: { case_insensitive: true } },
    ],
  },
  {
    name: "context lines around useState",
    prompt: "show 3 lines of context around each match for `useState`",
    expected: [
      { tool: "search_content", argEquals: { context_lines: 3 } },
    ],
  },
  {
    name: "list files containing 'experimental'",
    prompt: "list files containing the word `experimental`",
    // Either is acceptable — search_content first is preferred, bash with
    // grep -l is the documented fallback.
    expected: [
      { tool: "search_content" },
      { tool: "bash", argSubstr: "grep -l" },
    ],
  },
  {
    name: "count occurrences (grep -c territory)",
    prompt: "count how many lines mention `console.log`",
    // grep -c is intentionally NOT in search_content; bash is acceptable.
    expected: [
      { tool: "bash" },
      { tool: "search_content" },
    ],
  },
];

interface RunResult {
  firstToolCall: ToolCallInfo | null;
  text: string;
  error: Error | null;
}

async function runOneCase(prompt: string): Promise<RunResult> {
  const config: LlmConfig = {
    provider: PROVIDER,
    modelId: MODEL_ID,
    apiKey: null,
    baseUrl: BASE_URL,
  };

  const systemPrompt = buildAgentSystemPrompt({
    tools: ALL_TOOLS,
    workspacePath: "/tmp/goatllm-eval-fixture",
  });

  const messages: LlmMessage[] = [{ role: "user", content: prompt }];
  let firstToolCall: ToolCallInfo | null = null;
  let text = "";
  let error: Error | null = null;

  await agentLoop(messages, systemPrompt, config, {
    onToken: (chunk) => {
      text += chunk;
    },
    onToolCall: (tc) => {
      if (!firstToolCall) firstToolCall = tc;
    },
    onDone: () => {},
    onError: (e) => {
      error = e;
    },
  }, {
    tools: ALL_TOOLS,
    maxToolRounds: 1, // short-circuit after the first tool call
  });

  return { firstToolCall, text, error };
}

function matches(tc: ToolCallInfo, expected: EvalCase["expected"]): boolean {
  for (const e of expected) {
    if (tc.toolName !== e.tool) continue;
    if (e.argSubstr) {
      const argStr = JSON.stringify(tc.input ?? {});
      if (!argStr.includes(e.argSubstr)) continue;
    }
    if (e.argEquals) {
      const input = (tc.input ?? {}) as Record<string, unknown>;
      const ok = Object.entries(e.argEquals).every(([k, v]) => input[k] === v);
      if (!ok) continue;
    }
    return true;
  }
  return false;
}

describe.skipIf(!ENABLED)("PR0 grep-routing eval (manual, GOATLLM_EVAL=1)", () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const result = await runOneCase(c.prompt);
      if (result.error) {
        // Provider unreachable or auth failure: surface, don't silently pass.
        throw new Error(
          `Eval failed to reach provider (${PROVIDER} @ ${BASE_URL} / ${MODEL_ID}): ${result.error.message}`,
        );
      }
      expect(
        result.firstToolCall,
        `Model produced no tool call. Text was: ${result.text.slice(0, 200)}`,
      ).not.toBeNull();
      const ok = matches(result.firstToolCall as ToolCallInfo, c.expected);
      expect(
        ok,
        `Expected one of ${JSON.stringify(c.expected)}, got ${JSON.stringify({
          tool: (result.firstToolCall as ToolCallInfo).toolName,
          input: (result.firstToolCall as ToolCallInfo).input,
        })}`,
      ).toBe(true);
    }, 60_000);
  }
});
