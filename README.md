# @agentsoft/agent-chat

An MCP server for a **personal** (non-business) WhatsApp account via
[Baileys](https://github.com/WhiskeySockets/Baileys). Two processes:

- an always-on **bridge** daemon that owns the WhatsApp connection and writes
  every message/contact/media to a local SQLite database, and
- a stdio **MCP server** that your AI client spawns — it reads that database for
  queries and calls the bridge to send.

> ⚠️ **Read this first.** This uses an unofficial library against a personal
> number, which violates WhatsApp's Terms of Service and **can get the number
> banned** — especially under high volume or spam-like patterns. Use a number you
> accept that risk on, and don't bulk-message. The `data/` folder holds your
> session credentials (effectively full account access): treat it like a
> password — `chmod 700 data`.

## Architecture

```
AI client ──stdio──► MCP server ──HTTP(127.0.0.1 + token)──► Bridge daemon (Baileys, always-on)
                          │                                        │
                          └──────────► SQLite (better-sqlite3) ◄────┘
                                       chats · messages · contacts · FTS5
                                       data/media/*  (media files on disk)
```

## Setup

```bash
npm install
npm run cli -- init      # generates the bridge token, sets the port, optional first contact
```

`init` writes `data/config.json` (mode 600). Manage it later with the CLI rather
than editing the file by hand:

```bash
npm run cli -- allowlist add <number> [--label <name>]
npm run cli -- allowlist remove <number>
npm run cli -- allowlist list
npm run cli -- token rotate          # then restart the bridge + MCP client
npm run cli -- port <number>
npm run cli -- show                  # token redacted
```

After `npm link`, the same commands are available as `agent-chat <command>`.

## Run

1. **Link your account** (scan the QR with your phone via WhatsApp → Linked
   Devices → Link a device):

   ```bash
   npm run cli -- link            # or: npm run cli -- link --pair <number>
   ```

   Credentials are saved to `data/auth/`. Then start the always-on bridge
   (which reconnects silently once linked):

   ```bash
   npm run start:bridge
   ```

2. **Point your MCP client at the server** (stdio). Example client config:

   ```json
   {
     "mcpServers": {
       "agent-chat": {
         "command": "npx",
         "args": ["tsx", "src/mcp/index.ts"],
         "cwd": "ABSOLUTE/PATH/TO/whatsapp-mcp"
       }
     }
   }
   ```

## Tools

Read (always allowed): `list_chats`, `get_messages`, `search_messages`,
`list_contacts`, `get_new_messages`, `whatsapp_status`, `download_media`.

Send (numeric allowlist + two-phase confirm): `draft_message` → `send_draft`,
and `draft_media` → `send_draft`. Sending is deliberately two-step: a draft tool
returns a `draftId` and a preview without sending; `send_draft` then performs the
send and re-checks the allowlist.

## Use it from Claude Code

Register the MCP server with Claude Code (user scope) straight from the CLI:

```bash
npm run cli -- install claude-code     # runs `claude mcp add` under the hood
# restart Claude Code — the WhatsApp tools are now available
npm run cli -- uninstall claude-code   # to remove it
```

`agent-chat install` with no argument lists the supported agents. Scope defaults
to `--scope user`; the alternatives are `--scope project` (a `.mcp.json` in the
current directory) or `--scope local`.

Requirements: the `claude` CLI must be on your `PATH`, and this repo must stay in
place (the server is registered to run from here, with `AGENT_CHAT_HOME` pointing
at it so it finds your `data/`). Run `agent-chat init` (and `link`) first.

## Verifying it works (manual end-to-end)

These require a real phone and a test number on your allowlist:

1. `npm test` — all unit tests pass.
2. `npm run start:bridge`, scan the QR. Confirm the terminal shows it connected.
3. From your phone, message the linked account. Confirm a row appears:
   `sqlite3 data/whatsapp.db "select id,text from messages order by ts desc limit 3"`.
4. Run the MCP server from your client; call `whatsapp_status` → connected;
   `get_new_messages` → returns the test message.
5. `draft_message` to an allowlisted number, then `send_draft` — confirm it
   arrives. Confirm `draft_message` to a non-allowlisted number is rejected.
6. Send an image from the phone; call `download_media` with its message id;
   confirm the returned path exists and opens.

## Development

```bash
npm test                      # run the vitest suite
npx tsc -p tsconfig.json --noEmit   # type-check
```

Pure logic (store, normalization, allowlist, drafts, config) is unit-tested; the
Baileys connection and HTTP/stdio adapters are verified by type-checking and the
manual end-to-end checklist above.
