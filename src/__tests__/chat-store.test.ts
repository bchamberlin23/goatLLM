import { describe, it, expect, beforeEach, vi } from "vitest";
import { useChatStore } from "../stores/chat";
import { OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID } from "../lib/openai-codex-subscription";

function freshStore() {
  // Reset store state between tests
  localStorage.clear();
  useChatStore.setState({
    conversations: [],
    activeId: null,
    messages: {},
    messageQueue: {},
    steerPayload: null,
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

    it("exposes the curated Zen free models out of the box", () => {
      const models = useChatStore.getState().getModels();
      const ids = models.map((m) => m.id);
      expect(ids).toContain("opencode-go-free:big-pickle");
      expect(ids).toContain("opencode-go-free:deepseek-v4-flash-free");
      expect(ids).toContain("opencode-go-free:mimo-v2.5-free");
      expect(ids).toContain("opencode-go-free:nemotron-3-ultra-free");
      expect(ids).toContain("opencode-go-free:north-mini-code-free");
    });

    it("hides Codex subscription provider when not signed in", () => {
      // The Codex group is gated on ChatGPT OAuth sign-in. Until the
      // user signs in via the Settings card, the provider and its
      // models must be invisible to the picker so a stale selection
      // can't be invoked.
      useChatStore.setState(() => ({
        codexAuthStatus: { signed_in: false, account_id: null, expires: null },
      }));
      const providers = useChatStore.getState().getProviders();
      const builtIn = providers.filter((p) => p.isBuiltIn).map((p) => p.id);
      expect(builtIn).not.toContain(OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID);

      const models = useChatStore.getState().getModels();
      const ids = models.map((m) => m.id);
      expect(ids).not.toContain(`${OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID}:gpt-5.5`);
    });

    it("exposes Codex subscription models when signed in", () => {
      useChatStore.setState(() => ({
        codexAuthStatus: { signed_in: true, account_id: "acc_test", expires: 0 },
      }));
      const providers = useChatStore.getState().getProviders();
      const builtIn = providers.filter((p) => p.isBuiltIn).map((p) => p.id);
      expect(builtIn).toContain(OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID);

      const models = useChatStore.getState().getModels();
      const ids = models.map((m) => m.id);
      expect(ids).toContain(`${OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID}:gpt-5.5`);
    });

    it("setCodexAuthStatus toggles the Codex provider in the picker", () => {
      // Mirrors what CodexSubscriptionCard does on sign-in / sign-out:
      // it dispatches the new status into the chat store and the picker
      // re-renders on the next render cycle.
      useChatStore.getState().setCodexAuthStatus({
        signed_in: true,
        account_id: "acc_test",
        expires: 0,
      });
      expect(
        useChatStore
          .getState()
          .getProviders()
          .some((p) => p.id === OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID),
      ).toBe(true);

      useChatStore.getState().setCodexAuthStatus({
        signed_in: false,
        account_id: null,
        expires: null,
      });
      expect(
        useChatStore
          .getState()
          .getProviders()
          .some((p) => p.id === OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID),
      ).toBe(false);
    });

    it("checkCodexAuthStatus is a no-op outside Tauri", () => {
      // The action guards on window.__TAURI_INTERNALS__ so it can be
      // called from browser-only contexts (jsdom tests, Vite dev
      // server) without throwing. The auth state should be untouched.
      const before = useChatStore.getState().codexAuthStatus;
      return useChatStore
        .getState()
        .checkCodexAuthStatus()
        .then(() => {
          expect(useChatStore.getState().codexAuthStatus).toEqual(before);
        });
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

    it("merges /v1/models discovery results into the curated catalog", () => {
      // Mirrors pi-ai's "registry metadata wins, new entries append"
      // pattern. When a user hits Discover on a provider like OpenRouter,
      // the result is merged with the curated list and surfaced in the
      // picker. The curated entry for a shared id keeps its metadata.
      useChatStore.getState().configureProvider("openrouter", {
        apiKey: "sk-test",
      });
      // Simulate the chat store having cached a discovery result.
      // We poke the state directly because the discovery action goes
      // through the network and we don't want to mock fetch in this test.
      useChatStore.setState((s) => ({
        discoveredModels: {
          ...s.discoveredModels,
          openrouter: [
            { id: "anthropic/claude-3.5-sonnet", name: "Auto-Discovered 3.5 Sonnet", contextWindow: 1 },
            { id: "vendor/newest-experimental", name: "Newest Experimental", contextWindow: 500_000 },
          ],
        },
      }));

      const models = useChatStore.getState().getModels();
      const ids = models.map((m) => m.id);

      // New entry from discovery surfaces in the picker.
      expect(ids).toContain("openrouter:vendor/newest-experimental");

      // Curated entry wins on conflict: the curated display name and
      // context window (200_000) are preserved over the discovered
      // (1) bogus context.
      const curated = models.find((m) => m.id === "openrouter:anthropic/claude-3.5-sonnet")!;
      expect(curated.name).toBe("Claude 3.5 Sonnet");
      expect(curated.contextWindow).toBe(200_000);
    });

    it("shows the curated Zen free models in the configured OpenCode Go picker", () => {
      useChatStore.setState({ providerConfigs: {} });
      useChatStore.getState().configureProvider("opencode-go", { apiKey: "sk-test" });

      const models = useChatStore.getState().getModels();

      expect(models).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "opencode-go:big-pickle", name: "Big Pickle" }),
        expect.objectContaining({ id: "opencode-go:north-mini-code-free", name: "North Mini Code Free" }),
      ]));
    });

    it("ignores discovered Zen models for the built-in free picker", () => {
      useChatStore.setState({ providerConfigs: {} });
      useChatStore.setState((state) => ({
        discoveredModels: {
          ...state.discoveredModels,
          "opencode-go-free": [
            { id: "big-pickle-free", name: "Big Pickle", contextWindow: 128_000 },
            { id: "zen-premium", name: "Zen Premium", contextWindow: 128_000 },
          ],
        },
      }));

      const models = useChatStore.getState().getModels();

      expect(models).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "opencode-go-free:big-pickle", name: "Big Pickle" }),
        expect.objectContaining({ id: "opencode-go-free:deepseek-v4-flash-free" }),
      ]));
      expect(models.map((model) => model.id)).not.toContain("opencode-go-free:big-pickle-free");
    });

    it("refreshes every configured cloud provider that supports discovery", async () => {
      useChatStore.setState({
        providerConfigs: {
          openrouter: { apiKey: "sk-router" },
          groq: { apiKey: "sk-groq" },
          anthropic: { apiKey: "sk-anthropic" },
        },
      });
      const discoverCloudModels = vi.fn().mockResolvedValue(undefined);
      useChatStore.setState({ discoverCloudModels });

      await useChatStore.getState().discoverAllCloudModels();

      expect(discoverCloudModels).toHaveBeenCalledTimes(2);
      expect(discoverCloudModels).toHaveBeenCalledWith("openrouter");
      expect(discoverCloudModels).toHaveBeenCalledWith("groq");
    });

    it("does not merge discovery for providers that don't opt in", () => {
      // Anthropic doesn't expose /v1/models the way OpenRouter does, and
      // we curate its full catalog. A bogus discoveredModels entry must
      // not leak into the picker.
      useChatStore.getState().configureProvider("anthropic", { apiKey: "sk-test" });
      useChatStore.setState((s) => ({
        discoveredModels: {
          ...s.discoveredModels,
          anthropic: [{ id: "leaked-model", name: "Leaked", contextWindow: 1 }],
        },
      }));

      const models = useChatStore.getState().getModels();
      const ids = models.map((m) => m.id);
      expect(ids).not.toContain("anthropic:leaked-model");
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

    it("routes Big Pickle through the Zen free endpoint", () => {
      useChatStore.getState().configureProvider("opencode-go", {
        apiKey: "sk-test",
        baseUrl: "https://opencode.ai/zen/go/v1",
      });
      useChatStore.getState().setSelectedModel("opencode-go:big-pickle");

      expect(useChatStore.getState().getActiveLlmConfig()?.baseUrl).toBe(
        "https://opencode.ai/zen/v1",
      );
    });

    it("builds LlmConfig for Codex subscription without API key or user provider config", () => {
      useChatStore.setState(() => ({
        codexAuthStatus: { signed_in: true, account_id: "acc_test", expires: 0 },
      }));
      useChatStore
        .getState()
        .setSelectedModel(`${OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID}:gpt-5.5`);
      const config = useChatStore.getState().getActiveLlmConfig();
      expect(config).toMatchObject({
        provider: OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID,
        modelId: "gpt-5.5",
        apiKey: null,
        baseUrl: "https://chatgpt.com/backend-api",
      });
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

  describe("messageQueue", () => {
    it("queues messages per conversation and removes empty queues on dequeue", () => {
      const store = freshStore();
      const convId = store.createConversation();

      useChatStore.getState().enqueueMessage(convId, "follow up");

      expect(useChatStore.getState().messageQueue[convId]).toEqual([{ content: "follow up" }]);
      expect(JSON.parse(localStorage.getItem("goatllm-message-queue") || "{}")).toEqual({
        [convId]: [{ content: "follow up" }],
      });

      expect(useChatStore.getState().dequeueMessage(convId)).toEqual({ content: "follow up" });
      expect(useChatStore.getState().messageQueue[convId]).toBeUndefined();
      expect(JSON.parse(localStorage.getItem("goatllm-message-queue") || "{}")).toEqual({});
    });

    it("removes a queued message when steering it", () => {
      const store = freshStore();
      const convId = store.createConversation();

      useChatStore.getState().enqueueMessage(convId, "revise this");
      useChatStore.getState().steerMessage(convId, "revise this");

      expect(useChatStore.getState().messageQueue[convId]).toBeUndefined();
      expect(useChatStore.getState().steerPayload).toEqual({
        conversationId: convId,
        content: "revise this",
        steered: true,
      });
      expect(JSON.parse(localStorage.getItem("goatllm-message-queue") || "{}")).toEqual({});
    });

    it("steers only the selected queued message when queued content is duplicated", () => {
      const store = freshStore();
      const convId = store.createConversation();

      useChatStore.getState().enqueueMessage(convId, "repeat this");
      useChatStore.getState().enqueueMessage(convId, "different turn");
      useChatStore.getState().enqueueMessage(convId, "repeat this");

      (
        useChatStore.getState().steerMessage as (
          conversationId: string,
          content: string,
          queueIndex?: number,
        ) => void
      )(convId, "repeat this", 2);

      expect(useChatStore.getState().messageQueue[convId]).toEqual([
        { content: "repeat this" },
        { content: "different turn" },
      ]);
      expect(useChatStore.getState().steerPayload).toEqual({
        conversationId: convId,
        content: "repeat this",
        steered: true,
      });
      expect(JSON.parse(localStorage.getItem("goatllm-message-queue") || "{}")).toEqual({
        [convId]: [{ content: "repeat this" }, { content: "different turn" }],
      });
    });
  });
});
