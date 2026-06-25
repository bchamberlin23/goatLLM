import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({
  searchMessages: vi.fn(async () => [
    {
      message_id: "m-personal",
      conversation_id: "personal",
      conversation_title: "Personal",
      role: "user",
      content_preview: "needle personal",
      created_at: 1,
    },
    {
      message_id: "m-project",
      conversation_id: "project",
      conversation_title: "Project",
      role: "user",
      content_preview: "needle project",
      created_at: 2,
    },
    {
      message_id: "m-design",
      conversation_id: "design",
      conversation_title: "Design",
      role: "user",
      content_preview: "needle design",
      created_at: 3,
    },
  ]),
}));

import { useChatStore, type Conversation } from "../stores/chat";

function conversation(overrides: Partial<Conversation> & { id: string; title: string }): Conversation {
  const now = Date.now();
  const { id, title, ...rest } = overrides;
  return {
    id,
    title,
    lastMessagePreview: "",
    lastMessageAt: now,
    createdAt: now,
    modelId: null,
    systemPrompt: "",
    mode: "chat",
    workspacePath: null,
    ...rest,
  };
}

describe("message search scoping", () => {
  beforeEach(() => {
    localStorage.clear();
    useChatStore.setState({
      conversations: [
        conversation({ id: "personal", title: "Personal" }),
        conversation({ id: "project", title: "Project", mode: "agent", workspacePath: "/tmp/project" }),
        conversation({ id: "design", title: "Design", mode: "design", workspacePath: "/tmp/design" }),
      ],
      agentMode: false,
      designMode: false,
      workspacePath: null,
      designWorkspacePath: null,
      messageSearchResults: [],
      messageSearchLoading: false,
    });
  });

  it("does not leak project or design messages into personal chat search", async () => {
    await useChatStore.getState().performMessageSearch("needle");

    expect(useChatStore.getState().messageSearchResults.map((result) => result.conversation_id)).toEqual([
      "personal",
    ]);
  });
});
