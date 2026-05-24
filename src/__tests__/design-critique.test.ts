import { describe, it, expect, vi, beforeEach } from "vitest";
import { runCritique } from "../lib/design/critique";

// Mock the model factory so we never hit a real LLM.
vi.mock("../lib/model-factory", () => ({
  createModel: vi.fn().mockResolvedValue("mock-model"),
}));

// Mock generateText from the ai package.
const mockGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

const MIN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Test</title><style>:root{--bg:#fff;--fg:#111;}</style></head><body><h1>Hello</h1><p>A real sentence with meaning.</p></body></html>`;

const MOCK_CONFIG = {
  provider: "openai",
  model: "gpt-4o",
  apiKey: "sk-test",
} as unknown as Parameters<typeof runCritique>[1];

function validCritiqueJson(scores: Partial<Record<string, number>> = {}) {
  return {
    text: JSON.stringify({
      philosophy: scores.philosophy ?? 4,
      hierarchy: scores.hierarchy ?? 4,
      execution: scores.execution ?? 3,
      specificity: scores.specificity ?? 4,
      restraint: scores.restraint ?? 5,
      summary: "Solid work. Typography is tight; push the hierarchy further.",
    }),
  };
}

describe("runCritique", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns scores and summary for valid JSON response", async () => {
    mockGenerateText.mockResolvedValueOnce(validCritiqueJson());

    const result = await runCritique(MIN_HTML, MOCK_CONFIG);

    expect(result).not.toBeNull();
    expect(result!.scores.philosophy).toBe(4);
    expect(result!.scores.hierarchy).toBe(4);
    expect(result!.scores.execution).toBe(3);
    expect(result!.scores.specificity).toBe(4);
    expect(result!.scores.restraint).toBe(5);
    expect(result!.overall).toBe(4);
    expect(result!.belowBar).toEqual([]);
    expect(result!.summary).toContain("Solid work");
  });

  it("detects dimensions below bar (score < 3)", async () => {
    mockGenerateText.mockResolvedValueOnce(
      validCritiqueJson({ execution: 2, specificity: 1 }),
    );

    const result = await runCritique(MIN_HTML, MOCK_CONFIG);

    expect(result).not.toBeNull();
    expect(result!.belowBar).toContain("execution");
    expect(result!.belowBar).toContain("specificity");
    expect(result!.belowBar).not.toContain("philosophy");
    expect(result!.overall).toBeCloseTo(3.2);
  });

  it("returns null when model response has no JSON", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "This artifact looks great! No scores here.",
    });

    const result = await runCritique(MIN_HTML, MOCK_CONFIG);

    expect(result).toBeNull();
  });

  it("returns null when JSON is missing required dimensions", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ philosophy: 4, summary: "ok" }),
    });

    const result = await runCritique(MIN_HTML, MOCK_CONFIG);

    expect(result).toBeNull();
  });

  it("returns null when scores are out of range (1-5)", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        philosophy: 0,
        hierarchy: 4,
        execution: 3,
        specificity: 4,
        restraint: 5,
        summary: "ok",
      }),
    });

    const result = await runCritique(MIN_HTML, MOCK_CONFIG);

    expect(result).toBeNull();
  });

  it("returns null on model error (network / provider failure)", async () => {
    mockGenerateText.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await runCritique(MIN_HTML, MOCK_CONFIG);

    expect(result).toBeNull();
  });

  it("returns null on timeout", async () => {
    // Simulate a timeout by making generateText never resolve within the
    // 30s window. We use Promise.race internally, so we need to make the
    // timeout win. Use vi.useFakeTimers to control the clock.
    vi.useFakeTimers();

    const critiquePromise = runCritique(MIN_HTML, MOCK_CONFIG);

    // Advance past the 30s timeout.
    await vi.advanceTimersByTimeAsync(35_000);

    const result = await critiquePromise;

    expect(result).toBeNull();

    vi.useRealTimers();
  });

  it("trims large artifacts to ~24KB before sending", async () => {
    mockGenerateText.mockResolvedValueOnce(validCritiqueJson());

    // Build an artifact larger than 24KB.
    const largeHtml = MIN_HTML + "\n<!-- " + "x".repeat(50_000) + " -->";

    await runCritique(largeHtml, MOCK_CONFIG);

    // The prompt sent to generateText should be trimmed.
    const callArg = mockGenerateText.mock.calls[0][0];
    expect(callArg.prompt.length).toBeLessThanOrEqual(
      24_000 + "Score this artifact:\n\n".length + 200, // 200 char slop for elision markers
    );
  });

  it("respects abort signal when passed", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runCritique(MIN_HTML, MOCK_CONFIG, controller.signal);

    // When aborted before generateText runs, it should either return null
    // (caught error) or short-circuit depending on timing.
    // The function catches all errors, so it returns null.
    expect(result).toBeNull();
  });
});
