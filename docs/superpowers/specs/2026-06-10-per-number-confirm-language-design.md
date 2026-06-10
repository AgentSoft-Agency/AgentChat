# Per-number confirmation + preferred language — Design

**Date:** 2026-06-10
**Status:** Approved (pending spec review)

## Overview

Extend the agent-chat numeric allowlist so each number carries two new
attributes:

1. **`confirm`** — whether sending to this number requires the two-phase
   `draft → send_draft` confirmation flow (`true`), or may be sent in one shot
   (`false`).
2. **`language`** — the preferred language for composing messages to this
   number, as free text (e.g. `"Spanish"`, `"Mexican Spanish, casual"`).

A top-level **`defaultLanguage`** provides a global fallback for numbers with no
`language` set.

The numeric allowlist gate itself is unchanged: a number is still either on the
list or not, matched on bare digits. These attributes are metadata attached to
allowed numbers, surfaced to the assistant and (for `confirm`) enforced by the
server.

## Decisions (locked during brainstorming)

- **Confirmation is server-enforced via a fast path.** A new one-shot
  `send_message` tool sends immediately, but the server **permits it only for
  `confirm:false` numbers**. For `confirm:true` numbers the one-shot is rejected
  with an error directing the caller to `draft_message → send_draft`. A careless
  or forgetful agent therefore cannot fast-send a protected number — it is
  forced through the deliberate two-step. (Human approval *between* the two steps
  remains an assistant convention; the server enforces "no fast path", not the
  human keystroke.)
- **Language is a global default + per-number override, free text.** Free text is
  richer than an ISO code for tone/dialect. A number with no `language` resolves
  to `defaultLanguage`.
- **`confirm` defaults to `true`** for unspecified and legacy entries — nothing
  silently becomes fast-send.
- **One-shot is text only.** Media continues to go through `draft → send_draft`
  regardless of the `confirm` flag (a file send is higher-stakes, worth the
  two-step). No one-shot `send_media` in this iteration.

## Non-goals

- No change to the numeric matching of the allowlist (still bare-digit match).
- No one-shot media send.
- No per-number settings beyond `confirm` and `language` (e.g. no rate limits,
  no schedules).
- No change to read tools' behavior, the bridge, linking, or the install/PM2
  setup.

## Data model

### Config file (`data/config.json`)

```jsonc
{
  "defaultLanguage": "English",
  "bridgeToken": "…",
  "bridgePort": 7766,
  "allowlist": [
    { "number": "5219992583393", "label": "Karina", "confirm": true,  "language": "Spanish" },
    { "number": "5219986016453", "label": "Mom",    "confirm": false }
  ]
}
```

- `confirm` omitted → `true`.
- `language` omitted → resolves to `defaultLanguage` at read time (not written
  into the entry).
- `defaultLanguage` omitted in the file → `"English"`.

### Backward compatibility / migration

`parseConfig` must accept all three legacy entry forms and normalize them:

| Stored form | Normalizes to |
|---|---|
| `"5219992583393"` (bare string) | `{ number, confirm: true }` |
| `{ number, label }` | `{ number, label, confirm: true }` |
| `{ number, label?, confirm?, language? }` | itself, with `confirm` defaulting to `true` |

A config with no `defaultLanguage` key parses with `defaultLanguage: "English"`.
No migration script is needed — old files load unchanged; new attributes are
written only when the user sets them via the CLI.

## Components

### `src/shared/config.ts` (parsing)

- Replace the `numericString | {number,label}` union (which currently
  `.transform`s to a bare string) with a schema that **preserves the object**:
  ```ts
  // bare numeric string OR object; both normalize to AllowEntry
  const allowlistEntry = z.union([
    numericString.transform((number) => ({ number, confirm: true })),
    z.object({
      number: numericString,
      label: z.string().optional(),
      confirm: z.boolean().default(true),
      language: z.string().min(1).optional(),
    }),
  ]);
  ```
- Add `defaultLanguage: z.string().min(1).default("English")` to the schema.
- `AppConfig` (in `src/shared/types.ts`) changes:
  - `allowlist: AllowEntry[]` where
    `AllowEntry = { number: string; label?: string; confirm: boolean; language?: string }`.
  - add `defaultLanguage: string`.

### `src/shared/allowlist.ts` (policy lookup)

- Keep `resolveRecipient` unchanged.
- Add:
  ```ts
  export function findPolicy(allowlist: AllowEntry[], jid: string): AllowEntry | undefined {
    const num = jidToNumber(jid);
    return allowlist.find((e) => e.number === num);
  }
  export function isAllowed(allowlist: AllowEntry[], jid: string): boolean {
    return findPolicy(allowlist, jid) !== undefined;
  }
  export function resolveLanguage(entry: AllowEntry | undefined, defaultLanguage: string): string {
    return entry?.language ?? defaultLanguage;
  }
  ```
  `isAllowed`'s signature changes from `string[]` to `AllowEntry[]`; all callers
  updated.

### `src/mcp/tools.ts` (`ToolCore`)

- Constructor takes `allowlist: AllowEntry[]` and `defaultLanguage: string`
  instead of `allowlist: string[]`.
- `draftMessage` / `draftMedia`: same allow-gate, but the returned object gains
  `requiresConfirmation: boolean` and `language: string` (resolved):
  ```ts
  { draftId, toJid, preview, requiresConfirmation, language }
  ```
- **New `sendMessage(to, text)` (one-shot):**
  ```ts
  async sendMessage(to: string, text: string): Promise<{ id: string }> {
    const jid = resolveRecipient(to);
    const policy = findPolicy(this.allowlist, jid);
    if (!policy) throw new Error(`recipient not allowed: ${to}`);
    if (policy.confirm)
      throw new Error(
        `recipient ${policy.number} requires confirmation — use draft_message then send_draft`
      );
    return { id: await this.bridge.sendText(jid, text) };
  }
  ```
- `listContacts(query)`: enrich each returned contact with `onAllowlist: boolean`
  and, when allowlisted, `requiresConfirmation` + `language` (resolved). The
  store lookup is unchanged; enrichment happens in `ToolCore` using the policy.
- `sendDraft` unchanged.

### `src/mcp/server.ts` (tool registration)

- Register `send_message` with `inputSchema: { to: z.string(), text: z.string() }`.
- No other tool signatures change (the draft tools' richer return is just more
  JSON in the existing response).

### `src/mcp/index.ts` (wiring)

- Pass the structured `config.allowlist` and `config.defaultLanguage` into
  `ToolCore`.

### `src/cli/config-store.ts` + `src/cli/commands.ts` (CLI)

- `RawAllowlistEntry` becomes
  `string | { number: string; label?: string; confirm?: boolean; language?: string }`.
- `RawConfig` gains `defaultLanguage?: string` (createDefault sets `"English"`).
- `addAllowlist(config, number, opts)` becomes an **upsert that merges**: given
  `{ label?, confirm?, language? }`, it looks up any existing entry for the
  number and overlays only the provided fields (preserving the rest); a brand-new
  entry defaults to `confirm: true`. Serialization rule (deterministic): an entry
  with no label, no language, and `confirm === true` (all defaults) is written as
  a bare numeric string; any entry that carries a label, a language, or
  `confirm === false` is written as an object. This keeps default configs tidy
  and round-trips cleanly through `parseConfig`.
- `listAllowlist(config)` returns `{ number, label?, confirm, language? }[]`.
- New `setDefaultLanguage(config, text)`.
- CLI commands:
  - `allowlist add <number> [--label <name>] [--confirm|--no-confirm] [--lang <text>]`
    — parses the flags, calls the merging upsert.
  - `allowlist list` / `show` — print `confirm` and `language` per entry, and the
    global `defaultLanguage`.
  - `default-language "<text>"` — calls `setDefaultLanguage`.
- `src/cli/index.ts` — dispatch `default-language`; parse `--confirm/--no-confirm`
  and `--lang` for `allowlist add`.

## Tool behavior summary

| Tool | confirm:true number | confirm:false number |
|---|---|---|
| `send_message` (new, text one-shot) | **rejected** → use draft flow | sends immediately |
| `draft_message` → `send_draft` | allowed (preview carries `requiresConfirmation:true`, `language`) | allowed |
| `draft_media` → `send_draft` | allowed | allowed |
| `send_draft` | allowed | allowed |
| `list_contacts` | returns `requiresConfirmation:true`, `language` | returns `requiresConfirmation:false`, `language` |

## Assistant behavior (convention, not server-enforced)

1. Resolve the recipient (e.g. via `list_contacts`) and read its policy.
2. Compose in the recipient's resolved `language`.
3. For `confirm:true`: use `draft_message` → present the draft → on the user's OK,
   `send_draft`.
4. For `confirm:false`: may call `send_message` directly.

## Error handling

- One-shot `send_message` to a `confirm:true` number → explicit error naming the
  number and pointing to `draft_message` → `send_draft`.
- One-shot or draft to a non-allowlisted number → existing `recipient not allowed`
  error (unchanged).
- CLI `--lang` with an empty value → error (`language must be non-empty`).
- CLI conflicting `--confirm --no-confirm` → error.
- `writeConfig` continues to validate via `parseConfig` before writing, so a bad
  edit never lands on disk.

## Testing (TDD)

Unit-tested pure logic:
- **config parse:** legacy bare string and `{number,label}` → `confirm:true`;
  full object preserved; `confirm` default; `language` optional; missing
  `defaultLanguage` → `"English"`; invalid (empty language, non-boolean confirm)
  rejected.
- **policy lookup:** `findPolicy` finds by number across entry forms; `isAllowed`
  true/false; `resolveLanguage` returns override else default.
- **one-shot gate (`ToolCore.sendMessage`):** rejects `confirm:true`, sends for
  `confirm:false`, rejects non-allowlisted. (bridge mocked.)
- **draft enrichment:** `draftMessage`/`draftMedia` include correct
  `requiresConfirmation` + resolved `language`.
- **list_contacts enrichment:** allowlisted vs not; resolved language.
- **CLI config-store:** merging upsert preserves unspecified fields; new entry
  defaults `confirm:true`; `--no-confirm`; `--lang`; `setDefaultLanguage`;
  `listAllowlist` shape.

The MCP/stdio adapter and CLI dispatch are thin; verified by `tsc` and the
existing manual end-to-end checklist (extended: set a number `--no-confirm`,
confirm `send_message` sends; set another `--confirm`, confirm `send_message` is
rejected and the draft flow works).

## Files

```
src/shared/config.ts        # object-preserving allowlist schema + defaultLanguage   (modified)
src/shared/allowlist.ts     # findPolicy / isAllowed(AllowEntry[]) / resolveLanguage  (modified)
src/shared/types.ts         # AllowEntry, AppConfig.allowlist/defaultLanguage         (modified)
src/mcp/tools.ts            # sendMessage one-shot; draft + contacts enrichment       (modified)
src/mcp/server.ts           # register send_message                                  (modified)
src/mcp/index.ts            # pass allowlist objects + defaultLanguage to ToolCore    (modified)
src/cli/config-store.ts     # merging upsert, setDefaultLanguage, richer entries      (modified)
src/cli/commands.ts         # --confirm/--no-confirm/--lang, default-language, display(modified)
src/cli/index.ts            # dispatch + flag parsing                                 (modified)
tests/…                     # the unit tests above                                   (new/modified)
```

## Docs

README "Tools" and the CLI sections updated: document `send_message` (one-shot,
confirm:false only), the `confirm`/`language` attributes, the
`allowlist add --confirm/--no-confirm/--lang` flags, and `default-language`.
