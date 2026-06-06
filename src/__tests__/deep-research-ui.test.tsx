import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputBar } from "../components/InputBar";
import { MessageBubble } from "../components/MessageBubble";
import { ToolsTab } from "../components/settings/ToolsTab";
import { NEW_CHAT_DRAFT_KEY, useChatStore, type Message } from "../stores/chat";
import { planResolvers } from "../lib/deep-research";

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

    expect(screen.getByText("Researching Goal")).toBeInTheDocument();
    expect(screen.getByText(/Reading sources/)).toBeInTheDocument();
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

  it("renders planning draft and supports editing and starting the plan", () => {
    resetStore();
    const mockResolve = vi.fn();
    const msgId = "msg-planning";
    const convId = "conv-planning";
    
    // Seed the global planResolvers map
    planResolvers.set(msgId, mockResolve);

    // Initial state setup in store
    useChatStore.setState({
      conversations: [{ id: convId, title: "New Conversation", createdAt: Date.now(), lastMessagePreview: "", lastMessageAt: Date.now(), modelId: "gpt-4", systemPrompt: "" }],
      messages: {
        [convId]: [
          assistantMessage({
            id: msgId,
            conversationId: convId,
            isStreaming: true,
            deepResearch: {
              query: "undervalued stocks",
              phase: "planning",
              startedAt: Date.now() - 1000,
              planTitle: "Undervalued stocks research",
              planSteps: ["Step one", "Step two"],
              planApproved: false,
              events: [],
            },
          }),
        ],
      },
    });

    function TestWrapper() {
      const messages = useChatStore((s) => s.messages[convId] ?? []);
      return <MessageBubble message={messages[0]} />;
    }

    render(<TestWrapper />);

    // 1. Verify Draft Card is displayed
    expect(screen.getByText("Draft Research Plan")).toBeInTheDocument();
    expect(screen.getByText("Undervalued stocks research")).toBeInTheDocument();
    expect(screen.getByText("Step one")).toBeInTheDocument();
    expect(screen.getByText("Step two")).toBeInTheDocument();

    // 2. Click Edit to switch to edit mode
    fireEvent.click(screen.getByRole("button", { name: /edit plan/i }));
    expect(screen.getByLabelText("Edit Research Plan")).toBeInTheDocument();

    // Verify inputs are visible
    const titleInput = screen.getByPlaceholderText("e.g. Undervalued stocks with high upside");
    expect(titleInput).toHaveValue("Undervalued stocks research");
    
    // Change title
    fireEvent.change(titleInput, { target: { value: "Modified stock title" } });

    // Save changes
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    // Verify it saved and returned to preview mode
    expect(screen.getByText("Draft Research Plan")).toBeInTheDocument();
    expect(screen.getByText("Modified stock title")).toBeInTheDocument();

    // 3. Click Start to approve and run the plan
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    
    // Verify that the resolver was called with the latest steps
    expect(mockResolve).toHaveBeenCalledWith(["Step one", "Step two"]);
    
    // Verify that the message deepResearch phase is now updated to approved
    const updatedMsg = useChatStore.getState().messages[convId][0];
    expect(updatedMsg.deepResearch?.planApproved).toBe(true);
  });

  it("supports editing/updating the plan steps while research is running", () => {
    resetStore();
    const msgId = "msg-running";
    const convId = "conv-running";

    useChatStore.setState({
      conversations: [{ id: convId, title: "New Conversation", createdAt: Date.now(), lastMessagePreview: "", lastMessageAt: Date.now(), modelId: "gpt-4", systemPrompt: "" }],
      messages: {
        [convId]: [
          assistantMessage({
            id: msgId,
            conversationId: convId,
            isStreaming: true,
            deepResearch: {
              query: "undervalued stocks",
              phase: "searching",
              startedAt: Date.now() - 1000,
              planTitle: "Running stock research",
              planSteps: ["Task one", "Task two"],
              planApproved: true,
              round: 1,
              queries: 2,
              events: [],
            },
          }),
        ],
      },
    });

    function TestWrapper() {
      const messages = useChatStore((s) => s.messages[convId] ?? []);
      return <MessageBubble message={messages[0]} />;
    }

    render(<TestWrapper />);

    // 1. Verify running progress card and steps
    expect(screen.getByText("Researching Goal")).toBeInTheDocument();
    expect(screen.getByText("Running stock research")).toBeInTheDocument();
    expect(screen.getByText("Task one")).toBeInTheDocument();
    expect(screen.getByText("Task two")).toBeInTheDocument();
    expect(screen.getByText("Searching web...")).toBeInTheDocument();

    // 2. Click Update to edit the plan
    fireEvent.click(screen.getByRole("button", { name: /update/i }));
    expect(screen.getByLabelText("Edit Research Plan")).toBeInTheDocument();

    // Verify input has the current steps
    const stepInputs = screen.getAllByPlaceholderText(/step/i);
    expect(stepInputs[0]).toHaveValue("Task one");

    // Change step 1 value
    fireEvent.change(stepInputs[0], { target: { value: "Task one updated" } });

    // Save changes
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    // Verify it updated on the progress card
    expect(screen.getByText("Researching Goal")).toBeInTheDocument();
    expect(screen.getByText("Task one updated")).toBeInTheDocument();

    // Verify state in store is updated
    const updatedMsg = useChatStore.getState().messages[convId][0];
    expect(updatedMsg.deepResearch?.planSteps).toEqual(["Task one updated", "Task two"]);
  });

  it("supports configuring deep research max rounds and max searches in settings", () => {
    resetStore();

    // 1. Verify store defaults
    expect(useChatStore.getState().deepResearchMaxRounds).toBe(4);
    expect(useChatStore.getState().deepResearchMaxSearches).toBe(3);

    render(<ToolsTab />);

    // 2. Locate the inputs within the Deep Research section
    const section = screen.getByText("Deep Research").closest("section")!;
    const inputs = section.querySelectorAll('input[type="number"]');
    expect(inputs).toHaveLength(2);
    const roundsInput = inputs[0] as HTMLInputElement;
    const searchesInput = inputs[1] as HTMLInputElement;

    expect(roundsInput).toHaveValue(4);
    expect(searchesInput).toHaveValue(3);

    // 3. Change max rounds
    fireEvent.change(roundsInput, { target: { value: "6" } });
    expect(useChatStore.getState().deepResearchMaxRounds).toBe(6);

    // 4. Change max searches per round
    fireEvent.change(searchesInput, { target: { value: "5" } });
    expect(useChatStore.getState().deepResearchMaxSearches).toBe(5);
  });
});
