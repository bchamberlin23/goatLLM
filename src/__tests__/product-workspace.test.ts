import { describe, expect, it } from "vitest";
import type { Message } from "../stores/chat";
import {
  buildBranchGraph,
  buildConversationUsage,
  computeNextRun,
  createNotebookCell,
  createPromptVersion,
  estimateMessageCost,
  filterPromptDocuments,
  normalizeSyncConfig,
  sanitizeImageJobs,
  sanitizeModelComparisonRuns,
  sanitizeNotebookCells,
  sanitizeScheduledAgents,
  summarizeWatcherEvent,
} from "../lib/product-workspace";

const baseMessage = (overrides: Partial<Message>): Message => ({
  id: overrides.id ?? "m1",
  conversationId: overrides.conversationId ?? "c1",
  role: overrides.role ?? "assistant",
  content: overrides.content ?? "",
  createdAt: overrides.createdAt ?? 1,
  ...overrides,
});

describe("product workspace primitives", () => {
  it("estimates message cost from known model prices and user overrides", () => {
    const message = baseMessage({
      inputTokens: 1000,
      outputTokens: 500,
    });

    expect(estimateMessageCost(message, "openai:gpt-4o-mini")).toBeCloseTo(0.00045, 6);
    expect(
      estimateMessageCost(message, "custom:expensive", {
        "custom:expensive": { inputPerMillion: 2, outputPerMillion: 10 },
      }),
    ).toBeCloseTo(0.007, 6);
  });

  it("builds per-conversation usage with provider/model breakdowns and budget alerts", () => {
    const messages = [
      baseMessage({ id: "a1", inputTokens: 1000, outputTokens: 500, modelId: "openai:gpt-4o-mini" } as Partial<Message>),
      baseMessage({ id: "a2", inputTokens: 2000, outputTokens: 1000, modelId: "anthropic:claude-3-5-haiku-20241022" } as Partial<Message>),
    ];

    const usage = buildConversationUsage(messages, {
      modelIdForMessage: (message) => (message as Message & { modelId?: string }).modelId ?? "openai:gpt-4o-mini",
      monthlyBudgetUsd: 0.007,
      expensiveSessionUsd: 0.001,
    });

    expect(usage.totalInputTokens).toBe(3000);
    expect(usage.totalOutputTokens).toBe(1500);
    expect(usage.byProvider.map((row) => row.providerId)).toEqual(["anthropic", "openai"]);
    expect(usage.budgetStatus.state).toBe("warning");
    expect(usage.alerts.some((alert) => alert.kind === "expensive-session")).toBe(true);
  });

  it("creates explicit branch graph nodes, edges, tips, and active path", () => {
    const messages = [
      baseMessage({ id: "root", role: "user", parentId: null, createdAt: 1 }),
      baseMessage({ id: "a", role: "assistant", parentId: "root", createdAt: 2 }),
      baseMessage({ id: "b", role: "user", parentId: "a", createdAt: 3 }),
      baseMessage({ id: "fork", role: "user", parentId: "root", createdAt: 4 }),
    ];

    const graph = buildBranchGraph(messages, "b");

    expect(graph.edges).toEqual([
      { from: "root", to: "a" },
      { from: "a", to: "b" },
      { from: "root", to: "fork" },
    ]);
    expect(graph.tips.map((tip) => tip.id)).toEqual(["b", "fork"]);
    expect(graph.activePath).toEqual(["root", "a", "b"]);
  });

  it("versions prompt documents and filters by text and tags", () => {
    const first = createPromptVersion("review", "Review staged changes", {
      description: "Review code",
      tags: ["review", "code"],
      author: "local",
      at: 100,
    });
    const second = createPromptVersion("review", "Review staged changes carefully", {
      previous: first,
      description: "Review code",
      tags: ["review", "code"],
      author: "local",
      at: 200,
    });

    expect(second.version).toBe(2);
    expect(second.history).toHaveLength(1);
    expect(filterPromptDocuments([second], "carefully", ["code"])).toEqual([second]);
  });

  it("computes simple cron-style next run times", () => {
    const now = new Date("2026-06-05T04:30:00.000Z");

    expect(computeNextRun("0 5 * * *", now).toISOString()).toBe("2026-06-05T05:00:00.000Z");
    expect(computeNextRun("@daily", now).toISOString()).toBe("2026-06-06T00:00:00.000Z");
    expect(computeNextRun("*/15 * * * *", now).toISOString()).toBe("2026-06-05T04:45:00.000Z");
  });

  it("creates stable notebook cells and sync configs", () => {
    const cell = createNotebookCell("ai", "Explain this repo", 42);
    const sync = normalizeSyncConfig({
      enabled: true,
      provider: "s3",
      bucket: " goat ",
      endpoint: "https://storage.example.com/",
      prefix: "projects/goat/",
      encryptionKeyHint: "local-key",
    });

    expect(cell.id).toBe("cell-42-ai");
    expect(cell.status).toBe("idle");
    expect(sync.remoteLabel).toBe("S3 goat");
    expect(sync.prefix).toBe("projects/goat");
  });

  it("resets stuck running cells on hydrate without losing partial output", () => {
    const cleaned = sanitizeNotebookCells([
      { id: "a", kind: "ai", content: "q", status: "running", output: "partial", updatedAt: 1 },
      { id: "b", kind: "code", content: "print(1)", status: "running", output: "", updatedAt: 2 },
      { id: "c", kind: "text", content: "note", status: "done", output: "note", updatedAt: 3 },
    ]);

    // Running cell with captured output is treated as finished.
    expect(cleaned[0].status).toBe("done");
    expect(cleaned[0].output).toBe("partial");
    // Running cell with nothing yet falls back to idle.
    expect(cleaned[1].status).toBe("idle");
    // Already-settled cells are untouched.
    expect(cleaned[2].status).toBe("done");
  });

  it("tolerates malformed notebook storage", () => {
    expect(sanitizeNotebookCells(null)).toEqual([]);
    expect(sanitizeNotebookCells("oops")).toEqual([]);
    expect(sanitizeNotebookCells([null, 5, { id: "ok", kind: "text", content: "", status: "idle", updatedAt: 1 }])).toHaveLength(1);
  });

  it("settles interrupted model comparison runs on hydrate", () => {
    const cleaned = sanitizeModelComparisonRuns([
      {
        id: "run-1",
        prompt: "Compare this",
        modelIds: ["a", "b"],
        createdAt: 10,
        results: [
          { modelId: "a", status: "running", content: "partial" },
          { modelId: "b", status: "queued", content: "" },
          { modelId: "c", status: "done", content: "complete" },
        ],
      },
    ]);

    expect(cleaned[0].results.map((r) => r.status)).toEqual(["error", "error", "done"]);
    expect(cleaned[0].results[0].content).toBe("partial");
    expect(cleaned[0].results[0].error).toBe("Comparison interrupted.");
  });

  it("settles interrupted image jobs and scheduled agents on hydrate", () => {
    const jobs = sanitizeImageJobs([
      { id: "img-1", prompt: "A diagram", provider: "openai", status: "running", createdAt: 1 },
      { id: "img-2", prompt: "Finished", provider: "openai", status: "done", createdAt: 2, imageDataUrl: "data:image/png;base64,ok" },
    ]);
    const agents = sanitizeScheduledAgents([
      {
        id: "agent-1",
        name: "Nightly review",
        prompt: "Review repo",
        schedule: "@daily",
        enabled: true,
        nextRunAt: 100,
        lastStatus: "running",
      },
    ]);

    expect(jobs.map((job) => job.status)).toEqual(["error", "done"]);
    expect(jobs[0].error).toBe("Image generation interrupted.");
    expect(agents[0].lastStatus).toBe("error");
    expect(agents[0].lastResult).toBe("Scheduled run interrupted.");
  });

  it("summarizes watcher events into user-facing reactions", () => {
    expect(summarizeWatcherEvent({ path: "src/App.tsx", kind: "modify", at: 1 })).toContain("changed");
    expect(summarizeWatcherEvent({ path: "target/debug/app", kind: "create", at: 1 })).toContain("artifact");
    expect(summarizeWatcherEvent({ path: "vitest.log", kind: "modify", at: 1, diagnostic: "failed" })).toContain("failed");
  });
});
