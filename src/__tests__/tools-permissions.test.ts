import { describe, it, expect } from "vitest";
import { isWriteTool, shouldAutoApprove } from "../lib/tools";

describe("isWriteTool", () => {
  it("flags every write/exec tool", () => {
    expect(isWriteTool("write_file")).toBe(true);
    expect(isWriteTool("edit_file")).toBe(true);
    expect(isWriteTool("bash")).toBe(true);
    expect(isWriteTool("exec_command")).toBe(true);
    expect(isWriteTool("diff_file")).toBe(true);
    expect(isWriteTool("read_lints")).toBe(true);
    expect(isWriteTool("run_tests")).toBe(true);
    expect(isWriteTool("browser_fetch")).toBe(true);
    expect(isWriteTool("index_workspace")).toBe(true);
  });

  it("does not flag read-only tools", () => {
    expect(isWriteTool("read_file")).toBe(false);
    expect(isWriteTool("list_dir")).toBe(false);
    expect(isWriteTool("search_content")).toBe(false);
    expect(isWriteTool("search_semantic")).toBe(false);
    expect(isWriteTool("git_status")).toBe(false);
    expect(isWriteTool("git_log")).toBe(false);
    expect(isWriteTool("git_blame")).toBe(false);
    expect(isWriteTool("web_search")).toBe(false);
    expect(isWriteTool("web_fetch")).toBe(false);
  });

  it("does not flag unknown tools", () => {
    expect(isWriteTool("foo")).toBe(false);
    expect(isWriteTool("")).toBe(false);
  });
});

describe("shouldAutoApprove", () => {
  describe("manual mode", () => {
    it("never auto-approves anything", () => {
      expect(shouldAutoApprove("write_file", "manual")).toBe(false);
      expect(shouldAutoApprove("edit_file", "manual")).toBe(false);
      expect(shouldAutoApprove("bash", "manual")).toBe(false);
      expect(shouldAutoApprove("read_lints", "manual")).toBe(false);
    });
  });

  describe("auto mode", () => {
    it("auto-approves file edits", () => {
      expect(shouldAutoApprove("write_file", "auto")).toBe(true);
      expect(shouldAutoApprove("edit_file", "auto")).toBe(true);
    });

    it("auto-approves diffs and lints", () => {
      expect(shouldAutoApprove("diff_file", "auto")).toBe(true);
      expect(shouldAutoApprove("read_lints", "auto")).toBe(true);
      expect(shouldAutoApprove("run_tests", "auto")).toBe(true);
    });

    it("does NOT auto-approve shell commands — too dangerous", () => {
      // This is the safety contract: auto mode never lets bash run without
      // explicit user approval. Only YOLO mode does.
      expect(shouldAutoApprove("bash", "auto")).toBe(false);
      expect(shouldAutoApprove("exec_command", "auto")).toBe(false);
    });

    it("does NOT auto-approve browser_fetch — must show URL to user", () => {
      // Same reason as bash: agent could exfiltrate data via crafted URL.
      // User must see the URL before any HTTP request fires.
      expect(shouldAutoApprove("browser_fetch", "auto")).toBe(false);
    });
  });

  describe("yolo mode", () => {
    it("auto-approves everything including shell", () => {
      expect(shouldAutoApprove("bash", "yolo")).toBe(true);
      expect(shouldAutoApprove("exec_command", "yolo")).toBe(true);
      expect(shouldAutoApprove("write_file", "yolo")).toBe(true);
      expect(shouldAutoApprove("edit_file", "yolo")).toBe(true);
      expect(shouldAutoApprove("read_lints", "yolo")).toBe(true);
    });

    it("auto-approves even unknown tools (yolo means yolo)", () => {
      expect(shouldAutoApprove("future_unknown_tool", "yolo")).toBe(true);
    });
  });
});
