import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDefault, generateToken, normalizeNumber, readConfig, writeConfig,
} from "../../src/cli/config-store.js";
import { addAllowlist, removeAllowlist, listAllowlist, setDefaultLanguage } from "../../src/cli/config-store.js";
import { setPort, rotateToken } from "../../src/cli/config-store.js";

const tmpFile = () => join(mkdtempSync(join(tmpdir(), "agentchat-")), "config.json");

describe("config-store core", () => {
  it("generateToken returns a non-empty url-safe string", () => {
    const t = generateToken();
    expect(t.length).toBeGreaterThan(20);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("createDefault is schema-valid with token, port, and default language", () => {
    const c = createDefault();
    expect(c.bridgePort).toBe(7766);
    expect(c.bridgeToken).toBeTruthy();
    expect(c.allowlist).toEqual([]);
    expect(c.defaultLanguage).toBe("English");
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

  it("normalizeNumber keeps only digits", () => {
    expect(normalizeNumber("+52 1 55 1234 5678")).toBe("5215512345678");
    expect(normalizeNumber("abc")).toBe("");
  });

  it("writeConfig rejects an invalid config and does not create the file", () => {
    const file = tmpFile();
    const bad = { allowlist: [], bridgeToken: "", bridgePort: 7766 }; // empty token is invalid
    expect(() => writeConfig(file, bad)).toThrow();
    expect(existsSync(file)).toBe(false);
  });
});

describe("config-store allowlist", () => {
  it("adds a labeled entry, normalizing the number", () => {
    const c = addAllowlist(createDefault(), "+52 1 55 1234 5678", { label: "Mom" });
    expect(c.allowlist).toEqual([{ number: "5215512345678", label: "Mom" }]);
  });

  it("adds a bare entry when only a number (all defaults)", () => {
    const c = addAllowlist(createDefault(), "5215512345678");
    expect(c.allowlist).toEqual(["5215512345678"]);
  });

  it("writes an object when confirm:false or a language is set", () => {
    expect(addAllowlist(createDefault(), "5215512345678", { confirm: false }).allowlist)
      .toEqual([{ number: "5215512345678", confirm: false }]);
    expect(addAllowlist(createDefault(), "5215512345678", { language: "Spanish" }).allowlist)
      .toEqual([{ number: "5215512345678", language: "Spanish" }]);
  });

  it("upsert merges: unspecified fields are preserved", () => {
    let c = addAllowlist(createDefault(), "5215512345678", { label: "Mom", confirm: false });
    c = addAllowlist(c, "+52 155 1234 5678", { language: "Spanish" });
    expect(c.allowlist).toEqual([{ number: "5215512345678", label: "Mom", confirm: false, language: "Spanish" }]);
  });

  it("rejects a number with no digits", () => {
    expect(() => addAllowlist(createDefault(), "mom")).toThrow(/valid number/i);
  });

  it("removes by normalized number", () => {
    let c = addAllowlist(createDefault(), "5215512345678", { label: "Mom" });
    c = removeAllowlist(c, "+52 1 55 1234 5678");
    expect(c.allowlist).toEqual([]);
  });

  it("lists entries with confirm and optional fields", () => {
    let c = addAllowlist(createDefault(), "5215512345678", { label: "Mom", language: "Spanish" });
    c = addAllowlist(c, "120363000000000000", { confirm: false });
    expect(listAllowlist(c)).toEqual([
      { number: "5215512345678", label: "Mom", confirm: true, language: "Spanish" },
      { number: "120363000000000000", confirm: false },
    ]);
  });

  it("attributes survive a write/read round-trip", () => {
    const file = tmpFile();
    writeConfig(file, addAllowlist(createDefault(), "5215512345678", { label: "Mom", confirm: false, language: "Spanish" }));
    expect(readConfig(file).allowlist).toEqual([
      { number: "5215512345678", label: "Mom", confirm: false, language: "Spanish" },
    ]);
  });

  it("setDefaultLanguage updates the global default; rejects empty", () => {
    expect(setDefaultLanguage(createDefault(), "Spanish").defaultLanguage).toBe("Spanish");
    expect(() => setDefaultLanguage(createDefault(), "   ")).toThrow(/language/i);
  });
});

describe("config-store port + token", () => {
  it("sets a valid port", () => {
    expect(setPort(createDefault(), 8080).bridgePort).toBe(8080);
  });

  it("rejects a non-positive or non-integer port", () => {
    expect(() => setPort(createDefault(), 0)).toThrow(/port/i);
    expect(() => setPort(createDefault(), 12.5)).toThrow(/port/i);
  });

  it("rotateToken changes the token and stays schema-valid", () => {
    const c = createDefault();
    const r = rotateToken(c);
    expect(r.bridgeToken).not.toBe(c.bridgeToken);
    expect(r.bridgeToken.length).toBeGreaterThan(20);
    expect(() => writeConfig(tmpFile(), r)).not.toThrow();
  });
});
