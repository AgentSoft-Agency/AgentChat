import { describe, it, expect } from "vitest";
import { openDb } from "../../src/shared/db.js";

describe("openDb", () => {
  it("creates the schema and FTS table on an in-memory db", () => {
    const db = openDb(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
      .all()
      .map((r: any) => r.name);
    expect(tables).toContain("chats");
    expect(tables).toContain("messages");
    expect(tables).toContain("contacts");
    expect(tables).toContain("messages_fts");
  });

  it("keeps FTS in sync via trigger on insert", () => {
    const db = openDb(":memory:");
    db.prepare(
      `INSERT INTO messages (id, chat_jid, sender_jid, from_me, ts, type, text, media_path, raw_json, seen_by_llm)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run("m1", "123@s.whatsapp.net", null, 0, 1, "text", "hello kitchen", null, "{}", 0);
    const hit = db
      .prepare("SELECT id FROM messages_fts WHERE messages_fts MATCH ?")
      .get("kitchen") as any;
    expect(hit).toBeTruthy();
  });
});
