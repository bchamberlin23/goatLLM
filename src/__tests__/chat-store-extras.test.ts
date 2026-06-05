import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "../stores/chat";

beforeEach(() => {
  // Reset to a clean state between tests.
  useChatStore.setState({
    conversations: [],
    activeId: null,
    messages: {},
    artifacts: {},
    activeArtifactId: null,
    artifactPanelOpen: false,
    sidebarOpen: true,
    permissionMode: "manual",
    autoApprove: false,
  });
});

describe("artifact detection", () => {
  it("extracts a single HTML artifact from a fenced block", () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    const msg = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content: "Sure, here is the page:\n\n```html\n<h1>hi</h1>\n```",
    });

    store.detectArtifacts(convId, msg.id, msg.content);

    const artifacts = useChatStore.getState().artifacts[convId];
    expect(artifacts).toBeDefined();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].kind).toBe("html");
    expect(artifacts[0].code).toBe("<h1>hi</h1>");
  });

  it("extracts a Python artifact", () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    const msg = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content: "```python\nprint('hi')\n```",
    });

    store.detectArtifacts(convId, msg.id, msg.content);
    const artifacts = useChatStore.getState().artifacts[convId];
    expect(artifacts[0].kind).toBe("python");
    expect(artifacts[0].code).toBe("print('hi')");
  });

  it("updates an existing artifact in place when the heading matches across messages", () => {
    // Contract: a markdown heading on the line above the fence names the
    // artifact. Reusing the same heading + same kind in a later message
    // updates that artifact in place (id preserved, code replaced).
    const store = useChatStore.getState();
    const convId = store.createConversation();
    const msg1 = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content: "### Resume\n```latex\n\\section{Intro}\n```",
    });
    store.detectArtifacts(convId, msg1.id, msg1.content);
    const firstId = useChatStore.getState().artifacts[convId][0].id;

    const msg2 = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content: "### Resume\n```latex\n\\section{Updated}\n```",
    });
    store.detectArtifacts(convId, msg2.id, msg2.content);

    const artifacts = useChatStore.getState().artifacts[convId];
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].id).toBe(firstId);
    expect(artifacts[0].code).toBe("\\section{Updated}");
    expect(artifacts[0].messageId).toBe(msg2.id);
  });

  it("creates separate artifacts when headings differ, even for the same kind", () => {
    // Two named HTML pages should coexist. The agent can address each by
    // re-using its specific heading.
    const store = useChatStore.getState();
    const convId = store.createConversation();
    const msg = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content:
        "### Landing Page\n```html\n<h1>landing</h1>\n```\n\n### Pricing Page\n```html\n<h1>pricing</h1>\n```",
    });
    store.detectArtifacts(convId, msg.id, msg.content);

    const artifacts = useChatStore.getState().artifacts[convId];
    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((a) => a.title.toLowerCase())).toEqual([
      "landing page",
      "pricing page",
    ]);
  });

  it("falls back to first-line title when no heading precedes the fence", () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    const msg = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content: "```python\nprint('hi')\n```",
    });
    store.detectArtifacts(convId, msg.id, msg.content);
    const a = useChatStore.getState().artifacts[convId][0];
    expect(a.title).toBe("print('hi')");
  });

  it("matches headings case- and whitespace-insensitively", () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    const msg1 = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content: "### Resume Page\n```html\n<p>v1</p>\n```",
    });
    store.detectArtifacts(convId, msg1.id, msg1.content);

    const msg2 = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content: "###    resume   page   \n```html\n<p>v2</p>\n```",
    });
    store.detectArtifacts(convId, msg2.id, msg2.content);

    const artifacts = useChatStore.getState().artifacts[convId];
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].code).toBe("<p>v2</p>");
  });

  it("ignores unknown languages", () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    const msg = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content: "```rust\nfn main() {}\n```",
    });

    store.detectArtifacts(convId, msg.id, msg.content);
    expect(useChatStore.getState().artifacts[convId]).toBeUndefined();
  });

  it("opens the artifact panel and selects the first one detected", () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    const msg = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content: "```html\n<p>a</p>\n```\n\n```python\nprint(1)\n```",
    });

    store.detectArtifacts(convId, msg.id, msg.content);
    const state = useChatStore.getState();
    expect(state.artifactPanelOpen).toBe(true);
    expect(state.activeArtifactId).toBeDefined();
    const artifacts = state.artifacts[convId];
    expect(artifacts[0].kind).toBe("html");
    expect(state.activeArtifactId).toBe(artifacts[0].id);
  });

  it("does not extract empty code blocks", () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    const msg = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content: "```html\n   \n```",
    });

    store.detectArtifacts(convId, msg.id, msg.content);
    expect(useChatStore.getState().artifacts[convId]).toBeUndefined();
  });

  it("clearArtifacts removes all artifacts for the conversation", () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    const msg = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content: "```html\n<p>x</p>\n```",
    });
    store.detectArtifacts(convId, msg.id, msg.content);
    expect(useChatStore.getState().artifacts[convId]).toHaveLength(1);

    store.clearArtifacts(convId);
    const state = useChatStore.getState();
    expect(state.artifacts[convId]).toBeUndefined();
    expect(state.artifactPanelOpen).toBe(false);
    expect(state.activeArtifactId).toBeNull();
  });

  it("applies an edit-mode artifact block successfully during streaming and finalization", () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    const msg1 = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content: "### Page\n```html\n<h1>Old Title</h1>\n```",
    });
    store.detectArtifacts(convId, msg1.id, msg1.content);
    expect(useChatStore.getState().artifacts[convId][0].code).toBe("<h1>Old Title</h1>");

    const msg2Id = "msg-2";
    const editCode = "<<<EDIT>>>\n<<<OLD>>>\n<h1>Old Title</h1>\n<<<NEW>>>\n<h1>New Title</h1>\n<<<END>>>";
    
    // Simulate streaming the edit block
    store.streamArtifactDelta(convId, msg2Id, "html", "Page", 0, editCode);
    expect(useChatStore.getState().artifacts[convId][0].code).toBe(editCode); // while streaming, code is the raw markers
    
    // Detect artifacts at the end of stream
    store.detectArtifacts(convId, msg2Id, "### Page\n```html\n" + editCode + "\n```");
    
    const artifacts = useChatStore.getState().artifacts[convId];
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].code).toBe("<h1>New Title</h1>");
  });

  it("reverts an edit-mode artifact block to baseCode if edit application fails", () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    const msg1 = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content: "### Page\n```html\n<h1>Old Title</h1>\n```",
    });
    store.detectArtifacts(convId, msg1.id, msg1.content);
    expect(useChatStore.getState().artifacts[convId][0].code).toBe("<h1>Old Title</h1>");

    const msg2Id = "msg-2";
    const editCode = "<<<EDIT>>>\n<<<OLD>>>\nnon-existent pattern\n<<<NEW>>>\n<h1>New Title</h1>\n<<<END>>>";
    
    // Simulate streaming the edit block
    store.streamArtifactDelta(convId, msg2Id, "html", "Page", 0, editCode);
    expect(useChatStore.getState().artifacts[convId][0].code).toBe(editCode); // while streaming, code is the raw markers
    
    // Detect artifacts at the end of stream (where it fails to apply)
    store.detectArtifacts(convId, msg2Id, "### Page\n```html\n" + editCode + "\n```");
    
    const artifacts = useChatStore.getState().artifacts[convId];
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].code).toBe("<h1>Old Title</h1>"); // should be reverted to baseCode
  });
});

describe("sidebar toggle", () => {
  it("starts open", () => {
    expect(useChatStore.getState().sidebarOpen).toBe(true);
  });

  it("toggles between open and closed", () => {
    const store = useChatStore.getState();
    store.toggleSidebar();
    expect(useChatStore.getState().sidebarOpen).toBe(false);
    store.toggleSidebar();
    expect(useChatStore.getState().sidebarOpen).toBe(true);
  });

  it("setSidebarOpen forces a specific value", () => {
    const store = useChatStore.getState();
    store.setSidebarOpen(false);
    expect(useChatStore.getState().sidebarOpen).toBe(false);
    store.setSidebarOpen(false); // idempotent
    expect(useChatStore.getState().sidebarOpen).toBe(false);
  });

  it("opening an artifact closes the sidebar", () => {
    const store = useChatStore.getState();
    expect(useChatStore.getState().sidebarOpen).toBe(true);
    store.setActiveArtifact("artifact-1");
    expect(useChatStore.getState().sidebarOpen).toBe(false);
  });

  it("clearing the active artifact does not re-open the sidebar", () => {
    const store = useChatStore.getState();
    store.setActiveArtifact("artifact-1");
    expect(useChatStore.getState().sidebarOpen).toBe(false);
    store.setActiveArtifact(null);
    // It should not auto-open — user closed it for a reason.
    expect(useChatStore.getState().sidebarOpen).toBe(false);
  });

  it("opening an artifact exits the subagent panel so the canvas can render", () => {
    const store = useChatStore.getState();
    store.openSubagentPanel("tool-call-1");
    expect(useChatStore.getState().subagentPanelOpen).toBe(true);

    store.setActiveArtifact("artifact-1");

    const state = useChatStore.getState();
    expect(state.subagentPanelOpen).toBe(false);
    expect(state.activeSubagentToolCallId).toBeNull();
    expect(state.artifactPanelOpen).toBe(true);
  });

  it("opening a workspace file exits the subagent panel so the canvas can render", () => {
    const store = useChatStore.getState();
    store.openSubagentPanel("tool-call-1");
    expect(useChatStore.getState().subagentPanelOpen).toBe(true);

    store.setWorkspaceFile({ path: "src/App.tsx", name: "App.tsx", content: "export {};" });

    const state = useChatStore.getState();
    expect(state.subagentPanelOpen).toBe(false);
    expect(state.activeSubagentToolCallId).toBeNull();
    expect(state.artifactPanelOpen).toBe(true);
  });

  it("restores an open workspace file when returning to a conversation", () => {
    const store = useChatStore.getState();
    const firstId = store.createConversation();
    const secondId = store.createConversation();
    store.setActiveConversation(firstId);

    store.setWorkspaceFile({ path: "src/App.tsx", name: "App.tsx", content: "export {};" });
    store.setActiveConversation(secondId);
    store.setActiveConversation(firstId);

    const state = useChatStore.getState();
    expect(state.artifactPanelOpen).toBe(true);
    expect(state.workspaceFile?.path).toBe("src/App.tsx");
    expect(state.activeArtifactId).toBeNull();
  });

  it("opening an artifact recovers the owning conversation if activeId is stale", () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    const msg = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content: "```html\n<p>hi</p>\n```",
    });
    store.detectArtifacts(convId, msg.id, msg.content);
    const artifactId = useChatStore.getState().artifacts[convId][0].id;

    useChatStore.setState({ activeId: null, activeArtifactId: null, artifactPanelOpen: false });
    store.setActiveArtifact(artifactId);

    const state = useChatStore.getState();
    expect(state.activeId).toBe(convId);
    expect(state.activeArtifactId).toBe(artifactId);
    expect(state.artifactPanelOpen).toBe(true);
  });
});

describe("permission mode", () => {
  it("starts in manual", () => {
    expect(useChatStore.getState().permissionMode).toBe("manual");
    expect(useChatStore.getState().autoApprove).toBe(false);
  });

  it("setPermissionMode('yolo') enables autoApprove", () => {
    useChatStore.getState().setPermissionMode("yolo");
    expect(useChatStore.getState().permissionMode).toBe("yolo");
    expect(useChatStore.getState().autoApprove).toBe(true);
  });

  it("setPermissionMode('auto') keeps autoApprove false", () => {
    useChatStore.getState().setPermissionMode("auto");
    expect(useChatStore.getState().permissionMode).toBe("auto");
    expect(useChatStore.getState().autoApprove).toBe(false);
  });

  it("toggleAutoApprove flips between manual and yolo", () => {
    useChatStore.getState().toggleAutoApprove();
    expect(useChatStore.getState().permissionMode).toBe("yolo");
    useChatStore.getState().toggleAutoApprove();
    expect(useChatStore.getState().permissionMode).toBe("manual");
  });

  it("setAutoApprove(true) forces yolo", () => {
    useChatStore.getState().setAutoApprove(true);
    expect(useChatStore.getState().permissionMode).toBe("yolo");
    useChatStore.getState().setAutoApprove(false);
    expect(useChatStore.getState().permissionMode).toBe("manual");
  });
});
