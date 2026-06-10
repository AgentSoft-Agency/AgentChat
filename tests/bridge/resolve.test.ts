import { describe, it, expect, vi } from "vitest";
import { resolveSendJid } from "../../src/bridge/resolve.js";

describe("resolveSendJid", () => {
  it("resolves a contact number to its canonical WhatsApp jid (auto-correcting the Mexican 1)", async () => {
    const onWhatsApp = vi.fn(async (_n: string) => [
      { jid: "5219995062019@s.whatsapp.net", exists: true },
    ]);
    const jid = await resolveSendJid({ onWhatsApp }, "529995062019@s.whatsapp.net");
    expect(jid).toBe("5219995062019@s.whatsapp.net");
    expect(onWhatsApp).toHaveBeenCalledWith("529995062019");
  });

  it("passes a group jid through unchanged without querying", async () => {
    const onWhatsApp = vi.fn();
    const jid = await resolveSendJid({ onWhatsApp }, "120363000000000000@g.us");
    expect(jid).toBe("120363000000000000@g.us");
    expect(onWhatsApp).not.toHaveBeenCalled();
  });

  it("throws when the number is not on WhatsApp (exists:false)", async () => {
    const onWhatsApp = vi.fn(async () => [{ jid: "x@s.whatsapp.net", exists: false }]);
    await expect(resolveSendJid({ onWhatsApp }, "5210000000000@s.whatsapp.net")).rejects.toThrow(
      /not on WhatsApp/i
    );
  });

  it("throws when onWhatsApp returns no entry", async () => {
    const onWhatsApp = vi.fn(async () => undefined);
    await expect(resolveSendJid({ onWhatsApp }, "5210000000000@s.whatsapp.net")).rejects.toThrow(
      /not on WhatsApp/i
    );
  });
});
