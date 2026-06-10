import type { Db } from "./db.js";
import type { Chat, Contact, Message } from "./types.js";

function rowToMessage(r: any): Message {
  return {
    id: r.id, chatJid: r.chat_jid, senderJid: r.sender_jid,
    fromMe: !!r.from_me, ts: r.ts, type: r.type, text: r.text,
    mediaPath: r.media_path, rawJson: r.raw_json, seenByLlm: !!r.seen_by_llm,
  };
}

function rowToChat(r: any): Chat {
  return { jid: r.jid, name: r.name, isGroup: !!r.is_group, lastTs: r.last_ts, unreadCount: r.unread_count };
}

export class Store {
  constructor(private db: Db) {}

  upsertMessage(m: Message): void {
    this.db.prepare(
      `INSERT INTO messages (id, chat_jid, sender_jid, from_me, ts, type, text, media_path, raw_json, seen_by_llm)
       VALUES (@id,@chatJid,@senderJid,@fromMe,@ts,@type,@text,@mediaPath,@rawJson,@seenByLlm)
       ON CONFLICT(id) DO UPDATE SET
         text=excluded.text, type=excluded.type, media_path=excluded.media_path,
         raw_json=excluded.raw_json`
    ).run({
      ...m, fromMe: m.fromMe ? 1 : 0, seenByLlm: m.seenByLlm ? 1 : 0,
    });
    this.db.prepare(
      `INSERT INTO chats (jid, is_group, last_ts, unread_count)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET last_ts=MAX(chats.last_ts, excluded.last_ts)`
    ).run(m.chatJid, m.chatJid.endsWith("@g.us") ? 1 : 0, m.ts, 0);
  }

  setMediaPath(id: string, path: string): void {
    this.db.prepare(`UPDATE messages SET media_path=? WHERE id=?`).run(path, id);
  }

  getMessage(id: string): Message | null {
    const r = this.db.prepare(`SELECT * FROM messages WHERE id=?`).get(id);
    return r ? rowToMessage(r) : null;
  }

  getMessages(chatJid: string, limit: number, before?: number): Message[] {
    const rows = this.db.prepare(
      `SELECT * FROM messages WHERE chat_jid=? AND ts < ? ORDER BY ts DESC LIMIT ?`
    ).all(chatJid, before ?? Number.MAX_SAFE_INTEGER, limit);
    return rows.map(rowToMessage).reverse();
  }

  listChats(limit: number): Chat[] {
    return this.db.prepare(
      `SELECT * FROM chats ORDER BY last_ts DESC LIMIT ?`
    ).all(limit).map(rowToChat);
  }

  search(query: string, limit: number): Message[] {
    const rows = this.db.prepare(
      `SELECT m.* FROM messages_fts f JOIN messages m ON m.rowid = f.rowid
       WHERE messages_fts MATCH ? ORDER BY m.ts DESC LIMIT ?`
    ).all(query, limit);
    return rows.map(rowToMessage);
  }

  takeUnseen(limit: number): Message[] {
    const select = this.db.prepare(
      `SELECT * FROM messages WHERE seen_by_llm=0 AND from_me=0 ORDER BY ts ASC LIMIT ?`
    );
    const mark = this.db.prepare(`UPDATE messages SET seen_by_llm=1 WHERE id=?`);
    // Select + mark in one transaction so a concurrent reader on the shared
    // WAL db can't return the same unseen rows twice.
    const tx = this.db.transaction((n: number): Message[] => {
      const msgs = select.all(n).map(rowToMessage);
      for (const m of msgs) mark.run(m.id);
      return msgs;
    });
    return tx(limit);
  }

  upsertChatName(jid: string, name: string | null, isGroup: boolean): void {
    this.db.prepare(
      `INSERT INTO chats (jid, name, is_group, unread_count) VALUES (?,?,?,0)
       ON CONFLICT(jid) DO UPDATE SET name=COALESCE(excluded.name, chats.name)`
    ).run(jid, name, isGroup ? 1 : 0);
  }

  upsertContact(c: Contact): void {
    this.db.prepare(
      `INSERT INTO contacts (jid, push_name, name, phone) VALUES (@jid,@pushName,@name,@phone)
       ON CONFLICT(jid) DO UPDATE SET push_name=excluded.push_name, name=COALESCE(excluded.name, contacts.name)`
    ).run(c);
  }

  findContacts(query: string): Contact[] {
    const like = `%${query}%`;
    return this.db.prepare(
      `SELECT * FROM contacts WHERE push_name LIKE ? OR name LIKE ? OR phone LIKE ? LIMIT 50`
    ).all(like, like, like) as Contact[];
  }
}
