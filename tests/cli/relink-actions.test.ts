import { describe, it, expect } from "vitest";
import { decideLinkAction, decideLogoutAction } from "../../src/cli/relink-actions.js";

describe("decideLinkAction", () => {
  it("falls back to standalone when the bridge is unreachable", () => {
    expect(decideLinkAction({ reachable: false })).toBe("standalone");
  });
  it("reports already-linked when reachable and connected", () => {
    expect(decideLinkAction({ reachable: true, state: "connected" })).toBe("already-linked");
  });
  it("live-relinks when reachable but not connected", () => {
    expect(decideLinkAction({ reachable: true, state: "needs_relink" })).toBe("live-relink");
    expect(decideLinkAction({ reachable: true, state: "connecting" })).toBe("live-relink");
  });
});

describe("decideLogoutAction", () => {
  it("logs out via the bridge when reachable", () => {
    expect(decideLogoutAction(true)).toBe("bridge-logout");
  });
  it("clears locally when the bridge is down", () => {
    expect(decideLogoutAction(false)).toBe("local-clear");
  });
});
