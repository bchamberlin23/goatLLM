import { describe, it, expect } from "vitest";
import { listSkills, getSkill, getDefaultSkill, listSkillsByScenario } from "../lib/design/skills";
import { listDesignSystems, getDesignSystem, listDesignSystemsByCategory } from "../lib/design/systems";
import { listDirections, getDirection } from "../lib/design/directions";

describe("design catalog", () => {
  describe("skills", () => {
    const skills = listSkills();

    it("ships at least 14 skills", () => {
      expect(skills.length).toBeGreaterThanOrEqual(14);
    });

    it("every skill has the required fields", () => {
      for (const s of skills) {
        expect(s.id).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(s.name).toBeTruthy();
        expect(s.scenario).toMatch(/^(design|marketing|operation|engineering|product|finance|hr|personal)$/);
        expect(s.mode).toMatch(/^(prototype|deck|document)$/);
        expect(s.preview.kind).toMatch(/^(single-page|multi-frame|deck)$/);
        expect(s.description.length).toBeGreaterThan(10);
        expect(s.template).toContain("<!doctype html>");
        expect(s.references.length).toBeGreaterThan(0);
        for (const r of s.references) {
          expect(r.name).toBeTruthy();
          expect(r.body.length).toBeGreaterThan(20);
        }
      }
    });

    it("ids are unique", () => {
      const ids = skills.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("getSkill round-trips", () => {
      expect(getSkill("web-prototype")?.id).toBe("web-prototype");
      expect(getSkill("not-real")).toBeUndefined();
      expect(getSkill(null)).toBeUndefined();
    });

    it("has a default for both prototype and deck modes", () => {
      expect(getDefaultSkill("prototype").mode).toBe("prototype");
      expect(getDefaultSkill("deck").mode).toBe("deck");
    });

    it("groups by scenario without losing rows", () => {
      const grouped = listSkillsByScenario();
      const total = Object.values(grouped).reduce((n, arr) => n + arr.length, 0);
      expect(total).toBe(skills.length);
    });
  });

  describe("design systems", () => {
    const systems = listDesignSystems();

    it("ships at least 18 systems including 2 starters", () => {
      expect(systems.length).toBeGreaterThanOrEqual(18);
      expect(systems.filter((s) => s.isStarter).length).toBe(2);
    });

    it("every system has the required fields", () => {
      for (const s of systems) {
        expect(s.id).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(s.name).toBeTruthy();
        expect(s.category).toMatch(/^(starter|ai|devtools|productivity|fintech|media|automotive|other)$/);
        expect(s.tagline.length).toBeGreaterThan(10);
        expect(s.swatches.length).toBe(4);
        for (const sw of s.swatches) {
          expect(sw).toMatch(/^#[0-9a-f]{3,8}$/i);
        }
        expect(s.fonts.display).toBeTruthy();
        expect(s.fonts.body).toBeTruthy();
        expect(s.designMd).toContain("# Design System");
        expect(s.designMd).toContain("## Voice");
        expect(s.designMd).toContain("## Palette");
        expect(s.designMd).toContain("## Anti-patterns");
      }
    });

    it("ids are unique", () => {
      const ids = systems.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("getDesignSystem round-trips", () => {
      expect(getDesignSystem("default")?.isStarter).toBe(true);
      expect(getDesignSystem("not-real")).toBeUndefined();
    });

    it("groups by category without losing rows", () => {
      const grouped = listDesignSystemsByCategory();
      const total = Object.values(grouped).reduce((n, arr) => n + arr.length, 0);
      expect(total).toBe(systems.length);
    });
  });

  describe("directions", () => {
    const directions = listDirections();

    it("ships exactly 5 directions", () => {
      expect(directions.length).toBe(5);
    });

    it("every direction has full palette + fonts + refs", () => {
      for (const d of directions) {
        expect(d.id).toMatch(/^(editorial|modern-minimal|tech-utility|brutalist|soft-warm)$/);
        expect(d.name).toBeTruthy();
        expect(d.mood.length).toBeGreaterThan(20);
        // OKLch palette
        for (const v of Object.values(d.palette)) {
          expect(v).toMatch(/^oklch\(/);
        }
        expect(d.fonts.display).toBeTruthy();
        expect(d.fonts.body).toBeTruthy();
        expect(d.refs.length).toBeGreaterThan(0);
      }
    });

    it("getDirection round-trips", () => {
      expect(getDirection("editorial")?.id).toBe("editorial");
      expect(getDirection("not-real")).toBeUndefined();
      expect(getDirection(null)).toBeUndefined();
    });
  });
});
