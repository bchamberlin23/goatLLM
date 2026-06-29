import { describe, it, expect, beforeEach, vi } from "vitest";
import { useChatStore, type CreatedAgentThread } from "../stores/chat";
import { OPENAI_CODEX_SUBSCRIPTION_PROVIDER_ID } from "../lib/openai-codex-subscription";
import { createNotebookNote, createNotebookSource } from "../lib/canvas";

const fetchAdapterMocks = vi.hoisted(() => ({
  adapterFetch: vi.fn(),
}));

vi.mock("../lib/fetch-adapter", () => ({
  initFetch: vi.fn(async () => fetchAdapterMocks.adapterFetch),
  getFetch: vi.fn(() => fetchAdapterMocks.adapterFetch),
}));

const initialStoreActions = {
  discoverCloudModels: useChatStore.getState().discoverCloudModels,
};

function freshStore() {
  // Reset store state between tests
  localStorage.clear();
  useChatStore.setState({
    conversations: [],
    activeId: null,
    messages: {},
    messageQueue: {},
    steerPayload: null,
    providerConfigs: {},
    discoveredModels: {},
    discoveryStatus: {},
    discoveryError: {},
    discoverCloudModels: initialStoreActions.discoverCloudModels,
    selectedModelId: null,
    isStreaming: false,
    searchQuery: "",
  });
  return useChatStore.getState();
}

describe("ChatStore", () => {
  beforeEach(() => {
    freshStore();
    fetchAdapterMocks.adapterFetch.mockReset();
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

    it("keys project conversations to the selected agent workspace", () => {
      useChatStore.setState({
        agentMode: true,
        designMode: false,
        workspacePath: "/tmp/project-a",
      });

      const id = useChatStore.getState().createConversation();

      expect(useChatStore.getState().conversations.find((c) => c.id === id)).toEqual(
        expect.objectContaining({
          mode: "agent",
          workspacePath: "/tmp/project-a",
        }),
      );
      expect(localStorage.getItem(`goatllm-journal-conv:${id}`)).toContain("/tmp/project-a");
    });

    it("marks a chat as agent-scoped when moving it into the active project", () => {
      const store = freshStore();
      const id = store.createConversation();
      useChatStore.setState({
        agentMode: true,
        designMode: false,
        workspacePath: "/tmp/project-b",
      });

      useChatStore.getState().moveConversationToWorkspace(id, "/tmp/project-b");

      expect(useChatStore.getState().conversations.find((c) => c.id === id)).toEqual(
        expect.objectContaining({
          mode: "agent",
          workspacePath: "/tmp/project-b",
        }),
      );
    });

    it("normalizes legacy workspace chats on hydrate", async () => {
      freshStore();
      const legacy = {
        id: "legacy-project",
        title: "Legacy project chat",
        lastMessagePreview: "",
        lastMessageAt: 20,
        createdAt: 10,
        modelId: null,
        systemPrompt: "",
        mode: "chat",
        workspacePath: "/tmp/project",
      };
      localStorage.setItem("goatllm-journal-conv:legacy-project", JSON.stringify(legacy));

      await useChatStore.getState().hydrate();

      expect(useChatStore.getState().conversations.find((c) => c.id === "legacy-project")).toEqual(
        expect.objectContaining({
          mode: "agent",
          workspacePath: "/tmp/project",
        }),
      );
      expect(localStorage.getItem("goatllm-journal-conv:legacy-project")).toContain('"mode":"agent"');
    });

    it("creates a background agent thread with a persisted seed prompt", () => {
      const store = freshStore();
      const parentId = store.createConversation();
      useChatStore.setState({
        activeId: parentId,
        agentMode: true,
        workspacePath: "/tmp/project-c",
        selectedModelId: "openai:gpt-5.5",
      });

      const result: CreatedAgentThread = useChatStore.getState().createAgentThread({
        title: "Investigate flaky tests",
        prompt: "Find why the auth tests are flaky and report back.",
      });

      expect(result).toEqual(
        expect.objectContaining({
          title: "Investigate flaky tests",
          prompt: "Find why the auth tests are flaky and report back.",
        }),
      );
      expect(useChatStore.getState().activeId).toBe(parentId);

      const created = useChatStore.getState().conversations.find((c) => c.id === result.conversationId);
      expect(created).toEqual(
        expect.objectContaining({
          title: "Investigate flaky tests",
          mode: "agent",
          workspacePath: "/tmp/project-c",
          modelId: "openai:gpt-5.5",
        }),
      );
      expect(useChatStore.getState().messages[result.conversationId]).toEqual([
        expect.objectContaining({
          role: "user",
          content: "Find why the auth tests are flaky and report back.",
          conversationId: result.conversationId,
          modelId: "openai:gpt-5.5",
        }),
      ]);
      expect(localStorage.getItem(`goatllm-journal-conv:${result.conversationId}`)).toContain("/tmp/project-c");
      const messageJournalKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
      const persistedSeed = messageJournalKeys
        .filter((key): key is string => !!key?.startsWith("goatllm-journal-msg:"))
        .map((key) => localStorage.getItem(key))
        .find((value) => value?.includes(result.conversationId));
      expect(persistedSeed).toContain("Find why the auth tests are flaky and report back.");
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

    it("throttles conversation preview churn while streaming and flushes the final preview", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const store = freshStore();
      const convId = store.createConversation();

      const msg = useChatStore.getState().addMessage({
        conversationId: convId,
        role: "assistant",
        content: "",
        isStreaming: true,
      });

      useChatStore.getState().appendToMessage(convId, msg.id, "Hel");
      const afterFirst = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(afterFirst.lastMessagePreview).toBe("Hel");

      vi.setSystemTime(1_100);
      useChatStore.getState().appendToMessage(convId, msg.id, "lo");
      const afterSecond = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(afterSecond).toBe(afterFirst);
      expect(afterSecond.lastMessagePreview).toBe("Hel");

      useChatStore.getState().finalizeStreamingMessage(convId, msg.id);
      const afterFinal = useChatStore.getState().conversations.find((c) => c.id === convId)!;
      expect(afterFinal.lastMessagePreview).toBe("Hello");

      vi.useRealTimers();
    });

    it("persists the final conversation preview even when it matches the throttled preview", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const store = freshStore();
      const convId = store.createConversation();

      const msg = useChatStore.getState().addMessage({
        conversationId: convId,
        role: "assistant",
        content: "",
        isStreaming: true,
      });

      useChatStore.getState().appendToMessage(convId, msg.id, "Done");
      useChatStore.getState().finalizeStreamingMessage(convId, msg.id);

      expect(localStorage.getItem(`goatllm-journal-conv:${convId}`)).toContain(
        '"lastMessagePreview":"Done"',
      );

      vi.useRealTimers();
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
          "cline-pass": { apiKey: "cline-token" },
          anthropic: { apiKey: "sk-anthropic" },
        },
      });
      const discoverCloudModels = vi.fn().mockResolvedValue(undefined);
      useChatStore.setState({ discoverCloudModels });

      await useChatStore.getState().discoverAllCloudModels();

      expect(discoverCloudModels).toHaveBeenCalledTimes(3);
      expect(discoverCloudModels).toHaveBeenCalledWith("openrouter");
      expect(discoverCloudModels).toHaveBeenCalledWith("groq");
      expect(discoverCloudModels).toHaveBeenCalledWith("cline-pass");
    });

    it("refreshes ClinePass from Cline's recommended models endpoint", async () => {
      fetchAdapterMocks.adapterFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          clinePass: [
            { id: "cline-pass/qwen3.7-max", name: "cline-pass/qwen3.7-max" },
            { id: "cline-pass/glm-5.2", name: "GLM-5.2" },
          ],
        }),
      });
      useChatStore.setState({
        providerConfigs: {
          "cline-pass": { apiKey: "cline-token" },
        },
      });

      await useChatStore.getState().discoverCloudModels("cline-pass");

      expect(fetchAdapterMocks.adapterFetch).toHaveBeenCalledWith(
        "https://api.cline.bot/api/v1/ai/cline/recommended-models",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
      expect(useChatStore.getState().discoveredModels["cline-pass"]).toEqual([
        { id: "cline-pass/qwen3.7-max", name: "Qwen 3.7 Max", contextWindow: 262_144, reasoning: true },
        { id: "cline-pass/glm-5.2", name: "GLM 5.2", contextWindow: 1_024_000, reasoning: true },
      ]);
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
    it("claims queued messages one at a time in FIFO order", () => {
      const store = freshStore();
      const convId = store.createConversation();

      useChatStore.getState().enqueueMessage(convId, "first follow-up");
      useChatStore.getState().enqueueMessage(convId, "second follow-up");
      useChatStore.getState().enqueueMessage(convId, "third follow-up");

      expect(useChatStore.getState()).toHaveProperty("beginQueuedMessageDispatch");
      expect(useChatStore.getState().beginQueuedMessageDispatch(convId)?.content).toBe("first follow-up");
      expect(useChatStore.getState().beginQueuedMessageDispatch(convId)).toBeUndefined();

      useChatStore.getState().finishQueuedMessageDispatch(convId);
      expect(useChatStore.getState().beginQueuedMessageDispatch(convId)?.content).toBe("second follow-up");

      useChatStore.getState().finishQueuedMessageDispatch(convId);
      expect(useChatStore.getState().beginQueuedMessageDispatch(convId)?.content).toBe("third follow-up");
    });

    it("queues messages per conversation and removes empty queues on dequeue", () => {
      const store = freshStore();
      const convId = store.createConversation();

      useChatStore.getState().enqueueMessage(convId, "follow up");

      expect(useChatStore.getState().messageQueue[convId]).toEqual([
        expect.objectContaining({ id: expect.any(String), content: "follow up" }),
      ]);
      expect(JSON.parse(localStorage.getItem("goatllm-message-queue") || "{}")).toEqual({
        [convId]: [expect.objectContaining({ id: expect.any(String), content: "follow up" })],
      });

      expect(useChatStore.getState().dequeueMessage(convId)).toEqual(
        expect.objectContaining({ id: expect.any(String), content: "follow up" }),
      );
      expect(useChatStore.getState().messageQueue[convId]).toBeUndefined();
      expect(JSON.parse(localStorage.getItem("goatllm-message-queue") || "{}")).toEqual({});
    });

    it("removes a queued message when steering it", () => {
      const store = freshStore();
      const convId = store.createConversation();

      useChatStore.getState().enqueueMessage(convId, "revise this");
      const queued = useChatStore.getState().messageQueue[convId][0];
      useChatStore.getState().steerMessage(convId, queued.id);

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

      const queued = useChatStore.getState().messageQueue[convId];
      useChatStore.getState().steerMessage(convId, queued[2].id);

      expect(useChatStore.getState().messageQueue[convId]).toEqual([
        expect.objectContaining({ id: expect.any(String), content: "repeat this" }),
        expect.objectContaining({ id: expect.any(String), content: "different turn" }),
      ]);
      expect(useChatStore.getState().steerPayload).toEqual({
        conversationId: convId,
        content: "repeat this",
        steered: true,
      });
      expect(JSON.parse(localStorage.getItem("goatllm-message-queue") || "{}")).toEqual({
        [convId]: [
          expect.objectContaining({ id: expect.any(String), content: "repeat this" }),
          expect.objectContaining({ id: expect.any(String), content: "different turn" }),
        ],
      });
    });
  });

  describe("notebooks", () => {
    it("mutates active notebook sources and notes with synchronous journal persistence", () => {
      const store = freshStore();
      const notebookId = store.createNotebook();
      const source = createNotebookSource({
        title: "Research paper",
        kind: "text",
        content: "Main body",
        seed: 10,
      });
      const note = createNotebookNote({
        title: "Synthesis",
        content: "My take",
        sourceIds: [source.id],
        seed: 20,
      });

      useChatStore.getState().addNotebookSource(source);
      useChatStore.getState().addNotebookNote(note);
      useChatStore.getState().updateNotebookSource(source.id, { contextMode: "summary" });
      useChatStore.getState().updateNotebookNote(note.id, { content: "Updated take" });

      const active = useChatStore.getState().getActiveNotebook();
      expect(active).toEqual(
        expect.objectContaining({
          id: notebookId,
          sources: [expect.objectContaining({ id: source.id, contextMode: "summary" })],
          notes: [expect.objectContaining({ id: note.id, content: "Updated take" })],
        }),
      );
      expect(localStorage.getItem("goatllm-notebooks")).toContain("Updated take");

      useChatStore.getState().deleteNotebookSource(source.id);
      useChatStore.getState().deleteNotebookNote(note.id);
      expect(useChatStore.getState().getActiveNotebook()?.sources).toEqual([]);
      expect(useChatStore.getState().getActiveNotebook()?.notes).toEqual([]);
    });
  });
});
