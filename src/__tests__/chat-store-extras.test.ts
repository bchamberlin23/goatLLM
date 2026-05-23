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

  it("extracts a LaTeX artifact via 'latex' or 'tex' lang tag", () => {
    const store = useChatStore.getState();
    const convId = store.createConversation();
    const msg1 = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content: "```latex\n\\section{Intro}\n```",
    });
    store.detectArtifacts(convId, msg1.id, msg1.content);

    const msg2 = store.addMessage({
      conversationId: convId,
      role: "assistant",
      content: "```tex\n\\title{T}\n```",
    });
    store.detectArtifacts(convId, msg2.id, msg2.content);

    const artifacts = useChatStore.getState().artifacts[convId];
    expect(artifacts).toHaveLength(2);
    expect(artifacts.every((a) => a.kind === "latex")).toBe(true);
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
