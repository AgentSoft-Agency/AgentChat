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

  it("keeps FTS in sync via trigger on insert, indexing only text", () => {
    const db = openDb(":memory:");
    db.prepare(
      `INSERT INTO messages (id, chat_jid, sender_jid, from_me, ts, type, text, media_path, raw_json, seen_by_llm)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run("cafe123", "123@s.whatsapp.net", null, 0, 1, "text", "hello kitchen", null, "{}", 0);

    // text is searchable, retrieved by joining on rowid (the real query path)
    const hit = db
      .prepare(
        `SELECT m.id FROM messages_fts f JOIN messages m ON m.rowid = f.rowid
         WHERE messages_fts MATCH ?`
      )
      .get("kitchen") as any;
    expect(hit?.id).toBe("cafe123");

    // the message id token must NOT be indexed (no false-positive matches)
    const idHit = db
      .prepare("SELECT count(*) AS n FROM messages_fts WHERE messages_fts MATCH ?")
      .get("cafe") as any;
    expect(idHit.n).toBe(0);
  });
});
