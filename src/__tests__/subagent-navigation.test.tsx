import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatView } from "../components/ChatView";
import { useChatStore, type Message } from "../stores/chat";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, getItemKey }: { count: number; getItemKey: (index: number) => string | number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: getItemKey(index),
        start: index * 140,
        size: 140,
      })),
    getTotalSize: () => count * 140,
    measureElement: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

const convId = "conv-subagent-navigation";
const otherConvId = "conv-unrelated-subagent-navigation";
const toolCallId = "tool-subagent-navigation";

function resetStore() {
  const now = Date.now();
  const message: Message = {
    id: "msg-subagent-navigation",
    conversationId: convId,
    role: "assistant",
    content: "Parent conversation stays mounted",
    createdAt: now,
    toolCalls: [
      {
        toolCallId,
        toolName: "spawn_subagent",
        input: { task: "Inspect navigation lag" },
        output: "Navigation findings",
        state: "done",
        subagentTranscript: [
          { role: "user", content: "Inspect navigation lag" },
          { role: "assistant", content: "Found a parent remount." },
        ],
      },
    ],
  };

  useChatStore.setState({
    conversations: [
      {
        id: otherConvId,
        title: "Unrelated Subagent",
        lastMessagePreview: "",
        lastMessageAt: now - 1,
        createdAt: now - 1,
        modelId: null,
        systemPrompt: "",
      },
      {
        id: convId,
        title: "Subagent Navigation",
        lastMessagePreview: "",
        lastMessageAt: now,
        createdAt: now,
        modelId: null,
        systemPrompt: "",
      },
    ],
    activeId: convId,
    messages: {
      [otherConvId]: [
        {
          id: "msg-unrelated-subagent-navigation",
          conversationId: otherConvId,
          role: "assistant",
          content: "Unrelated conversation",
          createdAt: now - 1,
          toolCalls: [
            {
              toolCallId,
              toolName: "spawn_subagent",
              input: { task: "Wrong task" },
              output: "Wrong output",
              state: "done",
              subagentTranscript: [
                { role: "user", content: "Wrong task" },
                { role: "assistant", content: "Wrong transcript" },
              ],
            },
          ],
        },
      ],
      [convId]: [message],
    },
    compactionEntries: {},
    messageQueue: {},
    artifacts: {},
    activeArtifactId: null,
    artifactPanelOpen: false,
    workspaceFile: null,
    activeAttachment: null,
    attachmentPanelOpen: false,
    workspacePanelOpen: false,
    subagentPanelOpen: false,
    activeSubagentToolCallId: null,
    sidebarOpen: true,
    agentMode: false,
    designMode: false,
    researchMode: false,
    planMode: false,
    notebookMode: false,
    isStreaming: false,
    streamingConversationId: null,
    streamingAbortControllers: {},
    drafts: {},
    pendingDroppedFiles: [],
    discoveredSkills: [],
    disabledSkills: new Set(),
    autoTriggerSkills: new Set(),
  });
}

describe("subagent navigation", () => {
  beforeEach(() => {
    resetStore();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });

  it("keeps the parent message list mounted while the subagent panel is open", () => {
    render(<ChatView onOpenSettings={() => undefined} />);

    expect(screen.getByText("Parent conversation stays mounted")).toBeInTheDocument();

    act(() => {
      useChatStore.getState().openSubagentPanel(toolCallId);
    });

    expect(screen.getByRole("button", { name: /back to conversation/i })).toBeInTheDocument();
    expect(screen.getByText("Parent conversation stays mounted")).toBeInTheDocument();
  });

  it("resolves the subagent transcript from the active conversation", () => {
    render(<ChatView onOpenSettings={() => undefined} />);

    act(() => {
      useChatStore.getState().openSubagentPanel(toolCallId);
    });

    expect(screen.getAllByText("Inspect navigation lag").length).toBeGreaterThan(0);
    expect(screen.queryByText("Wrong task")).not.toBeInTheDocument();
  });
});
