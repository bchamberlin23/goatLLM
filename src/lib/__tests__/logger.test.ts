import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log, withError, normalizeError } from "../logger";

describe("logger", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe("level routing", () => {
    it("routes log.debug to console.debug", () => {
      log.debug("hello");
      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(debugSpy.mock.calls[0][0]).toBe("hello");
    });

    it("routes log.info to console.info", () => {
      log.info("hello");
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy.mock.calls[0][0]).toBe("hello");
    });

    it("routes log.warn to console.warn", () => {
      log.warn("hello");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toBe("hello");
    });

    it("routes log.error to console.error", () => {
      log.error("hello");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toBe("hello");
    });

    it("does not leak across levels", () => {
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");
      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("tag prefix", () => {
    it("prepends [tag] when tag is provided", () => {
      log.warn("failed", { tag: "db" });
      expect(warnSpy.mock.calls[0][0]).toBe("[db] failed");
    });

    it("omits the prefix when no tag is provided", () => {
      log.info("plain");
      expect(infoSpy.mock.calls[0][0]).toBe("plain");
    });

    it("passes structured data as the second argument", () => {
      log.warn("hi", { tag: "x", data: { a: 1 } });
      expect(warnSpy.mock.calls[0][1]).toEqual({ a: 1 });
    });
  });

  describe("withError helper", () => {
    it("wraps an Error into { error: message }", () => {
      const err = new Error("boom");
      const fields = withError("db", undefined, err);
      expect(fields.tag).toBe("db");
      expect(fields.data).toEqual({ error: "boom" });
    });

    it("stringifies non-Error values", () => {
      const fields = withError("x", undefined, "plain string");
      expect(fields.data).toEqual({ error: "plain string" });
    });

    it("coerces null/undefined/objects to strings", () => {
      expect(withError("t", undefined, null).data).toEqual({ error: "null" });
      expect(withError("t", undefined, undefined).data).toEqual({ error: "undefined" });
      expect(withError("t", undefined, 42).data).toEqual({ error: "42" });
      expect(withError("t", undefined, { code: "X" }).data).toEqual({
        error: "[object Object]",
      });
    });

    it("merges into an existing data record", () => {
      const fields = withError("db", { foo: 1, bar: "z" }, new Error("nope"));
      expect(fields.data).toEqual({ foo: 1, bar: "z", error: "nope" });
    });

    it("lets the error key overwrite a pre-existing 'error' field", () => {
      const fields = withError("db", { error: "old" }, new Error("new"));
      expect(fields.data).toEqual({ error: "new" });
    });
  });

  describe("normalizeError", () => {
    it("is exported and matches withError's behavior for Error", () => {
      expect(normalizeError(new Error("x"))).toEqual({ error: "x" });
    });
  });
});
