import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputBar } from "../components/InputBar";
import { MessageBubble } from "../components/MessageBubble";
import { NEW_CHAT_DRAFT_KEY, useChatStore, type Message } from "../stores/chat";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

function resetStore() {
  useChatStore.setState({
    conversations: [],
    activeId: null,
    messages: {},
    drafts: {
      [NEW_CHAT_DRAFT_KEY]: { content: "", attachments: [] },
    },
    researchMode: false,
    agentMode: false,
    designMode: false,
    tavilyApiKey: "test-key",
    searchBackend: "tavily",
    discoveredSkills: [],
    disabledSkills: new Set(),
    autoTriggerSkills: new Set(),
  });
}

function assistantMessage(partial: Partial<Message>): Message {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    role: "assistant",
    content: "",
    createdAt: Date.now() - 3000,
    ...partial,
  };
}

describe("Deep Research UI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("labels the input mode as Deep Research", () => {
    resetStore();
    render(<InputBar />);

    fireEvent.click(screen.getByRole("button", { name: /attach or add/i }));

    expect(screen.getByText("Deep Research")).toBeInTheDocument();
    expect(screen.queryByText(/^Research$/)).not.toBeInTheDocument();
  });

  it("labels the active input mode as Deep Research on", () => {
    resetStore();
    useChatStore.getState().setResearchMode(true);
    render(<InputBar />);

    fireEvent.click(screen.getByRole("button", { name: /attach or add/i }));

    expect(screen.getByText("Deep Research — on")).toBeInTheDocument();
  });

  it("renders structured in-bubble progress while Deep Research is running", () => {
    resetStore();
    render(
      <MessageBubble
        message={assistantMessage({
          isStreaming: true,
          deepResearch: {
            query: "compare search providers",
            phase: "reading",
            startedAt: Date.now() - 5000,
            round: 2,
            queries: 4,
            sourceCount: 3,
            findingCount: 2,
            currentSource: {
              title: "Search provider benchmarks",
              url: "https://example.com/benchmarks",
            },
            events: [
              { id: "1", phase: "planning", message: "Planning strategy", at: Date.now() - 4000 },
              { id: "2", phase: "reading", message: "Reading Search provider benchmarks", at: Date.now() - 1000 },
            ],
          },
        } as Partial<Message>)}
      />,
    );

    expect(screen.getByText("Deep Research")).toBeInTheDocument();
    expect(screen.getByText("Reading sources")).toBeInTheDocument();
    expect(screen.getByText("Round 2")).toBeInTheDocument();
    expect(screen.getByText("3 sources")).toBeInTheDocument();
    expect(screen.getByText("2 findings")).toBeInTheDocument();
    expect(screen.getByText("Search provider benchmarks")).toBeInTheDocument();
  });
});
