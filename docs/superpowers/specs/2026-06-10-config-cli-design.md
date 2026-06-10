# `agent-chat` config & setup CLI — Design

**Date:** 2026-06-10
**Status:** Approved (pending spec review)

## Overview

A command-line tool so users configure `@agentsoft/agent-chat` and link their
WhatsApp account without hand-editing `data/config.json`. It is the third entry
point alongside the bridge daemon and the stdio MCP server, and covers
everything *outside* the MCP tool surface: creating the config, managing the
send allowlist, the bridge token and port, and linking the account.

The CLI only reads and writes the same `data/config.json` that the bridge and
MCP server already consume, and reuses the existing WhatsApp connection code for
linking. It changes no MCP tools and no send/allowlist enforcement.

## Goals

- Replace the manual `cp data/config.example.json data/config.json` + edit step
  with `agent-chat init`.
- Manage the numeric allowlist (with optional labels) from the command line.
- Generate/rotate the bridge token and set the port without editing the file.
- Provide an explicit `agent-chat link` for account setup (QR / pairing code).

## Non-goals

- No changes to the MCP tools or to send/allowlist enforcement.
- No daemon/process management (starting the bridge/MCP stays as the existing
  `npm run start:*` scripts).
- No remote/multi-account configuration.

## Command surface

Invoked as `npm run cli -- <command>`; a `bin` entry also exposes
`agent-chat <command>` after `npm link`.

```
agent-chat init [--force]                       # create data/config.json
agent-chat link [--pair <number>]               # link the account (QR or pairing code)
agent-chat allowlist list
agent-chat allowlist add <number> [--label <name>]
agent-chat allowlist remove <number>
agent-chat token rotate                         # generate a new bridgeToken
agent-chat port <number>                        # set bridgePort
agent-chat show                                 # print current config (token redacted)
agent-chat help
```

Unknown commands / bad arguments print usage and exit non-zero.

## Components

Small, focused units under `src/cli/`:

- **`src/cli/config-store.ts`** (pure, unit-tested) — the heart of the feature.
  - Reads the **raw** JSON config, preserving labeled allowlist entries
    (`{ number, label }`) which `parseConfig` otherwise strips during
    normalization.
  - Validates any candidate config through the **existing zod schema** exported
    from `src/shared/config.ts` (re-exported as needed) *before* writing, so the
    file is never left invalid.
  - Mutators: `createDefault()`, `setPort(n)`, `rotateToken()`,
    `addAllowlist(number, label?)`, `removeAllowlist(number)`, `listAllowlist()`.
  - Writes pretty-printed JSON and sets file mode `600` (it holds the token).
  - Allowlist numbers are normalized (strip non-digits) before storing; `add`
    dedupes by normalized number (updating the label if re-added); `remove`
    matches the normalized number.

- **`src/cli/commands.ts`** — thin command handlers mapping each command to
  `config-store` calls and console output. `init` (and its optional first-entry
  prompt) uses Node's built-in `readline/promises`; all other commands are
  non-interactive.

- **`src/cli/link.ts`** — reuses `startWhatsApp(authDir, onEvent, pairingNumber?)`
  from `src/bridge/whatsapp.ts` with a no-op `onEvent`, polls `handle.status()`
  until `connected`, prints a success line and exits `0`. The QR is already
  printed to the terminal by `startWhatsApp`; `--pair <number>` routes through
  the pairing-code path. Times out (e.g. 120s) with a clear message.

- **`src/cli/index.ts`** — entry point. Shebang `#!/usr/bin/env -S npx tsx`,
  parses argv with **`node:util.parseArgs`** (no new dependency), dispatches to
  handlers, prints help/usage, exits non-zero on error.

### Raw config shape

`config-store` works with a raw type that keeps labels (distinct from the
normalized `AppConfig`):

```ts
type RawAllowlistEntry = string | { number: string; label?: string };
interface RawConfig {
  allowlist: RawAllowlistEntry[];
  bridgeToken: string;
  bridgePort: number;
}
```

`add` stores `{ number, label }` when a label is given, otherwise a bare numeric
string, for a clean file.

## Behavior details

- **`init`**: refuses to overwrite an existing `data/config.json` unless
  `--force`. Generates `bridgeToken` via
  `crypto.randomBytes(24).toString("base64url")`. Prompts for the port
  (default `7766`) and optionally to add a first allowlist entry
  (number + optional label). Creates the `data/` directory if missing. Writes
  `chmod 600`.
- **`token rotate`**: replaces `bridgeToken` and prints a reminder that the
  running bridge and the MCP client must be restarted to pick up the new token.
- **`port <number>`**: validates a positive integer; updates `bridgePort`.
- **`allowlist add/remove/list`**: operate on the raw allowlist, preserving
  labels; `list` prints `<number>  <label>` rows (or "(no entries)").
- **`link`**: explicit linking; the bridge still auto-shows the QR when started
  unlinked, so this is additive — nothing existing breaks.
- **`show`**: prints port, token redacted as `••••` (only whether it is set),
  and the allowlist.

## Errors & security

- Missing config on a command that needs one → actionable error:
  `No config found. Run 'agent-chat init' first.` (exit non-zero).
- Invalid number on `allowlist add` / invalid port → clear validation error.
- The candidate config is re-validated through the schema **before** writing;
  on failure the existing file is left untouched.
- Config is written with mode `600`. `show` never prints the raw token.

## Testing (TDD)

Unit tests for `config-store` against a temp file/dir:

- `init`/`createDefault` produces a schema-valid config with a non-empty token
  and default port.
- `addAllowlist` stores `{ number, label }`, normalizes the number, and dedupes
  (re-adding updates the label, not a duplicate row).
- Labels survive a read → write → read round-trip.
- `removeAllowlist` matches a normalized number (e.g. `+52 1 55…` removes
  `52155…`).
- `rotateToken` changes the token and keeps the result schema-valid.
- `setPort` rejects non-positive / non-integer input.
- Writing rejects a candidate that fails schema validation, leaving the prior
  file intact.

The interactive `init` prompts and `link` are thin adapters verified by `tsc`
and the manual end-to-end checklist (they need a TTY / a real phone).

## Files

```
src/cli/
  index.ts          # argv parsing (node:util.parseArgs) + dispatch + help
  commands.ts       # command handlers (init prompts via readline/promises)
  config-store.ts   # raw read/validate/write + mutators (pure, tested)
  link.ts           # account linking via bridge/whatsapp.ts
tests/cli/
  config-store.test.ts
```

`package.json` gains a `cli` script (`tsx src/cli/index.ts`) and a `bin`
(`agent-chat` → `src/cli/index.ts`). `src/shared/config.ts` exports its zod
schema so `config-store` can validate without duplicating it.

## Docs

README setup section changes from `cp … && edit` to:

```bash
npm run cli -- init     # generates the token, sets the port, optional first contact
npm run cli -- link     # scan the QR to link your account
```

Allowlist/token/port management documented under a short "Configuration" heading.
