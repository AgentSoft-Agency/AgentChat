# Live re-link + `logout` — design

## Problem

Re-linking the WhatsApp account today is a tedious multi-step chore. When the
linked device is removed (`device_removed` / 401 → `needs_relink`), the saved
credentials in `data/auth/` are dead but still `registered`, so reconnecting
with them just yields another 401 and never shows a fresh QR. Recovering
currently means: stop the bridge, manually move `data/auth/` aside, run
`agent-chat link` (a standalone socket), then restart the bridge so it loads the
new session.

There is also no way to deliberately log out (e.g. to switch numbers or for
security) — the only path is editing files by hand.

## Goals

- One command to re-link, with **zero bridge restart** and **zero manual file
  surgery**. The QR renders in the terminal where the command is run.
- Re-linking is folded into the existing `agent-chat link` command — there is
  **no** separate `relink` command.
- A new `agent-chat logout` command that properly unlinks the device from the
  WhatsApp account and clears the local session.

## Non-goals

- Changing read/send tools, the MCP server, the allowlist, or the message store.
- Restarting/managing the bridge process from the CLI (PM2, systemd, etc.). The
  re-link happens *inside* the already-running bridge, so no process management
  is needed.
- Backing up `data/auth/` on logout. Logout is a deliberate action; the session
  is deleted outright. The message DB and media on disk are untouched.

## Behavior

```bash
agent-chat link      # bridge running → live re-link, zero restart, QR in this terminal
                     # bridge down    → today's standalone link flow (unchanged)
agent-chat logout    # bridge running → unlink from WhatsApp (sock.logout) + clear session
                     # bridge down    → clear local session only
```

`link` probes the bridge (`GET /status`) and branches:

- **Reachable + already `connected`** → print "already linked; run
  `agent-chat logout` first to switch" and exit 0. No surprise re-link.
- **Reachable + not connected** (`needs_relink` / `connecting` / `qr_available`)
  → drive a live re-link through the bridge (below).
- **Not reachable** (connection refused) → fall back to the existing standalone
  link flow, unchanged. `--pair <number>` works in both paths.

`logout`:

- **Bridge reachable** → `POST /logout`; the bridge calls `sock.logout()` (which
  removes the device from the phone's Linked Devices list), then clears its auth
  and settles in `needs_relink`.
- **Bridge not reachable** → the CLI clears `data/auth/` directly and warns that,
  because no live socket was available to log out server-side, the device may
  linger in the phone's Linked Devices list until WhatsApp expires it.

## Components

### Bridge: `src/bridge/whatsapp.ts`

Extend `WhatsAppHandle` with two methods. The auth state, currently captured
once at startup (`const { state, saveCreds } = await useMultiFileAuthState`),
becomes reassignable so it can be replaced after the dir is cleared.

- `relink(): Promise<void>` — clear `data/auth/` on disk, re-init a fresh empty
  auth state via `useMultiFileAuthState`, tear down the current socket, and call
  `connect()` again. With `creds.registered === false`, Baileys emits a fresh QR,
  surfaced through the existing `lastQr()`.
- `logout(): Promise<void>` — if currently `connected`, call `sock.logout()`,
  then clear auth and settle in `needs_relink`; if not connected, just clear
  auth. Does not auto-reconnect.

**Reconnect guard (the tricky part):** the existing `connection.update` close
handler auto-reconnects on any non-`loggedOut` close (`whatsapp.ts:39`). During an
intentional `relink()`/`logout()` the dying old socket must not trigger a rogue
reconnect. Introduce a guard (an `intentional` flag or a socket generation
counter) so a close caused by a deliberate teardown is ignored by the
auto-reconnect path.

**Auth-clearing helper:** a small function that removes the contents of the auth
dir (then `useMultiFileAuthState` recreates it). Shared by `relink()` and the
CLI's bridge-down `logout` path so the behavior is identical.

### Bridge: `src/bridge/api.ts`

Three new endpoints, all **authenticated** (`Bearer` token), added alongside the
existing send/media routes:

- `POST /relink` → `await deps.relink()` → `200 { ok: true }`
- `POST /logout` → `await deps.logout()` → `200 { ok: true }`
- `GET /qr` → `200 { state, qr }` so the CLI can render the QR.

`/status` stays QR-less and unauthenticated, consistent with the existing
security note (`api.ts:28`): the QR is a linking credential and must only be
served over the authenticated `/qr`. Errors continue to fall through to the
existing `catch` → 500 handler.

### Bridge: `src/bridge/index.ts`

Wire `relink: () => handle.relink()` and `logout: () => handle.logout()` into the
`createBridgeApi` deps. `deps.status()` already returns `{ state, qr }`; `/qr`
reuses it.

### CLI: `src/cli/link.ts`

`runLink(paths, pairingNumber?)` is rewritten to:

1. `loadConfig(configFile)` for port + token; build a small HTTP client
   (reuse/extend the pattern in `src/mcp/bridge-client.ts`).
2. Probe `GET /status`.
3. Branch per **Behavior** above. Live path: `POST /relink` (passing
   `pairingNumber` when `--pair` is set), poll `GET /qr` and render with
   `qrcode-terminal` (re-render when the QR rotates), poll `GET /status` until
   `connected` (120s timeout, matching the current standalone timeout). For
   `--pair`, the bridge requests the pairing code on the new socket and the CLI
   prints it.
4. Standalone fallback path = the current `startWhatsApp` logic, unchanged.

### CLI: `src/cli/index.ts`

Add a `logout` case to the dispatch switch and a line to the `HELP` text. `link`
keeps its existing `--pair` option parsing.

## Error handling

- **Bridge probe:** connection-refused → treat as "bridge down" and take the
  standalone/local path. Any other error surfaces with a clear message.
- **Live re-link timeout:** if not `connected` within 120s, exit non-zero with
  "timed out waiting to link — re-run `agent-chat link`", matching today's
  standalone behavior.
- **`logout` while not connected:** the bridge clears auth without calling
  `sock.logout()` (nothing to log out); no error.
- **Auth-clearing race:** the reconnect guard prevents the auto-reconnect path
  from racing a deliberate teardown.

## Testing

- **Unit (vitest):** the bridge-up-vs-down branching in `runLink`/`logout`
  (driven by a fake bridge client), and the auth-clearing helper (clears a temp
  dir).
- **Type-check + manual E2E:** the Baileys socket methods (`relink`, `logout`)
  follow the repo convention that the live connection and HTTP/stdio adapters are
  verified by `tsc --noEmit` and the manual checklist. Add to the README's
  "Verifying it works" checklist:
  - From a `needs_relink` state, run `agent-chat link` with the bridge up →
    QR appears in the terminal → scan → status returns to `connected`, no restart.
  - `agent-chat logout` with the bridge up → device disappears from the phone's
    Linked Devices list; status is `needs_relink`.

## Docs

Update `README.md`: the "Run" section to describe `link`'s live-re-link behavior
when the bridge is running, and add `agent-chat logout` to the command list.
