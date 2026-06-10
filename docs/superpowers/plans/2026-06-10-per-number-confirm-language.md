# Per-number confirmation + preferred language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each allowlisted number a `confirm` flag (server-enforced one-shot vs two-phase send) and a preferred `language`, with a global `defaultLanguage` fallback.

**Architecture:** The config keeps allowlist entries as objects (`AllowEntry`) instead of stripping them to bare numbers; a new `defaultLanguage` is added. `ToolCore` gains a one-shot `send_message` tool that the server permits only for `confirm:false` numbers, and the draft/contacts tools surface `requiresConfirmation` + resolved `language`. The CLI sets these per number and the global default.

**Tech Stack:** TypeScript 6 (ESM/NodeNext), Zod v4, MCP SDK, better-sqlite3, vitest. Node `parseArgs` for the CLI.

**Critical constraint:** the husky **pre-commit hook runs `npm run typecheck && npm test` on every commit** — so each task must leave the build green. Tasks are sequenced so the `string[] → AllowEntry[]` type change never lands in a half-migrated, non-compiling state. Use the exact type/method names below verbatim across tasks.

**Canonical types (defined in Task 1, used everywhere after):**
```ts
// src/shared/types.ts
export interface AllowEntry { number: string; label?: string; confirm: boolean; language?: string; }
// AppConfig.allowlist: AllowEntry[];  AppConfig.defaultLanguage: string;
```

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/shared/types.ts` | `AllowEntry`; `AppConfig.allowlist`/`defaultLanguage` | 1 |
| `src/shared/config.ts` | object-preserving allowlist schema + `defaultLanguage` | 1 |
| `src/shared/allowlist.ts` | `findPolicy`, `resolveLanguage` (T1); `isAllowed(AllowEntry[])` (T2) | 1,2 |
| `src/mcp/index.ts` | wire allowlist/defaultLanguage into `ToolCore` | 1,2 |
| `src/mcp/tools.ts` | `send_message` one-shot; draft + contacts enrichment | 2,3 |
| `src/mcp/server.ts` | register `send_message` | 2 |
| `src/cli/config-store.ts` | merging upsert, `setDefaultLanguage`, richer entries | 4 |
| `src/cli/commands.ts` | `--confirm/--no-confirm/--lang`, `default-language`, display | 4,5 |
| `src/cli/index.ts` | flag parsing + `default-language` dispatch | 5 |
| `README.md` | document the tool, flags, attributes | 6 |

---

### Task 1: Config schema → AllowEntry objects + defaultLanguage + lookup helpers

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/config.ts`, `src/shared/allowlist.ts`, `src/mcp/index.ts`
- Test: `tests/shared/config.test.ts`, `tests/shared/allowlist.test.ts`

In this task `isAllowed` keeps its `string[]` signature (migrated in Task 2). `src/mcp/index.ts` maps the new objects back to numbers so `ToolCore` is untouched and the build stays green.

- [ ] **Step 1: Write/replace failing tests in `tests/shared/config.test.ts`**

Replace the whole file with:
```ts
import { describe, it, expect } from "vitest";
import { parseConfig } from "../../src/shared/config.js";

describe("parseConfig", () => {
  it("normalizes bare and labeled entries to AllowEntry objects (confirm defaults true)", () => {
    const cfg = parseConfig({
      allowlist: ["+52 155 1234 5678", { number: "120363012345678901", label: "Family" }],
      bridgeToken: "secret",
      bridgePort: 7766,
    });
    expect(cfg.allowlist).toEqual([
      { number: "5215512345678", confirm: true },
      { number: "120363012345678901", label: "Family", confirm: true },
    ]);
  });

  it("preserves confirm:false and a language override", () => {
    const cfg = parseConfig({
      allowlist: [{ number: "5215512345678", label: "Mom", confirm: false, language: "Spanish" }],
      bridgeToken: "s",
    });
    expect(cfg.allowlist).toEqual([
      { number: "5215512345678", label: "Mom", confirm: false, language: "Spanish" },
    ]);
  });

  it("defaults defaultLanguage to English when absent", () => {
    const cfg = parseConfig({ allowlist: [], bridgeToken: "s" });
    expect(cfg.defaultLanguage).toBe("English");
  });

  it("keeps an explicit defaultLanguage", () => {
    const cfg = parseConfig({ allowlist: [], bridgeToken: "s", defaultLanguage: "Spanish" });
    expect(cfg.defaultLanguage).toBe("Spanish");
  });

  it("rejects a non-numeric allowlist entry", () => {
    expect(() => parseConfig({ allowlist: ["mom"], bridgeToken: "s" })).toThrow(/numeric/i);
  });

  it("rejects an empty language", () => {
    expect(() =>
      parseConfig({ allowlist: [{ number: "5215512345678", language: "" }], bridgeToken: "s" })
    ).toThrow();
  });

  it("rejects a missing bridgeToken", () => {
    expect(() => parseConfig({ allowlist: [], bridgePort: 7766 })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/shared/config.test.ts`
Expected: FAIL (allowlist still normalizes to bare strings; no `defaultLanguage`).

- [ ] **Step 3: Update `src/shared/types.ts`**

Replace the `AppConfig` interface and add `AllowEntry`:
```ts
export interface AllowEntry {
  number: string;
  label?: string;
  confirm: boolean;
  language?: string;
}

export interface AppConfig {
  allowlist: AllowEntry[];
  defaultLanguage: string;
  bridgeToken: string;
  bridgePort: number;
}
```
(Leave `Chat`, `Message`, `Contact`, `Draft` unchanged.)

- [ ] **Step 4: Rewrite the schema in `src/shared/config.ts`**

```ts
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { AppConfig } from "./types.js";

const numericString = z
  .string()
  .transform((s) => s.replace(/[^0-9]/g, ""))
  .refine((s) => s.length > 0 && /^[0-9]+$/.test(s), {
    message: "allowlist entries must be numeric (phone digits or group id)",
  });

// A bare numeric string OR { number, label?, confirm?, language? }.
// Both normalize to an AllowEntry; confirm defaults to true.
const allowlistEntry = z.union([
  numericString.transform((number) => ({ number, confirm: true })),
  z.object({
    number: numericString,
    label: z.string().optional(),
    confirm: z.boolean().default(true),
    language: z.string().min(1).optional(),
  }),
]);

const schema = z.object({
  allowlist: z.array(allowlistEntry).default([]),
  defaultLanguage: z.string().min(1).default("English"),
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

- [ ] **Step 5: Add helpers to `src/shared/allowlist.ts`**

Keep `resolveRecipient` and `isAllowed(string[])` as-is; add imports and the two new helpers:
```ts
import { jidToNumber, numberToContactJid } from "./normalize.js";
import type { AllowEntry } from "./types.js";

/** Accepts a plain phone number or a full jid; returns a jid. */
export function resolveRecipient(to: string): string {
  return to.includes("@") ? to : numberToContactJid(to);
}

/** (Migrated to AllowEntry[] in Task 2.) */
export function isAllowed(allowlist: string[], jid: string): boolean {
  return allowlist.includes(jidToNumber(jid));
}

/** The policy entry for a jid, or undefined if not allowed. */
export function findPolicy(allowlist: AllowEntry[], jid: string): AllowEntry | undefined {
  const num = jidToNumber(jid);
  return allowlist.find((e) => e.number === num);
}

/** The entry's language if set, else the global default. */
export function resolveLanguage(entry: AllowEntry | undefined, defaultLanguage: string): string {
  return entry?.language ?? defaultLanguage;
}
```

- [ ] **Step 6: Keep `ToolCore` green via a shim in `src/mcp/index.ts`**

Change the `ToolCore` construction line (line 15) to map objects → numbers (constructor still takes `string[]` until Task 2):
```ts
const core = new ToolCore(store, bridge, new DraftStore(), config.allowlist.map((e) => e.number));
```

- [ ] **Step 7: Add helper tests to `tests/shared/allowlist.test.ts`**

Append inside the existing `describe("allowlist", …)` (keep all existing `isAllowed`/`resolveRecipient` cases unchanged):
```ts
  it("findPolicy returns the entry for an allowlisted jid", () => {
    const list = [{ number: "5215512345678", label: "Mom", confirm: false, language: "Spanish" }];
    expect(findPolicy(list, "5215512345678@s.whatsapp.net")).toEqual(list[0]);
    expect(findPolicy(list, "5219999999999@s.whatsapp.net")).toBeUndefined();
  });
  it("resolveLanguage prefers the entry language, else the default", () => {
    expect(resolveLanguage({ number: "1", confirm: true, language: "Spanish" }, "English")).toBe("Spanish");
    expect(resolveLanguage({ number: "1", confirm: true }, "English")).toBe("English");
    expect(resolveLanguage(undefined, "English")).toBe("English");
  });
```
And update the import line at the top:
```ts
import { resolveRecipient, isAllowed, findPolicy, resolveLanguage } from "../../src/shared/allowlist.js";
```

- [ ] **Step 8: Run the full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS (all suites green; `tools.test.ts` untouched and still passing because `ToolCore` is unchanged).

- [ ] **Step 9: Commit**

```bash
git add src/shared/types.ts src/shared/config.ts src/shared/allowlist.ts src/mcp/index.ts tests/shared/config.test.ts tests/shared/allowlist.test.ts
git commit -m "feat(config): per-number allowlist objects, defaultLanguage, policy helpers"
```

---

### Task 2: ToolCore migration + one-shot send_message + draft enrichment

**Files:**
- Modify: `src/shared/allowlist.ts`, `src/mcp/tools.ts`, `src/mcp/server.ts`, `src/mcp/index.ts`
- Test: `tests/mcp/tools.test.ts`, `tests/shared/allowlist.test.ts`

- [ ] **Step 1: Update `tests/mcp/tools.test.ts` (failing)**

Change the two `new ToolCore(...)` constructions to pass `AllowEntry[]` + a default language, and add the new behavior tests. Replace the file body with:
```ts
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
      language: "English", // falls back to default
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: FAIL (constructor arity; `sendMessage` missing; enrichment fields missing).

- [ ] **Step 3: Migrate `isAllowed` in `src/shared/allowlist.ts`**

Change `isAllowed` to consume `AllowEntry[]` via `findPolicy`:
```ts
export function isAllowed(allowlist: AllowEntry[], jid: string): boolean {
  return findPolicy(allowlist, jid) !== undefined;
}
```

- [ ] **Step 4: Update the `isAllowed` tests in `tests/shared/allowlist.test.ts`**

Change the three `isAllowed([...string...], …)` cases to pass entries:
```ts
  it("allows a contact whose number is on the list", () => {
    expect(isAllowed([{ number: "5215512345678", confirm: true }], "5215512345678@s.whatsapp.net")).toBe(true);
  });
  it("allows a group whose numeric id is on the list", () => {
    expect(isAllowed([{ number: "120363012345678901", confirm: true }], "120363012345678901@g.us")).toBe(true);
  });
  it("rejects a recipient not on the list", () => {
    expect(isAllowed([{ number: "5215512345678", confirm: true }], "5219999999999@s.whatsapp.net")).toBe(false);
  });
```

- [ ] **Step 5: Rewrite `src/mcp/tools.ts`**

```ts
import type { Store } from "../shared/store.js";
import type { BridgeClient } from "./bridge-client.js";
import { DraftStore } from "../shared/drafts.js";
import { resolveRecipient, isAllowed, findPolicy, resolveLanguage } from "../shared/allowlist.js";
import { isGroupJid } from "../shared/normalize.js";
import type { AllowEntry } from "../shared/types.js";

export class ToolCore {
  constructor(
    private store: Store,
    private bridge: BridgeClient,
    private drafts: DraftStore,
    private allowlist: AllowEntry[],
    private defaultLanguage: string
  ) {}

  listChats(limit = 20, query?: string) { return this.store.listChats(limit, query); }
  getMessages(chat: string, limit = 50, before?: number) {
    return this.store.getMessages(resolveRecipient(chat), limit, before);
  }
  searchMessages(query: string, chat?: string, limit = 20) {
    return this.store.search(query, limit, chat ? resolveRecipient(chat) : undefined);
  }
  listContacts(query = "") { return this.store.findContacts(query); }
  getNewMessages(limit = 50) { return this.store.takeUnseen(limit); }
  status() { return this.bridge.status(); }

  draftMessage(to: string, text: string) {
    const jid = resolveRecipient(to);
    const policy = findPolicy(this.allowlist, jid);
    if (!policy) throw new Error(`recipient not allowed: ${to}`);
    const d = this.drafts.create({ toJid: jid, kind: "text", text });
    return {
      draftId: d.id,
      toJid: jid,
      preview: `To ${jid}${isGroupJid(jid) ? " (group)" : ""}: ${text}`,
      requiresConfirmation: policy.confirm,
      language: resolveLanguage(policy, this.defaultLanguage),
    };
  }

  draftMedia(to: string, filePath: string, caption?: string) {
    const jid = resolveRecipient(to);
    const policy = findPolicy(this.allowlist, jid);
    if (!policy) throw new Error(`recipient not allowed: ${to}`);
    const d = this.drafts.create({ toJid: jid, kind: "media", filePath, caption });
    return {
      draftId: d.id,
      toJid: jid,
      preview: `To ${jid}: [media ${filePath}] ${caption ?? ""}`,
      requiresConfirmation: policy.confirm,
      language: resolveLanguage(policy, this.defaultLanguage),
    };
  }

  /** One-shot text send. Server-permitted only for confirm:false numbers. */
  async sendMessage(to: string, text: string): Promise<{ id: string }> {
    const jid = resolveRecipient(to);
    const policy = findPolicy(this.allowlist, jid);
    if (!policy) throw new Error(`recipient not allowed: ${to}`);
    if (policy.confirm) {
      throw new Error(
        `recipient ${policy.number} requires confirmation — use draft_message then send_draft`
      );
    }
    return { id: await this.bridge.sendText(jid, text) };
  }

  async downloadMedia(messageId: string): Promise<{ path: string }> {
    return { path: await this.bridge.downloadMedia(messageId) };
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

- [ ] **Step 6: Register `send_message` in `src/mcp/server.ts`**

Add after the `draft_media` registration (before `send_draft`):
```ts
  server.registerTool("send_message",
    { title: "Send message", description: "Send a text message in one step. Allowed only for numbers configured confirm:false; confirm:true numbers must use draft_message → send_draft.", inputSchema: { to: z.string(), text: z.string() } },
    async ({ to, text }) => json(await core.sendMessage(to, text)));
```

- [ ] **Step 7: Finish wiring `src/mcp/index.ts`**

Replace the shim from Task 1 with the real call:
```ts
const core = new ToolCore(store, bridge, new DraftStore(), config.allowlist, config.defaultLanguage);
```

- [ ] **Step 8: Run typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/shared/allowlist.ts src/mcp/tools.ts src/mcp/server.ts src/mcp/index.ts tests/mcp/tools.test.ts tests/shared/allowlist.test.ts
git commit -m "feat(mcp): one-shot send_message gated to confirm:false; draft enrichment"
```

---

### Task 3: list_contacts policy enrichment

**Files:**
- Modify: `src/mcp/tools.ts`
- Test: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Add a failing test to `tests/mcp/tools.test.ts`**

Append inside `describe("ToolCore", …)`:
```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/mcp/tools.test.ts`
Expected: FAIL (`onAllowlist` undefined).

- [ ] **Step 3: Enrich `listContacts` in `src/mcp/tools.ts`**

Replace the `listContacts` method:
```ts
  listContacts(query = "") {
    return this.store.findContacts(query).map((c) => {
      const policy = findPolicy(this.allowlist, c.jid);
      return policy
        ? { ...c, onAllowlist: true as const, requiresConfirmation: policy.confirm, language: resolveLanguage(policy, this.defaultLanguage) }
        : { ...c, onAllowlist: false as const };
    });
  }
```

- [ ] **Step 4: Run typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat(mcp): annotate list_contacts with allowlist policy and language"
```

---

### Task 4: CLI config-store — merging upsert, defaultLanguage, richer entries

**Files:**
- Modify: `src/cli/config-store.ts`, `src/cli/commands.ts`
- Test: `tests/cli/config-store.test.ts`

`commands.ts` is touched only to keep its `addAllowlist` call compiling (the new flags are added in Task 5).

- [ ] **Step 1: Update `tests/cli/config-store.test.ts` (failing)**

Update the `createDefault` assertion and the `allowlist` describe block; add `confirm`/`language`/`setDefaultLanguage` cases. Apply these edits:

Replace the `createDefault` test body to also assert the default language:
```ts
  it("createDefault is schema-valid with token, port, and default language", () => {
    const c = createDefault();
    expect(c.bridgePort).toBe(7766);
    expect(c.bridgeToken).toBeTruthy();
    expect(c.allowlist).toEqual([]);
    expect(c.defaultLanguage).toBe("English");
  });
```

Replace the entire `describe("config-store allowlist", …)` block with:
```ts
describe("config-store allowlist", () => {
  it("adds a labeled entry, normalizing the number", () => {
    const c = addAllowlist(createDefault(), "+52 1 55 1234 5678", { label: "Mom" });
    expect(c.allowlist).toEqual([{ number: "5215512345678", label: "Mom" }]);
  });

  it("adds a bare entry when only a number (all defaults)", () => {
    const c = addAllowlist(createDefault(), "5215512345678");
    expect(c.allowlist).toEqual(["5215512345678"]);
  });

  it("writes an object when confirm:false or a language is set", () => {
    expect(addAllowlist(createDefault(), "5215512345678", { confirm: false }).allowlist)
      .toEqual([{ number: "5215512345678", confirm: false }]);
    expect(addAllowlist(createDefault(), "5215512345678", { language: "Spanish" }).allowlist)
      .toEqual([{ number: "5215512345678", language: "Spanish" }]);
  });

  it("upsert merges: unspecified fields are preserved", () => {
    let c = addAllowlist(createDefault(), "5215512345678", { label: "Mom", confirm: false });
    c = addAllowlist(c, "+52 155 1234 5678", { language: "Spanish" }); // keep label + confirm
    expect(c.allowlist).toEqual([{ number: "5215512345678", label: "Mom", confirm: false, language: "Spanish" }]);
  });

  it("rejects a number with no digits", () => {
    expect(() => addAllowlist(createDefault(), "mom")).toThrow(/valid number/i);
  });

  it("removes by normalized number", () => {
    let c = addAllowlist(createDefault(), "5215512345678", { label: "Mom" });
    c = removeAllowlist(c, "+52 1 55 1234 5678");
    expect(c.allowlist).toEqual([]);
  });

  it("lists entries with confirm and optional fields", () => {
    let c = addAllowlist(createDefault(), "5215512345678", { label: "Mom", language: "Spanish" });
    c = addAllowlist(c, "120363000000000000", { confirm: false });
    expect(listAllowlist(c)).toEqual([
      { number: "5215512345678", label: "Mom", confirm: true, language: "Spanish" },
      { number: "120363000000000000", confirm: false },
    ]);
  });

  it("attributes survive a write/read round-trip", () => {
    const file = tmpFile();
    writeConfig(file, addAllowlist(createDefault(), "5215512345678", { label: "Mom", confirm: false, language: "Spanish" }));
    expect(readConfig(file).allowlist).toEqual([
      { number: "5215512345678", label: "Mom", confirm: false, language: "Spanish" },
    ]);
  });

  it("setDefaultLanguage updates the global default; rejects empty", () => {
    expect(setDefaultLanguage(createDefault(), "Spanish").defaultLanguage).toBe("Spanish");
    expect(() => setDefaultLanguage(createDefault(), "   ")).toThrow(/language/i);
  });
});
```

Add `setDefaultLanguage` to the imports at the top of the test file:
```ts
import { addAllowlist, removeAllowlist, listAllowlist, setDefaultLanguage } from "../../src/cli/config-store.js";
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/cli/config-store.test.ts`
Expected: FAIL (`addAllowlist` 3rd arg is a string today; `setDefaultLanguage` undefined; no `confirm` in list).

- [ ] **Step 3: Rewrite `src/cli/config-store.ts`**

```ts
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { parseConfig } from "../shared/config.js";

export type RawAllowlistEntry = string | { number: string; label?: string; confirm?: boolean; language?: string };

export interface RawConfig {
  allowlist: RawAllowlistEntry[];
  defaultLanguage?: string;
  bridgeToken: string;
  bridgePort: number;
}

export interface AllowOpts { label?: string; confirm?: boolean; language?: string; }

const DEFAULT_PORT = 7766;

export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export function createDefault(): RawConfig {
  return { allowlist: [], defaultLanguage: "English", bridgeToken: generateToken(), bridgePort: DEFAULT_PORT };
}

export function normalizeNumber(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

interface EntryFields { number: string; label?: string; confirm?: boolean; language?: string; }

function entryFields(e: RawAllowlistEntry): EntryFields {
  return typeof e === "string"
    ? { number: normalizeNumber(e) }
    : { number: normalizeNumber(e.number), label: e.label, confirm: e.confirm, language: e.language };
}

// Tidy serialization: bare string only when all-default; object otherwise.
function serializeEntry(f: EntryFields): RawAllowlistEntry {
  const hasLabel = !!f.label;
  const hasLang = !!f.language;
  const nonDefaultConfirm = f.confirm === false;
  if (!hasLabel && !hasLang && !nonDefaultConfirm) return f.number;
  const obj: { number: string; label?: string; confirm?: boolean; language?: string } = { number: f.number };
  if (hasLabel) obj.label = f.label;
  if (nonDefaultConfirm) obj.confirm = false;
  if (hasLang) obj.language = f.language;
  return obj;
}

export function readConfig(file: string): RawConfig {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  parseConfig(raw); // validate; throws if invalid
  return raw as RawConfig;
}

export function writeConfig(file: string, config: RawConfig): void {
  parseConfig(config); // validate before writing; never leave a broken file
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  chmodSync(file, 0o600);
}

/** Upsert that MERGES: provided fields override, unspecified ones are preserved. */
export function addAllowlist(config: RawConfig, number: string, opts: AllowOpts = {}): RawConfig {
  const num = normalizeNumber(number);
  if (!num) throw new Error(`not a valid number: ${number}`);
  const existing = config.allowlist.find((e) => entryFields(e).number === num);
  const prev = existing ? entryFields(existing) : { number: num };
  const merged: EntryFields = {
    number: num,
    label: opts.label ?? prev.label,
    confirm: opts.confirm ?? prev.confirm,
    language: opts.language ?? prev.language,
  };
  const allowlist = config.allowlist.filter((e) => entryFields(e).number !== num);
  allowlist.push(serializeEntry(merged));
  return { ...config, allowlist };
}

export function removeAllowlist(config: RawConfig, number: string): RawConfig {
  const num = normalizeNumber(number);
  return { ...config, allowlist: config.allowlist.filter((e) => entryFields(e).number !== num) };
}

export function listAllowlist(config: RawConfig): { number: string; label?: string; confirm: boolean; language?: string }[] {
  return config.allowlist.map((e) => {
    const f = entryFields(e);
    return {
      number: f.number,
      ...(f.label ? { label: f.label } : {}),
      confirm: f.confirm ?? true,
      ...(f.language ? { language: f.language } : {}),
    };
  });
}

export function setDefaultLanguage(config: RawConfig, language: string): RawConfig {
  const lang = language.trim();
  if (!lang) throw new Error("language must be non-empty");
  return { ...config, defaultLanguage: lang };
}

export function setPort(config: RawConfig, port: number): RawConfig {
  if (!Number.isInteger(port) || port <= 0) throw new Error(`invalid port: ${port}`);
  return { ...config, bridgePort: port };
}

export function rotateToken(config: RawConfig): RawConfig {
  return { ...config, bridgeToken: generateToken() };
}
```

- [ ] **Step 4: Keep `src/cli/commands.ts` compiling**

In `commands.ts`, the `allowlist` `add` branch currently calls `store.addAllowlist(requireConfig(configFile), number, label)`. Change only that call to pass an opts object (full flag wiring comes in Task 5):
```ts
    store.writeConfig(configFile, store.addAllowlist(requireConfig(configFile), number, { label }));
```
(Leave the `console.log` and the rest of the function unchanged for now.)

- [ ] **Step 5: Run typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/config-store.ts src/cli/commands.ts tests/cli/config-store.test.ts
git commit -m "feat(cli): merging allowlist upsert with confirm/language; default language"
```

---

### Task 5: CLI surface — flags, default-language command, display

**Files:**
- Modify: `src/cli/index.ts`, `src/cli/commands.ts`
- Test: `tests/cli/config-store.test.ts` (already covers the store logic; CLI dispatch is verified by `tsc` + manual run)

- [ ] **Step 1: Parse new flags + dispatch in `src/cli/index.ts`**

Replace the `allowlist` case with confirm/lang parsing and an opts object, and add a `default-language` case. Also update the `cmd.allowlist` signature usage:
```ts
    case "allowlist": {
      const { values, positionals } = parseArgs({
        args: rest.slice(1),
        options: {
          label: { type: "string" },
          confirm: { type: "boolean" },
          "no-confirm": { type: "boolean" },
          lang: { type: "string" },
        },
        allowPositionals: true,
      });
      if (values.confirm && values["no-confirm"]) {
        throw new Error("use either --confirm or --no-confirm, not both");
      }
      const confirm = values.confirm ? true : values["no-confirm"] ? false : undefined;
      cmd.allowlist(p.configFile, rest[0], positionals[0], { label: values.label, confirm, language: values.lang });
      break;
    }
    case "default-language": {
      if (!rest[0]) throw new Error('usage: agent-chat default-language "<language>"');
      cmd.defaultLanguage(p.configFile, rest[0]);
      break;
    }
```

Update the `HELP` text: change the allowlist add line and add two lines:
```
  agent-chat allowlist add <number> [--label <name>] [--confirm|--no-confirm] [--lang <language>]
  ...
  agent-chat default-language "<language>"        set the global default language
```

- [ ] **Step 2: Update `src/cli/commands.ts`**

Change the `allowlist` signature to take opts, wire the add branch, enrich `list`, add `defaultLanguage`, and enrich `show`:
```ts
export function allowlist(
  configFile: string,
  sub: string | undefined,
  number: string | undefined,
  opts: store.AllowOpts = {}
): void {
  if (sub === "list") {
    const entries = store.listAllowlist(requireConfig(configFile));
    if (entries.length === 0) { console.log("(no entries)"); return; }
    for (const e of entries) console.log(formatEntry(e));
    return;
  }
  if (sub === "add") {
    if (!number) throw new Error("usage: agent-chat allowlist add <number> [--label <name>] [--confirm|--no-confirm] [--lang <language>]");
    store.writeConfig(configFile, store.addAllowlist(requireConfig(configFile), number, opts));
    const tags = [
      opts.confirm === false ? "no-confirm" : opts.confirm === true ? "confirm" : null,
      opts.language ? `lang:${opts.language}` : null,
    ].filter(Boolean).join(", ");
    console.log(`✅ added ${store.normalizeNumber(number)}${opts.label ? ` (${opts.label})` : ""}${tags ? ` [${tags}]` : ""}`);
    return;
  }
  if (sub === "remove") {
    if (!number) throw new Error("usage: agent-chat allowlist remove <number>");
    store.writeConfig(configFile, store.removeAllowlist(requireConfig(configFile), number));
    console.log(`✅ removed ${store.normalizeNumber(number)}`);
    return;
  }
  throw new Error("usage: agent-chat allowlist <list|add|remove> ...");
}

function formatEntry(e: { number: string; label?: string; confirm: boolean; language?: string }): string {
  const parts = [e.number];
  if (e.label) parts.push(e.label);
  parts.push(e.confirm ? "[confirm]" : "[no-confirm]");
  if (e.language) parts.push(`lang:${e.language}`);
  return "  " + parts.join("  ");
}

export function defaultLanguage(configFile: string, language: string): void {
  store.writeConfig(configFile, store.setDefaultLanguage(requireConfig(configFile), language));
  console.log(`✅ default language set to ${language.trim()}`);
}
```

Update `show` to print the default language and the richer entries:
```ts
export function show(configFile: string): void {
  const c = requireConfig(configFile);
  console.log(`port:     ${c.bridgePort}`);
  console.log(`token:    ${c.bridgeToken ? "•••• (set)" : "(missing)"}`);
  console.log(`language: ${c.defaultLanguage ?? "English"}`);
  const entries = store.listAllowlist(c);
  console.log(`allowlist (${entries.length}):`);
  for (const e of entries) console.log(formatEntry(e));
}
```

- [ ] **Step 3: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Manual smoke (real CLI, temp config)**

Run:
```bash
AGENT_CHAT_HOME=$(mktemp -d) sh -c '
  node_modules/.bin/tsx src/cli/index.ts init --force <<< "" ;
  node_modules/.bin/tsx src/cli/index.ts allowlist add 5215512345678 --label Mom --no-confirm --lang Spanish ;
  node_modules/.bin/tsx src/cli/index.ts default-language English ;
  node_modules/.bin/tsx src/cli/index.ts show
'
```
Expected: `show` prints `language: English` and an allowlist line `5215512345678  Mom  [no-confirm]  lang:Spanish`.

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts src/cli/commands.ts
git commit -m "feat(cli): allowlist --confirm/--no-confirm/--lang flags and default-language command"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Tools section**

In `README.md`, in the "Tools" section, update the Send paragraph to mention the one-shot tool and the per-number policy. Replace the Send paragraph with:
```markdown
Send (numeric allowlist + per-number policy):

- **`send_message`** — one-shot text send. The server permits it **only** for
  numbers configured `confirm: false`; a `confirm: true` number is rejected and
  must use the two-phase flow below.
- **`draft_message` / `draft_media` → `send_draft`** — two-phase: a draft tool
  returns a `draftId` and a preview (with `requiresConfirmation` and the
  recipient's resolved `language`) without sending; `send_draft` performs the
  send and re-checks the allowlist.

Each allowlisted number carries `confirm` (default `true`) and an optional
`language`; `list_contacts` reports both for allowlisted contacts. A global
`defaultLanguage` (default `English`) is used when a number has no `language`.
```

- [ ] **Step 2: Update the Setup/CLI section**

In the CLI command list (the `npm run cli -- allowlist …` block), replace the allowlist lines and add a default-language line:
```markdown
npm run cli -- allowlist add <number> [--label <name>] [--confirm|--no-confirm] [--lang <language>]
npm run cli -- allowlist remove <number>
npm run cli -- allowlist list
npm run cli -- default-language "<language>"   # global default (default: English)
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document send_message, per-number confirm/language, default-language"
```

---

## Final verification (whole feature)

- [ ] `npm run typecheck && npm test` — all suites green.
- [ ] Legacy config (bare strings / `{number,label}`, no `defaultLanguage`) still loads (covered by `parseConfig` tests).
- [ ] One-shot `send_message`: rejected for `confirm:true`, sends for `confirm:false`, rejected for non-allowlisted (covered by `tools.test.ts`).
- [ ] Draft + `list_contacts` surface `requiresConfirmation` + resolved `language`.
- [ ] CLI: merging upsert preserves fields; `--confirm/--no-confirm/--lang`; `default-language`; `show`/`list` display.
- [ ] README documents the tool, attributes, and flags.
