/**
 * search_content schema tests — pin the new context_lines + case_insensitive
 * surface added in PR0 (the grep nudge). Validates the Zod schema accepts
 * the new fields and that the tool object's description tells the model
 * to prefer search_content over `bash grep`.
 *
 * NOTE: tool() narrows inputSchema to AI SDK's FlexibleSchema type, which
 * doesn't expose .parse statically. The runtime object IS the Zod schema,
 * so we cast through unknown to call .parse for these contract tests.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { READ_ONLY_TOOLS } from "../lib/tools/registry";

type Parseable = { parse: (input: unknown) => unknown; safeParse?: z.ZodType["safeParse"] };
const schemaOf = (toolName: keyof typeof READ_ONLY_TOOLS): Parseable =>
  READ_ONLY_TOOLS[toolName].inputSchema as unknown as Parseable;

describe("search_content schema (PR0 grep nudge)", () => {
  it("accepts pattern only", () => {
    const parsed = schemaOf("search_content").parse({ pattern: "foo" }) as { pattern: string };
    expect(parsed.pattern).toBe("foo");
  });

  it("accepts context_lines + case_insensitive", () => {
    const parsed = schemaOf("search_content").parse({
      pattern: "foo",
      context_lines: 3,
      case_insensitive: true,
    }) as { context_lines: number; case_insensitive: boolean };
    expect(parsed.context_lines).toBe(3);
    expect(parsed.case_insensitive).toBe(true);
  });

  it("accepts filePattern alongside the new fields", () => {
    const parsed = schemaOf("search_content").parse({
      pattern: "foo",
      filePattern: "*.ts",
      context_lines: 1,
      case_insensitive: false,
    }) as { filePattern: string };
    expect(parsed.filePattern).toBe("*.ts");
  });

  it("rejects non-numeric context_lines", () => {
    expect(() =>
      schemaOf("search_content").parse({ pattern: "foo", context_lines: "three" }),
    ).toThrow();
  });

  it("description guides the model toward search_content over bash grep", () => {
    const tool = READ_ONLY_TOOLS.search_content;
    expect(tool.description).toMatch(/grep/i);
    expect(tool.description).toMatch(/context_lines/);
    expect(tool.description).toMatch(/case_insensitive/);
  });
});
