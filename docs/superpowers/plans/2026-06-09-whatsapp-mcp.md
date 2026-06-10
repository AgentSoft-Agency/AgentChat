# WhatsApp MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server that lets an LLM send (gated) and read/search/receive WhatsApp messages from a personal account via Baileys.

**Architecture:** Two Node/TypeScript entry points in one package sharing a SQLite DB. A always-on **bridge daemon** owns the Baileys socket, ingests incoming messages/media into SQLite, and exposes a localhost-only token-guarded HTTP API for sending. A stdio **MCP server** reads SQLite directly for queries and calls the bridge API to send. Adapters (Baileys, HTTP, MCP) are thin wrappers over tested pure-core modules (`store`, `normalize`, `allowlist`, `drafts`, `config`).

**Tech Stack:** TypeScript, `@whiskeysockets/baileys`, `@modelcontextprotocol/sdk`, `better-sqlite3` (+FTS5), `zod`, `qrcode-terminal`, `pino`; `tsx` to run, `vitest` for tests.

**Spec:** `docs/superpowers/specs/2026-06-09-whatsapp-mcp-design.md`

---

## File structure

```
whatsapp-mcp/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    shared/
      types.ts          # shared TS interfaces
      paths.ts          # data-dir path resolution
      config.ts         # load/validate data/config.json
      db.ts             # open sqlite, migrations, WAL
      store.ts          # all read/write queries over a Database
      normalize.ts      # Baileys message -> MessageRow; jid<->number helpers
      allowlist.ts      # strictly-numeric allowlist resolution + check
      drafts.ts         # in-memory two-phase draft store (TTL)
    bridge/
      whatsapp.ts       # Baileys socket: connect, reconnect, QR
      ingest.ts         # Baileys events -> store writes
      api.ts            # localhost HTTP API (send, send-media, status, qr)
      index.ts          # bridge entry point
    mcp/
      bridge-client.ts  # HTTP client for the bridge API
      tools.ts          # pure tool-core functions over store + bridge-client
      server.ts         # register tools on McpServer
      index.ts          # MCP entry point
  tests/                # mirrors src/
  data/                 # gitignored: auth/, media/, whatsapp.db, config.json
  README.md
```

Most TDD effort targets `shared/*` (pure logic). `bridge/whatsapp.ts`, `bridge/api.ts`, `mcp/server.ts` are adapters verified by smoke tests + a manual end-to-end check (real WhatsApp), per the spec's testing section.

---

## Phase 1 — Foundation

### Task 1: Project scaffold + tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/shared/.gitkeep`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@agentsoft/agent-chat",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start:bridge": "tsx src/bridge/index.ts",
    "start:mcp": "tsx src/mcp/index.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install @whiskeysockets/baileys @modelcontextprotocol/sdk better-sqlite3 zod qrcode-terminal pino pino-pretty
npm install -D typescript tsx vitest @types/node @types/better-sqlite3 @types/qrcode-terminal
```
Expected: `node_modules/` populated, `package.json` gains `dependencies`/`devDependencies`. (`data/` and `node_modules/` are already gitignored.)

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 5: Verify the toolchain runs**

Run: `npx vitest run`
Expected: exits cleanly with "No test files found" (0 failures).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts
git commit -m "chore: project scaffold and tooling"
```

---

### Task 2: Shared types

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: Write the types**

```ts
export interface Chat {
  jid: string;
  name: string | null;
  isGroup: boolean;
  lastTs: number | null;
  unreadCount: number;
}

export interface Message {
  id: string;
  chatJid: string;
  senderJid: string | null;
  fromMe: boolean;
  ts: number;
  type: "text" | "image" | "document" | "audio" | "video" | "other";
  text: string | null;
  mediaPath: string | null;
  rawJson: string;
  seenByLlm: boolean;
}

export interface Contact {
  jid: string;
  pushName: string | null;
  name: string | null;
  phone: string | null;
}

export interface AppConfig {
  allowlist: string[]; // strictly numeric: contact phone digits or group numeric id
  bridgeToken: string;
  bridgePort: number;
}

export interface Draft {
  id: string;
  toJid: string;
  kind: "text" | "media";
  text?: string;
  filePath?: string;
  caption?: string;
  createdAt: number;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: shared types"
```

---

### Task 3: Path resolution

**Files:**
- Create: `src/shared/paths.ts`
- Test: `tests/shared/paths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { paths } from "../../src/shared/paths.js";

describe("paths", () => {
  it("derives data sub-paths from a base dir", () => {
    const p = paths("/tmp/wa");
    expect(p.dataDir).toBe("/tmp/wa");
    expect(p.dbFile).toBe("/tmp/wa/whatsapp.db");
    expect(p.authDir).toBe("/tmp/wa/auth");
    expect(p.mediaDir).toBe("/tmp/wa/media");
    expect(p.configFile).toBe("/tmp/wa/config.json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/paths.test.ts`
Expected: FAIL — cannot find module `paths.js`.

- [ ] **Step 3: Implement**

```ts
import { join, resolve } from "node:path";

export interface Paths {
  dataDir: string;
  dbFile: string;
  authDir: string;
  mediaDir: string;
  configFile: string;
}

export function paths(dataDir = resolve(process.cwd(), "data")): Paths {
  return {
    dataDir,
    dbFile: join(dataDir, "whatsapp.db"),
    authDir: join(dataDir, "auth"),
    mediaDir: join(dataDir, "media"),
    configFile: join(dataDir, "config.json"),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/paths.ts tests/shared/paths.test.ts
git commit -m "feat: data path resolution"
```

---

### Task 4: Database schema + migrations

**Files:**
- Create: `src/shared/db.ts`
- Test: `tests/shared/db.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/db.test.ts`
Expected: FAIL — cannot find module `db.js`.

- [ ] **Step 3: Implement**

```ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chats (
  jid TEXT PRIMARY KEY,
  name TEXT,
  is_group INTEGER NOT NULL DEFAULT 0,
  last_ts INTEGER,
  unread_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_jid TEXT NOT NULL,
  sender_jid TEXT,
  from_me INTEGER NOT NULL DEFAULT 0,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  text TEXT,
  media_path TEXT,
  raw_json TEXT NOT NULL,
  seen_by_llm INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages (chat_jid, ts);
CREATE INDEX IF NOT EXISTS idx_messages_unseen ON messages (seen_by_llm);
CREATE TABLE IF NOT EXISTS contacts (
  jid TEXT PRIMARY KEY,
  push_name TEXT,
  name TEXT,
  phone TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text, content='messages', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;
`;

export function openDb(dbFile: string): Db {
  if (dbFile !== ":memory:") mkdirSync(dirname(dbFile), { recursive: true });
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/db.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/db.ts tests/shared/db.test.ts
git commit -m "feat: sqlite schema and FTS triggers"
```

---

### Task 5: jid <-> number helpers

**Files:**
- Create: `src/shared/normalize.ts` (helpers first; message normalization added in Task 7)
- Test: `tests/shared/jid.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { jidToNumber, numberToContactJid, isGroupJid } from "../../src/shared/normalize.js";

describe("jid helpers", () => {
  it("extracts the numeric user part from a contact jid", () => {
    expect(jidToNumber("5215512345678@s.whatsapp.net")).toBe("5215512345678");
  });
  it("extracts the numeric id from a group jid", () => {
    expect(jidToNumber("120363012345678901@g.us")).toBe("120363012345678901");
  });
  it("strips a device suffix", () => {
    expect(jidToNumber("5215512345678:12@s.whatsapp.net")).toBe("5215512345678");
  });
  it("builds a contact jid from a plain number (tolerates +)", () => {
    expect(numberToContactJid("+52 1 55 1234 5678")).toBe("5215512345678@s.whatsapp.net");
  });
  it("detects group jids", () => {
    expect(isGroupJid("120363@g.us")).toBe(true);
    expect(isGroupJid("5215@s.whatsapp.net")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/jid.test.ts`
Expected: FAIL — cannot find module `normalize.js`.

- [ ] **Step 3: Implement (create `src/shared/normalize.ts`)**

```ts
export function isGroupJid(jid: string): boolean {
  return jid.endsWith("@g.us");
}

export function jidToNumber(jid: string): string {
  const userPart = jid.split("@")[0] ?? "";
  return userPart.split(":")[0].replace(/[^0-9]/g, "");
}

export function numberToContactJid(input: string): string {
  const digits = input.replace(/[^0-9]/g, "");
  return `${digits}@s.whatsapp.net`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/jid.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/normalize.ts tests/shared/jid.test.ts
git commit -m "feat: jid<->number helpers"
```

---

### Task 6: Config loader (strictly-numeric allowlist)

**Files:**
- Create: `src/shared/config.ts`
- Test: `tests/shared/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseConfig } from "../../src/shared/config.js";

describe("parseConfig", () => {
  it("accepts bare-number and labeled allowlist entries, normalizing to numbers", () => {
    const cfg = parseConfig({
      allowlist: ["+52 155 1234 5678", { number: "120363012345678901", label: "Family" }],
      bridgeToken: "secret",
      bridgePort: 7766,
    });
    expect(cfg.allowlist).toEqual(["5215512345678", "120363012345678901"]);
  });

  it("rejects a non-numeric allowlist entry", () => {
    expect(() =>
      parseConfig({ allowlist: ["mom"], bridgeToken: "s", bridgePort: 7766 })
    ).toThrow(/numeric/i);
  });

  it("rejects a labeled entry whose number is non-numeric", () => {
    expect(() =>
      parseConfig({ allowlist: [{ number: "mom", label: "Mom" }], bridgeToken: "s", bridgePort: 7766 })
    ).toThrow(/numeric/i);
  });

  it("rejects a missing bridgeToken", () => {
    expect(() =>
      parseConfig({ allowlist: [], bridgePort: 7766 })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/config.test.ts`
Expected: FAIL — cannot find module `config.js`.

- [ ] **Step 3: Implement**

```ts
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { AppConfig } from "./types.js";

// A number, after stripping non-digits, must be non-empty digits.
const numericString = z
  .string()
  .transform((s) => s.replace(/[^0-9]/g, ""))
  .refine((s) => s.length > 0 && /^[0-9]+$/.test(s), {
    message: "allowlist entries must be numeric (phone digits or group id)",
  });

// An entry is either a bare numeric string or { number, label? }; both
// normalize to the numeric string. The label is for readability only.
const allowlistEntry = z.union([
  numericString,
  z.object({ number: numericString, label: z.string().optional() }).transform((e) => e.number),
]);

const schema = z.object({
  allowlist: z.array(allowlistEntry).default([]),
  bridgeToken: z.string().min(1),
  bridgePort: z.number().int().positive().default(7766),
});

export function parseConfig(raw: unknown): AppConfig {
  return schema.parse(raw);
}

export function loadConfig(configFile: string): AppConfig {
  return parseConfig(JSON.parse(readFileSync(configFile, "utf8")));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/config.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add src/shared/config.ts tests/shared/config.test.ts
git commit -m "feat: config loader with strictly-numeric allowlist"
```

---

### Task 7: Message normalization (Baileys -> Message)

**Files:**
- Modify: `src/shared/normalize.ts`
- Test: `tests/shared/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/normalize.test.ts`
Expected: FAIL — `normalizeMessage` is not exported.

- [ ] **Step 3: Implement (append to `src/shared/normalize.ts`)**

```ts
import type { Message } from "./types.js";

type MediaKind = "image" | "document" | "audio" | "video";
const MEDIA_KEYS: Record<string, MediaKind> = {
  imageMessage: "image",
  documentMessage: "document",
  audioMessage: "audio",
  videoMessage: "video",
};

export function normalizeMessage(raw: any): Message | null {
  if (!raw?.key?.id || !raw?.key?.remoteJid || !raw?.message) return null;
  const content = raw.message;

  let type: Message["type"] = "other";
  let text: string | null = null;

  if (typeof content.conversation === "string") {
    type = "text";
    text = content.conversation;
  } else if (content.extendedTextMessage?.text != null) {
    type = "text";
    text = content.extendedTextMessage.text;
  } else {
    for (const [key, kind] of Object.entries(MEDIA_KEYS)) {
      if (content[key]) {
        type = kind;
        text = content[key].caption ?? null;
        break;
      }
    }
  }

  if (type === "other" && text === null) return null;

  const tsRaw = raw.messageTimestamp;
  const ts = typeof tsRaw === "object" && tsRaw?.toNumber ? tsRaw.toNumber() : Number(tsRaw ?? 0);

  return {
    id: raw.key.id,
    chatJid: raw.key.remoteJid,
    senderJid: raw.key.participant ?? (raw.key.fromMe ? null : raw.key.remoteJid),
    fromMe: !!raw.key.fromMe,
    ts,
    type,
    text,
    mediaPath: null,
    rawJson: JSON.stringify(raw),
    seenByLlm: false,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/normalize.test.ts`
Expected: PASS (all five).

- [ ] **Step 5: Commit**

```bash
git add src/shared/normalize.ts tests/shared/normalize.test.ts
git commit -m "feat: normalize Baileys messages to rows"
```

---

### Task 8: Store layer (writes + reads + search + unread)

**Files:**
- Create: `src/shared/store.ts`
- Test: `tests/shared/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/store.test.ts`
Expected: FAIL — cannot find module `store.js`.

- [ ] **Step 3: Implement**

```ts
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
    const rows = this.db.prepare(
      `SELECT * FROM messages WHERE seen_by_llm=0 AND from_me=0 ORDER BY ts ASC LIMIT ?`
    ).all(limit);
    const msgs = rows.map(rowToMessage);
    const mark = this.db.prepare(`UPDATE messages SET seen_by_llm=1 WHERE id=?`);
    const tx = this.db.transaction((ids: string[]) => ids.forEach((id) => mark.run(id)));
    tx(msgs.map((m) => m.id));
    return msgs;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/store.test.ts`
Expected: PASS (all five).

- [ ] **Step 5: Commit**

```bash
git add src/shared/store.ts tests/shared/store.test.ts
git commit -m "feat: sqlite store layer"
```

---

### Task 9: Allowlist resolution + check

**Files:**
- Create: `src/shared/allowlist.ts`
- Test: `tests/shared/allowlist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolveRecipient, isAllowed } from "../../src/shared/allowlist.js";

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/allowlist.test.ts`
Expected: FAIL — cannot find module `allowlist.js`.

- [ ] **Step 3: Implement**

```ts
import { isGroupJid, jidToNumber, numberToContactJid } from "./normalize.js";

/** Accepts a plain phone number or a full jid; returns a jid. */
export function resolveRecipient(to: string): string {
  return to.includes("@") ? to : numberToContactJid(to);
}

/** Allowlist holds strictly numeric ids: contact phone digits or group numeric id. */
export function isAllowed(allowlist: string[], jid: string): boolean {
  void isGroupJid; // jidToNumber handles both contact and group jids
  return allowlist.includes(jidToNumber(jid));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/allowlist.test.ts`
Expected: PASS (all five).

- [ ] **Step 5: Commit**

```bash
git add src/shared/allowlist.ts tests/shared/allowlist.test.ts
git commit -m "feat: numeric allowlist resolution and check"
```

---

### Task 10: Two-phase draft store

**Files:**
- Create: `src/shared/drafts.ts`
- Test: `tests/shared/drafts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { DraftStore } from "../../src/shared/drafts.js";

describe("DraftStore", () => {
  it("creates a draft and consumes it once", () => {
    let now = 1000;
    const drafts = new DraftStore(60_000, () => now);
    const d = drafts.create({ toJid: "1@s.whatsapp.net", kind: "text", text: "hi" });
    expect(d.id).toBeTruthy();
    const got = drafts.consume(d.id);
    expect(got?.text).toBe("hi");
    expect(drafts.consume(d.id)).toBeNull(); // already consumed
  });

  it("expires drafts past the TTL", () => {
    let now = 1000;
    const drafts = new DraftStore(60_000, () => now);
    const d = drafts.create({ toJid: "1@s.whatsapp.net", kind: "text", text: "hi" });
    now = 1000 + 60_001;
    expect(drafts.consume(d.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/drafts.test.ts`
Expected: FAIL — cannot find module `drafts.js`.

- [ ] **Step 3: Implement**

```ts
import { randomUUID } from "node:crypto";
import type { Draft } from "./types.js";

export class DraftStore {
  private drafts = new Map<string, Draft>();
  constructor(private ttlMs = 5 * 60_000, private clock: () => number = () => Date.now()) {}

  create(input: Omit<Draft, "id" | "createdAt">): Draft {
    const draft: Draft = { ...input, id: randomUUID(), createdAt: this.clock() };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  consume(id: string): Draft | null {
    const d = this.drafts.get(id);
    if (!d) return null;
    this.drafts.delete(id);
    if (this.clock() - d.createdAt > this.ttlMs) return null;
    return d;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/drafts.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/shared/drafts.ts tests/shared/drafts.test.ts
git commit -m "feat: two-phase draft store with TTL"
```

---

## Phase 2 — Bridge daemon

### Task 11: Ingest (Baileys events -> store)

**Files:**
- Create: `src/bridge/ingest.ts`
- Test: `tests/bridge/ingest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bridge/ingest.test.ts`
Expected: FAIL — cannot find module `ingest.js`.

- [ ] **Step 3: Implement**

```ts
import type { Store } from "../shared/store.js";
import { normalizeMessage } from "../shared/normalize.js";

export function ingestMessagesUpsert(store: Store, event: { messages: any[] }): void {
  for (const raw of event.messages) {
    const m = normalizeMessage(raw);
    if (m) store.upsertMessage(m);
  }
}

export function ingestContactsUpsert(store: Store, contacts: any[]): void {
  for (const c of contacts) {
    if (!c?.id) continue;
    store.upsertContact({
      jid: c.id, pushName: c.notify ?? null, name: c.name ?? null,
      phone: c.id.includes("@s.whatsapp.net") ? c.id.split("@")[0] : null,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bridge/ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/ingest.ts tests/bridge/ingest.test.ts
git commit -m "feat: bridge ingest from Baileys events"
```

---

### Task 12: WhatsApp connection (Baileys adapter)

**Files:**
- Create: `src/bridge/whatsapp.ts`

This is an adapter verified by the manual E2E in Task 18 (it needs a real phone). No unit test; keep it thin.

- [ ] **Step 1: Implement the connection module**

```ts
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import pino from "pino";

export interface WhatsAppHandle {
  sock: () => WASocket; // getter — returns the CURRENT socket (changes across reconnects)
  status: () => "connecting" | "connected" | "needs_relink";
  lastQr: () => string | null;
}

export async function startWhatsApp(
  authDir: string,
  onEvent: (sock: WASocket) => void
): Promise<WhatsAppHandle> {
  const logger = pino({ level: "warn" });
  let state: "connecting" | "connected" | "needs_relink" = "connecting";
  let lastQr: string | null = null;
  let current: WASocket;

  const { state: authState, saveCreds } = await useMultiFileAuthState(authDir);

  const connect = async (): Promise<WASocket> => {
    const sock = makeWASocket({ auth: authState, logger });
    current = sock;
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (u) => {
      if (u.qr) { lastQr = u.qr; qrcode.generate(u.qr, { small: true }); }
      if (u.connection === "open") { state = "connected"; lastQr = null; }
      if (u.connection === "close") {
        const code = (u.lastDisconnect?.error as Boom)?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) { state = "needs_relink"; }
        else { state = "connecting"; void connect(); }
      }
    });
    onEvent(sock);
    return sock;
  };

  await connect();
  return { sock: () => current, status: () => state, lastQr: () => lastQr };
}
```

- [ ] **Step 2: Install Baileys' boom peer if missing**

Run: `npm install @hapi/boom`
Expected: installs (Baileys uses Boom for disconnect errors).

- [ ] **Step 3: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS. (If `@hapi/boom` types are missing, the install above resolves it.)

- [ ] **Step 4: Commit**

```bash
git add src/bridge/whatsapp.ts package.json package-lock.json
git commit -m "feat: Baileys connection adapter with reconnect and QR"
```

---

### Task 13: Bridge HTTP API (localhost + token)

**Files:**
- Create: `src/bridge/api.ts`
- Test: `tests/bridge/api.test.ts`

- [ ] **Step 1: Write the failing test** (tests auth + routing with a fake sender)

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createBridgeApi } from "../../src/bridge/api.js";
import type { Server } from "node:http";

let server: Server;
afterEach(() => server?.close());

async function call(port: number, path: string, body: any, token?: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe("bridge api", () => {
  it("rejects requests without the bearer token", async () => {
    const sent: any[] = [];
    server = createBridgeApi({
      token: "secret",
      sendText: async (jid, text) => { sent.push({ jid, text }); return "id1"; },
      sendMedia: async () => "id2",
      status: () => ({ state: "connected", qr: null }),
    }).listen(0);
    const port = (server.address() as any).port;
    const r = await call(port, "/send", { to: "1@s.whatsapp.net", text: "hi" });
    expect(r.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("sends text when authorized", async () => {
    const sent: any[] = [];
    server = createBridgeApi({
      token: "secret",
      sendText: async (jid, text) => { sent.push({ jid, text }); return "id1"; },
      sendMedia: async () => "id2",
      status: () => ({ state: "connected", qr: null }),
    }).listen(0);
    const port = (server.address() as any).port;
    const r = await call(port, "/send", { to: "1@s.whatsapp.net", text: "hi" }, "secret");
    expect(r.status).toBe(200);
    expect(sent).toEqual([{ jid: "1@s.whatsapp.net", text: "hi" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bridge/api.test.ts`
Expected: FAIL — cannot find module `api.js`.

- [ ] **Step 3: Implement**

```ts
import { createServer, type Server } from "node:http";

export interface BridgeDeps {
  token: string;
  sendText: (jid: string, text: string) => Promise<string>;
  sendMedia: (jid: string, filePath: string, caption?: string) => Promise<string>;
  status: () => { state: string; qr: string | null };
}

function readJson(req: any): Promise<any> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c));
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
  });
}

export function createBridgeApi(deps: BridgeDeps): Server {
  return createServer(async (req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === "GET" && req.url === "/status") {
        return send(200, deps.status());
      }
      if (req.headers.authorization !== `Bearer ${deps.token}`) {
        return send(401, { error: "unauthorized" });
      }
      const body = await readJson(req);
      if (req.method === "POST" && req.url === "/send") {
        const id = await deps.sendText(body.to, body.text);
        return send(200, { id });
      }
      if (req.method === "POST" && req.url === "/send-media") {
        const id = await deps.sendMedia(body.to, body.filePath, body.caption);
        return send(200, { id });
      }
      return send(404, { error: "not found" });
    } catch (err: any) {
      return send(500, { error: String(err?.message ?? err) });
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bridge/api.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/bridge/api.ts tests/bridge/api.test.ts
git commit -m "feat: localhost bridge HTTP api with token auth"
```

---

### Task 14: Bridge entry point (wire it together)

**Files:**
- Create: `src/bridge/index.ts`

Adapter glue — verified by the manual E2E (Task 18).

- [ ] **Step 1: Implement**

```ts
import { downloadMediaMessage, type WASocket } from "@whiskeysockets/baileys";
import { writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { paths } from "../shared/paths.js";
import { loadConfig } from "../shared/config.js";
import { openDb } from "../shared/db.js";
import { Store } from "../shared/store.js";
import { ingestMessagesUpsert, ingestContactsUpsert } from "./ingest.js";
import { startWhatsApp } from "./whatsapp.js";
import { createBridgeApi } from "./api.js";

const p = paths();
const config = loadConfig(p.configFile);
const store = new Store(openDb(p.dbFile));
mkdirSync(p.mediaDir, { recursive: true });

const handle = await startWhatsApp(p.authDir, (sock: WASocket) => {
  sock.ev.on("messages.upsert", (e) => ingestMessagesUpsert(store, e));
  sock.ev.on("contacts.upsert", (c) => ingestContactsUpsert(store, c));
});

async function saveMediaFor(id: string): Promise<void> {
  const m = store.getMessage(id);
  if (!m || m.type === "text" || m.mediaPath) return;
  const raw = JSON.parse(m.rawJson);
  const buf = await downloadMediaMessage(
    raw,
    "buffer",
    {},
    { logger: undefined as any, reuploadRequest: handle.sock().updateMediaMessage }
  );
  const file = join(p.mediaDir, `${id}`);
  await writeFile(file, buf as Buffer);
  store.setMediaPath(id, file);
}

const api = createBridgeApi({
  token: config.bridgeToken,
  sendText: async (jid, text) => {
    const r = await handle.sock().sendMessage(jid, { text });
    return r?.key?.id ?? "";
  },
  sendMedia: async (jid, filePath, caption) => {
    const r = await handle.sock().sendMessage(jid, { document: { url: filePath }, caption, fileName: filePath.split("/").pop() });
    return r?.key?.id ?? "";
  },
  status: () => ({ state: handle.status(), qr: handle.lastQr() }),
});

api.listen(config.bridgePort, "127.0.0.1", () =>
  console.error(`bridge api on 127.0.0.1:${config.bridgePort}`)
);

// expose media download for the MCP layer via a tiny endpoint
void saveMediaFor;
```

> Note: `saveMediaFor` is referenced by the media endpoint added in Task 17. Leaving the `void` reference avoids an unused-symbol error until then.

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/bridge/index.ts
git commit -m "feat: bridge entry point"
```

---

## Phase 3 — MCP read tools

### Task 15: Bridge client + tool-core functions

**Files:**
- Create: `src/mcp/bridge-client.ts`, `src/mcp/tools.ts`
- Test: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write the failing test** (tool-core over a real in-memory store + fake bridge)

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/shared/db.js";
import { Store } from "../../src/shared/store.js";
import { DraftStore } from "../../src/shared/drafts.js";
import { ToolCore } from "../../src/mcp/tools.js";

const fakeBridge = {
  sendText: async () => "sent-1",
  sendMedia: async () => "sent-2",
  status: async () => ({ state: "connected", qr: null }),
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: FAIL — cannot find module `tools.js`.

- [ ] **Step 3: Implement `src/mcp/bridge-client.ts`**

```ts
export interface BridgeClient {
  sendText: (jid: string, text: string) => Promise<string>;
  sendMedia: (jid: string, filePath: string, caption?: string) => Promise<string>;
  status: () => Promise<{ state: string; qr: string | null }>;
}

export function httpBridgeClient(port: number, token: string): BridgeClient {
  const base = `http://127.0.0.1:${port}`;
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
  const post = async (path: string, body: unknown) => {
    const res = await fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`bridge ${path} failed: ${res.status}`);
    return res.json();
  };
  return {
    sendText: async (to, text) => (await post("/send", { to, text })).id,
    sendMedia: async (to, filePath, caption) => (await post("/send-media", { to, filePath, caption })).id,
    status: async () => {
      const res = await fetch(base + "/status");
      if (!res.ok) throw new Error(`bridge /status failed: ${res.status}`);
      return res.json();
    },
  };
}
```

- [ ] **Step 4: Implement `src/mcp/tools.ts`**

```ts
import type { Store } from "../shared/store.js";
import type { BridgeClient } from "./bridge-client.js";
import { DraftStore } from "../shared/drafts.js";
import { resolveRecipient, isAllowed } from "../shared/allowlist.js";
import { isGroupJid } from "../shared/normalize.js";

export class ToolCore {
  constructor(
    private store: Store,
    private bridge: BridgeClient,
    private drafts: DraftStore,
    private allowlist: string[]
  ) {}

  listChats(limit = 20) { return this.store.listChats(limit); }
  getMessages(chat: string, limit = 50, before?: number) {
    return this.store.getMessages(resolveRecipient(chat), limit, before);
  }
  searchMessages(query: string, limit = 20) { return this.store.search(query, limit); }
  listContacts(query = "") { return this.store.findContacts(query); }
  getNewMessages(limit = 50) { return this.store.takeUnseen(limit); }
  status() { return this.bridge.status(); }

  draftMessage(to: string, text: string): { draftId: string; toJid: string; preview: string } {
    const jid = resolveRecipient(to);
    if (!isAllowed(this.allowlist, jid)) throw new Error(`recipient not allowed: ${to}`);
    const d = this.drafts.create({ toJid: jid, kind: "text", text });
    return { draftId: d.id, toJid: jid, preview: `To ${jid}${isGroupJid(jid) ? " (group)" : ""}: ${text}` };
  }

  draftMedia(to: string, filePath: string, caption?: string): { draftId: string; toJid: string; preview: string } {
    const jid = resolveRecipient(to);
    if (!isAllowed(this.allowlist, jid)) throw new Error(`recipient not allowed: ${to}`);
    const d = this.drafts.create({ toJid: jid, kind: "media", filePath, caption });
    return { draftId: d.id, toJid: jid, preview: `To ${jid}: [media ${filePath}] ${caption ?? ""}` };
  }

  async sendDraft(draftId: string): Promise<{ id: string }> {
    const d = this.drafts.consume(draftId);
    if (!d) throw new Error(`unknown or expired draft: ${draftId}`);
    if (!isAllowed(this.allowlist, d.toJid)) throw new Error(`recipient not allowed: ${d.toJid}`);
    const id =
      d.kind === "text"
        ? await this.bridge.sendText(d.toJid, d.text ?? "")
        : await this.bridge.sendMedia(d.toJid, d.filePath ?? "", d.caption);
    return { id };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: PASS (all three).

- [ ] **Step 6: Commit**

```bash
git add src/mcp/bridge-client.ts src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: mcp tool-core and bridge client"
```

---

### Task 16: MCP server registration + entry point

**Files:**
- Create: `src/mcp/server.ts`, `src/mcp/index.ts`

Adapter glue. Verified by a smoke test in Step 4 (lists tools over stdio).

> **SDK API check:** before writing, open `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` and confirm the `registerTool` signature. The code below uses the published 1.x form where `inputSchema` is a **Zod raw shape** (`{ field: z.string() }`). If the installed version expects `z.object({...})`, wrap each `inputSchema` accordingly. Either way the handler returns `{ content: [{ type: "text", text }] }`.

- [ ] **Step 1: Implement `src/mcp/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolCore } from "./tools.js";

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

export function buildServer(core: ToolCore): McpServer {
  const server = new McpServer({ name: "whatsapp-mcp", version: "0.1.0" });

  server.registerTool("list_chats",
    { title: "List chats", description: "Recent WhatsApp chats", inputSchema: { limit: z.number().optional() } },
    async ({ limit }) => json(core.listChats(limit)));

  server.registerTool("get_messages",
    { title: "Get messages", description: "Messages in a chat (newest last)", inputSchema: { chat: z.string(), limit: z.number().optional(), before: z.number().optional() } },
    async ({ chat, limit, before }) => json(core.getMessages(chat, limit, before)));

  server.registerTool("search_messages",
    { title: "Search messages", description: "Full-text search across history", inputSchema: { query: z.string(), limit: z.number().optional() } },
    async ({ query, limit }) => json(core.searchMessages(query, limit)));

  server.registerTool("list_contacts",
    { title: "List contacts", description: "Find contacts by name/number", inputSchema: { query: z.string().optional() } },
    async ({ query }) => json(core.listContacts(query)));

  server.registerTool("get_new_messages",
    { title: "Get new messages", description: "Unseen incoming messages; marks them seen", inputSchema: { limit: z.number().optional() } },
    async ({ limit }) => json(core.getNewMessages(limit)));

  server.registerTool("whatsapp_status",
    { title: "WhatsApp status", description: "Connection state", inputSchema: {} },
    async () => json(await core.status()));

  server.registerTool("draft_message",
    { title: "Draft message", description: "Prepare a text message (does not send). Returns draftId.", inputSchema: { to: z.string(), text: z.string() } },
    async ({ to, text }) => json(core.draftMessage(to, text)));

  server.registerTool("draft_media",
    { title: "Draft media", description: "Prepare a media message (does not send). Returns draftId.", inputSchema: { to: z.string(), filePath: z.string(), caption: z.string().optional() } },
    async ({ to, filePath, caption }) => json(core.draftMedia(to, filePath, caption)));

  server.registerTool("send_draft",
    { title: "Send draft", description: "Send a previously drafted message by draftId", inputSchema: { draftId: z.string() } },
    async ({ draftId }) => json(await core.sendDraft(draftId)));

  return server;
}
```

- [ ] **Step 2: Implement `src/mcp/index.ts`**

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { paths } from "../shared/paths.js";
import { loadConfig } from "../shared/config.js";
import { openDb } from "../shared/db.js";
import { Store } from "../shared/store.js";
import { DraftStore } from "../shared/drafts.js";
import { httpBridgeClient } from "./bridge-client.js";
import { ToolCore } from "./tools.js";
import { buildServer } from "./server.js";

const p = paths();
const config = loadConfig(p.configFile);
const store = new Store(openDb(p.dbFile));
const bridge = httpBridgeClient(config.bridgePort, config.bridgeToken);
const core = new ToolCore(store, bridge, new DraftStore(), config.allowlist);

const server = buildServer(core);
await server.connect(new StdioServerTransport());
console.error("whatsapp-mcp server running on stdio");
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS. If it fails on `registerTool` typings, apply the SDK API check note above.

- [ ] **Step 4: Smoke-test the stdio server lists tools**

Create `data/config.json` first (minimal): `{"allowlist":[],"bridgeToken":"x","bridgePort":7766}`, then run:
```bash
mkdir -p data
printf '{"allowlist":[],"bridgeToken":"x","bridgePort":7766}' > data/config.json
printf '%s\n%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | npx tsx src/mcp/index.ts
```
Expected: JSON-RPC responses on stdout; the `tools/list` result contains `list_chats`, `get_messages`, `send_draft`, etc. (Ctrl-C to exit.)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts src/mcp/index.ts
git commit -m "feat: mcp server registration and stdio entry point"
```

---

## Phase 4 — Media & groups

### Task 17: Media download endpoint + tool

**Files:**
- Modify: `src/bridge/api.ts`, `src/bridge/index.ts`, `src/mcp/bridge-client.ts`, `src/mcp/tools.ts`, `src/mcp/server.ts`
- Test: `tests/mcp/tools.test.ts` (extend)

- [ ] **Step 1: Add a failing test for `downloadMedia` tool-core**

Append to `tests/mcp/tools.test.ts`:
```ts
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
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: FAIL — `core.downloadMedia` is not a function; `BridgeClient` has no `downloadMedia`.

- [ ] **Step 3: Extend `BridgeClient` (`src/mcp/bridge-client.ts`)**

Add to the interface and implementation:
```ts
// interface:
  downloadMedia: (messageId: string) => Promise<string>;
// implementation (inside the returned object):
    downloadMedia: async (messageId) => (await post("/download-media", { messageId })).path,
```

- [ ] **Step 4: Add `downloadMedia` to `ToolCore` (`src/mcp/tools.ts`)**

```ts
  async downloadMedia(messageId: string): Promise<{ path: string }> {
    const path = await this.bridge.downloadMedia(messageId);
    return { path };
  }
```

- [ ] **Step 5: Add the bridge endpoint + dep (`src/bridge/api.ts`)**

Add to `BridgeDeps`:
```ts
  downloadMedia: (messageId: string) => Promise<string>;
```
Add a route (after the `/send-media` block, before the 404):
```ts
      if (req.method === "POST" && req.url === "/download-media") {
        const path = await deps.downloadMedia(body.messageId);
        return send(200, { path });
      }
```

- [ ] **Step 6: Wire it in `src/bridge/index.ts`**

In the `createBridgeApi({...})` deps, add:
```ts
  downloadMedia: async (messageId: string) => {
    await saveMediaFor(messageId);
    const m = store.getMessage(messageId);
    if (!m?.mediaPath) throw new Error(`no media for ${messageId}`);
    return m.mediaPath;
  },
```
Then delete the trailing `void saveMediaFor;` line (now used).

- [ ] **Step 7: Register the `download_media` tool (`src/mcp/server.ts`)**

```ts
  server.registerTool("download_media",
    { title: "Download media", description: "Download a media message; returns a local file path", inputSchema: { messageId: z.string() } },
    async ({ messageId }) => json(await core.downloadMedia(messageId)));
```

- [ ] **Step 8: Run tests + type-check**

Run: `npx vitest run tests/mcp/tools.test.ts && npx tsc -p tsconfig.json --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/bridge/api.ts src/bridge/index.ts src/mcp/bridge-client.ts src/mcp/tools.ts src/mcp/server.ts tests/mcp/tools.test.ts
git commit -m "feat: media download endpoint and tool"
```

---

### Task 18: Group naming in chats

**Files:**
- Modify: `src/bridge/index.ts`
- Test: none (adapter; covered by manual E2E)

- [ ] **Step 1: Populate group subjects on connect**

In `src/bridge/index.ts`, inside the `startWhatsApp` event callback, add a groups handler:
```ts
  sock.ev.on("groups.upsert", (groups) => {
    for (const g of groups) {
      if (g?.id) store.upsertChatName(g.id, g.subject ?? null, true);
    }
  });
```

- [ ] **Step 2: Add `upsertChatName` to `Store` (`src/shared/store.ts`)**

```ts
  upsertChatName(jid: string, name: string | null, isGroup: boolean): void {
    this.db.prepare(
      `INSERT INTO chats (jid, name, is_group, unread_count) VALUES (?,?,?,0)
       ON CONFLICT(jid) DO UPDATE SET name=COALESCE(excluded.name, chats.name)`
    ).run(jid, name, isGroup ? 1 : 0);
  }
```

- [ ] **Step 3: Add a store test for `upsertChatName`**

Append to `tests/shared/store.test.ts`:
```ts
it("sets a chat name without clobbering on null", () => {
  store.upsertChatName("120363@g.us", "Family", true);
  store.upsertChatName("120363@g.us", null, true);
  expect(store.listChats(10).find((c) => c.jid === "120363@g.us")?.name).toBe("Family");
});
```

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run tests/shared/store.test.ts && npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/index.ts src/shared/store.ts tests/shared/store.test.ts
git commit -m "feat: store and surface group names"
```

---

## Phase 5 — Docs & manual end-to-end

### Task 19: README + config example

**Files:**
- Create: `README.md`, `data/config.example.json`
- Modify: `.gitignore` (ensure `data/config.example.json` is tracked)

- [ ] **Step 1: Allow the example config through gitignore**

Append to `.gitignore`:
```
!data/config.example.json
```

- [ ] **Step 2: Create `data/config.example.json`**

```json
{
  "allowlist": [
    { "number": "5215512345678", "label": "Mom" },
    { "number": "120363012345678901", "label": "Family group" }
  ],
  "bridgeToken": "change-me-to-a-long-random-string",
  "bridgePort": 7766
}
```

- [ ] **Step 3: Write `README.md`**

````markdown
# whatsapp-mcp

MCP server for a **personal** WhatsApp account via Baileys. Two processes:
a always-on **bridge** (owns the WhatsApp connection, writes to SQLite) and a
stdio **MCP server** (read/search/send tools for your AI client).

> ⚠️ Uses an unofficial library against a personal number — this violates
> WhatsApp's Terms of Service and can get the number banned. Use a number you
> accept that risk on. `data/` holds your session credentials: treat it like a
> password (`chmod 700 data`).

## Setup

```bash
npm install
cp data/config.example.json data/config.json   # edit allowlist + bridgeToken
```

Allowlist enforcement is **strictly numeric**: a contact's phone digits (no `+`)
or a group's numeric id. Each entry may be a bare number string **or**
`{ "number": "...", "label": "..." }` — the `label` is for your reference only
and never affects the check. You can still address contacts by name in the tools
(via `list_contacts`); that's separate from the allowlist.

## Run

1. Start the bridge and scan the QR with WhatsApp → Linked Devices:
   ```bash
   npm run start:bridge
   ```
2. Point your MCP client at the server (stdio). Example client config:
   ```json
   {
     "mcpServers": {
       "whatsapp": { "command": "npx", "args": ["tsx", "src/mcp/index.ts"], "cwd": "ABSOLUTE/PATH/TO/whatsapp-mcp" }
     }
   }
   ```

## Tools

`list_chats`, `get_messages`, `search_messages`, `list_contacts`,
`get_new_messages`, `whatsapp_status`, `download_media`,
`draft_message` → `send_draft`, `draft_media` → `send_draft`.

Sending is two-phase (draft then send) and restricted to the numeric allowlist.
````

- [ ] **Step 4: Commit**

```bash
git add README.md data/config.example.json .gitignore
git commit -m "docs: README and example config"
```

---

### Task 20: Manual end-to-end verification

**Files:** none (manual checklist — requires a real phone + a test number on the allowlist).

- [ ] **Step 1:** `npm test` — all unit tests pass.
- [ ] **Step 2:** `npm run start:bridge`, scan the QR. Confirm console shows `connected`.
- [ ] **Step 3:** From your phone, send a message to the linked account. Confirm a row appears: `sqlite3 data/whatsapp.db "select id,text from messages order by ts desc limit 3"`.
- [ ] **Step 4:** Run the MCP server via your client; call `whatsapp_status` → `connected`; `get_new_messages` → returns the test message.
- [ ] **Step 5:** `draft_message` to an allowlisted number, then `send_draft`; confirm it arrives on the phone. Confirm `draft_message` to a non-allowlisted number is rejected.
- [ ] **Step 6:** Send an image from the phone; call `download_media` with its id; confirm the returned path exists and opens.
- [ ] **Step 7:** Final commit if any doc tweaks were needed.

```bash
git add -A && git commit -m "chore: manual e2e verified" --allow-empty
```

---

## Self-review notes

- **Spec coverage:** send text (Tasks 15–16), read/search history (8, 15–16), live receive via `seen_by_llm`/`takeUnseen` (8, 15), media (17), groups (18), always-on bridge + stdio MCP + shared SQLite (11–16), strictly-numeric allowlist + two-phase confirm (6, 9, 10, 15), linking/QR (12), reconnect/`needs_relink` (12), localhost+token security (13), testing approach (pure-core unit tests + smoke + manual E2E). All spec sections map to a task.
- **Type consistency:** `Store`, `ToolCore`, `BridgeClient`, `BridgeDeps`, `DraftStore` signatures are defined once and reused; `downloadMedia` added to `BridgeClient`/`BridgeDeps`/`ToolCore` together in Task 17.
- **Known risk to watch:** the MCP SDK `registerTool` input-schema shape (raw Zod shape vs `z.object`) — Task 16 Step 1 note tells the implementer to confirm against the installed version and adapt.
