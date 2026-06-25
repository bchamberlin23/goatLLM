import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("built-in skill bundle", () => {
  it.each(["internet-research-router", "stop-slop", "taste-check", "engineering-grill"])(
    "ships and seeds %s",
    (name) => {
      const skillPath = join(root, "public", "skills", name, "SKILL.md");
      expect(existsSync(skillPath)).toBe(true);
      const skill = readFileSync(skillPath, "utf8");
      expect(skill).toContain(`name: ${name}`);
      expect(skill).toContain("description:");

      const seed = readFileSync(join(root, "src", "lib", "skill-seed.ts"), "utf8");
      expect(seed).toContain(`name: "${name}"`);
    },
  );
});
