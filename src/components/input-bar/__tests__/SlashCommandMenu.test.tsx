import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SlashCommandMenu } from "../SlashCommandMenu";

import type { SlashCommandDefinition } from "../../../lib/slash-commands";

const commands: SlashCommandDefinition[] = [
  {
    name: "goal",
    label: "/goal",
    description: "Run autonomously until a goal is handled.",
    argumentHint: "<goal>",
    keywords: ["autonomous"],
    execute: vi.fn(),
  },
  {
    name: "compact",
    label: "/compact",
    description: "Summarize older context.",
    keywords: ["summarize"],
    execute: vi.fn(),
  },
];

describe("SlashCommandMenu", () => {
  it("renders command metadata and selected state", () => {
    render(<SlashCommandMenu commands={commands} activeIndex={1} onSelect={vi.fn()} />);

    expect(screen.getByRole("listbox", { name: "Slash commands" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /compact/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("<goal>")).toBeInTheDocument();
  });

  it("selects a command from the menu", () => {
    const onSelect = vi.fn();
    render(<SlashCommandMenu commands={commands} activeIndex={0} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("option", { name: /goal/i }));

    expect(onSelect).toHaveBeenCalledWith(commands[0]);
  });
});
