# Live re-link + `logout` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `agent-chat link` re-link a live, already-running bridge with zero restart, and add an `agent-chat logout` command that unlinks the device from WhatsApp and clears the local session.

**Architecture:** The running bridge gains `relink()`/`logout()` methods on its WhatsApp handle and three new authenticated HTTP endpoints (`POST /relink`, `POST /logout`, `GET /qr`). The CLI `link`/`logout` commands probe the bridge over HTTP and branch: drive the live endpoints when the bridge is up, fall back to the existing standalone flow (link) or a direct local auth-clear (logout) when it is down. Branch decisions are extracted into pure, unit-tested helpers.

**Tech Stack:** TypeScript (NodeNext ESM, run via `tsx`), Node ≥ 24, Baileys (`@whiskeysockets/baileys`), `qrcode-terminal`, Node `http`, vitest.

## Global Constraints

- **ESM import extensions:** local module imports use the `.js` extension even for `.ts` files (NodeNext), e.g. `import { paths } from "../shared/paths.js"`. Copy this exactly.
- **Commits:** Conventional Commits format is enforced by the `commit-msg` hook (`<type>(<scope>): <subject>`). The `pre-commit` hook runs `npm run typecheck && npm test` — every commit must leave typecheck and the full vitest suite green.
- **QR is a linking credential:** it is served **only** over the authenticated `GET /qr`. `GET /status` stays unauthenticated and never includes the QR.
- **No scope creep:** do not change the read/send tools, the MCP server, the allowlist, or the message store/DB.
- **Commit footer:** end each commit message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- `src/shared/auth.ts` — **new.** `clearAuthDir(authDir)` helper, shared by the bridge (`relink`/`logout`) and the CLI's bridge-down `logout` path.
- `src/bridge/whatsapp.ts` — **modify.** Reassignable auth state + pairing number, a reconnect guard (generation counter), and new `relink()` / `logout()` / `lastPairingCode()` on the handle.
- `src/bridge/api.ts` — **modify.** `relink`/`logout` added to `BridgeDeps`; new `POST /relink`, `POST /logout`, authenticated `GET /qr`.
- `src/bridge/index.ts` — **modify.** Wire `relink`/`logout` and `pairingCode` into the API deps.
- `src/cli/relink-actions.ts` — **new.** Pure `decideLinkAction` / `decideLogoutAction` branch helpers.
- `src/cli/bridge-control.ts` — **new.** HTTP client for the CLI: `probe`, `relink`, `logout`, `fetchQr`.
- `src/cli/link.ts` — **modify.** `runLink` probes the bridge and branches (already-linked / live-relink / standalone fallback).
- `src/cli/logout.ts` — **new.** `runLogout` command.
- `src/cli/index.ts` — **modify.** Update the `link` call site; add the `logout` dispatch case + help text.
- `README.md` — **modify.** Document live re-link and the `logout` command; extend the manual E2E checklist.

---

## Task 1: `clearAuthDir` shared helper

**Files:**
- Create: `src/shared/auth.ts`
- Test: `tests/shared/auth.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `clearAuthDir(authDir: string): void` — removes every entry inside `authDir` (files and subdirs) but leaves the directory itself; a no-op if the directory does not exist.

- [ ] **Step 1: Write the failing test**

Create `tests/shared/auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearAuthDir } from "../../src/shared/auth.js";

describe("clearAuthDir", () => {
  it("removes all contents but keeps the directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "auth-"));
    writeFileSync(join(dir, "creds.json"), "{}");
    mkdirSync(join(dir, "keys"));
    writeFileSync(join(dir, "keys", "k.json"), "{}");

    clearAuthDir(dir);

    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("is a no-op when the directory does not exist", () => {
    const dir = join(tmpdir(), "auth-does-not-exist-xyz");
    expect(() => clearAuthDir(dir)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/auth.test.ts`
Expected: FAIL — cannot resolve `../../src/shared/auth.js` / `clearAuthDir is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/auth.ts`:

```ts
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Remove everything inside `authDir`, leaving the directory itself in place. */
export function clearAuthDir(authDir: string): void {
  if (!existsSync(authDir)) return;
  for (const entry of readdirSync(authDir)) {
    rmSync(join(authDir, entry), { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/auth.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/auth.ts tests/shared/auth.test.ts
git commit -m "feat(shared): add clearAuthDir helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Bridge handle — `relink()`, `logout()`, reconnect guard

**Files:**
- Modify: `src/bridge/whatsapp.ts`

**Interfaces:**
- Consumes: `clearAuthDir` from Task 1.
- Produces: an extended `WhatsAppHandle`:
  - `relink: (pairingNumber?: string) => Promise<void>` — clear auth, start a fresh socket, emit a new QR (or pairing code).
  - `logout: () => Promise<void>` — `sock.logout()` when connected, then clear auth; settle in `needs_relink`.
  - `lastPairingCode: () => string | null` — the most recent pairing code, or null.
  - (existing `sock`, `status`, `lastQr` unchanged.)

> **Verification convention:** this task touches the live Baileys socket, which the repo verifies by type-check + the manual E2E checklist (see Task 9), not unit tests. There is no failing-test step; the gate is `npm run typecheck` plus the existing suite staying green.

- [ ] **Step 1: Replace the body of `src/bridge/whatsapp.ts`**

Replace the entire file with:

```ts
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import pino from "pino";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import { clearAuthDir } from "../shared/auth.js";

export interface WhatsAppHandle {
  sock: () => WASocket; // getter — returns the CURRENT socket (changes across reconnects)
  status: () => "connecting" | "qr_available" | "connected" | "needs_relink";
  lastQr: () => string | null;
  lastPairingCode: () => string | null;
  relink: (pairingNumber?: string) => Promise<void>;
  logout: () => Promise<void>;
}

export async function startWhatsApp(
  authDir: string,
  onEvent: (sock: WASocket) => void,
  pairingNumber?: string
): Promise<WhatsAppHandle> {
  const logger = pino({ level: "warn" }) as unknown as ILogger;
  let state: "connecting" | "qr_available" | "connected" | "needs_relink" = "connecting";
  let lastQr: string | null = null;
  let lastPairingCode: string | null = null;
  let current: WASocket;
  let pairing = pairingNumber;
  // Each socket owns a generation; only the newest generation's close handler
  // is allowed to auto-reconnect. A deliberate teardown (relink/logout) bumps
  // the counter first, so the dying socket's close event becomes a no-op.
  let generation = 0;

  let { state: authState, saveCreds } = await useMultiFileAuthState(authDir);

  const connect = async (): Promise<WASocket> => {
    const myGen = ++generation;
    const sock = makeWASocket({ auth: authState, logger });
    current = sock;
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (u) => {
      if (u.qr) { lastQr = u.qr; state = "qr_available"; qrcode.generate(u.qr, { small: true }); }
      if (u.connection === "open") { state = "connected"; lastQr = null; lastPairingCode = null; }
      if (u.connection === "close") {
        if (myGen !== generation) return; // superseded by a deliberate relink/logout
        const code = (u.lastDisconnect?.error as Boom)?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) { state = "needs_relink"; }
        else { state = "connecting"; lastQr = null; void connect(); }
      }
    });
    onEvent(sock);
    if (pairing && !authState.creds.registered) {
      const num = pairing.replace(/[^0-9]/g, "");
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(num);
          lastPairingCode = code;
          console.error(`Pairing code for ${num}: ${code}`);
        } catch (e) {
          console.error("pairing code request failed:", e);
        }
      }, 3000);
    }
    return sock;
  };

  const relink = async (newPairing?: string): Promise<void> => {
    generation++;                       // disarm the current socket's reconnect
    try { current?.end?.(undefined); } catch { /* already closed */ }
    clearAuthDir(authDir);
    ({ state: authState, saveCreds } = await useMultiFileAuthState(authDir));
    if (newPairing) pairing = newPairing;
    lastQr = null;
    lastPairingCode = null;
    state = "connecting";
    await connect();                    // fresh socket emits a new QR / pairing code
  };

  const logout = async (): Promise<void> => {
    generation++;                       // disarm the current socket's reconnect
    if (state === "connected") {
      try { await current.logout(); } catch { /* best effort */ }
    } else {
      try { current?.end?.(undefined); } catch { /* already closed */ }
    }
    clearAuthDir(authDir);
    ({ state: authState, saveCreds } = await useMultiFileAuthState(authDir));
    lastQr = null;
    lastPairingCode = null;
    state = "needs_relink";
  };

  await connect();
  return {
    sock: () => current,
    status: () => state,
    lastQr: () => lastQr,
    lastPairingCode: () => lastPairingCode,
    relink,
    logout,
  };
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `npm run typecheck`
Expected: no errors. (`index.ts` still compiles — it consumes only the unchanged `sock`/`status`/`lastQr`.)

- [ ] **Step 3: Verify the existing suite still passes**

Run: `npm test`
Expected: all existing tests pass (88 currently).

- [ ] **Step 4: Commit**

```bash
git add src/bridge/whatsapp.ts
git commit -m "feat(bridge): add live relink/logout to the WhatsApp handle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Bridge API — `/relink`, `/logout`, `/qr` endpoints + index wiring

**Files:**
- Modify: `src/bridge/api.ts`
- Modify: `src/bridge/index.ts`
- Test: `tests/bridge/api.test.ts`

**Interfaces:**
- Consumes: `handle.relink`, `handle.logout`, `handle.lastPairingCode` from Task 2.
- Produces: `BridgeDeps` gains `relink: (pairingNumber?: string) => Promise<void>` and `logout: () => Promise<void>`; `status` return type widens to `{ state: string; qr?: string | null; pairingCode?: string | null }`. New routes: `POST /relink` (auth, body `{ pair?: string }`), `POST /logout` (auth), `GET /qr` (auth) → `{ state, qr, pairingCode }`.

- [ ] **Step 1: Write the failing tests**

Append these tests inside the `describe("bridge api", ...)` block in `tests/bridge/api.test.ts`. They use a `baseDeps` helper so the new required fields are set once; add the helper just below the `call` function:

```ts
function baseDeps(overrides: Partial<Parameters<typeof createBridgeApi>[0]> = {}) {
  return {
    token: "secret",
    sendText: async () => "i",
    sendMedia: async () => "i",
    downloadMedia: async () => "/x",
    status: () => ({ state: "connected", qr: null, pairingCode: null }),
    relink: async () => {},
    logout: async () => {},
    ...overrides,
  };
}

async function get(port: number, path: string, token?: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
```

```ts
it("POST /relink requires the token and forwards the pair option", async () => {
  const calls: Array<string | undefined> = [];
  server = createBridgeApi(baseDeps({ relink: async (p?: string) => { calls.push(p); } })).listen(0);
  const port = (server.address() as any).port;

  const unauth = await call(port, "/relink", {});
  expect(unauth.status).toBe(401);

  const ok = await call(port, "/relink", { pair: "5215512345678" }, "secret");
  expect(ok.status).toBe(200);
  expect(ok.json).toEqual({ ok: true });
  expect(calls).toEqual(["5215512345678"]);
});

it("POST /logout requires the token and calls logout", async () => {
  let called = false;
  server = createBridgeApi(baseDeps({ logout: async () => { called = true; } })).listen(0);
  const port = (server.address() as any).port;

  const unauth = await call(port, "/logout", {});
  expect(unauth.status).toBe(401);
  expect(called).toBe(false);

  const ok = await call(port, "/logout", {}, "secret");
  expect(ok.status).toBe(200);
  expect(called).toBe(true);
});

it("GET /qr requires the token and returns the QR + pairing code", async () => {
  server = createBridgeApi(baseDeps({
    status: () => ({ state: "qr_available", qr: "QRDATA", pairingCode: "ABCD-1234" }),
  })).listen(0);
  const port = (server.address() as any).port;

  const unauth = await get(port, "/qr");
  expect(unauth.status).toBe(401);

  const ok = await get(port, "/qr", "secret");
  expect(ok.status).toBe(200);
  expect(ok.json).toEqual({ state: "qr_available", qr: "QRDATA", pairingCode: "ABCD-1234" });
});

it("GET /status never exposes the QR", async () => {
  server = createBridgeApi(baseDeps({
    status: () => ({ state: "qr_available", qr: "QRDATA", pairingCode: "ABCD-1234" }),
  })).listen(0);
  const port = (server.address() as any).port;
  const r = await get(port, "/status");
  expect(r.status).toBe(200);
  expect(r.json).toEqual({ state: "qr_available" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/bridge/api.test.ts`
Expected: the 4 new tests FAIL (routes return 404 / missing `relink`/`logout` typed deps); the 3 existing tests still pass.

- [ ] **Step 3: Update `BridgeDeps` and add the routes in `src/bridge/api.ts`**

Replace the `BridgeDeps` interface and the request handler. The new interface:

```ts
export interface BridgeDeps {
  token: string;
  sendText: (jid: string, text: string) => Promise<string>;
  sendMedia: (jid: string, filePath: string, caption?: string) => Promise<string>;
  status: () => { state: string; qr?: string | null; pairingCode?: string | null };
  downloadMedia: (messageId: string) => Promise<string>;
  relink: (pairingNumber?: string) => Promise<void>;
  logout: () => Promise<void>;
}
```

Inside `createBridgeApi`, the handler body becomes (note `GET /status` stays before the auth check; `GET /qr` and the new POSTs are after it):

```ts
    try {
      if (req.method === "GET" && req.url === "/status") {
        // Only expose connection state, never the raw QR (a linking credential),
        // on this unauthenticated endpoint. The authenticated /qr serves the QR.
        const { state } = deps.status();
        return send(200, { state });
      }
      if (req.headers.authorization !== `Bearer ${deps.token}`) {
        return send(401, { error: "unauthorized" });
      }
      if (req.method === "GET" && req.url === "/qr") {
        const { state, qr = null, pairingCode = null } = deps.status();
        return send(200, { state, qr, pairingCode });
      }
      const body = await readJson(req);
      if (req.method === "POST" && req.url === "/relink") {
        await deps.relink(body.pair);
        return send(200, { ok: true });
      }
      if (req.method === "POST" && req.url === "/logout") {
        await deps.logout();
        return send(200, { ok: true });
      }
      if (req.method === "POST" && req.url === "/send") {
        const id = await deps.sendText(body.to, body.text);
        return send(200, { id });
      }
      if (req.method === "POST" && req.url === "/send-media") {
        const id = await deps.sendMedia(body.to, body.filePath, body.caption);
        return send(200, { id });
      }
      if (req.method === "POST" && req.url === "/download-media") {
        const path = await deps.downloadMedia(body.messageId);
        return send(200, { path });
      }
      return send(404, { error: "not found" });
    } catch (err: any) {
      return send(500, { error: String(err?.message ?? err) });
    }
```

- [ ] **Step 4: Wire the new deps in `src/bridge/index.ts`**

In the `createBridgeApi({ ... })` call, change the `status` line and add `relink`/`logout`:

```ts
  status: () => ({ state: handle.status(), qr: handle.lastQr(), pairingCode: handle.lastPairingCode() }),
  relink: (pairingNumber?: string) => handle.relink(pairingNumber),
  logout: () => handle.logout(),
```

(Place `relink`/`logout` alongside the other deps, e.g. after `downloadMedia`.)

- [ ] **Step 5: Run tests + type-check to verify they pass**

Run: `npx vitest run tests/bridge/api.test.ts && npm run typecheck`
Expected: all api tests PASS (7 total); type-check clean.

- [ ] **Step 6: Commit**

```bash
git add src/bridge/api.ts src/bridge/index.ts tests/bridge/api.test.ts
git commit -m "feat(bridge): add /relink, /logout, and authenticated /qr endpoints

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: CLI branch-decision helpers (pure)

**Files:**
- Create: `src/cli/relink-actions.ts`
- Test: `tests/cli/relink-actions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type LinkAction = "already-linked" | "live-relink" | "standalone"`
  - `decideLinkAction(probe: { reachable: boolean; state?: string }): LinkAction`
  - `type LogoutAction = "bridge-logout" | "local-clear"`
  - `decideLogoutAction(reachable: boolean): LogoutAction`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/relink-actions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { decideLinkAction, decideLogoutAction } from "../../src/cli/relink-actions.js";

describe("decideLinkAction", () => {
  it("falls back to standalone when the bridge is unreachable", () => {
    expect(decideLinkAction({ reachable: false })).toBe("standalone");
  });
  it("reports already-linked when reachable and connected", () => {
    expect(decideLinkAction({ reachable: true, state: "connected" })).toBe("already-linked");
  });
  it("live-relinks when reachable but not connected", () => {
    expect(decideLinkAction({ reachable: true, state: "needs_relink" })).toBe("live-relink");
    expect(decideLinkAction({ reachable: true, state: "connecting" })).toBe("live-relink");
  });
});

describe("decideLogoutAction", () => {
  it("logs out via the bridge when reachable", () => {
    expect(decideLogoutAction(true)).toBe("bridge-logout");
  });
  it("clears locally when the bridge is down", () => {
    expect(decideLogoutAction(false)).toBe("local-clear");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/relink-actions.test.ts`
Expected: FAIL — cannot resolve `../../src/cli/relink-actions.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/cli/relink-actions.ts`:

```ts
export type LinkAction = "already-linked" | "live-relink" | "standalone";

export function decideLinkAction(probe: { reachable: boolean; state?: string }): LinkAction {
  if (!probe.reachable) return "standalone";
  return probe.state === "connected" ? "already-linked" : "live-relink";
}

export type LogoutAction = "bridge-logout" | "local-clear";

export function decideLogoutAction(reachable: boolean): LogoutAction {
  return reachable ? "bridge-logout" : "local-clear";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/relink-actions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/relink-actions.ts tests/cli/relink-actions.test.ts
git commit -m "feat(cli): add link/logout branch-decision helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: CLI bridge-control HTTP client

**Files:**
- Create: `src/cli/bridge-control.ts`

**Interfaces:**
- Consumes: nothing (talks to the bridge over HTTP).
- Produces:
  - `interface BridgeControl { probe(): Promise<{ reachable: boolean; state?: string }>; relink(pair?: string): Promise<void>; logout(): Promise<void>; fetchQr(): Promise<{ state: string; qr: string | null; pairingCode: string | null }>; }`
  - `httpBridgeControl(port: number, token: string): BridgeControl`

> **Verification convention:** this is a network adapter (like `src/mcp/bridge-client.ts`, which has no unit test). It is verified by type-check + the manual E2E checklist (Task 9), so there is no failing-test step.

- [ ] **Step 1: Create `src/cli/bridge-control.ts`**

```ts
export interface BridgeControl {
  /** GET /status; reachable:false when the bridge isn't listening. */
  probe: () => Promise<{ reachable: boolean; state?: string }>;
  relink: (pair?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** GET /qr (authenticated). */
  fetchQr: () => Promise<{ state: string; qr: string | null; pairingCode: string | null }>;
}

export function httpBridgeControl(port: number, token: string): BridgeControl {
  const base = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${token}` };
  const postJson = { "content-type": "application/json", ...auth };

  const post = async (path: string, body: unknown) => {
    const res = await fetch(base + path, { method: "POST", headers: postJson, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`bridge ${path} failed: ${res.status}`);
  };

  return {
    probe: async () => {
      try {
        const res = await fetch(base + "/status");
        if (!res.ok) return { reachable: false };
        const { state } = (await res.json()) as { state?: string };
        return { reachable: true, state };
      } catch {
        return { reachable: false }; // connection refused → bridge is down
      }
    },
    relink: async (pair?: string) => { await post("/relink", pair ? { pair } : {}); },
    logout: async () => { await post("/logout", {}); },
    fetchQr: async () => {
      const res = await fetch(base + "/qr", { headers: auth });
      if (!res.ok) throw new Error(`bridge /qr failed: ${res.status}`);
      return (await res.json()) as { state: string; qr: string | null; pairingCode: string | null };
    },
  };
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli/bridge-control.ts
git commit -m "feat(cli): add bridge-control HTTP client

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Rewrite `runLink` — live re-link + standalone fallback

**Files:**
- Modify: `src/cli/link.ts`
- Modify: `src/cli/index.ts` (update the `link` call site)

**Interfaces:**
- Consumes: `decideLinkAction` (Task 4), `httpBridgeControl` (Task 5), `loadConfig` (`src/shared/config.ts`), `Paths` (`src/shared/paths.ts`), `startWhatsApp` (Task 2).
- Produces: `runLink(p: Paths, pairingNumber?: string): Promise<void>` (signature changes from `(authDir, pairingNumber)`).

> **Verification convention:** orchestration over the network + live socket — verified by type-check + the manual E2E checklist (Task 9). The branch logic it relies on is already unit-tested in Task 4.

- [ ] **Step 1: Replace the body of `src/cli/link.ts`**

```ts
import qrcode from "qrcode-terminal";
import type { Paths } from "../shared/paths.js";
import { loadConfig } from "../shared/config.js";
import { httpBridgeControl, type BridgeControl } from "./bridge-control.js";
import { decideLinkAction } from "./relink-actions.js";
import { startWhatsApp } from "../bridge/whatsapp.js";

const LINK_TIMEOUT_MS = 120_000;

export async function runLink(p: Paths, pairingNumber?: string): Promise<void> {
  const config = loadConfig(p.configFile);
  const ctl = httpBridgeControl(config.bridgePort, config.bridgeToken);
  const probe = await ctl.probe();
  const action = decideLinkAction(probe);

  if (action === "already-linked") {
    console.log("Already linked. Run 'agent-chat logout' first to link a different account.");
    return;
  }
  if (action === "live-relink") {
    await liveRelink(ctl, pairingNumber);
    return;
  }
  await standaloneLink(p.authDir, pairingNumber);
}

/** Drive a re-link through the already-running bridge — no restart. */
async function liveRelink(ctl: BridgeControl, pairingNumber?: string): Promise<void> {
  console.log(
    pairingNumber
      ? `Requesting a pairing code for ${pairingNumber} on the running bridge…`
      : "Re-linking the running bridge — scan the QR below with WhatsApp → Linked Devices → Link a device."
  );
  await ctl.relink(pairingNumber);

  const deadline = Date.now() + LINK_TIMEOUT_MS;
  let shownQr: string | null = null;
  let shownPair: string | null = null;
  while (Date.now() < deadline) {
    const q = await ctl.fetchQr();
    if (q.state === "connected") {
      console.log("✅ linked successfully.");
      return;
    }
    if (q.qr && q.qr !== shownQr) { shownQr = q.qr; qrcode.generate(q.qr, { small: true }); }
    if (q.pairingCode && q.pairingCode !== shownPair) {
      shownPair = q.pairingCode;
      console.log(`Pairing code: ${q.pairingCode}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("timed out after 120s waiting to link. Re-run 'agent-chat link'.");
}

/** Bridge not running: link a standalone socket (the original flow). */
async function standaloneLink(authDir: string, pairingNumber?: string): Promise<void> {
  console.log(
    pairingNumber
      ? `Requesting a pairing code for ${pairingNumber}…`
      : "Linking — scan the QR below with WhatsApp → Linked Devices → Link a device."
  );
  const handle = await startWhatsApp(authDir, () => {}, pairingNumber);
  const deadline = Date.now() + LINK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const s = handle.status();
    if (s === "connected") {
      console.log("✅ linked successfully.");
      process.exit(0);
    }
    if (s === "needs_relink") {
      console.error("❌ logged out before linking completed — re-run 'agent-chat link'.");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error("❌ timed out after 120s waiting to link. Re-run 'agent-chat link'.");
  process.exit(1);
}
```

- [ ] **Step 2: Update the `link` call site in `src/cli/index.ts`**

In the `case "link":` block, change the call from `await runLink(p.authDir, values.pair);` to:

```ts
      await runLink(p, values.pair);
```

- [ ] **Step 3: Verify type-check + full suite pass**

Run: `npm run typecheck && npm test`
Expected: type-check clean; all tests pass (no test imports `runLink`, so nothing breaks).

- [ ] **Step 4: Commit**

```bash
git add src/cli/link.ts src/cli/index.ts
git commit -m "feat(cli): live re-link through the running bridge from 'link'

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Add the `logout` command

**Files:**
- Create: `src/cli/logout.ts`
- Modify: `src/cli/index.ts` (dispatch case + help text)

**Interfaces:**
- Consumes: `decideLogoutAction` (Task 4), `httpBridgeControl` (Task 5), `clearAuthDir` (Task 1), `loadConfig`, `Paths`.
- Produces: `runLogout(p: Paths): Promise<void>`.

> **Verification convention:** orchestration over the network — type-check + manual E2E (Task 9). The branch logic is unit-tested in Task 4; the local-clear helper in Task 1.

- [ ] **Step 1: Create `src/cli/logout.ts`**

```ts
import type { Paths } from "../shared/paths.js";
import { loadConfig } from "../shared/config.js";
import { httpBridgeControl } from "./bridge-control.js";
import { decideLogoutAction } from "./relink-actions.js";
import { clearAuthDir } from "../shared/auth.js";

export async function runLogout(p: Paths): Promise<void> {
  const config = loadConfig(p.configFile);
  const ctl = httpBridgeControl(config.bridgePort, config.bridgeToken);
  const probe = await ctl.probe();

  if (decideLogoutAction(probe.reachable) === "bridge-logout") {
    await ctl.logout();
    console.log(
      "Logged out. The device was removed from your WhatsApp Linked Devices. " +
        "Run 'agent-chat link' to reconnect."
    );
    return;
  }

  clearAuthDir(p.authDir);
  console.log(
    "Local session cleared. The bridge wasn't running, so this device may still " +
      "appear in your phone's Linked Devices until WhatsApp expires it. " +
      "Run 'agent-chat link' to reconnect."
  );
}
```

- [ ] **Step 2: Wire it into `src/cli/index.ts`**

Add the import near the other CLI imports:

```ts
import { runLogout } from "./logout.js";
```

Add a dispatch case (e.g. right after the `link` case):

```ts
    case "logout":
      await runLogout(p);
      break;
```

Add a line to the `HELP` template, under the `link` line:

```
  agent-chat logout                               log out and clear the session
```

- [ ] **Step 3: Verify type-check + full suite pass**

Run: `npm run typecheck && npm test`
Expected: type-check clean; all tests pass.

- [ ] **Step 4: Manually verify the help lists logout**

Run: `npm run cli -- help`
Expected: output includes the `agent-chat logout` line.

- [ ] **Step 5: Commit**

```bash
git add src/cli/logout.ts src/cli/index.ts
git commit -m "feat(cli): add logout command

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Documentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: behavior implemented in Tasks 1–7.
- Produces: no code.

- [ ] **Step 1: Update the "Run" section**

In `README.md`, in the link step (around the `npm run cli -- link` block), add a sentence after it:

```markdown
   If the bridge is already running, `link` re-links it **in place** — it clears
   the dead session, shows a fresh QR (or pairing code) right here, and reconnects
   with no restart. If the bridge isn't running, `link` links a standalone session
   as above.
```

- [ ] **Step 2: Document `logout` in the Setup command list**

Add to the CLI command list (near `token rotate` / `port`):

```markdown
npm run cli -- logout                # unlink the device from WhatsApp and clear the session
```

- [ ] **Step 3: Extend the manual E2E checklist**

In the "Verifying it works (manual end-to-end)" section, add:

```markdown
7. With the bridge running, simulate a re-link: `npm run cli -- logout`, then
   `npm run cli -- link`. Confirm a QR appears in the terminal, scan it, and
   `whatsapp_status` returns `connected` again — without restarting the bridge.
8. Run `npm run cli -- logout` while the bridge is up; confirm the device
   disappears from your phone's WhatsApp → Linked Devices list.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document live re-link and the logout command

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** live re-link via `link` (Tasks 2,3,5,6) · `logout` unlink+clear (Tasks 1,2,3,5,7) · zero restart / in-process relink (Task 2 generation guard + Task 3 endpoints) · QR in terminal (Task 6 `liveRelink`) · authenticated `/qr`, QR-less `/status` (Task 3) · standalone fallback (Task 6) · `--pair` in both paths (Task 2 `relink(pairing)`, Task 3 body `pair`, Task 6 forwarding) · bridge-down local clear (Tasks 1,7) · docs + manual E2E (Task 8). All spec sections map to a task.
- **Type consistency:** `decideLinkAction`/`decideLogoutAction` names and `LinkAction`/`LogoutAction` unions match across Tasks 4/6/7. `BridgeControl` method names (`probe`/`relink`/`logout`/`fetchQr`) match across Tasks 5/6/7. `handle.relink(pairingNumber?)`, `handle.logout()`, `handle.lastPairingCode()` match across Tasks 2/3. `BridgeDeps.status()` return shape `{ state, qr?, pairingCode? }` matches across Tasks 2/3.
- **Placeholder scan:** no TBD/TODO; every code step shows full code.
