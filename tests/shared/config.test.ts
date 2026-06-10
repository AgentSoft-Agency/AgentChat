import { describe, it, expect } from "vitest";
import { parseConfig } from "../../src/shared/config.js";

describe("parseConfig", () => {
  it("accepts bare-number and labeled allowlist entries, normalizing to numbers", () => {
    const cfg = parseConfig({
      allowlist: ["+52 155 1234 5678", { number: "120363012345678901", label: "Family" }],
      bridgeToken: "secret",
      bridgePort: 7766,
    });
    expect(cfg.allowlist).toEqual(["5215512345678", "120363012345678901"]);
  });

  it("rejects a non-numeric allowlist entry", () => {
    expect(() =>
      parseConfig({ allowlist: ["mom"], bridgeToken: "s", bridgePort: 7766 })
    ).toThrow(/numeric/i);
  });

  it("rejects a labeled entry whose number is non-numeric", () => {
    expect(() =>
      parseConfig({ allowlist: [{ number: "mom", label: "Mom" }], bridgeToken: "s", bridgePort: 7766 })
    ).toThrow(/numeric/i);
  });

  it("rejects a missing bridgeToken", () => {
    expect(() =>
      parseConfig({ allowlist: [], bridgePort: 7766 })
    ).toThrow();
  });
});
