import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/shared/db.js";
import { Store } from "../../src/shared/store.js";
import type { Message } from "../../src/shared/types.js";

const msg = (over: Partial<Message>): Message => ({
  id: "m1", chatJid: "111@s.whatsapp.net", senderJid: "111@s.whatsapp.net",
  fromMe: false, ts: 100, type: "text", text: "hello", mediaPath: null,
  rawJson: "{}", seenByLlm: false, ...over,
});

describe("Store", () => {
  let store: Store;
  beforeEach(() => { store = new Store(openDb(":memory:")); });

  it("upserts a message and reads it back, updating the chat", () => {
    store.upsertMessage(msg({}));
    const msgs = store.getMessages("111@s.whatsapp.net", 10);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe("hello");
    const chats = store.listChats(10);
    expect(chats[0].jid).toBe("111@s.whatsapp.net");
    expect(chats[0].lastTs).toBe(100);
  });

  it("is idempotent on message id (upsert, not duplicate)", () => {
    store.upsertMessage(msg({ text: "v1" }));
    store.upsertMessage(msg({ text: "v2" }));
    expect(store.getMessages("111@s.whatsapp.net", 10)).toHaveLength(1);
    expect(store.getMessages("111@s.whatsapp.net", 10)[0].text).toBe("v2");
  });

  it("full-text searches message text", () => {
    store.upsertMessage(msg({ id: "a", text: "dinner at eight" }));
    store.upsertMessage(msg({ id: "b", text: "lunch tomorrow" }));
    const hits = store.search("dinner", 10);
    expect(hits.map((h) => h.id)).toEqual(["a"]);
  });

  it("returns and then clears unseen messages", () => {
    store.upsertMessage(msg({ id: "a", seenByLlm: false }));
    store.upsertMessage(msg({ id: "b", fromMe: true, seenByLlm: false }));
    const fresh = store.takeUnseen(10);
    expect(fresh.map((m) => m.id)).toEqual(["a"]); // fromMe excluded
    expect(store.takeUnseen(10)).toHaveLength(0); // now marked seen
  });

  it("upserts and searches contacts", () => {
    store.upsertContact({ jid: "111@s.whatsapp.net", pushName: "Al", name: null, phone: "111" });
    expect(store.findContacts("Al")[0].jid).toBe("111@s.whatsapp.net");
  });

  it("sets a chat name without clobbering on null", () => {
    store.upsertChatName("120363@g.us", "Family", true);
    store.upsertChatName("120363@g.us", null, true);
    expect(store.listChats(10).find((c) => c.jid === "120363@g.us")?.name).toBe("Family");
  });
});
