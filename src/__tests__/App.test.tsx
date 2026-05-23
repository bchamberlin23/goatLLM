import { describe, it, expect } from "vitest";
import { useChatStore } from "../stores/chat";

describe("App store integration", () => {
  it("initializes with empty state", () => {
    const state = useChatStore.getState();
    expect(state.conversations).toEqual([]);
    expect(state.activeId).toBeNull();
    expect(state.isStreaming).toBe(false);
  });

  it("selectedModelId starts null and can be set", () => {
    useChatStore.getState().setSelectedModel("opencode-go:deepseek-v4-flash-free");
    expect(useChatStore.getState().selectedModelId).toBe("opencode-go:deepseek-v4-flash-free");
  });
});
