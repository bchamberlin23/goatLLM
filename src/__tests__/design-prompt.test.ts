import { describe, it, expect } from "vitest";
import { buildDesignSystemPrompt } from "../lib/design/prompt";

describe("buildDesignSystemPrompt", () => {
  it("first turn with skill includes discovery directives and identity charter", () => {
    const prompt = buildDesignSystemPrompt({
      skillId: "web-prototype",
      systemId: null,
      directionId: null,
      isFirstTurn: true,
    });

    // Identity charter always present.
    expect(prompt).toContain("<identity>");
    expect(prompt).toContain("<voice>");
    expect(prompt).toContain("<anti_slop>");
    expect(prompt).toContain("<artifact_contract>");

    // Active skill block present.
    expect(prompt).toContain('<active_skill id="web-prototype"');
    expect(prompt).toContain("<seed_template>");

    // First-turn discovery form present.
    expect(prompt).toContain('<question-form id="discovery">');
    expect(prompt).toContain('name="surface"');
    expect(prompt).toContain('name="audience"');

    // Follow-up directives present.
    expect(prompt).toContain('<discovery turn="2+">');

    // P0 gate present.
    expect(prompt).toContain("<p0_gate>");
  });

  it("subsequent turn excludes first-turn discovery form", () => {
    const prompt = buildDesignSystemPrompt({
      skillId: "web-prototype",
      systemId: null,
      directionId: null,
      isFirstTurn: false,
    });

    // Follow-up directives still present.
    expect(prompt).toContain('<discovery turn="2+">');
    // First-turn discovery form absent.
    expect(prompt).not.toContain('<question-form id="discovery">');
    // Identity charter always present.
    expect(prompt).toContain("<identity>");
  });

  it("no skill selected skips skill block and discovery directives", () => {
    const prompt = buildDesignSystemPrompt({
      skillId: null,
      systemId: null,
      directionId: null,
      isFirstTurn: true,
    });

    // No skill block.
    expect(prompt).not.toContain("<active_skill");
    // No discovery form (requires active skill).
    expect(prompt).not.toContain('<question-form id="discovery">');
    expect(prompt).not.toContain('<discovery turn="2+">');
    // Identity charter still present — base design mode always gets it.
    expect(prompt).toContain("<identity>");
    // P0 gate still present.
    expect(prompt).toContain("<p0_gate>");
  });

  it("design system is inlined when selected", () => {
    const prompt = buildDesignSystemPrompt({
      skillId: "web-prototype",
      systemId: "linear-app",
      directionId: null,
      isFirstTurn: false,
    });

    expect(prompt).toContain('<active_design_system id="linear-app"');
    expect(prompt).toContain("## Voice");
    expect(prompt).toContain("## Palette");
    expect(prompt).toContain("## Anti-patterns");
  });

  it("direction binds OKLch palette into prompt", () => {
    const prompt = buildDesignSystemPrompt({
      skillId: "web-prototype",
      systemId: null,
      directionId: "editorial",
      isFirstTurn: false,
    });

    expect(prompt).toContain('<active_direction id="editorial"');
    expect(prompt).toContain("--bg:");
    expect(prompt).toContain("--fg:");
    expect(prompt).toContain("--accent:");
    expect(prompt).toContain("oklch(");
    expect(prompt).toContain("display:");
    expect(prompt).toContain("body:");
  });

  it("user prompt is injected as a tagged block", () => {
    const prompt = buildDesignSystemPrompt({
      skillId: "web-prototype",
      systemId: null,
      directionId: null,
      isFirstTurn: false,
      userPrompt: "Always use dark mode.",
    });

    expect(prompt).toContain("<user_system_prompt>");
    expect(prompt).toContain("Always use dark mode.");
    expect(prompt).toContain("</user_system_prompt>");
  });

  it("empty user prompt is not injected", () => {
    const prompt = buildDesignSystemPrompt({
      skillId: "web-prototype",
      systemId: null,
      directionId: null,
      isFirstTurn: false,
      userPrompt: "",
    });

    expect(prompt).not.toContain("<user_system_prompt>");
  });

  it("null skillId does not throw", () => {
    expect(() =>
      buildDesignSystemPrompt({
        skillId: null,
        systemId: null,
        directionId: null,
        isFirstTurn: false,
      }),
    ).not.toThrow();
  });

  it("unknown skill/system/direction ids produce no blocks but don't crash", () => {
    const prompt = buildDesignSystemPrompt({
      skillId: "not-a-real-skill",
      systemId: "not-a-real-system",
      directionId: "not-a-real-direction",
      isFirstTurn: false,
    });

    expect(prompt).not.toContain("<active_skill");
    expect(prompt).not.toContain("<active_design_system");
    expect(prompt).not.toContain("<active_direction");
    expect(prompt).toContain("<identity>");
  });

  it("full stack: skill + system + direction + first turn + user prompt", () => {
    const prompt = buildDesignSystemPrompt({
      skillId: "saas-landing",
      systemId: "stripe",
      directionId: "modern-minimal",
      isFirstTurn: true,
      userPrompt: "Make it pop.",
    });

    // All five components present.
    expect(prompt).toContain("<identity>");
    expect(prompt).toContain('<active_skill id="saas-landing"');
    expect(prompt).toContain('<active_design_system id="stripe"');
    expect(prompt).toContain('<active_direction id="modern-minimal"');
    expect(prompt).toContain('<question-form id="discovery">');
    expect(prompt).toContain("<user_system_prompt>");
    expect(prompt).toContain("Make it pop.");
  });
});
