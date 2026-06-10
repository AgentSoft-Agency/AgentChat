import { describe, it, expect } from "vitest";
import { openDb } from "../../src/shared/db.js";
import { Store } from "../../src/shared/store.js";
import { ingestMessagesUpsert } from "../../src/bridge/ingest.js";

describe("ingestMessagesUpsert", () => {
  it("writes normalizable messages and skips the rest", () => {
    const store = new Store(openDb(":memory:"));
    ingestMessagesUpsert(store, {
      messages: [
        { key: { id: "a", remoteJid: "1@s.whatsapp.net", fromMe: false }, messageTimestamp: 5, message: { conversation: "hey" } },
        { key: { id: "b", remoteJid: "1@s.whatsapp.net", fromMe: false }, messageTimestamp: 6, message: {} },
      ],
    });
    const msgs = store.getMessages("1@s.whatsapp.net", 10);
    expect(msgs.map((m) => m.id)).toEqual(["a"]);
  });
});
