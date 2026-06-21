import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelPicker } from "../components/ModelPicker";
import { useChatStore } from "../stores/chat";

describe("ModelPicker", () => {
  beforeEach(() => {
    localStorage.clear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("switches models in an active conversation without a confirmation warning", () => {
    const models = useChatStore.getState().getModels().filter((model) => model.isAvailable);
    const [initialModel, nextModel] = models;
    expect(initialModel).toBeDefined();
    expect(nextModel).toBeDefined();

    const now = Date.now();
    useChatStore.setState({
      activeId: "conv-model-picker",
      selectedModelId: initialModel.id,
      conversations: [{
        id: "conv-model-picker",
        title: "Model switch",
        lastMessagePreview: "Hello",
        lastMessageAt: now,
        createdAt: now,
        modelId: initialModel.id,
        systemPrompt: "",
      }],
      messages: {
        "conv-model-picker": [{
          id: "message-1",
          conversationId: "conv-model-picker",
          role: "user",
          content: "Hello",
          createdAt: now,
          modelId: initialModel.id,
        }],
      },
    });

    render(<ModelPicker />);

    fireEvent.click(screen.getByRole("button", { name: /Model:/ }));
    fireEvent.click(screen.getByText(nextModel.name).closest("button")!);

    expect(useChatStore.getState().selectedModelId).toBe(nextModel.id);
    expect(screen.queryByText("Switch models?")).not.toBeInTheDocument();
  });
});
