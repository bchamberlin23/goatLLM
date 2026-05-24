import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseCommandArgs,
  substituteArgs,
  parsePromptTemplate,
  expandPromptTemplate,
  loadPromptTemplates,
} from "../lib/prompt-templates";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("parseCommandArgs", () => {
  it("splits on whitespace", () => {
    expect(parseCommandArgs("a b c")).toEqual(["a", "b", "c"]);
  });

  it("handles double quotes", () => {
    expect(parseCommandArgs('foo "bar baz" qux')).toEqual(["foo", "bar baz", "qux"]);
  });

  it("handles single quotes", () => {
    expect(parseCommandArgs("'one two' three")).toEqual(["one two", "three"]);
  });

  it("handles escapes", () => {
    expect(parseCommandArgs('a\\ b c')).toEqual(["a b", "c"]);
  });

  it("returns empty for empty input", () => {
    expect(parseCommandArgs("")).toEqual([]);
  });
});

describe("substituteArgs", () => {
  it("substitutes positional args", () => {
    expect(substituteArgs("Hello $1 from $2", ["world", "goat"])).toBe("Hello world from goat");
  });

  it("substitutes $@ and $ARGUMENTS", () => {
    expect(substituteArgs("Run: $@", ["a", "b"])).toBe("Run: a b");
    expect(substituteArgs("Run: $ARGUMENTS", ["a", "b"])).toBe("Run: a b");
  });

  it("substitutes ${@:N} and ${@:N:L}", () => {
    expect(substituteArgs("${@:2}", ["a", "b", "c", "d"])).toBe("b c d");
    expect(substituteArgs("${@:2:2}", ["a", "b", "c", "d"])).toBe("b c");
  });

  it("returns empty string for missing positional", () => {
    expect(substituteArgs("$1 $2", ["only-one"])).toBe("only-one ");
  });

  it("does NOT recursively substitute arg values", () => {
    expect(substituteArgs("$1", ["$2 wins"])).toBe("$2 wins");
  });
});

describe("parsePromptTemplate", () => {
  it("parses frontmatter and body", () => {
    const raw = `---
description: Review staged changes
argument-hint: "<path>"
---
Review the file $1.`;
    const tpl = parsePromptTemplate("review", ".goat/prompts/review.md", raw);
    expect(tpl.name).toBe("review");
    expect(tpl.description).toBe("Review staged changes");
    expect(tpl.argumentHint).toBe("<path>");
    expect(tpl.content).toBe("Review the file $1.");
  });

  it("falls back to the first non-empty line for description", () => {
    const tpl = parsePromptTemplate("ship", ".goat/prompts/ship.md", "Build, test, push.");
    expect(tpl.description).toBe("Build, test, push.");
  });
});

describe("expandPromptTemplate", () => {
  const templates = [
    parsePromptTemplate("review", "p", "---\ndescription: r\n---\nReview $1"),
    parsePromptTemplate("plan", "p", "---\ndescription: p\n---\nPlan: $@"),
  ];

  it("expands a known template", () => {
    expect(expandPromptTemplate("/review src/foo.ts", templates)).toBe("Review src/foo.ts");
  });

  it("expands $@ across multiple args", () => {
    expect(expandPromptTemplate('/plan "do thing" carefully', templates)).toBe("Plan: do thing carefully");
  });

  it("returns input unchanged when template not found", () => {
    expect(expandPromptTemplate("/unknown args", templates)).toBe("/unknown args");
  });

  it("returns input unchanged for plain text", () => {
    expect(expandPromptTemplate("hello world", templates)).toBe("hello world");
  });
});

describe("loadPromptTemplates", () => {
  let invoke: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    const mod = await import("@tauri-apps/api/core");
    invoke = mod.invoke as unknown as ReturnType<typeof vi.fn>;
    invoke.mockReset();
  });

  it("returns empty array when no template dirs exist", async () => {
    invoke.mockRejectedValue(new Error("missing"));
    const out = await loadPromptTemplates("/ws");
    expect(out).toEqual([]);
  });

  it("loads markdown files and prefers .goat/ over .pi/", async () => {
    invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "list_dir") {
        const path = args.path as string;
        if (path === ".goat/prompts") return [{ name: "review.md", is_dir: false, size: 100 }];
        if (path === ".pi/prompts") return [
          { name: "review.md", is_dir: false, size: 100 },
          { name: "plan.md", is_dir: false, size: 100 },
        ];
        return [];
      }
      if (cmd === "read_file") {
        const path = args.path as string;
        if (path === ".goat/prompts/review.md")
          return "---\ndescription: native review\n---\nReview $1";
        if (path === ".pi/prompts/review.md")
          return "---\ndescription: pi review\n---\nReview $1 (pi)";
        if (path === ".pi/prompts/plan.md")
          return "---\ndescription: pi plan\n---\nPlan: $@";
        throw new Error("missing");
      }
      throw new Error("unknown");
    });
    const out = await loadPromptTemplates("/ws");
    const review = out.find((t) => t.name === "review");
    expect(review?.description).toBe("native review");
    expect(out.find((t) => t.name === "plan")).toBeTruthy();
  });
});
