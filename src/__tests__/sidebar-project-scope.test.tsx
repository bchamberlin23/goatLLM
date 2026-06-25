import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "../components/Sidebar";
import { useChatStore, type Conversation } from "../stores/chat";

function conversation(overrides: Partial<Conversation> & { id: string; title: string }): Conversation {
  const { id, title, ...rest } = overrides;
  const now = Date.now();
  return {
    id,
    title,
    lastMessagePreview: "",
    lastMessageAt: now,
    createdAt: now,
    modelId: null,
    systemPrompt: "",
    mode: "chat",
    workspacePath: null,
    ...rest,
  };
}

describe("app sidebar project scoping", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "list_workspaces") return ["/tmp/project"];
      return undefined;
    });
    useChatStore.setState({
      conversations: [
        conversation({ id: "agent-1", title: "Agent project chat", mode: "agent", workspacePath: "/tmp/project" }),
        conversation({ id: "legacy-1", title: "Legacy workspace chat", mode: "chat", workspacePath: "/tmp/project" }),
        conversation({ id: "design-1", title: "Design project chat", mode: "design", workspacePath: "/tmp/project" }),
      ],
      messages: {},
      activeId: "agent-1",
      streamingAbortControllers: {},
      agentMode: true,
      designMode: false,
      notebookMode: false,
      workspacePath: "/tmp/project",
    });
  });

  it("renders only exact agent conversations under a project", async () => {
    render(<Sidebar onOpenSettings={() => {}} />);

    expect(await screen.findByText("Agent project chat")).toBeInTheDocument();
    expect(screen.queryByText("Legacy workspace chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Design project chat")).not.toBeInTheDocument();
  });
});
