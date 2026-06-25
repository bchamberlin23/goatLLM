import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TopBar } from "../components/TopBar";
import { useChatStore } from "../stores/chat";

const startDragging = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging }),
}));

describe("TopBar window drag", () => {
  beforeEach(() => {
    startDragging.mockReset();
    useChatStore.setState({
      conversations: [],
      activeId: null,
      messages: {},
      sidebarOpen: true,
      agentMode: false,
      designMode: false,
    });
  });

  it("starts a Tauri window drag from empty top chrome", () => {
    const { container } = render(<TopBar />);
    const dragRegion = container.querySelector("[data-tauri-drag-region]");

    expect(dragRegion).not.toBeNull();
    if (!dragRegion) throw new Error("Expected a top-bar drag region");
    fireEvent.pointerDown(dragRegion, { button: 0, isPrimary: true });

    expect(startDragging).toHaveBeenCalledTimes(1);
  });
});
