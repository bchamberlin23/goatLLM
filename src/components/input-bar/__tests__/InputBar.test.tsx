import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputBar as PublicInputBar } from "../../InputBar";
import { ComposerTextarea } from "../ComposerTextarea";
import { InputBar } from "../InputBar";
import { NEW_CHAT_DRAFT_KEY, useChatStore } from "../../../stores/chat";

function resetStore() {
  useChatStore.setState({
    conversations: [],
    activeId: null,
    messages: {},
    drafts: {
      [NEW_CHAT_DRAFT_KEY]: { content: "", attachments: [] },
    },
    selectedModelId: null,
    isStreaming: false,
    streamingConversationId: null,
    streamingAbortControllers: {},
    pendingDroppedFiles: [],
    pendingFormSubmission: null,
    resendPayload: null,
    messageQueue: {},
    steerPayload: null,
    animatedBorderEnabled: false,
    researchMode: false,
    agentMode: false,
    designMode: false,
    planMode: false,
    pursueGoalMode: false,
    tavilyApiKey: "test-key",
    searchBackend: "tavily",
    discoveredSkills: [],
    disabledSkills: new Set(),
    autoTriggerSkills: new Set(),
  });
}

function setWorkingComposerState({
  animatedBorderEnabled,
  streaming,
}: {
  animatedBorderEnabled: boolean;
  streaming: boolean;
}) {
  const conversationId = "conv-working";
  useChatStore.setState({
    activeId: conversationId,
    conversations: [
      {
        id: conversationId,
        title: "Working conversation",
        lastMessagePreview: "",
        lastMessageAt: 1,
        createdAt: 1,
        modelId: null,
        systemPrompt: "",
        mode: "chat",
      },
    ],
    messages: { [conversationId]: [] },
    animatedBorderEnabled,
    streamingConversationId: streaming ? conversationId : null,
    streamingAbortControllers: streaming ? { [conversationId]: new AbortController() } : {},
  });
  return conversationId;
}

function getComposerSurface() {
  const surface = screen.getByLabelText("Message input").closest(".composer-surface");
  expect(surface).toBeInstanceOf(HTMLElement);
  return surface as HTMLElement;
}

describe("InputBar decomposition", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    resetStore();
  });

  it("preserves the public InputBar export", () => {
    resetStore();

    render(<PublicInputBar />);

    expect(screen.getByLabelText("Message input")).toBeInTheDocument();
  });

  it("renders the extracted orchestrator and persists the new-chat draft", () => {
    resetStore();

    const { unmount } = render(<InputBar />);
    fireEvent.change(screen.getByLabelText("Message input"), {
      target: { value: "keep this draft" },
    });

    expect(useChatStore.getState().drafts[NEW_CHAT_DRAFT_KEY]?.content).toBe("keep this draft");

    unmount();
    render(<InputBar />);

    expect(screen.getByLabelText("Message input")).toHaveValue("keep this draft");
  });

  it("lets ComposerTextarea own submit, newline, and history keyboard behavior", () => {
    const onSubmit = vi.fn();
    const onHistoryRecall = vi.fn();

    render(
      <ComposerTextarea
        value="hello"
        isFollowUp={false}
        isStreaming={false}
        noModelsAvailable={false}
        agentMode={false}
        designMode={false}
        speechListening={false}
        fileReferenceWorkspace={null}
        onChange={vi.fn()}
        onSubmit={onSubmit}
        onHistoryRecall={onHistoryRecall}
        onPaste={vi.fn()}
      />,
    );

    const textarea = screen.getByLabelText("Message input");
    fireEvent.keyDown(textarea, { key: "Enter" });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(textarea, { key: "ArrowUp", altKey: true });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onHistoryRecall).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["public", PublicInputBar],
    ["decomposed", InputBar],
  ] as const)(
    "shows the %s composer breathing effect only while the model is working and the toggle is on",
    (_, Component) => {
      resetStore();
      const conversationId = setWorkingComposerState({
        animatedBorderEnabled: true,
        streaming: false,
      });

      const { rerender } = render(<Component />);

      let surface = getComposerSurface();
      expect(surface).not.toHaveClass("composer-working-breath");
      expect(surface.querySelector(".working-breath-ring")).toBeNull();

      act(() => {
        useChatStore.setState({
          streamingConversationId: conversationId,
          streamingAbortControllers: { [conversationId]: new AbortController() },
        });
      });
      rerender(<Component />);

      surface = getComposerSurface();
      expect(surface).toHaveClass("composer-working-breath");
      expect(surface.querySelector(".working-breath-ring")).toBeInTheDocument();

      act(() => {
        useChatStore.setState({
          animatedBorderEnabled: false,
        });
      });
      rerender(<Component />);

      surface = getComposerSurface();
      expect(surface).not.toHaveClass("composer-working-breath");
      expect(surface.querySelector(".working-breath-ring")).toBeNull();
    },
  );
});
