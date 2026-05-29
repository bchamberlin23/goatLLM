import { describe, it, expect } from "vitest";
import { stripLeakedToolJson } from "../lib/sanitize";

describe("stripLeakedToolJson", () => {
  it("leaves plain prose untouched", () => {
    const t = "Here is a normal answer with no JSON at all.";
    expect(stripLeakedToolJson(t)).toBe(t);
  });

  it("strips a complete leaked tool-arg object", () => {
    const t = 'Let me search. {"query": "react hooks"} Done.';
    expect(stripLeakedToolJson(t)).toBe("Let me search.  Done.");
  });

  it("strips an unterminated streaming fragment to end of region", () => {
    const t = 'Reading the file {"filename": "report.m';
    expect(stripLeakedToolJson(t)).toBe("Reading the file ");
  });

  it("strips {summary leak", () => {
    const t = 'Summarizing {"summary": "the gist", "title": "X"}';
    expect(stripLeakedToolJson(t)).toBe("Summarizing ");
  });

  it("preserves JSON inside fenced code blocks", () => {
    const t = 'Example:\n```json\n{"query": "keep me"}\n```\n';
    expect(stripLeakedToolJson(t)).toBe(t);
  });

  it("leaves unknown-key objects alone", () => {
    const t = 'Config: {"color": "red", "size": 3}';
    expect(stripLeakedToolJson(t)).toBe(t);
  });

  it("handles braces inside string values", () => {
    const t = 'Run {"command": "echo {hi}"} now';
    expect(stripLeakedToolJson(t)).toBe("Run  now");
  });

  it("strips nested arrays in edits", () => {
    const t = 'Editing {"edits": [{"old_text":"a","new_text":"b"}]} ok';
    expect(stripLeakedToolJson(t)).toBe("Editing  ok");
  });

  it("strips load_skill name leak", () => {
    const t = 'Loading {"name": "impeccable"} skill';
    expect(stripLeakedToolJson(t)).toBe("Loading  skill");
  });

  it("strips unquoted name key", () => {
    const t = "Loading { name: \"impeccable\" } skill";
    expect(stripLeakedToolJson(t)).toBe("Loading  skill");
  });

  it("strips streaming-tail { name fragment", () => {
    const t = "Loading { name";
    expect(stripLeakedToolJson(t)).toBe("Loading ");
  });

  it("strips streaming-tail {summary fragment", () => {
    const t = "Summarizing {summary";
    expect(stripLeakedToolJson(t)).toBe("Summarizing ");
  });
});
