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

    expect(prompt).toContain("<identity>");
    expect(prompt).toContain("<voice>");
    expect(prompt).toContain("<anti_slop>");
    expect(prompt).toContain("<artifact_contract>");

    expect(prompt).toContain('<active_skill id="web-prototype"');
    expect(prompt).toContain("<seed_template>");

    expect(prompt).toContain('<question-form id="discovery"');
    expect(prompt).toContain('"id": "output"');
    expect(prompt).toContain('"id": "audience"');
    expect(prompt).toContain('"id": "brand"');
    expect(prompt).toContain('"id": "platform"');
    expect(prompt).toContain('"id": "tone"');
    expect(prompt).toContain('"id": "scale"');
    expect(prompt).toContain('"id": "constraints"');

    expect(prompt).toContain("<discovery>");

    expect(prompt).toContain("<p0_gate>");
  });

  it("subsequent turn excludes first-turn discovery form", () => {
    const prompt = buildDesignSystemPrompt({
      skillId: "web-prototype",
      systemId: null,
      directionId: null,
      isFirstTurn: false,
    });

    expect(prompt).not.toContain('<question-form id="discovery"');
    expect(prompt).toContain("<identity>");
  });

  it("no skill selected skips skill block and discovery directives", () => {
    const prompt = buildDesignSystemPrompt({
      skillId: null,
      systemId: null,
      directionId: null,
      isFirstTurn: true,
    });

    expect(prompt).not.toContain("<active_skill");
    expect(prompt).not.toContain('<question-form id="discovery"');
    expect(prompt).not.toContain("<discovery>");
    expect(prompt).toContain("<identity>");
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
      directionId: "editorial-monocle",
      isFirstTurn: false,
    });

    expect(prompt).toContain('<active_direction id="editorial-monocle"');
    expect(prompt).toContain("--bg:");
    expect(prompt).toContain("--fg:");
    expect(prompt).toContain("--accent:");
    expect(prompt).toContain("--muted:");
    expect(prompt).toContain("--border:");
    expect(prompt).toContain("oklch(");
    expect(prompt).toContain("display:");
    expect(prompt).toContain("body:");
    expect(prompt).toContain("Posture:");
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

    expect(prompt).toContain("<identity>");
    expect(prompt).toContain('<active_skill id="saas-landing"');
    expect(prompt).toContain('<active_design_system id="stripe"');
    expect(prompt).toContain('<active_direction id="modern-minimal"');
    expect(prompt).toContain('<question-form id="discovery"');
    expect(prompt).toContain("<user_system_prompt>");
    expect(prompt).toContain("Make it pop.");
  });

  it("includes direction library spec block on first turn", () => {
    const prompt = buildDesignSystemPrompt({
      skillId: "web-prototype",
      systemId: null,
      directionId: null,
      isFirstTurn: true,
    });

    expect(prompt).toContain("## Direction library");
    expect(prompt).toContain("editorial-monocle");
    expect(prompt).toContain("modern-minimal");
    expect(prompt).toContain("human-approachable");
    expect(prompt).toContain("tech-utility");
    expect(prompt).toContain("brutalist-experimental");
  });

  it("includes cross-platform contracts in discovery directives", () => {
    const prompt = buildDesignSystemPrompt({
      skillId: "web-prototype",
      systemId: null,
      directionId: null,
      isFirstTurn: true,
    });

    expect(prompt).toContain("Cross-platform");
    expect(prompt).toContain("Responsive web");
    expect(prompt).toContain("iOS app");
    expect(prompt).toContain("Android app");
    expect(prompt).toContain("iphone-15-pro.html");
  });

  it("includes brand extraction workflow in discovery directives", () => {
    const prompt = buildDesignSystemPrompt({
      skillId: "web-prototype",
      systemId: null,
      directionId: null,
      isFirstTurn: true,
    });

    expect(prompt).toContain("Branch A");
    expect(prompt).toContain("Branch B");
    expect(prompt).toContain("brand_spec");
    expect(prompt).toContain("reference_match");
    expect(prompt).toContain("brand-spec");
  });
});
