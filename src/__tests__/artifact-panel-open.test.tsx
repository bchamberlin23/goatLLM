import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArtifactCard } from "../components/ArtifactPanel";
import { ChatView } from "../components/ChatView";
import { SafeArtifactPanel } from "../components/SafeArtifactPanel";
import { TopBar } from "../components/TopBar";
import { useChatStore, type Artifact, type Message } from "../stores/chat";

const convId = "conv-artifact-open";
const msgId = "msg-artifact-open";

function resetStore() {
  const artifact: Artifact = {
    id: "artifact-html-1",
    kind: "html",
    title: "Demo Page",
    code: "<h1>Hello</h1>",
    messageId: msgId,
    createdAt: 2,
    versions: [
      {
        code: "<h1>Hello</h1>",
        title: "Demo Page",
        createdAt: 2,
        source: "agent",
        messageId: msgId,
      },
    ],
    activeVersionIndex: 0,
  };
  const message: Message = {
    id: msgId,
    conversationId: convId,
    role: "assistant",
    content: "```html\n<h1>Hello</h1>\n```",
    createdAt: 2,
  };

  useChatStore.setState({
    conversations: [
      {
        id: convId,
        title: "Artifact Open",
        lastMessagePreview: "",
        lastMessageAt: 2,
        createdAt: 1,
        modelId: null,
        systemPrompt: "",
      },
    ],
    activeId: convId,
    messages: { [convId]: [message] },
    artifacts: { [convId]: [artifact] },
    activeArtifactId: null,
    artifactPanelOpen: false,
    workspaceFile: null,
    activeAttachment: null,
    attachmentPanelOpen: false,
    workspacePanelOpen: false,
    subagentPanelOpen: false,
    sidebarOpen: true,
    agentMode: false,
    designMode: false,
    researchMode: false,
    planMode: false,
    isStreaming: false,
    streamingConversationId: null,
    streamingAbortControllers: {},
    drafts: {},
    discoveredSkills: [],
    disabledSkills: new Set(),
    autoTriggerSkills: new Set(),
  });

  return artifact;
}

function addMalformedArtifact() {
  useChatStore.setState((state) => ({
    artifacts: {
      ...state.artifacts,
      [convId]: [
        ...(state.artifacts[convId] ?? []),
        {
          id: "artifact-js-legacy",
          kind: "javascript" as Artifact["kind"],
          title: "Legacy Script",
          code: "console.log('legacy');",
          messageId: msgId,
          createdAt: 3,
          versions: [
            {
              code: "console.log('legacy');",
              title: "Legacy Script",
              createdAt: 3,
              source: "agent",
              messageId: msgId,
            },
          ],
          activeVersionIndex: 0,
        },
      ],
    },
  }));
}

describe("artifact panel opening", () => {
  it("opens the canvas from a normal chat artifact card", async () => {
    const artifact = resetStore();
    render(
      <div>
        <ArtifactCard artifact={artifact} />
        <SafeArtifactPanel />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /demo page/i }));

    expect(await screen.findAllByText("Demo Page")).toHaveLength(2);
    expect(screen.queryByText("Artifacts")).not.toBeInTheDocument();
    expect(useChatStore.getState().artifactPanelOpen).toBe(true);
  });

  it("opens the canvas from the chat assets menu", async () => {
    resetStore();
    render(
      <div>
        <TopBar />
        <SafeArtifactPanel />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Chat assets" }));
    fireEvent.click(screen.getByRole("button", { name: /demo page/i }));

    expect(await screen.findAllByText("Demo Page")).toHaveLength(1);
    expect(screen.queryByText("Artifacts")).not.toBeInTheDocument();
    expect(useChatStore.getState().artifactPanelOpen).toBe(true);
  });

  it("still opens a website artifact when another restored artifact has a legacy kind", async () => {
    const artifact = resetStore();
    addMalformedArtifact();
    render(
      <div>
        <ArtifactCard artifact={artifact} />
        <SafeArtifactPanel />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /demo page/i }));

    expect(await screen.findAllByText("Demo Page")).toHaveLength(2);
    expect(screen.queryByText("Artifacts")).not.toBeInTheDocument();
    expect(useChatStore.getState().artifactPanelOpen).toBe(true);
  });

  it("keeps the canvas mounted when opening a restored artifact with a legacy kind", async () => {
    resetStore();
    addMalformedArtifact();
    const legacyArtifact = useChatStore
      .getState()
      .artifacts[convId]
      .find((artifact) => artifact.id === "artifact-js-legacy")!;

    render(
      <div>
        <ArtifactCard artifact={legacyArtifact} />
        <SafeArtifactPanel />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /legacy script/i }));

    expect(await screen.findByText("Preview is not available for this artifact type.")).toBeInTheDocument();
    expect(useChatStore.getState().artifactPanelOpen).toBe(true);
  });

  it("renders an artifact canvas from the selected artifact even if the legacy open flag is stale", async () => {
    const artifact = resetStore();
    useChatStore.setState({
      activeArtifactId: artifact.id,
      artifactPanelOpen: false,
      sidebarOpen: false,
    });

    render(<ChatView onOpenSettings={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTitle("Demo Page")).toBeInTheDocument();
    });
  });

  it("keeps a workspace file canvas open after the full chat layout mounts it", async () => {
    resetStore();
    render(<ChatView onOpenSettings={() => {}} />);

    act(() => {
      useChatStore.getState().setWorkspaceFile({
        path: "src/index.html",
        name: "index.html",
        content: "<h1>Canvas File</h1>",
      });
    });

    await waitFor(() => {
      expect(useChatStore.getState().workspaceFile?.path).toBe("src/index.html");
    });
    await waitFor(() => {
      expect(screen.getAllByText("index.html").length).toBeGreaterThan(0);
    });
    expect(useChatStore.getState().artifactPanelOpen).toBe(true);
  });

  it("renders markdown workspace files as an in-app preview", async () => {
    resetStore();
    useChatStore.setState({
      artifactPanelOpen: true,
      workspaceFile: {
        path: "README.md",
        name: "README.md",
        content: "# Preview Heading\n\nA **bold** note with [a link](https://example.com).",
      },
    });

    render(<SafeArtifactPanel />);

    expect(await screen.findByRole("heading", { name: "Preview Heading", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "a link" })).toHaveAttribute("href", "https://example.com");
    expect(screen.queryByTitle("README.md")).not.toBeInTheDocument();
  });
});
