import { fireEvent, render, screen } from "@testing-library/react";
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
});
