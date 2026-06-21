import { describe, expect, it } from "vitest";

import { buildAgentSystemPrompt, buildChatSystemPrompt } from "../lib/system-prompt";
import {
  ALL_TOOLS,
  CHAT_TOOLS,
  RESEARCH_TOOLS,
  filterToolsForConfiguredServices,
} from "../lib/tools/registry";

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
});
