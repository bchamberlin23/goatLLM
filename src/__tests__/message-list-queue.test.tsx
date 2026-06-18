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
    messageQueue: { [convId]: [{ content: "Tighten the conclusion" }] },
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

  it("renders queued follow-ups as pending user turns with a clear steering action", () => {
    render(<MessageList />);

    expect(screen.getByText("Queued follow-up")).toBeInTheDocument();
    expect(screen.getByText("Tighten the conclusion")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /steer now/i }));

    expect(useChatStore.getState().steerPayload).toEqual({
      conversationId: convId,
      content: "Tighten the conclusion",
      steered: true,
    });
  });
});
