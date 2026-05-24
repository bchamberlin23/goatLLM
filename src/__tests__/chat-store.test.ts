import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "../stores/chat";

function freshStore() {
  // Reset store state between tests
  useChatStore.setState({
    conversations: [],
    activeId: null,
    messages: {},
    selectedModelId: null,
    isStreaming: false,
    searchQuery: "",
  });
  return useChatStore.getState();
}

describe("ChatStore", () => {
  beforeEach(() => {
    freshStore();
  });

  describe("conversations", () => {
    it("creates a conversation with default title", () => {
      freshStore();
      const id = useChatStore.getState().createConversation();
      const state = useChatStore.getState();

      expect(id).toBeTruthy();
      expect(state.conversations).toHaveLength(1);
      expect(state.conversations[0].title).toBe("New Conversation");
      expect(state.activeId).toBe(id);
    });

    it("deletes a conversation and falls back to next", () => {
      const store = freshStore();
      const id1 = store.createConversation();
      const id2 = store.createConversation();

      useChatStore.getState().deleteConversation(id1);

      const state = useChatStore.getState();
      expect(state.conversations).toHaveLength(1);
      expect(state.conversations[0].id).toBe(id2);
      expect(state.activeId).toBe(id2);
    });

    it("renames a conversation", () => {
      const store = freshStore();
      const id = store.createConversation();

      useChatStore.getState().renameConversation(id, "My Chat");

      const conv = useChatStore.getState().conversations.find((c) => c.id === id);
      expect(conv?.title).toBe("My Chat");
    });

    it("filters conversations by search query", () => {
      const store = freshStore();
      store.createConversation();
      const id = store.createConversation();
      useChatStore.getState().renameConversation(id, "Debugging Rust");

      useChatStore.getState().setSearchQuery("rust");
      const filtered = useChatStore.getState().getFilteredConversations();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe("Debugging Rust");
    });

    it("clears search results when query is empty", () => {
      const store = freshStore();
      store.createConversation();
      store.createConversation();

      useChatStore.getState().setSearchQuery("nothing");
      expect(useChatStore.getState().getFilteredConversations()).toHaveLength(0);

      useChatStore.getState().setSearchQuery("");
      expect(useChatStore.getState().getFilteredConversations()).toHaveLength(2);
    });
  });

  describe("messages", () => {
    it("adds a user message and updates conversation preview", () => {
      const store = freshStore();
      const convId = store.createConversation();

      const msg = useChatStore.getState().addMessage({
        conversationId: convId,
        role: "user",
        content: "Hello, world!",
      });

      expect(msg.id).toBeTruthy();
      expect(msg.createdAt).toBeGreaterThan(0);

      const msgs = useChatStore.getState().messages[convId];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe("Hello, world!");

      const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
      expect(conv?.lastMessagePreview).toBe("Hello, world!");
    });

    it("keeps default title until LLM-generated title arrives", () => {
      const store = freshStore();
      const convId = store.createConversation();

      useChatStore.getState().addMessage({
        conversationId: convId,
        role: "user",
        content: "How do I fix a segfault in Rust when using unsafe code?",
      });

      // The store no longer derives a title from the first message; that's the
      // job of generateTitle() once the assistant reply is in.
      const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
      expect(conv?.title).toBe("New Conversation");
      expect(conv?.lastMessagePreview).toContain("segfault");
    });

    it("appends tokens to streaming message", () => {
      const store = freshStore();
      const convId = store.createConversation();

      const msg = useChatStore.getState().addMessage({
        conversationId: convId,
        role: "assistant",
        content: "",
        isStreaming: true,
      });

      useChatStore.getState().appendToMessage(convId, msg.id, "Hello");
      useChatStore.getState().appendToMessage(convId, msg.id, " world");

      const msgs = useChatStore.getState().messages[convId];
      expect(msgs[0].content).toBe("Hello world");
    });

    it("updates a message", () => {
      const store = freshStore();
      const convId = store.createConversation();

      const msg = useChatStore.getState().addMessage({
        conversationId: convId,
        role: "assistant",
        content: "",
        isStreaming: true,
      });

      useChatStore.getState().updateMessage(convId, msg.id, {
        content: "Done",
        isStreaming: false,
      });

      const msgs = useChatStore.getState().messages[convId];
      expect(msgs[0].content).toBe("Done");
      expect(msgs[0].isStreaming).toBe(false);
    });
  });

  describe("providers & models", () => {
    it("includes the bundled free OpenCode Go provider by default", () => {
      const providers = useChatStore.getState().getProviders();
      const builtIn = providers.filter((p) => p.isBuiltIn);
      expect(builtIn.map((p) => p.id)).toEqual(["opencode-go-free"]);
    });

    it("exposes the free DeepSeek model out of the box", () => {
      const models = useChatStore.getState().getModels();
      const ids = models.map((m) => m.id);
      expect(ids).toContain("opencode-go-free:deepseek-v4-flash-free");
    });

    it("includes cloud provider models after config", () => {
      useChatStore.getState().configureProvider("opencode-go", {
        apiKey: "sk-test",
        baseUrl: "https://opencode.ai/zen/go/v1",
      });

      const models = useChatStore.getState().getModels();
      const ids = models.map((m) => m.id);
      expect(ids).toContain("opencode-go:deepseek-v4-pro");
    });

    it("returns null LlmConfig when no model selected", () => {
      expect(useChatStore.getState().getActiveLlmConfig()).toBeNull();
    });

    it("builds LlmConfig for cloud provider", () => {
      useChatStore.getState().configureProvider("opencode-go", {
        apiKey: "sk-test",
      });
      useChatStore.getState().setSelectedModel("opencode-go:deepseek-v4-pro");
      const config = useChatStore.getState().getActiveLlmConfig();
      expect(config).toBeTruthy();
      expect(config?.provider).toBe("opencode-go");
      expect(config?.apiKey).toBe("sk-test");
    });
  });

  describe("active conversation", () => {
    it("returns null when no active conversation", () => {
      expect(useChatStore.getState().getActiveConversation()).toBeNull();
      expect(useChatStore.getState().getActiveMessages()).toEqual([]);
    });

    it("returns active conversation and messages", () => {
      const store = freshStore();
      const convId = store.createConversation();

      useChatStore.getState().addMessage({
        conversationId: convId,
        role: "user",
        content: "Hi",
      });

      const active = useChatStore.getState().getActiveConversation();
      expect(active?.id).toBe(convId);

      const msgs = useChatStore.getState().getActiveMessages();
      expect(msgs).toHaveLength(1);
    });
  });

  describe("streaming", () => {
    it("toggles streaming state", () => {
      useChatStore.getState().setStreaming(true);
      expect(useChatStore.getState().isStreaming).toBe(true);

      useChatStore.getState().setStreaming(false);
      expect(useChatStore.getState().isStreaming).toBe(false);
    });
  });

  describe("scroll positions", () => {
    it("saves scroll position per conversation", () => {
      const store = freshStore();
      const convId = store.createConversation();

      useChatStore.getState().saveScrollPosition(convId, 500);
      expect(useChatStore.getState().scrollPositions[convId]).toBe(500);
    });
  });

  describe("editMessage", () => {
    it("updates message content in place", () => {
      const store = freshStore();
      const convId = store.createConversation();
      const msg = useChatStore.getState().addMessage({
        conversationId: convId,
        role: "user",
        content: "Hello world",
      });

      useChatStore.getState().editMessage(convId, msg.id, "Hello edited");

      const msgs = useChatStore.getState().messages[convId];
      expect(msgs[0].content).toBe("Hello edited");
    });
  });

  describe("removeMessagesAfter", () => {
    it("removes all messages after the given message ID", () => {
      const store = freshStore();
      const convId = store.createConversation();
      const msg1 = useChatStore.getState().addMessage({
        conversationId: convId,
        role: "user",
        content: "Q1",
      });
      useChatStore.getState().addMessage({
        conversationId: convId,
        role: "assistant",
        content: "A1",
      });

      useChatStore.getState().removeMessagesAfter(convId, msg1.id);

      const msgs = useChatStore.getState().messages[convId];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe("Q1");
    });

    it("does nothing for unknown message ID", () => {
      const store = freshStore();
      const convId = store.createConversation();
      useChatStore.getState().addMessage({
        conversationId: convId,
        role: "user",
        content: "Q1",
      });

      useChatStore.getState().removeMessagesAfter(convId, "nonexistent");

      const msgs = useChatStore.getState().messages[convId];
      expect(msgs).toHaveLength(1);
    });
  });

  describe("resendPayload", () => {
    it("sets and clears resend payload", () => {
      expect(useChatStore.getState().resendPayload).toBeNull();

      useChatStore.getState().triggerResend("conv-1", "Retry this");
      expect(useChatStore.getState().resendPayload).toEqual({
        conversationId: "conv-1",
        content: "Retry this",
        attachments: undefined,
      });

      useChatStore.getState().clearResend();
      expect(useChatStore.getState().resendPayload).toBeNull();
    });
  });
});
