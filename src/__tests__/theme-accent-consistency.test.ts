import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("theme accent consistency", () => {
  it("keeps user-selectable active states on the dynamic accent token", () => {
    const components = [
      "src/components/ModeToggle.tsx",
      "src/components/AgentPill.tsx",
      "src/components/AutoApproveToggle.tsx",
      "src/components/WorkspacePicker.tsx",
      "src/components/design/DesignPills.tsx",
      "src/components/design/DesignHero.tsx",
      "src/components/design/SurfacePill.tsx",
      "src/components/settings/InterfaceTab.tsx",
      "src/components/settings/SettingsTabs.tsx",
      "src/components/settings/ToolsTab.tsx",
    ];

    for (const component of components) {
      const source = readSource(component);
      expect(source, component).not.toMatch(/(?:bg|border|text|ring|shadow)-(?:orange|amber)-/);
      expect(source, component).not.toMatch(/rgba\(245\s*,\s*158\s*,\s*66/);
    }
  });

  it("documents the dynamic token rule in the design system", () => {
    const design = readSource("DESIGN.md");

    expect(design).toContain("Theme customization");
    expect(design).toContain("--accent");
  });

  it("keeps the mesh ambient effect tied to the selected theme", () => {
    const css = readSource("src/index.css");
    const meshVariables = /\.mode-mesh\s*\{([\s\S]*?)\n\}/.exec(css)?.[1];
    const meshEffect = /\.liquid-glow-field\.mode-mesh\s*\{([\s\S]*?)\n\}/.exec(css)?.[1];

    expect(meshVariables).toContain("--theme-glow-rgb: var(--theme-accent-rgb)");
    expect(meshEffect).toContain("rgba(var(--theme-glow-rgb), 0.055)");
  });
});
