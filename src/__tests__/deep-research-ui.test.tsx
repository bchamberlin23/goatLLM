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
    plusMenuVisibility: {
      chat: { research: true },
      design: { research: true },
      agent: { research: true },
    },
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

  it("opens the detail pane when clicking sources and findings metrics", async () => {
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
            sourceCount: 2,
            findingCount: 2,
            sources: ["https://example.com/one", "https://example.com/two"],
            findings: ["First finding summary", "Second finding summary"],
            currentSource: {
              title: "Search provider benchmarks",
              url: "https://example.com/benchmarks",
            },
            events: [],
          },
        } as Partial<Message>)}
      />,
    );

    // Initial state: details pane is not open
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Click on sources badge
    fireEvent.click(screen.getByText("2 sources"));

    // Verify dialog is open and displays sources tab contents
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Research Details")).toBeInTheDocument();
    expect(screen.getAllByText("example.com").length).toBe(2);
    expect(screen.getByText("https://example.com/one")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/two")).toBeInTheDocument();

    // Switch to findings tab
    fireEvent.click(screen.getByRole("button", { name: /findings \(2\)/i }));
    expect(screen.getByText("First finding summary")).toBeInTheDocument();
    expect(screen.getByText("Second finding summary")).toBeInTheDocument();

    // Close detail pane using close button
    fireEvent.click(screen.getByRole("button", { name: /close details pane/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("supports search filtering and copy controls inside the drawer", async () => {
    const mockWriteText = vi.fn().mockImplementation(() => Promise.resolve());
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

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
            sourceCount: 2,
            findingCount: 2,
            sources: ["https://example.com/one", "https://example.com/two"],
            findings: ["First finding summary", "Second finding summary"],
            events: [],
          },
        } as Partial<Message>)}
      />,
    );

    // Open detail pane
    fireEvent.click(screen.getByText("2 sources"));

    // Verify both sources are displayed initially
    expect(screen.getByText("https://example.com/one")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/two")).toBeInTheDocument();

    // Type query to filter to "one"
    const searchInput = screen.getByPlaceholderText("Search sources by domain or URL...");
    fireEvent.change(searchInput, { target: { value: "one" } });

    // Verify filtering
    expect(screen.getByText("https://example.com/one")).toBeInTheDocument();
    expect(screen.queryByText("https://example.com/two")).not.toBeInTheDocument();

    // Test individual copy button
    const copyButton = screen.getAllByRole("button", { name: /copy source url/i })[0];
    fireEvent.click(copyButton);
    expect(mockWriteText).toHaveBeenCalledWith("https://example.com/one");

    // Clear search
    fireEvent.click(screen.getByRole("button", { name: /clear filter/i }));
    expect(screen.getByText("https://example.com/two")).toBeInTheDocument();

    // Type query that matches nothing
    fireEvent.change(searchInput, { target: { value: "nomatch" } });
    expect(screen.getByText("No matching sources")).toBeInTheDocument();
  });
});
