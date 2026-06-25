import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "../Sidebar";
import { useChatStore, type Conversation } from "../../../stores/chat";
import { useContextMenuStore } from "../stores/ui-store";

const sidebarDir = join(process.cwd(), "src/components/sidebar");

function conversation(overrides: Partial<Conversation> & { id: string; title: string }): Conversation {
  const { id, title, ...rest } = overrides;
  return {
    id,
    title,
    lastMessagePreview: "",
    lastMessageAt: Date.now(),
    createdAt: Date.now(),
    modelId: null,
    systemPrompt: "",
    mode: "chat",
    workspacePath: null,
    ...rest,
  };
}

function resetSidebarState(conversations: Conversation[]) {
  localStorage.clear();
  useContextMenuStore.getState().reset();
  useChatStore.setState({
    conversations,
    activeId: conversations[0]?.id ?? null,
    messages: {},
    searchQuery: "",
    streamingAbortControllers: {},
    messageSearchResults: [],
    messageSearchLoading: false,
    agentMode: false,
    designMode: false,
    notebookMode: false,
    workspacePath: null,
    designWorkspacePath: null,
    designWorkspaces: [],
    notebooks: [],
    activeNotebookId: null,
  });
}

describe("Sidebar decomposition", () => {
  beforeEach(() => {
    resetSidebarState([]);
  });

  it("keeps chat-store access and effects in the orchestrator", () => {
    const leafFiles = readdirSync(sidebarDir)
      .filter((file) => file.endsWith(".tsx") && file !== "Sidebar.tsx");

    for (const file of leafFiles) {
      const source = readFileSync(join(sidebarDir, file), "utf8");
      expect(source, `${file} should receive derived props instead of reading chat state`).not.toContain("useChatStore");
      expect(source, `${file} should stay effect-free`).not.toContain("useEffect");
    }
  });

  it("keeps the orchestrator under 200 lines", () => {
    const source = readFileSync(join(sidebarDir, "Sidebar.tsx"), "utf8");
    expect(source.trim().split(/\r?\n/).length).toBeLessThan(200);
  });

  it("virtualizes conversation rows at the requested row size and overscan", () => {
    const source = readFileSync(join(sidebarDir, "ConversationsSection.tsx"), "utf8");
    expect(source).toContain("useVirtualizer");
    expect(source).toContain("estimateSize: () => 32");
    expect(source).toContain("overscan: 8");
  });
});

describe("Sidebar", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "list_workspaces") return ["/tmp/project"];
      return undefined;
    });
    resetSidebarState([
      conversation({ id: "chat-1", title: "Personal chat" }),
      conversation({ id: "agent-1", title: "Agent project chat", mode: "agent", workspacePath: "/tmp/project" }),
      conversation({ id: "design-1", title: "Design folder chat", mode: "design", workspacePath: "/tmp/design" }),
    ]);
  });

  it("renders the chat sidebar without leaking workspace or design conversations", () => {
    render(<Sidebar onOpenSettings={() => {}} />);

    expect(screen.getByText("Personal chat")).toBeInTheDocument();
    expect(screen.queryByText("Agent project chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Design folder chat")).not.toBeInTheDocument();
  });

  it("does not retag the active conversation when selecting a project", async () => {
    resetSidebarState([
      conversation({ id: "chat-1", title: "Personal chat" }),
      conversation({ id: "agent-1", title: "Agent project chat", mode: "agent", workspacePath: "/tmp/project" }),
    ]);
    useChatStore.setState({
      agentMode: true,
      activeId: "chat-1",
      workspacePath: null,
    });

    render(<Sidebar onOpenSettings={() => {}} />);
    fireEvent.click(await screen.findByTitle("/tmp/project"));

    expect(useChatStore.getState().conversations.find((c) => c.id === "chat-1")).toEqual(
      expect.objectContaining({
        mode: "chat",
        workspacePath: null,
      }),
    );
  });

  it("shows only agent conversations in project sections", async () => {
    resetSidebarState([
      conversation({ id: "agent-1", title: "Agent project chat", mode: "agent", workspacePath: "/tmp/project" }),
      conversation({ id: "chat-legacy", title: "Legacy workspace chat", mode: "chat", workspacePath: "/tmp/project" }),
      conversation({ id: "design-1", title: "Design folder chat", mode: "design", workspacePath: "/tmp/project" }),
    ]);
    useChatStore.setState({
      agentMode: true,
      activeId: "agent-1",
      workspacePath: "/tmp/project",
    });

    render(<Sidebar onOpenSettings={() => {}} />);

    expect(await screen.findByText("Agent project chat")).toBeInTheDocument();
    expect(screen.queryByText("Legacy workspace chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Design folder chat")).not.toBeInTheDocument();
  });
});
