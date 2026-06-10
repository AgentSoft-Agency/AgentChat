import { describe, it, expect } from "vitest";
import { normalizeMessage } from "../../src/shared/normalize.js";

const base = (message: any) => ({
  key: { id: "ABC", remoteJid: "5215512345678@s.whatsapp.net", fromMe: false },
  messageTimestamp: 1700000000,
  pushName: "Alice",
  message,
});

describe("normalizeMessage", () => {
  it("normalizes a plain text message", () => {
    const m = normalizeMessage(base({ conversation: "hi there" }))!;
    expect(m.id).toBe("ABC");
    expect(m.chatJid).toBe("5215512345678@s.whatsapp.net");
    expect(m.fromMe).toBe(false);
    expect(m.ts).toBe(1700000000);
    expect(m.type).toBe("text");
    expect(m.text).toBe("hi there");
    expect(m.mediaPath).toBeNull();
  });

  it("normalizes an extended text message", () => {
    const m = normalizeMessage(base({ extendedTextMessage: { text: "edited hi" } }))!;
    expect(m.type).toBe("text");
    expect(m.text).toBe("edited hi");
  });

  it("normalizes an image with caption (media not yet downloaded)", () => {
    const m = normalizeMessage(base({ imageMessage: { caption: "a pic" } }))!;
    expect(m.type).toBe("image");
    expect(m.text).toBe("a pic");
    expect(m.mediaPath).toBeNull();
  });

  it("sets sender_jid from participant for group messages", () => {
    const raw = {
      key: { id: "G1", remoteJid: "120363@g.us", fromMe: false, participant: "5219999@s.whatsapp.net" },
      messageTimestamp: 1700000001,
      message: { conversation: "group hi" },
    };
    const m = normalizeMessage(raw)!;
    expect(m.chatJid).toBe("120363@g.us");
    expect(m.senderJid).toBe("5219999@s.whatsapp.net");
  });

  it("returns null for protocol/empty messages", () => {
    expect(normalizeMessage(base({}))).toBeNull();
    expect(normalizeMessage(base(null))).toBeNull();
  });
});
