import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearAuthDir } from "../../src/shared/auth.js";

describe("clearAuthDir", () => {
  it("removes all contents but keeps the directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "auth-"));
    writeFileSync(join(dir, "creds.json"), "{}");
    mkdirSync(join(dir, "keys"));
    writeFileSync(join(dir, "keys", "k.json"), "{}");

    clearAuthDir(dir);

    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("is a no-op when the directory does not exist", () => {
    const dir = join(tmpdir(), "auth-does-not-exist-xyz");
    expect(() => clearAuthDir(dir)).not.toThrow();
  });
});
