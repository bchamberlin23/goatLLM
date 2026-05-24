import { describe, it, expect } from "vitest";
import { withFileMutationQueue } from "../lib/file-mutation-queue";

describe("withFileMutationQueue", () => {
  it("serializes operations targeting the same path", async () => {
    const order: string[] = [];
    const slow = withFileMutationQueue("/a", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push("a-done");
      return "a";
    });
    const fast = withFileMutationQueue("/a", async () => {
      order.push("b-start");
      return "b";
    });
    const results = await Promise.all([slow, fast]);
    expect(results).toEqual(["a", "b"]);
    expect(order).toEqual(["a-done", "b-start"]);
  });

  it("runs different paths concurrently", async () => {
    let aRunning = false;
    let observedConcurrent = false;
    const a = withFileMutationQueue("/a", async () => {
      aRunning = true;
      await new Promise((r) => setTimeout(r, 30));
      aRunning = false;
      return "a";
    });
    const b = withFileMutationQueue("/b", async () => {
      if (aRunning) observedConcurrent = true;
      return "b";
    });
    await Promise.all([a, b]);
    expect(observedConcurrent).toBe(true);
  });

  it("releases the queue when the operation throws", async () => {
    const failing = withFileMutationQueue("/x", async () => {
      throw new Error("boom");
    }).catch(() => "caught");
    const ok = withFileMutationQueue("/x", async () => "ok");
    const [a, b] = await Promise.all([failing, ok]);
    expect(a).toBe("caught");
    expect(b).toBe("ok");
  });
});
