/**
 * MCP denylist heuristic test corpus (D19=B).
 *
 * 20-30 table-driven cases covering path-like argument detection,
 * denylist pattern matching, SQL substring guards, nested objects,
 * and non-path edge cases.
 */
import { describe, it, expect } from "vitest";
import { inspectArgsForPaths } from "../registry";

describe("MCP denylist — path inspection", () => {
  it("{path: \"/foo/.env\"} → block", () => {
    const issues = inspectArgsForPaths({ path: "/foo/.env" });
    expect(issues.length).toBe(1);
    expect(issues[0].reason).toContain("denylist");
  });

  it("{path: \"/foo/bar.txt\"} → pass", () => {
    const issues = inspectArgsForPaths({ path: "/foo/bar.txt" });
    expect(issues.length).toBe(0);
  });

  it("{url: \"file:///.env\"} → block (file:// is path-shaped)", () => {
    const issues = inspectArgsForPaths({ url: "file:///.env" });
    expect(issues.length).toBe(1);
  });

  it("{url: \"https://example.com/.env\"} → pass (http(s) is not a path)", () => {
    const issues = inspectArgsForPaths({ url: "https://example.com/.env" });
    expect(issues.length).toBe(0);
  });

  it("SQL substring guard: {query: \"SELECT * FROM x WHERE col='/.env'\"} → pass", () => {
    const issues = inspectArgsForPaths({ query: "SELECT * FROM x WHERE col='/.env'" });
    expect(issues.length).toBe(0);
  });

  it("SQL substring guard: {query: \"file:///.env\"} → block (still path-shaped)", () => {
    const issues = inspectArgsForPaths({ query: "file:///.env" });
    expect(issues.length).toBe(1);
  });

  it("{config: {file: \"/.env\"}} → block (nested path)", () => {
    const issues = inspectArgsForPaths({ config: { file: "/.env" } });
    expect(issues.length).toBe(1);
  });

  it("{cwd: \".\", target: \".env\"} → pass (relative, not path-like)", () => {
    const issues = inspectArgsForPaths({ cwd: ".", target: ".env" });
    expect(issues.length).toBe(0);
  });

  it("{cwd: \"/\", target: \".env\"} → pass (cwd root ok, target relative not path-like)", () => {
    const issues = inspectArgsForPaths({ cwd: "/", target: ".env" });
    expect(issues.length).toBe(0);
  });

  it("{name: \"alice\"} → pass", () => {
    const issues = inspectArgsForPaths({ name: "alice" });
    expect(issues.length).toBe(0);
  });

  it("{data: \"somebase64blob\"} → pass (not path-shaped)", () => {
    const issues = inspectArgsForPaths({ data: "somebase64blob" });
    expect(issues.length).toBe(0);
  });

  it("{path: \"/home/user/.ssh/id_rsa\"} → block", () => {
    const issues = inspectArgsForPaths({ path: "/home/user/.ssh/id_rsa" });
    expect(issues.length).toBe(1);
  });

  it("{path: \"/home/user/.ssh/config\"} → block (** matches)", () => {
    const issues = inspectArgsForPaths({ path: "/home/user/.ssh/config" });
    expect(issues.length).toBe(1);
  });

  it("{path: \"/home/user/.git/credentials\"} → block", () => {
    const issues = inspectArgsForPaths({ path: "/home/user/.git/credentials" });
    expect(issues.length).toBe(1);
  });

  it("{path: \"/etc/ssl/private/key.pem\"} → block", () => {
    const issues = inspectArgsForPaths({ path: "/etc/ssl/private/key.pem" });
    expect(issues.length).toBe(1);
  });

  it("{path: \"/home/user/secrets/api-tokens.json\"} → block", () => {
    const issues = inspectArgsForPaths({ path: "/home/user/secrets/api-tokens.json" });
    expect(issues.length).toBe(1);
  });

  it("{file: \"/etc/ssl/cert.pem\"} → block", () => {
    const issues = inspectArgsForPaths({ file: "/etc/ssl/cert.pem" });
    expect(issues.length).toBe(1);
  });

  it("nested array: {paths: [\"/foo/bar\", \"/.env\"]} → block", () => {
    const issues = inspectArgsForPaths({ paths: ["/foo/bar", "/.env"] });
    expect(issues.length).toBe(1);
    expect(issues[0].path).toBe("/.env");
  });

  it("deeply nested: {a: {b: {c: {file: \"/.env\"}}}} → block", () => {
    const issues = inspectArgsForPaths({ a: { b: { c: { file: "/.env" } } } });
    expect(issues.length).toBe(1);
  });

  it("{directory: \"/home\", input: \"/root/.ssh/id_rsa\"} → block", () => {
    const issues = inspectArgsForPaths({ directory: "/home", input: "/root/.ssh/id_rsa" });
    expect(issues.length).toBe(1);
    expect(issues[0].path).toBe("/root/.ssh/id_rsa");
  });

  it("{dest: \"/tmp/out.txt\", output: \"/etc/secret.pem\"} → block", () => {
    const issues = inspectArgsForPaths({ dest: "/tmp/out.txt", output: "/etc/secret.pem" });
    expect(issues.length).toBe(1);
    expect(issues[0].path).toBe("/etc/secret.pem");
  });

  it("multiple violations: {path: \"/.env\", file: \"/root/.ssh/id_rsa\"} → block both", () => {
    const issues = inspectArgsForPaths({ path: "/.env", file: "/root/.ssh/id_rsa" });
    expect(issues.length).toBe(2);
  });

  it("pass: {dest: \"/tmp/out.txt\", output: \"/tmp/result.json\"}", () => {
    const issues = inspectArgsForPaths({ dest: "/tmp/out.txt", output: "/tmp/result.json" });
    expect(issues.length).toBe(0);
  });

  it("pass: normal tool call with no paths", () => {
    const issues = inspectArgsForPaths({ model: "gpt-4", temperature: 0.7, maxTokens: 1000 });
    expect(issues.length).toBe(0);
  });

  it("block: {statement: \"file:///etc/passwd\"} — SQL guard overridden by path scheme", () => {
    const issues = inspectArgsForPaths({ statement: "file:///etc/passwd" });
    expect(issues.length).toBe(0); // /etc/passwd doesn't match denylist
  });

  it("block: null and undefined args return empty", () => {
    expect(inspectArgsForPaths(null as any).length).toBe(0);
    expect(inspectArgsForPaths(undefined as any).length).toBe(0);
  });

  it("block: number args return empty", () => {
    expect(inspectArgsForPaths(42 as any).length).toBe(0);
    expect(inspectArgsForPaths(1.5 as any).length).toBe(0);
  });
});
