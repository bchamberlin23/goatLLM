import { describe, expect, it } from "vitest";
import {
  appendScheduledRun,
  buildContinueScheduledRunPrompt,
  computeNextScheduledRun,
  createScheduledAgentRun,
  dueScheduledAgents,
  sanitizeScheduledAgentRuns,
  settleScheduledAgentRuntimeState,
  updateScheduledAgentAfterRun,
} from "../scheduled-agents";
import type { ScheduledAgent } from "../../stores/chat";

const agent = (overrides: Partial<ScheduledAgent> = {}): ScheduledAgent => ({
  id: "agent-1",
  name: "Daily digest",
  prompt: "Summarize the repo",
  schedule: "0 9 * * *",
  enabled: true,
  nextRunAt: Date.UTC(2026, 5, 18, 9, 0, 0),
  lastStatus: "idle",
  ...overrides,
});

describe("scheduled-agents", () => {
  it("computes next runs for presets, intervals, and daily cron", () => {
    const from = new Date(Date.UTC(2026, 5, 18, 8, 30, 0));

    expect(computeNextScheduledRun("@daily", from).toISOString()).toBe("2026-06-19T00:00:00.000Z");
    expect(computeNextScheduledRun("@weekly", from).toISOString()).toBe("2026-06-25T00:00:00.000Z");
    expect(computeNextScheduledRun("*/15 * * * *", from).toISOString()).toBe("2026-06-18T08:45:00.000Z");
    expect(computeNextScheduledRun("0 9 * * *", from).toISOString()).toBe("2026-06-18T09:00:00.000Z");
  });

  it("selects only enabled due agents without running duplicates", () => {
    const now = Date.UTC(2026, 5, 18, 10, 0, 0);
    const agents = [
      agent({ id: "due", nextRunAt: now - 1 }),
      agent({ id: "future", nextRunAt: now + 1 }),
      agent({ id: "off", enabled: false, nextRunAt: now - 1 }),
    ];
    const runs = [createScheduledAgentRun(agent({ id: "busy" }), now)];

    expect(dueScheduledAgents([...agents, agent({ id: "busy", nextRunAt: now - 1 })], runs, now).map((a) => a.id)).toEqual(["due"]);
  });

  it("records immutable run rows and caps history newest first", () => {
    const first = createScheduledAgentRun(agent(), 10);
    const second = createScheduledAgentRun(agent(), 11);
    const runs = appendScheduledRun([first], second, 1);

    expect(runs).toEqual([second]);
    expect(second).toMatchObject({
      agentId: "agent-1",
      status: "queued",
      prompt: "Summarize the repo",
      createdAt: 11,
    });
  });

  it("updates agents after completed and failed runs", () => {
    const completed = updateScheduledAgentAfterRun(agent(), {
      status: "done",
      result: "Digest complete",
      completedAt: 20,
      nextRunAt: 30,
    });
    const failed = updateScheduledAgentAfterRun(agent(), {
      status: "error",
      error: "No model",
      completedAt: 21,
      nextRunAt: 31,
    });

    expect(completed).toMatchObject({ lastStatus: "done", lastResult: "Digest complete", lastRunAt: 20, nextRunAt: 30 });
    expect(failed).toMatchObject({ lastStatus: "error", lastResult: "No model", lastRunAt: 21, nextRunAt: 31 });
  });

  it("settles interrupted runtime state on hydrate", () => {
    const { agents, runs } = settleScheduledAgentRuntimeState(
      [agent({ lastStatus: "running", lastResult: "halfway" })],
      [
        {
          id: "run-1",
          agentId: "agent-1",
          agentName: "Daily digest",
          prompt: "Summarize",
          status: "running",
          createdAt: 1,
          startedAt: 2,
          trace: [],
        },
      ],
    );

    expect(agents[0]).toMatchObject({ lastStatus: "error", lastResult: "Scheduled run interrupted." });
    expect(runs[0]).toMatchObject({ status: "error", error: "Scheduled run interrupted." });
  });

  it("sanitizes malformed run rows", () => {
    const runs = sanitizeScheduledAgentRuns([
      { id: "ok", agentId: "a", agentName: "A", prompt: "P", status: "done", createdAt: 1, trace: ["x"], result: "done" },
      { id: 1, agentId: "bad" },
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0].trace).toEqual(["x"]);
  });

  it("builds continue-in-thread prompt with trace and result", () => {
    const prompt = buildContinueScheduledRunPrompt({
      id: "run-1",
      agentId: "agent-1",
      agentName: "Daily digest",
      prompt: "Summarize",
      status: "done",
      createdAt: 1,
      startedAt: 2,
      completedAt: 3,
      result: "Summary body",
      trace: ["Started", "Fetched files"],
    });

    expect(prompt).toContain("Scheduled agent: Daily digest");
    expect(prompt).toContain("Original prompt:\nSummarize");
    expect(prompt).toContain("Result:\nSummary body");
    expect(prompt).toContain("- Started");
  });
});
