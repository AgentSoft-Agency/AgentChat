import { describe, it, expect } from "vitest";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDefault, generateToken, readConfig, writeConfig,
} from "../../src/cli/config-store.js";

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
