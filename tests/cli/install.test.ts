import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths } from "../../src/shared/paths.js";
import { preflight } from "../../src/cli/install.js";

function tmpHome(): string {
  const home = mkdtempSync(join(tmpdir(), "agentchat-home-"));
  mkdirSync(join(home, "data"), { recursive: true });
  return home;
}

describe("preflight", () => {
  it("throws when config.json is missing", () => {
    const p = paths(join(tmpHome(), "data"));
    expect(() => preflight(p)).toThrow(/init/i);
  });

  it("returns linked=false when config exists but no creds", () => {
    const home = tmpHome();
    writeFileSync(join(home, "data", "config.json"), "{}");
    const p = paths(join(home, "data"));
    expect(preflight(p)).toEqual({ linked: false });
  });

  it("returns linked=true when creds.json exists", () => {
    const home = tmpHome();
    writeFileSync(join(home, "data", "config.json"), "{}");
    mkdirSync(join(home, "data", "auth"), { recursive: true });
    writeFileSync(join(home, "data", "auth", "creds.json"), "{}");
    const p = paths(join(home, "data"));
    expect(preflight(p)).toEqual({ linked: true });
  });
});
