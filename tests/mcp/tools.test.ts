import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/shared/db.js";
import { Store } from "../../src/shared/store.js";
import { DraftStore } from "../../src/shared/drafts.js";
import { ToolCore } from "../../src/mcp/tools.js";

const fakeBridge = {
  sendText: async () => "sent-1",
  sendMedia: async () => "sent-2",
  status: async () => ({ state: "connected" }),
};

describe("ToolCore", () => {
  let core: ToolCore;
  let store: Store;
  beforeEach(() => {
    store = new Store(openDb(":memory:"));
    core = new ToolCore(
      store,
      fakeBridge,
      new DraftStore(),
      [
        { number: "5215512345678", label: "Mom", confirm: true, language: "Spanish" },
        { number: "5215500000000", label: "Bot", confirm: false },
      ],
      "English"
    );
  });

  it("drafts a message only for allowlisted numbers", () => {
    const ok = core.draftMessage("5215512345678", "hi");
    expect(ok.draftId).toBeTruthy();
    expect(() => core.draftMessage("5219999999999", "hi")).toThrow(/not allowed/i);
  });

  it("draft surfaces requiresConfirmation and resolved language", () => {
    expect(core.draftMessage("5215512345678", "hi")).toMatchObject({
      requiresConfirmation: true,
      language: "Spanish",
    });
    expect(core.draftMessage("5215500000000", "hi")).toMatchObject({
      requiresConfirmation: false,
      language: "English",
    });
  });

  it("one-shot send_message sends for confirm:false numbers", async () => {
    expect(await core.sendMessage("5215500000000", "hi")).toEqual({ id: "sent-1" });
  });

  it("one-shot send_message rejects confirm:true numbers", async () => {
    await expect(core.sendMessage("5215512345678", "hi")).rejects.toThrow(/requires confirmation/i);
  });

  it("one-shot send_message rejects non-allowlisted numbers", async () => {
    await expect(core.sendMessage("5219999999999", "hi")).rejects.toThrow(/not allowed/i);
  });

  it("sends a previously created draft", async () => {
    const { draftId } = core.draftMessage("5215512345678", "hi");
    expect((await core.sendDraft(draftId)).id).toBe("sent-1");
  });

  it("rejects an unknown or expired draft", async () => {
    await expect(core.sendDraft("nope")).rejects.toThrow(/draft/i);
  });

  it("returns a media path from the bridge", async () => {
    const c = new ToolCore(
      new Store(openDb(":memory:")),
      { ...fakeBridge, downloadMedia: async (id: string) => `/data/media/${id}` } as any,
      new DraftStore(),
      [],
      "English"
    );
    expect(await c.downloadMedia("m1")).toEqual({ path: "/data/media/m1" });
  });

  it("draftMedia surfaces requiresConfirmation and resolved language", () => {
    expect(core.draftMedia("5215500000000", "/tmp/x.png", "cap")).toMatchObject({
      requiresConfirmation: false,
      language: "English",
    });
  });

  it("list_contacts annotates allowlist policy and resolved language", () => {
    store.upsertContact({ jid: "5215512345678@s.whatsapp.net", pushName: null, name: "Mom", phone: "5215512345678" });
    store.upsertContact({ jid: "5219999999999@s.whatsapp.net", pushName: null, name: "Stranger", phone: "5219999999999" });
    const mom = core.listContacts("Mom")[0] as any;
    expect(mom).toMatchObject({ onAllowlist: true, requiresConfirmation: true, language: "Spanish" });
    const stranger = core.listContacts("Stranger")[0] as any;
    expect(stranger.onAllowlist).toBe(false);
    expect(stranger.requiresConfirmation).toBeUndefined();
    expect(stranger.language).toBeUndefined();
  });
});
