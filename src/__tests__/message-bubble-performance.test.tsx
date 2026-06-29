import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageBubble } from "../components/MessageBubble";
import { useChatStore, type Message } from "../stores/chat";

const markdownMock = vi.hoisted(() => ({
  render: vi.fn(),
}));

vi.mock("../components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => {
    markdownMock.render(content);
    return <div data-testid="markdown">{content}</div>;
  },
  CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>,
}));

const convId = "conv-perf";

function resetStore() {
  const oldMessage: Message = {
    id: "old-message",
    conversationId: convId,
    role: "assistant",
    content: "Already rendered",
    createdAt: 1,
  };
  const streamingMessage: Message = {
    id: "streaming-message",
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
        title: "Perf",
        lastMessagePreview: "",
        lastMessageAt: 2,
        createdAt: 1,
        modelId: null,
        systemPrompt: "",
      },
    ],
    activeId: convId,
    messages: { [convId]: [oldMessage, streamingMessage] },
    artifacts: {},
    activeArtifactId: null,
    artifactPanelOpen: false,
    agentMode: false,
    designMode: false,
  });

  return { oldMessage, streamingMessage };
}

describe("MessageBubble performance", () => {
  beforeEach(() => {
    localStorage.clear();
    markdownMock.render.mockClear();
  });

  it("does not rerender a parentless bubble when another message streams", () => {
    const { oldMessage, streamingMessage } = resetStore();

    render(<MessageBubble message={oldMessage} />);
    expect(markdownMock.render).toHaveBeenCalledTimes(1);

    act(() => {
      useChatStore.getState().appendToMessage(convId, streamingMessage.id, "new token");
    });

    expect(markdownMock.render).toHaveBeenCalledTimes(1);
  });
});
