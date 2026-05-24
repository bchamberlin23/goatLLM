import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadProjectContext, PROJECT_CONTEXT_FILES, MAX_CONTEXT_FILE_BYTES } from "../lib/project-context";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("loadProjectContext", () => {
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import("@tauri-apps/api/core");
    invoke = mod.invoke as unknown as ReturnType<typeof vi.fn>;
    invoke.mockReset();
  });

  it("returns empty array when no context files exist", async () => {
    invoke.mockRejectedValue(new Error("not found"));
    const out = await loadProjectContext("/ws");
    expect(out).toEqual([]);
  });

  it("loads files that exist, skips files that don't", async () => {
    invoke.mockImplementation(async (_cmd: string, args: Record<string, unknown>) => {
      const path = args.path as string;
      if (path === "GOAT.md") return "# Goat rules";
      if (path === "AGENTS.md") return "# Agents rules";
      throw new Error("not found");
    });
    const out = await loadProjectContext("/ws");
    expect(out.map((f) => f.path)).toEqual(["GOAT.md", "AGENTS.md"]);
    expect(out[0].content).toBe("# Goat rules");
  });

  it("preserves the configured priority order", async () => {
    // All present — output order should match PROJECT_CONTEXT_FILES.
    invoke.mockResolvedValue("content");
    const out = await loadProjectContext("/ws");
    expect(out.map((f) => f.path)).toEqual([...PROJECT_CONTEXT_FILES]);
  });

  it("truncates files larger than the byte cap", async () => {
    const big = "x".repeat(MAX_CONTEXT_FILE_BYTES + 1000);
    invoke.mockImplementation(async (_cmd, args: Record<string, unknown>) => {
      if ((args.path as string) === "GOAT.md") return big;
      throw new Error("not found");
    });
    const out = await loadProjectContext("/ws");
    expect(out).toHaveLength(1);
    expect(out[0].content.length).toBeLessThanOrEqual(MAX_CONTEXT_FILE_BYTES + 200);
    expect(out[0].content).toContain("[truncated");
  });

  it("skips empty files", async () => {
    invoke.mockImplementation(async (_cmd, args: Record<string, unknown>) => {
      if ((args.path as string) === "GOAT.md") return "";
      throw new Error("not found");
    });
    const out = await loadProjectContext("/ws");
    expect(out).toEqual([]);
  });
});
