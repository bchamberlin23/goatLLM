import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DesignHero } from "../components/design/DesignHero";
import { QuestionFormRenderer } from "../components/design/QuestionFormRenderer";
import { DesignPills } from "../components/design/DesignPills";
import type { ParsedQuestionForm } from "../lib/design/parser";
import { useChatStore } from "../stores/chat";

describe("DesignHero", () => {
  it("renders the heading and scenario groups", () => {
    render(<DesignHero />);

    expect(screen.getByText("Pick a surface to design.")).toBeInTheDocument();
    // Scenario labels should be present.
    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.getByText("Marketing")).toBeInTheDocument();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
  });

  it("renders skill cards with correct names", () => {
    render(<DesignHero />);

    expect(screen.getByText("Web prototype")).toBeInTheDocument();
    expect(screen.getByText("SaaS landing")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Pricing page")).toBeInTheDocument();
    expect(screen.getByText("Docs page")).toBeInTheDocument();
    expect(screen.getByText("Blog post")).toBeInTheDocument();
    expect(screen.getByText("Mobile app")).toBeInTheDocument();
    expect(screen.getByText("Social carousel")).toBeInTheDocument();
    expect(screen.getByText("Magazine poster")).toBeInTheDocument();
    expect(screen.getByText("Simple deck")).toBeInTheDocument();
    expect(screen.getByText("PM spec")).toBeInTheDocument();
    expect(screen.getByText("Kanban board")).toBeInTheDocument();
  });

  it("renders mode badges on skill cards", () => {
    render(<DesignHero />);

    const prototypeBadges = screen.getAllByText("prototype");
    expect(prototypeBadges.length).toBeGreaterThanOrEqual(9);

    const deckBadges = screen.getAllByText("deck");
    expect(deckBadges.length).toBeGreaterThanOrEqual(3);

    const documentBadges = screen.getAllByText("document");
    expect(documentBadges.length).toBeGreaterThanOrEqual(2);
  });

  it("renders a 'Skill selected' badge when a skill is active", () => {
    useChatStore.setState({ activeSkillId: "web-prototype" });

    render(<DesignHero />);

    expect(screen.getByText("Skill selected")).toBeInTheDocument();

    // Reset state for subsequent tests.
    useChatStore.setState({ activeSkillId: null });
  });
});

describe("DesignPills", () => {
  it("renders both pills", () => {
    render(<DesignPills />);

    // SurfacePill and VisualStylePill are the two pills.
    expect(screen.getByText("Pick a surface")).toBeInTheDocument();
    expect(screen.getByText("Visual style")).toBeInTheDocument();
  });
});

describe("QuestionFormRenderer", () => {
  const mockForm: ParsedQuestionForm = {
    id: "discovery",
    fields: [
      {
        id: "surface",
        label: "What are you designing?",
        type: "radio",
        options: [
          { value: "landing", label: "Landing page" },
          { value: "dashboard", label: "Dashboard" },
        ],
      },
      {
        id: "brand",
        label: "Brand notes",
        type: "textarea",
        options: [],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders field labels and options", () => {
    render(<QuestionFormRenderer form={mockForm} conversationId="conv-1" />);

    expect(screen.getByText("What are you designing?")).toBeInTheDocument();
    expect(screen.getByText("Landing page")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Brand notes")).toBeInTheDocument();
  });

  it("renders a submit button", () => {
    render(<QuestionFormRenderer form={mockForm} conversationId="conv-1" />);

    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("is disabled when the disabled prop is set", () => {
    render(
      <QuestionFormRenderer
        form={mockForm}
        conversationId="conv-1"
        disabled
      />,
    );

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
  });

  it("submits and disables the form on click", () => {
    const setPendingFormSubmission = vi.fn();
    useChatStore.setState({ setPendingFormSubmission });

    render(<QuestionFormRenderer form={mockForm} conversationId="conv-1" />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(setPendingFormSubmission).toHaveBeenCalledTimes(1);
    expect(setPendingFormSubmission).toHaveBeenCalledWith({
      conversationId: "conv-1",
      text: expect.stringContaining("[form answers — discovery]"),
    });

    // Reset store.
    useChatStore.setState({ setPendingFormSubmission: undefined });
  });
});
