import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "../components/Settings";

describe("Settings polish", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders as a named modal dialog", () => {
    render(<Settings onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });

  it("uses full-surface tab selection instead of side stripes", () => {
    render(<Settings onClose={vi.fn()} />);

    const providersTab = screen.getByRole("tab", { name: /providers/i });
    expect(providersTab).toHaveAttribute("aria-selected", "true");
    expect(providersTab.className).not.toContain("border-l-2");
  });

  it("renders the persisted Advanced tab without spinning the store subscription", () => {
    localStorage.setItem("goatllm-settings-tab", "advanced");

    render(<Settings onClose={vi.fn()} />);

    expect(screen.getByRole("tabpanel", { name: "Advanced" })).toBeInTheDocument();
    expect(screen.getByText("Agent policy")).toBeInTheDocument();
  });
});
