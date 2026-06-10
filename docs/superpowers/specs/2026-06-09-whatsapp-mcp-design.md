# WhatsApp MCP (Baileys, personal account) — Design

**Date:** 2026-06-09
**Status:** Approved (pending spec review)

## Overview

An MCP server that lets an LLM client send and receive WhatsApp messages from a
**personal** (non-business) WhatsApp account. WhatsApp offers no official API for
personal accounts, so the connection is made through **Baileys**, an unofficial
TypeScript library that speaks the WhatsApp Web multi-device protocol over
WebSocket. The account is linked exactly like a WhatsApp Web / linked device (QR
or pairing code).

### Risk acknowledgment (important)

Using unofficial libraries against a personal number violates WhatsApp's Terms of
Service and carries a real risk of the number being **banned**, especially under
high volume or spam-like patterns. This project is intended for personal
automation on a number the user accepts that risk on. Sends are deliberately
gated (allowlist + confirmation) to reduce accidental or rogue messages.

## Goals

- Send text messages from the personal account (gated).
- Read conversations, list chats, and full-text search message history.
- Surface newly arrived ("live") messages to the LLM.
- Handle media (images, docs, voice notes) and groups.
- Keep WhatsApp connected even when the AI client is closed.

## Non-goals

- No business/Cloud API integration.
- No multi-account support (single personal account).
- No remote/multi-user access (local, single user). HTTP is localhost-only.
- No outbound bulk messaging or automation that increases ban risk.

## Architecture

Two Node/TypeScript processes in one repository, sharing a SQLite database:

```
AI client ──stdio──► MCP server ──HTTP(127.0.0.1 + bearer token)──► Bridge daemon (Baileys, always-on)
                          │                                              │
                          └──────────────► SQLite (better-sqlite3) ◄─────┘
                                           chats · messages · contacts · FTS5
                                           data/media/*  (media files on disk)
```

### Components

- **Bridge daemon** (`src/bridge/`)
  - Owns the single live Baileys socket.
  - Handles linking: prints the QR to its own terminal (`qrcode-terminal`).
    A pairing-code fallback for headless hosts is triggered by setting the
    `AGENT_CHAT_PAIRING_NUMBER` env var. Persists creds via
    `useMultiFileAuthState('data/auth')`.
  - Auto-reconnects on drop; reconnects unless the disconnect reason is
    `loggedOut`.
  - Writes every incoming message, contact update, and downloaded media to
    SQLite.
  - Exposes a **localhost-only HTTP API** (`/send`, `/send-media`,
    `/download-media`, `/status`) guarded by a bearer token. Only this process
    can send, because only it holds the socket. The QR is **not** served over
    HTTP — it is a linking credential and is only printed to the bridge's
    terminal; the unauthenticated `/status` returns only the connection state.

- **MCP server** (`src/mcp/`)
  - stdio MCP server spawned by the AI client.
  - **Reads** SQLite directly for all query tools.
  - **Sends** by calling the bridge's HTTP API.
  - Holds no WhatsApp connection of its own.

- **Shared** (`src/shared/`)
  - DB schema + migrations, config loader (allowlist, bridge token, paths),
    shared types, Baileys-message→row normalization.

## Data model (SQLite via better-sqlite3)

- `chats(jid TEXT PK, name TEXT, is_group INTEGER, last_ts INTEGER, unread_count INTEGER)` — `unread_count` exists in the schema but is **not surfaced** by `list_chats`; the live-receive path (`seen_by_llm` + `get_new_messages`) covers "what's new" without needing reliable unread accounting across history sync.
- `messages(id TEXT PK, chat_jid TEXT, sender_jid TEXT, from_me INTEGER, ts INTEGER, type TEXT, text TEXT, media_path TEXT, raw_json TEXT, seen_by_llm INTEGER DEFAULT 0)`
- `contacts(jid TEXT PK, push_name TEXT, name TEXT, phone TEXT)`
- `messages_fts` — FTS5 virtual table over `messages.text` for fast search,
  kept in sync via triggers.
- Media files saved under `data/media/`; the relative path is stored on the
  message row. `seen_by_llm` powers live receive (see Key flows).

`better-sqlite3` is synchronous and supports FTS5; the same DB file is opened by
both processes (WAL mode enabled so the always-on writer and the on-demand reader
don't block each other).

## MCP tool surface

### Read tools (direct SQLite, always allowed)

- `list_chats(limit?, query?)` — recent chats with last message + unread count.
- `get_messages(chat, limit?, before?)` — messages in a conversation, paginated.
- `search_messages(query, chat?, limit?)` — FTS5 search across history.
- `list_contacts(query?)` — resolve names/numbers to JIDs.
- `get_new_messages()` — messages with `seen_by_llm=0`; returns them and marks
  them seen (live receive).
- `download_media(message_id)` — ensures the media is downloaded and returns its
  local file path.
- `whatsapp_status()` — connection state: `connected` / `needs_relink` /
  `qr_available`.

### Send tools (via bridge HTTP API, allowlist + two-phase confirm)

- `draft_message(to, text)` — resolves the recipient, checks the allowlist, and
  returns a `draft_id` + a human-readable preview **without sending**.
- `draft_media(to, file_path, caption?)` — same, for a media file.
- `send_draft(draft_id)` — actually performs the send; re-checks the allowlist at
  send time. Drafts are short-lived (in-memory, TTL).

## Key flows

### Linking (first run)
1. Bridge starts with no saved creds → generates a QR and prints it in its own
   terminal (`qrcode-terminal`). The QR is never served over HTTP.
2. User scans via phone: WhatsApp → Linked Devices → Link a device.
3. Creds persist to `data/auth/`; subsequent starts reconnect silently.
4. Pairing-code path (`sock.requestPairingCode(number)`) is offered as a fallback
   for headless setups.

### Live receive
- Bridge writes each incoming message with `seen_by_llm=0`.
- `get_new_messages()` returns the unseen rows and flips the flag.
- Polling-based, which is reliable over stdio; nothing is lost because every
  message is persisted regardless of whether a client is connected.

### Send guardrail
- Allowlist enforcement is **strictly numeric**: a contact's phone number in
  international format (digits only, no `+`, e.g. `5215512345678`) for 1:1 chats,
  or a group's numeric id (the digits before `@g.us`) for groups. The resolver
  converts any recipient to its numeric id before checking.
- Config entries in `data/config.json` may be **either** a bare number string
  **or** an object `{ "number": "...", "label": "..." }`. The optional `label`
  is for the operator's readability only — it is stripped at load time and never
  affects enforcement. Names are not part of the check.
- Enforced at **draft** time (reject non-allowlisted numbers early with a clear
  error) and re-checked at **send** time.
- Separately, contacts' display names are stored in the `contacts` table and
  exposed via `list_contacts`, so the LLM can address people by name and resolve
  to a number — this is orthogonal to the allowlist.

## Error handling

- **Connection drop:** Baileys `connection.update` → reconnect unless
  `DisconnectReason.loggedOut`.
- **Logged out / banned:** surface `needs_relink` via `whatsapp_status()` and
  `GET /status`; bridge stops auto-reconnecting and waits for a new link.
- **Send failures** (unregistered number, rate limit): bridge returns a
  structured error; `send_draft` surfaces it as a tool error.
- **Bridge down:** MCP query tools still work against SQLite (read-only);
  send tools and `whatsapp_status()` return a clear "bridge unavailable" error.

## Security

- Bridge HTTP server binds `127.0.0.1` only and requires a bearer token (shared
  secret in `data/config.json` or env) so no other local process can send.
- `data/` (auth creds, DB, media, config) is gitignored and treated as secret.
  The `data/auth/` folder is effectively full account access — documented in the
  README, recommend restrictive file permissions.
- Allowlist gates all sends.

## Testing (TDD)

Unit tests run against an in-memory SQLite DB and a fake bridge client:

- **Store layer:** insert/query/search/unread-tracking, FTS triggers.
- **Allowlist enforcement:** draft and send rejection paths.
- **Draft → confirm logic:** draft creation, TTL/expiry, send re-check.
- **Normalization:** Baileys message object → `messages` row for the message
  types we handle (text, image, document, audio).

The live Baileys socket is mocked in unit tests. Real-WhatsApp end-to-end
verification (link, send, receive) is a documented manual check, not part of CI.

## Project layout

```
whatsapp-mcp/
  package.json
  tsconfig.json
  src/
    bridge/
      index.ts          # entry: Baileys connection, reconnect, QR
      api.ts            # localhost HTTP command server
      ingest.ts         # incoming message/media → store
    mcp/
      index.ts          # entry: stdio MCP server
      tools/            # tool definitions (read + send)
      bridge-client.ts  # calls the bridge HTTP API
    shared/
      db.ts             # schema, migrations, WAL setup
      store.ts          # query/write helpers (shared)
      config.ts         # allowlist, token, paths
      normalize.ts      # Baileys message → row
      types.ts
  data/                 # gitignored: auth/, media/, whatsapp.db, config.json
  tests/
  README.md
```

`bridge` and `mcp` are two entry points (npm scripts: `start:bridge`,
`start:mcp`) within one package, sharing `src/shared`.

## Dependencies (confirmed current via Context7)

- `@whiskeysockets/baileys` — WhatsApp Web multi-device client.
- `@modelcontextprotocol/sdk` — MCP TypeScript SDK (stdio server).
- `better-sqlite3` — synchronous SQLite with FTS5.
- `qrcode-terminal` — render the link QR in the terminal.
- `pino` — logger required by Baileys.
- Dev: `typescript`, `tsx` (run TS entry points), `vitest` (tests).

## Phasing

Although the full scope is approved, implementation will proceed in dependency
order so each phase is independently verifiable:

1. **Foundation:** repo, schema/migrations, config, store layer (+ tests).
2. **Bridge:** Baileys connection, linking (terminal QR + pairing fallback),
   ingest to SQLite, `/status`.
3. **MCP read tools:** `list_chats`, `get_messages`, `search_messages`,
   `list_contacts`, `get_new_messages`, `whatsapp_status`.
4. **Send path:** bridge `/send` + `/send-media`, allowlist, draft/confirm tools.
5. **Media & groups:** media download/send, group resolution in read tools.
6. **Docs + manual E2E:** README (linking, config, client wiring), manual check.
