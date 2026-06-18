import { describe, expect, it } from "vitest";

import { buildSummarizationRequest } from "../lib/context-manager";

import type { Message } from "../stores/chat";

function msg(id: string, role: Message["role"], content: string, createdAt: number): Message {
  return {
    id,
    conversationId: "conv-1",
    role,
    content,
    createdAt,
  };
}

describe("iterative compaction summaries", () => {
  it("uses the initial prompt when no previous summary exists", () => {
    const request = buildSummarizationRequest({
      dropped: [msg("u1", "user", "build a thing", 1)],
    });

    expect(request.promptVersion).toBe("initial");
    expect(request.system).toContain("context-compaction assistant");
    expect(request.prompt).not.toContain("<previous-summary>");
  });

  it("uses the update prompt and includes the previous summary on later compactions", () => {
    const request = buildSummarizationRequest({
      dropped: [msg("u2", "user", "now add persistence", 2)],
      previousSummary: "## Goal\nBuild a thing.",
      cumulativeFiles: {
        readFiles: ["src/App.tsx"],
        modifiedFiles: ["src/lib/db.ts"],
      },
    });

    expect(request.promptVersion).toBe("update");
    expect(request.system).toContain("preserve all existing");
    expect(request.prompt).toContain("<previous-summary>");
    expect(request.prompt).toContain("Build a thing");
    expect(request.prompt).toContain("<cumulative-files>");
    expect(request.prompt).toContain("src/lib/db.ts");
  });
});
