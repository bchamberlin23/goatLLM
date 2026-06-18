import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEETING_SETTINGS,
  buildContinueMeetingPrompt,
  buildMeetingSummaryPrompt,
  createMeetingSession,
  extractMeetingSections,
  sanitizeMeetingSessions,
  settleMeetingRuntimeState,
} from "../meeting-assistant";

describe("meeting-assistant", () => {
  it("creates durable meeting session rows", () => {
    const session = createMeetingSession({
      title: "Design review",
      source: "upload",
      audioFilename: "review.m4a",
      now: 10,
    });

    expect(session).toMatchObject({
      title: "Design review",
      source: "upload",
      audioFilename: "review.m4a",
      status: "transcribing",
      createdAt: 10,
      updatedAt: 10,
      actionItems: [],
      decisions: [],
      participants: [],
    });
  });

  it("settles runtime-only statuses on hydrate", () => {
    const sessions = settleMeetingRuntimeState([
      createMeetingSession({ title: "Live", source: "recording", now: 1 }),
      { ...createMeetingSession({ title: "Done", source: "upload", now: 2 }), status: "done", summary: "ok" },
    ]);

    expect(sessions[0]).toMatchObject({
      status: "error",
      error: "Meeting processing interrupted.",
    });
    expect(sessions[1]).toMatchObject({ status: "done", summary: "ok" });
  });

  it("sanitizes malformed sessions", () => {
    const sessions = sanitizeMeetingSessions([
      { id: "m1", title: "Weekly", source: "upload", status: "done", createdAt: 1, updatedAt: 2, actionItems: ["Ship"], decisions: ["Use pnpm"], participants: ["Ada"] },
      { id: 12, title: "bad" },
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].participants).toEqual(["Ada"]);
  });

  it("builds summary prompts with style and transcript", () => {
    const prompt = buildMeetingSummaryPrompt({
      ...createMeetingSession({ title: "Planning", source: "upload", now: 1 }),
      transcript: "Ada: We will ship Friday.\nBen: I own docs.",
    }, { ...DEFAULT_MEETING_SETTINGS, summaryStyle: "detailed" });

    expect(prompt).toContain("Meeting title: Planning");
    expect(prompt).toContain("Style: detailed");
    expect(prompt).toContain("Ada: We will ship Friday.");
  });

  it("extracts decisions and action items from markdown summaries", () => {
    const sections = extractMeetingSections(`
## Summary
We planned the release.

## Decisions
- Ship on Friday
- Keep pnpm

## Action Items
- Ada: Prepare release notes
- Ben: Update docs
`);

    expect(sections.decisions).toEqual(["Ship on Friday", "Keep pnpm"]);
    expect(sections.actionItems).toEqual(["Ada: Prepare release notes", "Ben: Update docs"]);
  });

  it("builds continue-in-thread prompt", () => {
    const prompt = buildContinueMeetingPrompt({
      ...createMeetingSession({ title: "Planning", source: "upload", now: 1 }),
      transcript: "Transcript body",
      summary: "Summary body",
      actionItems: ["Ada: Notes"],
      decisions: ["Ship Friday"],
    });

    expect(prompt).toContain("Meeting: Planning");
    expect(prompt).toContain("Summary body");
    expect(prompt).toContain("- Ada: Notes");
    expect(prompt).toContain("Transcript body");
  });
});
