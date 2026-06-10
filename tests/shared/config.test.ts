import { describe, it, expect } from "vitest";
import { parseConfig } from "../../src/shared/config.js";

describe("parseConfig", () => {
  it("normalizes bare and labeled entries to AllowEntry objects (confirm defaults true)", () => {
    const cfg = parseConfig({
      allowlist: ["+52 155 1234 5678", { number: "120363012345678901", label: "Family" }],
      bridgeToken: "secret",
      bridgePort: 7766,
    });
    expect(cfg.allowlist).toEqual([
      { number: "5215512345678", confirm: true },
      { number: "120363012345678901", label: "Family", confirm: true },
    ]);
  });

  it("preserves confirm:false and a language override", () => {
    const cfg = parseConfig({
      allowlist: [{ number: "5215512345678", label: "Mom", confirm: false, language: "Spanish" }],
      bridgeToken: "s",
    });
    expect(cfg.allowlist).toEqual([
      { number: "5215512345678", label: "Mom", confirm: false, language: "Spanish" },
    ]);
  });

  it("defaults defaultLanguage to English when absent", () => {
    const cfg = parseConfig({ allowlist: [], bridgeToken: "s" });
    expect(cfg.defaultLanguage).toBe("English");
  });

  it("keeps an explicit defaultLanguage", () => {
    const cfg = parseConfig({ allowlist: [], bridgeToken: "s", defaultLanguage: "Spanish" });
    expect(cfg.defaultLanguage).toBe("Spanish");
  });

  it("rejects a non-numeric allowlist entry", () => {
    expect(() => parseConfig({ allowlist: ["mom"], bridgeToken: "s" })).toThrow(/numeric/i);
  });

  it("rejects an empty language", () => {
    expect(() =>
      parseConfig({ allowlist: [{ number: "5215512345678", language: "" }], bridgeToken: "s" })
    ).toThrow();
  });

  it("rejects a missing bridgeToken", () => {
    expect(() => parseConfig({ allowlist: [], bridgePort: 7766 })).toThrow();
  });
});
