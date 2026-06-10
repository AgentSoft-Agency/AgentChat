import { describe, it, expect } from "vitest";
import { resolveRecipient, isAllowed, findPolicy, resolveLanguage } from "../../src/shared/allowlist.js";

describe("allowlist", () => {
  it("resolves a plain number to a contact jid", () => {
    expect(resolveRecipient("+52 155 1234 5678")).toBe("5215512345678@s.whatsapp.net");
  });
  it("passes a full jid through unchanged", () => {
    expect(resolveRecipient("120363@g.us")).toBe("120363@g.us");
  });
  it("allows a contact whose number is on the list", () => {
    expect(isAllowed(["5215512345678"], "5215512345678@s.whatsapp.net")).toBe(true);
  });
  it("allows a group whose numeric id is on the list", () => {
    expect(isAllowed(["120363012345678901"], "120363012345678901@g.us")).toBe(true);
  });
  it("rejects a recipient not on the list", () => {
    expect(isAllowed(["5215512345678"], "5219999999999@s.whatsapp.net")).toBe(false);
  });
  it("findPolicy returns the entry for an allowlisted jid", () => {
    const list = [{ number: "5215512345678", label: "Mom", confirm: false, language: "Spanish" }];
    expect(findPolicy(list, "5215512345678@s.whatsapp.net")).toEqual(list[0]);
    expect(findPolicy(list, "5219999999999@s.whatsapp.net")).toBeUndefined();
  });
  it("resolveLanguage prefers the entry language, else the default", () => {
    expect(resolveLanguage({ number: "1", confirm: true, language: "Spanish" }, "English")).toBe("Spanish");
    expect(resolveLanguage({ number: "1", confirm: true }, "English")).toBe("English");
    expect(resolveLanguage(undefined, "English")).toBe("English");
  });
});
