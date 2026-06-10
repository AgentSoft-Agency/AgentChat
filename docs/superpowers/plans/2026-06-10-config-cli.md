# Config & Setup CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `agent-chat` CLI so users configure the app and link their WhatsApp account without hand-editing `data/config.json`.

**Architecture:** A third entry point under `src/cli/`. All config-mutation logic lives in a pure, unit-tested `config-store` module that reads/writes the **raw** JSON (preserving `{number,label}` allowlist entries) and validates every candidate through the existing `parseConfig` before writing. Thin command handlers and an argv dispatcher (`node:util.parseArgs`) sit on top; `link` reuses the bridge's `startWhatsApp`.

**Tech Stack:** TypeScript (ESM/NodeNext), `node:util.parseArgs`, `node:readline/promises`, `node:crypto`; `vitest`; reuses `src/shared/config.ts` and `src/bridge/whatsapp.ts`.

**Spec:** `docs/superpowers/specs/2026-06-10-config-cli-design.md`

---

## File structure

```
src/cli/
  config-store.ts   # raw read/validate/write + pure mutators (UNIT-TESTED — the core)
  commands.ts       # command handlers; init uses readline/promises
  link.ts           # account linking via bridge/whatsapp.ts
  index.ts          # shebang + argv parsing (parseArgs) + dispatch + help
tests/cli/
  config-store.test.ts
```

`package.json` gains a `cli` script and a `bin`. No change is needed to
`src/shared/config.ts`: `config-store` validates by calling the already-exported
`parseConfig` (it throws on invalid input), so the zod schema stays private.

---

## Task 1: config-store — read/write/createDefault

**Files:**
- Create: `src/cli/config-store.ts`
- Test: `tests/cli/config-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDefault, generateToken, readConfig, writeConfig,
} from "../../src/cli/config-store.js";

const tmpFile = () => join(mkdtempSync(join(tmpdir(), "agentchat-")), "config.json");

describe("config-store core", () => {
  it("generateToken returns a non-empty url-safe string", () => {
    const t = generateToken();
    expect(t.length).toBeGreaterThan(20);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("createDefault is schema-valid with a token and default port", () => {
    const c = createDefault();
    expect(c.bridgePort).toBe(7766);
    expect(c.bridgeToken).toBeTruthy();
    expect(c.allowlist).toEqual([]);
  });

  it("writes (mode 600) and reads back round-trip", () => {
    const file = tmpFile();
    const c = createDefault();
    writeConfig(file, c);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readConfig(file)).toEqual(c);
  });

  it("readConfig rejects a schema-invalid file", () => {
    const file = tmpFile();
    // bridgeToken missing → invalid
    writeFileSync(file, '{"allowlist":[],"bridgePort":7766}');
    expect(() => readConfig(file)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/config-store.test.ts`
Expected: FAIL — cannot find module `config-store.js`.

- [ ] **Step 3: Implement**

```ts
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { parseConfig } from "../shared/config.js";

export type RawAllowlistEntry = string | { number: string; label?: string };

export interface RawConfig {
  allowlist: RawAllowlistEntry[];
  bridgeToken: string;
  bridgePort: number;
}

const DEFAULT_PORT = 7766;

export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export function createDefault(): RawConfig {
  return { allowlist: [], bridgeToken: generateToken(), bridgePort: DEFAULT_PORT };
}

export function normalizeNumber(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

function entryNumber(e: RawAllowlistEntry): string {
  return normalizeNumber(typeof e === "string" ? e : e.number);
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

// (mutators added in Tasks 2 and 3; entryNumber is used there)
export { entryNumber };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/config-store.test.ts`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add src/cli/config-store.ts tests/cli/config-store.test.ts
git commit -m "feat(cli): config-store read/write/createDefault"
```

---

## Task 2: config-store — allowlist add/remove/list

**Files:**
- Modify: `src/cli/config-store.ts`
- Test: `tests/cli/config-store.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the test file)

```ts
import { addAllowlist, removeAllowlist, listAllowlist } from "../../src/cli/config-store.js";

describe("config-store allowlist", () => {
  it("adds a labeled entry, normalizing the number", () => {
    const c = addAllowlist(createDefault(), "+52 1 55 1234 5678", "Mom");
    expect(c.allowlist).toEqual([{ number: "5215512345678", label: "Mom" }]);
  });

  it("adds a bare entry when no label", () => {
    const c = addAllowlist(createDefault(), "5215512345678");
    expect(c.allowlist).toEqual(["5215512345678"]);
  });

  it("dedupes by normalized number, updating the label", () => {
    let c = addAllowlist(createDefault(), "5215512345678");
    c = addAllowlist(c, "+52 155 1234 5678", "Mom");
    expect(c.allowlist).toEqual([{ number: "5215512345678", label: "Mom" }]);
  });

  it("rejects a number with no digits", () => {
    expect(() => addAllowlist(createDefault(), "mom")).toThrow(/valid number/i);
  });

  it("removes by normalized number", () => {
    let c = addAllowlist(createDefault(), "5215512345678", "Mom");
    c = removeAllowlist(c, "+52 1 55 1234 5678");
    expect(c.allowlist).toEqual([]);
  });

  it("lists entries with optional labels", () => {
    let c = addAllowlist(createDefault(), "5215512345678", "Mom");
    c = addAllowlist(c, "120363000000000000");
    expect(listAllowlist(c)).toEqual([
      { number: "5215512345678", label: "Mom" },
      { number: "120363000000000000" },
    ]);
  });

  it("labels survive a write/read round-trip", () => {
    const file = tmpFile();
    writeConfig(file, addAllowlist(createDefault(), "5215512345678", "Mom"));
    expect(readConfig(file).allowlist).toEqual([{ number: "5215512345678", label: "Mom" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/config-store.test.ts`
Expected: FAIL — `addAllowlist` is not exported.

- [ ] **Step 3: Implement** (append to `src/cli/config-store.ts`, before the `export { entryNumber }` line or replacing it)

```ts
export function addAllowlist(config: RawConfig, number: string, label?: string): RawConfig {
  const num = normalizeNumber(number);
  if (!num) throw new Error(`not a valid number: ${number}`);
  const allowlist = config.allowlist.filter((e) => entryNumber(e) !== num);
  allowlist.push(label ? { number: num, label } : num);
  return { ...config, allowlist };
}

export function removeAllowlist(config: RawConfig, number: string): RawConfig {
  const num = normalizeNumber(number);
  return { ...config, allowlist: config.allowlist.filter((e) => entryNumber(e) !== num) };
}

export function listAllowlist(config: RawConfig): { number: string; label?: string }[] {
  return config.allowlist.map((e) =>
    typeof e === "string" ? { number: e } : { number: e.number, label: e.label }
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/config-store.test.ts`
Expected: PASS (all allowlist tests + Task 1 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/config-store.ts tests/cli/config-store.test.ts
git commit -m "feat(cli): config-store allowlist add/remove/list"
```

---

## Task 3: config-store — setPort/rotateToken

**Files:**
- Modify: `src/cli/config-store.ts`
- Test: `tests/cli/config-store.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { setPort, rotateToken } from "../../src/cli/config-store.js";

describe("config-store port + token", () => {
  it("sets a valid port", () => {
    expect(setPort(createDefault(), 8080).bridgePort).toBe(8080);
  });

  it("rejects a non-positive or non-integer port", () => {
    expect(() => setPort(createDefault(), 0)).toThrow(/port/i);
    expect(() => setPort(createDefault(), 12.5)).toThrow(/port/i);
  });

  it("rotateToken changes the token and stays schema-valid", () => {
    const c = createDefault();
    const r = rotateToken(c);
    expect(r.bridgeToken).not.toBe(c.bridgeToken);
    expect(r.bridgeToken.length).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/config-store.test.ts`
Expected: FAIL — `setPort` is not exported.

- [ ] **Step 3: Implement** (append to `src/cli/config-store.ts`)

```ts
export function setPort(config: RawConfig, port: number): RawConfig {
  if (!Number.isInteger(port) || port <= 0) throw new Error(`invalid port: ${port}`);
  return { ...config, bridgePort: port };
}

export function rotateToken(config: RawConfig): RawConfig {
  return { ...config, bridgeToken: generateToken() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/config-store.test.ts`
Expected: PASS (all config-store tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/config-store.ts tests/cli/config-store.test.ts
git commit -m "feat(cli): config-store setPort/rotateToken"
```

---

## Task 4: Command handlers (`commands.ts`)

**Files:**
- Create: `src/cli/commands.ts`

Thin handlers over `config-store`. `init` is interactive (readline). Verified by
`tsc` here and the CLI smoke test in Task 6.

- [ ] **Step 1: Implement**

```ts
import { createInterface } from "node:readline/promises";
import { existsSync } from "node:fs";
import * as store from "./config-store.js";

function requireConfig(configFile: string): store.RawConfig {
  if (!existsSync(configFile)) {
    throw new Error("No config found. Run 'agent-chat init' first.");
  }
  return store.readConfig(configFile);
}

export async function init(configFile: string, force: boolean): Promise<void> {
  if (existsSync(configFile) && !force) {
    throw new Error(`config already exists at ${configFile} (use --force to overwrite)`);
  }
  let config = store.createDefault();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const portAns = (await rl.question(`Bridge port [${config.bridgePort}]: `)).trim();
    if (portAns) config = store.setPort(config, Number(portAns));
    const num = (await rl.question("First allowed number (blank to skip): ")).trim();
    if (num) {
      const label = (await rl.question("Label (optional): ")).trim();
      config = store.addAllowlist(config, num, label || undefined);
    }
  } finally {
    rl.close();
  }
  store.writeConfig(configFile, config);
  console.log(`\n✅ wrote ${configFile} (token generated, mode 600). Next: agent-chat link`);
}

export function allowlist(configFile: string, sub: string | undefined, number: string | undefined, label: string | undefined): void {
  if (sub === "list") {
    const entries = store.listAllowlist(requireConfig(configFile));
    if (entries.length === 0) { console.log("(no entries)"); return; }
    for (const e of entries) console.log(`${e.number}${e.label ? `  ${e.label}` : ""}`);
    return;
  }
  if (sub === "add") {
    if (!number) throw new Error("usage: agent-chat allowlist add <number> [--label <name>]");
    store.writeConfig(configFile, store.addAllowlist(requireConfig(configFile), number, label));
    console.log(`✅ added ${store.normalizeNumber(number)}${label ? ` (${label})` : ""}`);
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

export function tokenRotate(configFile: string): void {
  store.writeConfig(configFile, store.rotateToken(requireConfig(configFile)));
  console.log("✅ token rotated. Restart the bridge and your MCP client to apply it.");
}

export function setPort(configFile: string, portArg: string | undefined): void {
  const port = Number(portArg);
  store.writeConfig(configFile, store.setPort(requireConfig(configFile), port));
  console.log(`✅ bridge port set to ${port}`);
}

export function show(configFile: string): void {
  const c = requireConfig(configFile);
  console.log(`port:  ${c.bridgePort}`);
  console.log(`token: ${c.bridgeToken ? "•••• (set)" : "(missing)"}`);
  const entries = store.listAllowlist(c);
  console.log(`allowlist (${entries.length}):`);
  for (const e of entries) console.log(`  ${e.number}${e.label ? `  ${e.label}` : ""}`);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands.ts
git commit -m "feat(cli): command handlers"
```

---

## Task 5: Link command (`link.ts`)

**Files:**
- Create: `src/cli/link.ts`

Reuses `startWhatsApp`; verified by `tsc` and the manual end-to-end (needs a phone).

- [ ] **Step 1: Implement**

```ts
import { startWhatsApp } from "../bridge/whatsapp.js";

export async function runLink(authDir: string, pairingNumber?: string): Promise<void> {
  console.log(
    pairingNumber
      ? `Requesting a pairing code for ${pairingNumber}…`
      : "Linking — scan the QR below with WhatsApp → Linked Devices → Link a device."
  );
  const handle = await startWhatsApp(authDir, () => {}, pairingNumber);
  const deadline = Date.now() + 120_000;
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

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS. (If the installed `startWhatsApp` signature differs, adapt the call; it is `startWhatsApp(authDir, onEvent, pairingNumber?)`.)

- [ ] **Step 3: Commit**

```bash
git add src/cli/link.ts
git commit -m "feat(cli): link command"
```

---

## Task 6: Dispatcher + packaging + smoke test

**Files:**
- Create: `src/cli/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Implement `src/cli/index.ts`**

```ts
#!/usr/bin/env -S npx tsx
import { parseArgs } from "node:util";
import { paths } from "../shared/paths.js";
import * as cmd from "./commands.js";
import { runLink } from "./link.js";

const HELP = `agent-chat — configure @agentsoft/agent-chat

Usage:
  agent-chat init [--force]                       create data/config.json
  agent-chat link [--pair <number>]               link your WhatsApp account
  agent-chat allowlist list
  agent-chat allowlist add <number> [--label <name>]
  agent-chat allowlist remove <number>
  agent-chat token rotate                         generate a new bridge token
  agent-chat port <number>                        set the bridge port
  agent-chat show                                 print config (token redacted)
  agent-chat help
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const rest = argv.slice(1);
  const p = paths();

  switch (command) {
    case "init": {
      const { values } = parseArgs({ args: rest, options: { force: { type: "boolean" } } });
      await cmd.init(p.configFile, !!values.force);
      break;
    }
    case "link": {
      const { values } = parseArgs({ args: rest, options: { pair: { type: "string" } } });
      await runLink(p.authDir, values.pair);
      break;
    }
    case "allowlist": {
      const { values, positionals } = parseArgs({
        args: rest.slice(1), options: { label: { type: "string" } }, allowPositionals: true,
      });
      cmd.allowlist(p.configFile, rest[0], positionals[0], values.label);
      break;
    }
    case "token": {
      if (rest[0] !== "rotate") throw new Error("usage: agent-chat token rotate");
      cmd.tokenRotate(p.configFile);
      break;
    }
    case "port": {
      cmd.setPort(p.configFile, rest[0]);
      break;
    }
    case "show":
      cmd.show(p.configFile);
      break;
    case "help":
    case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`unknown command: ${command}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(`error: ${e?.message ?? e}`);
  process.exit(1);
});
```

- [ ] **Step 2: Make `index.ts` executable and wire `package.json`**

Run: `chmod +x src/cli/index.ts`

Add to `package.json` `scripts`: `"cli": "tsx src/cli/index.ts"`, and a top-level `bin`:
```json
  "bin": { "agent-chat": "src/cli/index.ts" },
```
(Place `bin` next to `scripts`. The shebang `#!/usr/bin/env -S npx tsx` lets the bin run the TS source.)

- [ ] **Step 3: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 4: Smoke-test the whole CLI** (writes to gitignored `data/`; piping answers makes `init` non-interactive)

```bash
rm -f data/config.json
printf '\n\n' | npm run cli -- init --force
npm run cli -- allowlist add "+52 1 55 1234 5678" --label Mom
npm run cli -- allowlist add 120363000000000000
npm run cli -- allowlist list
npm run cli -- port 8123
npm run cli -- token rotate
npm run cli -- show
```
Expected: `init` writes `data/config.json`; `allowlist list` shows `5215512345678  Mom` and the group id; `show` reports `port: 8123`, `token: •••• (set)`, and 2 allowlist entries. Confirm `data/config.json` is valid JSON with the labeled entry preserved:
```bash
node -e "console.log(JSON.stringify(require('./data/config.json').allowlist))"
```
Expected: `[{"number":"5215512345678","label":"Mom"},"120363000000000000"]`

- [ ] **Step 5: Verify the full suite still passes**

Run: `npx vitest run`
Expected: all tests pass (config-store tests included). Do NOT commit anything under `data/`.

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts package.json
git commit -m "feat(cli): dispatcher and packaging"
```

---

## Task 7: README — replace hand-editing with the CLI

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Setup section**

Replace the existing Setup block:
````markdown
## Setup

```bash
npm install
cp data/config.example.json data/config.json   # then edit it
```
````
with:
````markdown
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
````

- [ ] **Step 2: Update the Run section** so linking uses the CLI

Replace step 1 of the **Run** section (the `npm run start:bridge` instruction to scan the QR) with:
````markdown
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
````

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: use the agent-chat CLI for setup and linking"
```

---

## Self-review notes

- **Spec coverage:** init (Task 4/6), allowlist add/remove/list (Tasks 2, 4, 6),
  token rotate (Tasks 3, 4), port (Tasks 3, 4), link with `--pair` (Task 5/6),
  show with redaction (Task 4), label preservation via raw config (Tasks 1–2),
  validate-before-write + chmod 600 (Task 1), `parseArgs` dispatch + help +
  non-zero exit (Task 6), bin + `cli` script (Task 6), README (Task 7). All spec
  sections map to a task.
- **Deviation from spec:** the spec mentioned exporting the zod schema from
  `config.ts`; the plan instead validates via the already-exported `parseConfig`
  (it throws on invalid input), so no change to `config.ts` is needed — simpler,
  same guarantee.
- **Type consistency:** `RawConfig`, `RawAllowlistEntry`, `normalizeNumber`,
  `entryNumber`, and the mutator signatures defined in Task 1 are reused
  unchanged in Tasks 2–4; `commands.ts` and `index.ts` call them with matching
  shapes; `runLink(authDir, pairingNumber?)` matches `startWhatsApp(authDir,
  onEvent, pairingNumber?)`.
