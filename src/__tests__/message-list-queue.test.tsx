import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "../components/MessageList";
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

const convId = "conv-queue";

function resetStore() {
  const now = Date.now();
  const message: Message = {
    id: "msg-1",
    conversationId: convId,
    role: "user",
    content: "First turn",
    createdAt: now,
  };

  useChatStore.setState({
    conversations: [
      {
        id: convId,
        title: "Queue",
        lastMessagePreview: "First turn",
        lastMessageAt: now,
        createdAt: now,
        modelId: null,
        systemPrompt: "",
      },
    ],
    activeId: convId,
    messages: { [convId]: [message] },
    messageQueue: { [convId]: [{ id: "queued-1", content: "Tighten the conclusion with a longer explanation than fits on one line" }] },
    steerPayload: null,
    streamingConversationId: convId,
    streamingAbortControllers: {},
    scrollPositions: {},
  });
}

describe("MessageList queued messages", () => {
  beforeEach(() => {
    resetStore();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("renders queued follow-ups as compact one-line turns with steer, edit, and delete actions", () => {
    render(<MessageList />);

    const queuedContent = screen.getByText("Tighten the conclusion with a longer explanation than fits on one line");
    expect(queuedContent).toHaveClass("truncate");
    expect(screen.getByRole("button", { name: /steer queued follow-up 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit queued follow-up 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete queued follow-up 1/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /steer queued follow-up 1/i }));

    expect(useChatStore.getState().steerPayload).toEqual({
      conversationId: convId,
      content: "Tighten the conclusion with a longer explanation than fits on one line",
      steered: true,
    });
  });

  it("shows a model-change divider before the next user turn", () => {
    const now = Date.now();
    useChatStore.setState({
      messages: {
        [convId]: [
          { id: "user-a", conversationId: convId, role: "user", content: "First turn", createdAt: now, modelId: "model-a" },
          { id: "assistant-a", conversationId: convId, role: "assistant", content: "First reply", createdAt: now + 1, modelId: "model-a" },
          { id: "user-b", conversationId: convId, role: "user", content: "Continue", createdAt: now + 2, modelId: "model-b" },
        ],
      },
      messageQueue: {},
    });

    render(<MessageList />);

    expect(screen.getByText("Model changed from model-a to model-b")).toBeInTheDocument();
  });
});
