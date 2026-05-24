import { describe, it, expect, beforeEach } from "vitest";
import {
  createProject,
  loadProject,
  saveProject,
  deleteProject,
  getFile,
  setFile,
  deleteFile,
  listFiles,
} from "../lib/design/project";
import type { DesignProject } from "../lib/design/project";

describe("design project", () => {
  const CONV_ID = "test-conv-1";

  beforeEach(() => {
    localStorage.clear();
  });

  describe("createProject", () => {
    it("creates a project with metadata and optional seed", () => {
      const p = createProject({
        conversationId: CONV_ID,
        skillId: "web-prototype",
        systemId: "linear-app",
        directionId: "editorial",
        seedHtml: "<!doctype html><html></html>",
      });

      expect(p.conversationId).toBe(CONV_ID);
      expect(p.skillId).toBe("web-prototype");
      expect(p.systemId).toBe("linear-app");
      expect(p.directionId).toBe("editorial");
      expect(p.files["template.html"]).toBe("<!doctype html><html></html>");
    });

    it("creates a project without a seed", () => {
      const p = createProject({
        conversationId: CONV_ID,
        skillId: "saas-landing",
        systemId: null,
        directionId: null,
      });

      expect(p.files).toEqual({});
    });
  });

  describe("loadProject / saveProject / deleteProject", () => {
    it("round-trips through localStorage", () => {
      const p = createProject({
        conversationId: CONV_ID,
        skillId: "web-prototype",
        systemId: null,
        directionId: null,
        seedHtml: "<html></html>",
      });

      saveProject(p);
      const loaded = loadProject(CONV_ID);

      expect(loaded).not.toBeNull();
      expect(loaded!.conversationId).toBe(CONV_ID);
      expect(loaded!.skillId).toBe("web-prototype");
      expect(loaded!.files["template.html"]).toBe("<html></html>");
    });

    it("returns null for missing project", () => {
      expect(loadProject("nonexistent")).toBeNull();
    });

    it("deletes a project", () => {
      const p = createProject({
        conversationId: CONV_ID,
        skillId: "web-prototype",
        systemId: null,
        directionId: null,
      });
      saveProject(p);
      expect(loadProject(CONV_ID)).not.toBeNull();

      deleteProject(CONV_ID);
      expect(loadProject(CONV_ID)).toBeNull();
    });
  });

  describe("file operations", () => {
    let project: DesignProject;

    beforeEach(() => {
      project = createProject({
        conversationId: CONV_ID,
        skillId: "web-prototype",
        systemId: null,
        directionId: null,
      });
    });

    it("getFile returns undefined for missing file", () => {
      expect(getFile(project, "nonexistent.html")).toBeUndefined();
    });

    it("setFile adds a file", () => {
      const updated = setFile(project, "brand-spec.md", "# Brand spec");
      expect(getFile(updated, "brand-spec.md")).toBe("# Brand spec");
      // Original project is unchanged (immutable update).
      expect(getFile(project, "brand-spec.md")).toBeUndefined();
    });

    it("setFile overwrites an existing file", () => {
      const first = setFile(project, "theme.css", ":root {}");
      const second = setFile(first, "theme.css", ":root { --bg: #fff; }");
      expect(getFile(second, "theme.css")).toBe(":root { --bg: #fff; }");
    });

    it("deleteFile removes a file", () => {
      const withFile = setFile(project, "notes.md", "notes");
      expect(getFile(withFile, "notes.md")).toBe("notes");

      const withoutFile = deleteFile(withFile, "notes.md");
      expect(getFile(withoutFile, "notes.md")).toBeUndefined();
    });

    it("deleteFile is a no-op for missing files", () => {
      const result = deleteFile(project, "nonexistent.md");
      expect(result.files).toEqual({});
    });
  });

  describe("listFiles", () => {
    it("sorts alphabetically with directories first", () => {
      let p = createProject({
        conversationId: CONV_ID,
        skillId: "web-prototype",
        systemId: null,
        directionId: null,
      });
      p = setFile(p, "template.html", "");
      p = setFile(p, "assets/logo.svg", "");
      p = setFile(p, "brand-spec.md", "");
      p = setFile(p, "assets/hero.png", "");
      p = setFile(p, "theme.css", "");

      const files = listFiles(p);
      expect(files).toEqual([
        "assets/hero.png",
        "assets/logo.svg",
        "brand-spec.md",
        "template.html",
        "theme.css",
      ]);
    });

    it("returns empty array for empty project", () => {
      const p = createProject({
        conversationId: CONV_ID,
        skillId: "web-prototype",
        systemId: null,
        directionId: null,
      });
      expect(listFiles(p)).toEqual([]);
    });
  });
});
