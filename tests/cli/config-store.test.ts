import { describe, it, expect } from "vitest";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDefault, generateToken, readConfig, writeConfig,
} from "../../src/cli/config-store.js";
import { addAllowlist, removeAllowlist, listAllowlist } from "../../src/cli/config-store.js";

const tmpFile = () => join(mkdtempSync(join(tmpdir(), "agentchat-")), "config.json");

describe("config-store core", () => {
  it("generateToken returns a non-empty url-safe string", () => {
    const t = generateToken();
    expect(t.length).toBeGreaterThan(20);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("createDefault is schema-valid with a token and default port", () => {
    const c = createDefault();
    expect(c.bridgePort).toBe(7766);
    expect(c.bridgeToken).toBeTruthy();
    expect(c.allowlist).toEqual([]);
  });

  it("writes (mode 600) and reads back round-trip", () => {
    const file = tmpFile();
    const c = createDefault();
    writeConfig(file, c);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readConfig(file)).toEqual(c);
  });

  it("readConfig rejects a schema-invalid file", () => {
    const file = tmpFile();
    // bridgeToken missing → invalid
    writeFileSync(file, '{"allowlist":[],"bridgePort":7766}');
    expect(() => readConfig(file)).toThrow();
  });
});

describe("config-store allowlist", () => {
  it("adds a labeled entry, normalizing the number", () => {
    const c = addAllowlist(createDefault(), "+52 1 55 1234 5678", "Mom");
    expect(c.allowlist).toEqual([{ number: "5215512345678", label: "Mom" }]);
  });

  it("adds a bare entry when no label", () => {
    const c = addAllowlist(createDefault(), "5215512345678");
    expect(c.allowlist).toEqual(["5215512345678"]);
  });

  it("dedupes by normalized number, updating the label", () => {
    let c = addAllowlist(createDefault(), "5215512345678");
    c = addAllowlist(c, "+52 155 1234 5678", "Mom");
    expect(c.allowlist).toEqual([{ number: "5215512345678", label: "Mom" }]);
  });

  it("rejects a number with no digits", () => {
    expect(() => addAllowlist(createDefault(), "mom")).toThrow(/valid number/i);
  });

  it("removes by normalized number", () => {
    let c = addAllowlist(createDefault(), "5215512345678", "Mom");
    c = removeAllowlist(c, "+52 1 55 1234 5678");
    expect(c.allowlist).toEqual([]);
  });

  it("lists entries with optional labels", () => {
    let c = addAllowlist(createDefault(), "5215512345678", "Mom");
    c = addAllowlist(c, "120363000000000000");
    expect(listAllowlist(c)).toEqual([
      { number: "5215512345678", label: "Mom" },
      { number: "120363000000000000" },
    ]);
  });

  it("labels survive a write/read round-trip", () => {
    const file = tmpFile();
    writeConfig(file, addAllowlist(createDefault(), "5215512345678", "Mom"));
    expect(readConfig(file).allowlist).toEqual([{ number: "5215512345678", label: "Mom" }]);
  });
});
