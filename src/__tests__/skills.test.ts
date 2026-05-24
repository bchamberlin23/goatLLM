import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatSkillsForPrompt, loadAllSkills, readSkillFile, type Skill } from "../lib/skills";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const baseSkill = (over: Partial<Skill>): Skill => ({
  name: "demo",
  description: "Demo skill",
  filePath: "/x/SKILL.md",
  baseDir: "/x",
  disableModelInvocation: false,
  source: "test",
  mode: "agent",
  ...over,
});

describe("formatSkillsForPrompt", () => {
  it("returns empty string for no visible skills", () => {
    expect(formatSkillsForPrompt([])).toBe("");
  });

  it("emits an XML block with one entry per skill", () => {
    const out = formatSkillsForPrompt([
      baseSkill({ name: "a", description: "first" }),
      baseSkill({ name: "b", description: "second", filePath: "/y/SKILL.md" }),
    ]);
    expect(out).toContain("<available_skills>");
    expect(out).toContain("<name>a</name>");
    expect(out).toContain("<description>first</description>");
    expect(out).toContain("<name>b</name>");
    expect(out).toContain("<location>/y/SKILL.md</location>");
  });

  it("excludes disable-model-invocation skills from the prompt", () => {
    const out = formatSkillsForPrompt([
      baseSkill({ name: "shown" }),
      baseSkill({ name: "hidden", disableModelInvocation: true }),
    ]);
    expect(out).toContain("<name>shown</name>");
    expect(out).not.toContain("<name>hidden</name>");
  });

  it("escapes XML metacharacters in fields", () => {
    const out = formatSkillsForPrompt([
      baseSkill({ name: "x", description: "has <angle> & ampersand" }),
    ]);
    expect(out).toContain("&lt;angle&gt;");
    expect(out).toContain("&amp; ampersand");
  });
});

describe("loadAllSkills", () => {
  let invoke: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    const mod = await import("@tauri-apps/api/core");
    invoke = mod.invoke as unknown as ReturnType<typeof vi.fn>;
    invoke.mockReset();
  });

  it("returns an empty list and no errors when no skill dirs exist", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "home_dir") return "/home/u";
      if (cmd === "goat_agent_dir") return "/home/u/.goat/agent";
      if (cmd === "path_exists_abs") return false;
      if (cmd === "list_dir_abs") return [];
      throw new Error("unexpected");
    });
    const result = await loadAllSkills({ customPaths: [], includeDefaults: true });
    expect(result.skills).toEqual([]);
    expect(result.errorMessages).toEqual([]);
  });

  it("loads a SKILL.md from a skill-root directory", async () => {
    invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "home_dir") return "/h";
      if (cmd === "goat_agent_dir") return "/h/.goat/agent";
      if (cmd === "path_exists_abs") {
        const p = args?.path as string;
        return p.startsWith("/h/.goat/agent/skills");
      }
      if (cmd === "list_dir_abs") {
        const p = args?.path as string;
        if (p === "/h/.goat/agent/skills") {
          return [{ name: "demo", is_dir: true, size: 0 }];
        }
        if (p === "/h/.goat/agent/skills/demo") {
          return [{ name: "SKILL.md", is_dir: false, size: 100 }];
        }
        return [];
      }
      if (cmd === "read_text_file_abs") {
        const p = args?.path as string;
        if (p === "/h/.goat/agent/skills/demo/SKILL.md") {
          return "---\nname: demo\ndescription: A demo skill\n---\nBody.";
        }
      }
      throw new Error(`unexpected ${cmd}`);
    });
    const result = await loadAllSkills({ customPaths: [], includeDefaults: true });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe("demo");
    expect(result.skills[0].description).toBe("A demo skill");
  });

  it("rejects skills with invalid names", async () => {
    invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "home_dir") return "/h";
      if (cmd === "goat_agent_dir") return "/h/.goat/agent";
      if (cmd === "path_exists_abs") {
        return (args?.path as string).startsWith("/h/.goat/agent/skills");
      }
      if (cmd === "list_dir_abs") {
        const p = args?.path as string;
        if (p === "/h/.goat/agent/skills") {
          return [{ name: "bad-name", is_dir: true, size: 0 }];
        }
        if (p === "/h/.goat/agent/skills/bad-name") {
          return [{ name: "SKILL.md", is_dir: false, size: 100 }];
        }
        return [];
      }
      if (cmd === "read_text_file_abs") {
        // double-hyphen in name → invalid per the spec
        return "---\nname: bad--name\ndescription: hi\n---\nx";
      }
      throw new Error(`unexpected ${cmd}`);
    });
    const result = await loadAllSkills({ customPaths: [], includeDefaults: true });
    expect(result.skills).toEqual([]);
    expect(result.errorMessages.some((e) => e.includes("consecutive hyphens"))).toBe(true);
  });

  it("respects `disable-model-invocation` frontmatter", async () => {
    invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "home_dir") return "/h";
      if (cmd === "goat_agent_dir") return "/h/.goat/agent";
      if (cmd === "path_exists_abs") {
        return (args?.path as string).startsWith("/h/.goat/agent/skills");
      }
      if (cmd === "list_dir_abs") {
        const p = args?.path as string;
        if (p === "/h/.goat/agent/skills") {
          return [{ name: "private", is_dir: true, size: 0 }];
        }
        if (p === "/h/.goat/agent/skills/private") {
          return [{ name: "SKILL.md", is_dir: false, size: 100 }];
        }
        return [];
      }
      if (cmd === "read_text_file_abs") {
        return "---\nname: private\ndescription: hidden\ndisable-model-invocation: true\n---\nx";
      }
      throw new Error("unexpected");
    });
    const result = await loadAllSkills({ customPaths: [], includeDefaults: true });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].disableModelInvocation).toBe(true);
  });

  it("parses `mode` frontmatter and defaults to agent", async () => {
    invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "home_dir") return "/h";
      if (cmd === "goat_agent_dir") return "/h/.goat/agent";
      if (cmd === "path_exists_abs") {
        return (args?.path as string).startsWith("/h/.goat/agent/skills");
      }
      if (cmd === "list_dir_abs") {
        const p = args?.path as string;
        if (p === "/h/.goat/agent/skills") {
          return [
            { name: "chatonly", is_dir: true, size: 0 },
            { name: "defaulted", is_dir: true, size: 0 },
            { name: "both", is_dir: true, size: 0 },
          ];
        }
        if (p.endsWith("/skills/chatonly") || p.endsWith("/skills/defaulted") || p.endsWith("/skills/both")) {
          return [{ name: "SKILL.md", is_dir: false, size: 100 }];
        }
        return [];
      }
      if (cmd === "read_text_file_abs") {
        const p = args?.path as string;
        if (p.includes("/chatonly/")) return "---\nname: chatonly\ndescription: c\nmode: chat\n---\nx";
        if (p.includes("/defaulted/")) return "---\nname: defaulted\ndescription: d\n---\nx";
        if (p.includes("/both/")) return "---\nname: both\ndescription: b\nmode: both\n---\nx";
      }
      throw new Error("unexpected");
    });
    const result = await loadAllSkills({ customPaths: [], includeDefaults: true });
    expect(result.skills.find((s) => s.name === "chatonly")?.mode).toBe("chat");
    expect(result.skills.find((s) => s.name === "defaulted")?.mode).toBe("agent");
    expect(result.skills.find((s) => s.name === "both")?.mode).toBe("both");
  });

  it("ignores invalid `mode` values and falls back to agent", async () => {
    invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "home_dir") return "/h";
      if (cmd === "goat_agent_dir") return "/h/.goat/agent";
      if (cmd === "path_exists_abs") return (args?.path as string).startsWith("/h/.goat/agent/skills");
      if (cmd === "list_dir_abs") {
        const p = args?.path as string;
        if (p === "/h/.goat/agent/skills") return [{ name: "weird", is_dir: true, size: 0 }];
        if (p === "/h/.goat/agent/skills/weird") return [{ name: "SKILL.md", is_dir: false, size: 100 }];
        return [];
      }
      if (cmd === "read_text_file_abs") {
        return "---\nname: weird\ndescription: x\nmode: foobar\n---\nx";
      }
      throw new Error("unexpected");
    });
    const result = await loadAllSkills({ customPaths: [], includeDefaults: true });
    expect(result.skills[0].mode).toBe("agent");
  });

  it("deduplicates by name across sources (first match wins)", async () => {
    // Native goat dir AND pi dir both have a "shared" skill — native should win.
    invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "home_dir") return "/h";
      if (cmd === "goat_agent_dir") return "/h/.goat/agent";
      if (cmd === "path_exists_abs") {
        const p = args?.path as string;
        return p.includes("/.goat/agent/skills") || p.includes("/.pi/agent/skills");
      }
      if (cmd === "list_dir_abs") {
        const p = args?.path as string;
        if (p.endsWith("/skills")) {
          return [{ name: "shared", is_dir: true, size: 0 }];
        }
        if (p.endsWith("/skills/shared")) {
          return [{ name: "SKILL.md", is_dir: false, size: 100 }];
        }
        return [];
      }
      if (cmd === "read_text_file_abs") {
        const p = args?.path as string;
        if (p.includes(".goat/agent")) return "---\nname: shared\ndescription: from goat\n---\nx";
        if (p.includes(".pi/agent")) return "---\nname: shared\ndescription: from pi\n---\nx";
      }
      throw new Error("unexpected");
    });
    const result = await loadAllSkills({ customPaths: [], includeDefaults: true });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].description).toBe("from goat");
  });

  it("expands ~ in custom paths", async () => {
    let queriedPath: string | null = null;
    invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "home_dir") return "/myhome";
      if (cmd === "path_exists_abs") {
        queriedPath = args?.path as string;
        return false;
      }
      if (cmd === "list_dir_abs") return [];
      throw new Error(`unexpected ${cmd}`);
    });
    const result = await loadAllSkills({
      customPaths: ["~/skills"],
      includeDefaults: false,
    });
    expect(queriedPath).toBe("/myhome/skills");
    expect(result.errorMessages.some((e) => e.includes("/myhome/skills"))).toBe(true);
  });
});

describe("readSkillFile", () => {
  let invoke: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    const mod = await import("@tauri-apps/api/core");
    invoke = mod.invoke as unknown as ReturnType<typeof vi.fn>;
    invoke.mockReset();
  });

  it("delegates to read_text_file_abs", async () => {
    invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      expect(cmd).toBe("read_text_file_abs");
      expect(args.path).toBe("/x/SKILL.md");
      return "skill body";
    });
    const out = await readSkillFile("/x/SKILL.md");
    expect(out).toBe("skill body");
  });
});
