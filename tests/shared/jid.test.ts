import { describe, it, expect } from "vitest";
import { jidToNumber, numberToContactJid, isGroupJid } from "../../src/shared/normalize.js";

describe("jid helpers", () => {
  it("extracts the numeric user part from a contact jid", () => {
    expect(jidToNumber("5215512345678@s.whatsapp.net")).toBe("5215512345678");
  });
  it("extracts the numeric id from a group jid", () => {
    expect(jidToNumber("120363012345678901@g.us")).toBe("120363012345678901");
  });
  it("strips a device suffix", () => {
    expect(jidToNumber("5215512345678:12@s.whatsapp.net")).toBe("5215512345678");
  });
  it("builds a contact jid from a plain number (tolerates +)", () => {
    expect(numberToContactJid("+52 1 55 1234 5678")).toBe("5215512345678@s.whatsapp.net");
  });
  it("detects group jids", () => {
    expect(isGroupJid("120363@g.us")).toBe(true);
    expect(isGroupJid("5215@s.whatsapp.net")).toBe(false);
  });
});
