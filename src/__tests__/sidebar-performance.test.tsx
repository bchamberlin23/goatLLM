import { Profiler, act } from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../components/Sidebar";
import { useChatStore, type Message } from "../stores/chat";

const convId = "conv-sidebar-perf";

function resetStore() {
  const assistant: Message = {
    id: "assistant-streaming",
    conversationId: convId,
    role: "assistant",
    content: "",
    createdAt: 2,
    isStreaming: true,
  };

  useChatStore.setState({
    conversations: [
      {
        id: convId,
        title: "Sidebar perf",
        lastMessagePreview: "",
        lastMessageAt: 2,
        createdAt: 1,
        modelId: null,
        systemPrompt: "",
        mode: "chat",
        workspacePath: null,
      },
    ],
    activeId: convId,
    messages: { [convId]: [assistant] },
    messageQueue: {},
    searchQuery: "",
    messageSearchResults: [],
    messageSearchLoading: false,
    streamingAbortControllers: {},
    agentMode: false,
    designMode: false,
    notebookMode: false,
  });

  return assistant;
}

describe("Sidebar performance", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not rerender when a streamed chunk does not change conversation metadata", () => {
    const assistant = resetStore();
    const renders: string[] = [];

    render(
      <Profiler id="sidebar" onRender={(_id, phase) => renders.push(phase)}>
        <Sidebar onOpenSettings={() => undefined} />
      </Profiler>,
    );

    act(() => {
      useChatStore.getState().appendToMessage(convId, assistant.id, "first");
    });
    renders.length = 0;

    vi.setSystemTime(1_100);
    act(() => {
      useChatStore.getState().appendToMessage(convId, assistant.id, " second");
    });

    expect(renders).toHaveLength(0);
  });
});
