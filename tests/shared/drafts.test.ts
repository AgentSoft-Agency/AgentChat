import { describe, it, expect } from "vitest";
import { DraftStore } from "../../src/shared/drafts.js";

describe("DraftStore", () => {
  it("creates a draft and consumes it once", () => {
    let now = 1000;
    const drafts = new DraftStore(60_000, () => now);
    const d = drafts.create({ toJid: "1@s.whatsapp.net", kind: "text", text: "hi" });
    expect(d.id).toBeTruthy();
    const got = drafts.consume(d.id);
    expect(got?.text).toBe("hi");
    expect(drafts.consume(d.id)).toBeNull(); // already consumed
  });

  it("expires drafts past the TTL", () => {
    let now = 1000;
    const drafts = new DraftStore(60_000, () => now);
    const d = drafts.create({ toJid: "1@s.whatsapp.net", kind: "text", text: "hi" });
    now = 1000 + 60_001;
    expect(drafts.consume(d.id)).toBeNull();
  });
});
