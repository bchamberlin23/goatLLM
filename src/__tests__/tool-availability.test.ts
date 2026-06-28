import { describe, expect, it } from "vitest";

import { buildAgentSystemPrompt, buildChatSystemPrompt } from "../lib/system-prompt";
import {
  ALL_TOOLS,
  CHAT_TOOLS,
  PLAN_TOOLS,
  RESEARCH_TOOLS,
  filterToolsForConfiguredServices,
} from "../lib/tools/registry";

interface CreateAgentThreadTool {
  execute: (
    input: { title?: string; prompt: string; workspace_path?: string },
    options: unknown,
  ) => string | Promise<string>;
}

describe("filterToolsForConfiguredServices", () => {
  it("removes scrape_url from every tool bundle without a Firecrawl key", () => {
    for (const tools of [ALL_TOOLS, CHAT_TOOLS, RESEARCH_TOOLS]) {
      expect(filterToolsForConfiguredServices(tools, "")).not.toHaveProperty("scrape_url");
    }
  });

  it("keeps scrape_url available when a Firecrawl key is configured", () => {
    expect(filterToolsForConfiguredServices(RESEARCH_TOOLS, "fc-test")).toHaveProperty("scrape_url");
  });

  it("does not instruct the model to use scrape_url when Firecrawl is unavailable", () => {
    const tools = filterToolsForConfiguredServices(RESEARCH_TOOLS, "");

    expect(buildAgentSystemPrompt({ tools, researchMode: true })).not.toContain("scrape_url");
  });

  it("does not mention scrape_url in chat without a Firecrawl key", () => {
    expect(buildChatSystemPrompt(undefined, false, true)).not.toContain("scrape_url");
  });

  it("exposes real agent thread creation only to agent tool bundles", () => {
    expect(ALL_TOOLS).toHaveProperty("create_agent_thread");
    expect(PLAN_TOOLS).toHaveProperty("create_agent_thread");
    expect(RESEARCH_TOOLS).not.toHaveProperty("create_agent_thread");
    expect(CHAT_TOOLS).not.toHaveProperty("create_agent_thread");
  });

  it("create_agent_thread creates a persisted agent conversation", async () => {
    const { useChatStore } = await import("../stores/chat");
    localStorage.clear();
    useChatStore.setState({
      conversations: [],
      activeId: null,
      messages: {},
      agentMode: true,
      workspacePath: "/tmp/thread-tool-project",
      selectedModelId: "openai:gpt-5.5",
    });

    const createAgentThread = ALL_TOOLS.create_agent_thread as CreateAgentThreadTool | undefined;
    expect(createAgentThread).toBeTruthy();
    if (!createAgentThread) throw new Error("create_agent_thread is not registered");

    const output = await createAgentThread.execute(
      {
        title: "Parallel audit",
        prompt: "Audit the persistence layer for thread safety.",
      },
      {},
    );

    expect(output).toContain("Created agent thread");
    const created = useChatStore.getState().conversations.find((conversation) => conversation.title === "Parallel audit");
    expect(created).toBeDefined();
    if (!created) throw new Error("agent thread was not created");
    expect(created).toEqual(
      expect.objectContaining({
        mode: "agent",
        workspacePath: "/tmp/thread-tool-project",
      }),
    );
    expect(useChatStore.getState().messages[created.id][0]).toEqual(
      expect.objectContaining({
        role: "user",
        content: "Audit the persistence layer for thread safety.",
      }),
    );
  });
});
