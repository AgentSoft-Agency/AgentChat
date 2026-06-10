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
    core = new ToolCore(store, fakeBridge, new DraftStore(), ["5215512345678"]);
  });

  it("drafts a message only for allowlisted numbers", () => {
    const ok = core.draftMessage("5215512345678", "hi");
    expect(ok.draftId).toBeTruthy();
    expect(() => core.draftMessage("5219999999999", "hi")).toThrow(/not allowed/i);
  });

  it("sends a previously created draft", async () => {
    const { draftId } = core.draftMessage("5215512345678", "hi");
    const r = await core.sendDraft(draftId);
    expect(r.id).toBe("sent-1");
  });

  it("rejects an unknown or expired draft", async () => {
    await expect(core.sendDraft("nope")).rejects.toThrow(/draft/i);
  });

  it("returns a media path from the bridge", async () => {
    const store = new Store(openDb(":memory:"));
    const core = new ToolCore(
      store,
      { ...fakeBridge, downloadMedia: async (id: string) => `/data/media/${id}` } as any,
      new DraftStore(),
      []
    );
    expect(await core.downloadMedia("m1")).toEqual({ path: "/data/media/m1" });
  });
});
