# Interactive CLI menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an arrow-key interactive menu (`agent-chat` on a TTY, or `agent-chat menu`) that is a front-end over the existing CLI commands — link/re-link, logout, allowlist, default-language, token rotate, port, install/uninstall, show.

**Architecture:** A thin orchestration loop in `src/cli/menu.ts` that owns no business logic — it renders a live bridge-status header, presents `@clack/prompts` selects/prompts, and dispatches each choice to the existing `cmd.*`, `runLink`, `runLogout`, `runInstall`/`runUninstall` functions. Pure, TTY-free helpers (`buildAllowOpts`, `formatStatusLine`, `chooseLaunch`) live in `src/cli/menu-actions.ts` and are unit-tested; the clack wiring is verified by `tsc` + manual E2E, per repo convention. `src/cli/index.ts` routes bare `agent-chat`/`agent-chat menu` to the menu on a TTY.

**Tech Stack:** TypeScript (ESM, NodeNext, `.js` import extensions), `tsx`, `@clack/prompts` (new), `vitest`.

## Global Constraints

- **Only one new dependency:** `@clack/prompts`. No other runtime deps added.
- **No process control:** the menu never starts/stops/restarts the bridge (PM2/systemd). It only talks to the running bridge over HTTP, like the commands do today.
- **No change to existing subcommands:** every `agent-chat <command>` keeps its current behavior and flags. The only edit to existing command code is exporting `liveRelink` from `link.ts` (no behavior change).
- **ESM imports:** intra-repo imports use `.js` extensions on `.ts` sources (e.g. `from "./menu-actions.js"`). Package imports (`@clack/prompts`) take no extension.
- **Commits:** Conventional Commits (a commit-msg hook enforces this). The pre-commit hook runs `npm run typecheck && npm test` — both must pass for every commit.
- **Config key names:** `config.json` uses `bridgeToken`, `bridgePort`, `allowlist`, `defaultLanguage` (via `loadConfig` → `AppConfig`).

---

### Task 1: Pure menu helpers (`menu-actions.ts`)

TTY-free logic so the menu's decisions are unit-testable without driving clack. Three functions: assemble allowlist options from answers, format the status header, and decide what bare `agent-chat` / `agent-chat menu` does.

**Files:**
- Create: `src/cli/menu-actions.ts`
- Test: `tests/cli/menu-actions.test.ts`

**Interfaces:**
- Consumes: `AllowOpts` from `src/cli/config-store.ts` (`{ label?: string; confirm?: boolean; language?: string }`).
- Produces:
  - `type ConfirmChoice = "default" | "confirm" | "no-confirm"`
  - `buildAllowOpts(a: { label: string; confirmChoice: ConfirmChoice; language: string }): AllowOpts`
  - `interface ProbeResult { reachable: boolean; state?: string }`
  - `formatStatusLine(probe: ProbeResult, port: number): string`
  - `type LaunchDecision = "menu" | "help" | "error-needs-tty"`
  - `chooseLaunch(input: { command: string | undefined; isTTY: boolean }): LaunchDecision`

- [ ] **Step 1: Write the failing tests**

Create `tests/cli/menu-actions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildAllowOpts, formatStatusLine, chooseLaunch } from "../../src/cli/menu-actions.js";

describe("buildAllowOpts", () => {
  it("omits blank label, blank language, and the default confirm choice", () => {
    expect(buildAllowOpts({ label: "  ", confirmChoice: "default", language: "" })).toEqual({});
  });
  it("trims and includes label and language", () => {
    expect(buildAllowOpts({ label: "  Mom ", confirmChoice: "default", language: " Spanish " })).toEqual({
      label: "Mom",
      language: "Spanish",
    });
  });
  it("maps the confirm choices to booleans", () => {
    expect(buildAllowOpts({ label: "", confirmChoice: "confirm", language: "" })).toEqual({ confirm: true });
    expect(buildAllowOpts({ label: "", confirmChoice: "no-confirm", language: "" })).toEqual({ confirm: false });
  });
});

describe("formatStatusLine", () => {
  it("renders 'down' when the bridge is unreachable", () => {
    expect(formatStatusLine({ reachable: false }, 7766)).toBe("Bridge: ○ down  ·  port 7766");
  });
  it("renders connected with a filled glyph", () => {
    expect(formatStatusLine({ reachable: true, state: "connected" }, 7766)).toBe("Bridge: ● connected  ·  port 7766");
  });
  it("maps known non-connected states to friendly words", () => {
    expect(formatStatusLine({ reachable: true, state: "needs_relink" }, 7766)).toBe(
      "Bridge: ◍ needs re-link  ·  port 7766"
    );
  });
  it("falls back to the raw state, and to 'unknown' when state is missing", () => {
    expect(formatStatusLine({ reachable: true, state: "weird" }, 8080)).toBe("Bridge: ◍ weird  ·  port 8080");
    expect(formatStatusLine({ reachable: true }, 7766)).toBe("Bridge: ◍ unknown  ·  port 7766");
  });
});

describe("chooseLaunch", () => {
  it("opens the menu for the explicit command on a TTY", () => {
    expect(chooseLaunch({ command: "menu", isTTY: true })).toBe("menu");
  });
  it("errors for the explicit command without a TTY", () => {
    expect(chooseLaunch({ command: "menu", isTTY: false })).toBe("error-needs-tty");
  });
  it("opens the menu for no command on a TTY", () => {
    expect(chooseLaunch({ command: undefined, isTTY: true })).toBe("menu");
  });
  it("prints help for no command without a TTY", () => {
    expect(chooseLaunch({ command: undefined, isTTY: false })).toBe("help");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/cli/menu-actions.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/cli/menu-actions.js"` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/cli/menu-actions.ts`:

```ts
import type { AllowOpts } from "./config-store.js";

export type ConfirmChoice = "default" | "confirm" | "no-confirm";

/** Assemble allowlist upsert options from interactive answers.
 *  Blank label/language are omitted; the "default" confirm choice leaves
 *  confirm unset so config-store's merge preserves any existing value. */
export function buildAllowOpts(a: { label: string; confirmChoice: ConfirmChoice; language: string }): AllowOpts {
  const opts: AllowOpts = {};
  const label = a.label.trim();
  if (label) opts.label = label;
  if (a.confirmChoice === "confirm") opts.confirm = true;
  else if (a.confirmChoice === "no-confirm") opts.confirm = false;
  const language = a.language.trim();
  if (language) opts.language = language;
  return opts;
}

export interface ProbeResult {
  reachable: boolean;
  state?: string;
}

const STATE_WORDS: Record<string, string> = {
  connected: "connected",
  needs_relink: "needs re-link",
  connecting: "connecting",
  qr_available: "QR ready",
};

/** One-line bridge status header: glyph + state word + port. */
export function formatStatusLine(probe: ProbeResult, port: number): string {
  if (!probe.reachable) return `Bridge: ○ down  ·  port ${port}`;
  const state = probe.state ?? "unknown";
  const glyph = state === "connected" ? "●" : "◍";
  const word = STATE_WORDS[state] ?? state;
  return `Bridge: ${glyph} ${word}  ·  port ${port}`;
}

export type LaunchDecision = "menu" | "help" | "error-needs-tty";

/** Routing for bare `agent-chat` and the explicit `agent-chat menu`. */
export function chooseLaunch(input: { command: string | undefined; isTTY: boolean }): LaunchDecision {
  if (input.command === "menu") return input.isTTY ? "menu" : "error-needs-tty";
  return input.isTTY ? "menu" : "help"; // no command
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/cli/menu-actions.test.ts`
Expected: PASS — 11 tests across the three describe blocks.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass (existing 99 + 11 new = 110).

- [ ] **Step 6: Commit**

```bash
git add src/cli/menu-actions.ts tests/cli/menu-actions.test.ts
git commit -m "feat(cli): pure helpers for the interactive menu"
```

---

### Task 2: Interactive menu (`menu.ts`) + CLI wiring

The clack-driven menu loop and its sub-menus, plus routing it into `index.ts`. Reuses the existing command functions verbatim. Adds the `@clack/prompts` dependency and exports `liveRelink` so the menu's link action can re-link in place without `process.exit`.

**Files:**
- Modify: `package.json` (add `@clack/prompts` to `dependencies`) and `package-lock.json` (via `npm install`)
- Modify: `src/cli/link.ts:28` — change `async function liveRelink` to `export async function liveRelink` (no other change)
- Create: `src/cli/menu.ts`
- Modify: `src/cli/index.ts` — add a `menu` line to `HELP`; replace the `case "help": case undefined:` block with menu routing + a standalone `case "help":`
- (No new automated tests — clack I/O is verified by typecheck + the manual checks in Step 6 and Task 3's E2E.)

**Interfaces:**
- Consumes:
  - `buildAllowOpts`, `formatStatusLine`, `type ConfirmChoice` from `./menu-actions.js` (Task 1)
  - `chooseLaunch` from `./menu-actions.js` (Task 1)
  - `loadConfig(configFile): AppConfig` from `../shared/config.js`; `AppConfig` (`{ allowlist; defaultLanguage: string; bridgeToken: string; bridgePort: number }`) from `../shared/types.js`
  - `httpBridgeControl(port, token)` from `./bridge-control.js` (`.probe(): Promise<{ reachable: boolean; state?: string }>`)
  - `decideLinkAction(probe): "already-linked" | "live-relink" | "standalone"` from `./relink-actions.js`
  - `liveRelink(ctl, pairingNumber?)`, `runLink(p, pairingNumber?)` from `./link.js`
  - `runLogout(p)` from `./logout.js`
  - `runInstall(agentId, scope)`, `runUninstall(agentId, scope)` from `./install.js`
  - `listAgents()` from `./agents/registry.js`; `SCOPES`, `type Scope` from `./agents/types.js`
  - `cmd.allowlist`, `cmd.defaultLanguage`, `cmd.tokenRotate`, `cmd.setPort`, `cmd.show`, `cmd.init` from `./commands.js`
  - `type Paths` from `../shared/paths.js`
- Produces: `runMenu(paths: Paths): Promise<void>` (consumed by `index.ts`)

- [ ] **Step 1: Add the dependency**

Run: `npm install @clack/prompts`
Expected: `@clack/prompts` appears under `dependencies` in `package.json`; `package-lock.json` updates; install succeeds with no errors.

- [ ] **Step 2: Export `liveRelink` from `link.ts`**

In `src/cli/link.ts`, change the declaration at line 28 from:

```ts
async function liveRelink(ctl: BridgeControl, pairingNumber?: string): Promise<void> {
```

to:

```ts
export async function liveRelink(ctl: BridgeControl, pairingNumber?: string): Promise<void> {
```

No other change to `link.ts`. (`standaloneLink` keeps its `process.exit` calls: the socket's auto-reconnect cannot be disarmed from outside the handle, so the command path must exit the process to stop it. The menu never calls `standaloneLink` — see Step 3's `linkAction`.)

- [ ] **Step 3: Write `menu.ts`**

Create `src/cli/menu.ts`:

```ts
import { existsSync } from "node:fs";
import { intro, outro, select, text, confirm, isCancel, note, log } from "@clack/prompts";
import type { Paths } from "../shared/paths.js";
import type { AppConfig } from "../shared/types.js";
import { loadConfig } from "../shared/config.js";
import { httpBridgeControl } from "./bridge-control.js";
import { decideLinkAction } from "./relink-actions.js";
import { liveRelink } from "./link.js";
import { runLogout } from "./logout.js";
import { runInstall, runUninstall } from "./install.js";
import { listAgents } from "./agents/registry.js";
import { SCOPES, type Scope } from "./agents/types.js";
import * as cmd from "./commands.js";
import { buildAllowOpts, formatStatusLine } from "./menu-actions.js";

const nonEmpty = (v: string) => (v.trim() ? undefined : "required");

export async function runMenu(paths: Paths): Promise<void> {
  intro("agent-chat — interactive");

  if (!existsSync(paths.configFile)) {
    const doInit = await confirm({ message: "No config found. Run 'init' to create one now?" });
    if (isCancel(doInit) || !doInit) {
      outro("Run 'agent-chat init' when you're ready.");
      return;
    }
    await cmd.init(paths.configFile, false);
  }

  for (;;) {
    const config = loadConfig(paths.configFile);
    const probe = await httpBridgeControl(config.bridgePort, config.bridgeToken).probe();
    note(formatStatusLine(probe, config.bridgePort));

    const action = await select({
      message: "Choose an action",
      options: [
        { value: "link", label: "Link / re-link account" },
        { value: "logout", label: "Log out" },
        { value: "allowlist", label: "Allowlist" },
        { value: "language", label: "Default language" },
        { value: "token", label: "Rotate token" },
        { value: "port", label: "Set port" },
        { value: "install", label: "Install / uninstall an agent" },
        { value: "show", label: "Show config" },
        { value: "quit", label: "Quit" },
      ],
    });

    if (isCancel(action) || action === "quit") {
      outro("Bye.");
      return;
    }

    try {
      await runAction(action, paths, config);
    } catch (err) {
      log.error(`error: ${(err as Error)?.message ?? String(err)}`);
    }
  }
}

async function runAction(action: string, paths: Paths, config: AppConfig): Promise<void> {
  switch (action) {
    case "link":
      await linkAction(config);
      return;
    case "logout": {
      const ok = await confirm({ message: "Log out and clear the local session?" });
      if (isCancel(ok) || !ok) return;
      await runLogout(paths);
      return;
    }
    case "allowlist":
      await allowlistAction(paths);
      return;
    case "language": {
      const lang = await text({ message: "Default language", placeholder: config.defaultLanguage });
      if (isCancel(lang) || !lang.trim()) return;
      cmd.defaultLanguage(paths.configFile, lang);
      return;
    }
    case "token": {
      const ok = await confirm({
        message: "Rotate the bridge token? You must then restart the bridge and your MCP client.",
      });
      if (isCancel(ok) || !ok) return;
      cmd.tokenRotate(paths.configFile);
      return;
    }
    case "port": {
      const port = await text({
        message: "Bridge port",
        placeholder: String(config.bridgePort),
        validate: (v) => (/^[0-9]+$/.test(v.trim()) ? undefined : "enter a positive integer"),
      });
      if (isCancel(port)) return;
      cmd.setPort(paths.configFile, port);
      return;
    }
    case "install":
      await installAction();
      return;
    case "show":
      cmd.show(paths.configFile);
      return;
  }
}

/** Re-link through the running bridge. When the bridge is down the menu can't
 *  re-link in place, so it points the user at the standalone command instead. */
async function linkAction(config: AppConfig): Promise<void> {
  const ctl = httpBridgeControl(config.bridgePort, config.bridgeToken);
  const decision = decideLinkAction(await ctl.probe());

  if (decision === "already-linked") {
    log.info("Already linked. Choose 'Log out' first to link a different account.");
    return;
  }
  if (decision === "standalone") {
    log.warn(
      "The bridge isn't running, so the menu can't re-link in place. " +
        "Start it (e.g. 'pm2 start agent-chat-bridge'), then reopen the menu — " +
        "or run 'agent-chat link' to link a standalone socket."
    );
    return;
  }

  // live-relink
  const method = await select({
    message: "Link by:",
    options: [
      { value: "qr", label: "Scanning a QR code" },
      { value: "pair", label: "Entering a pairing code on your phone" },
    ],
  });
  if (isCancel(method)) return;

  let pair: string | undefined;
  if (method === "pair") {
    const num = await text({ message: "Your number, with country code (digits only)", validate: nonEmpty });
    if (isCancel(num)) return;
    pair = num.trim();
  }
  await liveRelink(ctl, pair);
}

async function allowlistAction(paths: Paths): Promise<void> {
  const sub = await select({
    message: "Allowlist",
    options: [
      { value: "list", label: "List entries" },
      { value: "add", label: "Add or update an entry" },
      { value: "remove", label: "Remove an entry" },
      { value: "back", label: "Back" },
    ],
  });
  if (isCancel(sub) || sub === "back") return;

  if (sub === "list") {
    cmd.allowlist(paths.configFile, "list", undefined);
    return;
  }
  if (sub === "remove") {
    const num = await text({ message: "Number to remove (digits)", validate: nonEmpty });
    if (isCancel(num)) return;
    cmd.allowlist(paths.configFile, "remove", num);
    return;
  }

  // add / update
  const number = await text({ message: "Number (digits)", validate: nonEmpty });
  if (isCancel(number)) return;
  const label = await text({ message: "Label (optional)", placeholder: "" });
  if (isCancel(label)) return;
  const confirmChoice = await select({
    message: "Require confirmation before this contact's messages reach the agent?",
    options: [
      { value: "default", label: "Use the existing / default setting" },
      { value: "confirm", label: "Yes — require confirmation" },
      { value: "no-confirm", label: "No — deliver without confirmation" },
    ],
  });
  if (isCancel(confirmChoice)) return;
  const language = await text({ message: "Language (optional)", placeholder: "" });
  if (isCancel(language)) return;

  const opts = buildAllowOpts({ label, confirmChoice, language });
  cmd.allowlist(paths.configFile, "add", number, opts);
}

async function installAction(): Promise<void> {
  const op = await select({
    message: "Install or uninstall?",
    options: [
      { value: "install", label: "Install" },
      { value: "uninstall", label: "Uninstall" },
      { value: "back", label: "Back" },
    ],
  });
  if (isCancel(op) || op === "back") return;

  const agentId = await select({
    message: "Which agent?",
    options: listAgents().map((a) => ({ value: a.id, label: a.label })),
  });
  if (isCancel(agentId)) return;

  const scope = await select({
    message: "Scope",
    options: SCOPES.map((s) => ({ value: s, label: s })),
  });
  if (isCancel(scope)) return;

  if (op === "install") await runInstall(agentId, scope as Scope);
  else await runUninstall(agentId, scope as Scope);
}
```

- [ ] **Step 4: Wire `index.ts`**

In `src/cli/index.ts`, add the imports near the existing CLI imports (after the `runLogout` import on line 6):

```ts
import { runMenu } from "./menu.js";
import { chooseLaunch } from "./menu-actions.js";
```

Add a `menu` line to the `HELP` template, immediately before the `agent-chat help` line:

```
  agent-chat menu                                 open the interactive menu
  agent-chat help
```

Replace the existing combined case:

```ts
    case "help":
    case undefined:
      console.log(HELP);
      break;
```

with:

```ts
    case "menu":
    case undefined: {
      const decision = chooseLaunch({ command, isTTY: !!process.stdout.isTTY });
      if (decision === "menu") {
        await runMenu(p);
        break;
      }
      if (decision === "error-needs-tty") {
        throw new Error("interactive menu needs a terminal; run a specific command instead (see 'agent-chat help').");
      }
      console.log(HELP); // decision === "help"
      break;
    }
    case "help":
      console.log(HELP);
      break;
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean (no errors). This confirms the clack types resolve and `runMenu`/`chooseLaunch` are wired correctly.

- [ ] **Step 6: Manual non-interactive verification**

These exercise the routing without a TTY (a subagent's stdout is a pipe, so `process.stdout.isTTY` is falsy — `runMenu` is never entered and clack never blocks):

```bash
npm run cli -- menu        # → stderr "error: interactive menu needs a terminal..."; exit code 1
npm run cli                # → prints HELP; exit code 0
npm run cli -- help        # → prints HELP including the new "agent-chat menu" line
```

Verify the first prints the needs-a-terminal error and exits non-zero (`echo $?` → 1), and the latter two print the help text including the `menu` line. (The interactive flow itself — arrow-key navigation and the sub-prompts — is verified by a human in Task 3's E2E checklist, since it requires a real terminal.)

- [ ] **Step 7: Run the full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass (110, unchanged from Task 1 — this task adds no automated tests).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/cli/link.ts src/cli/menu.ts src/cli/index.ts
git commit -m "feat(cli): interactive management menu"
```

---

### Task 3: Document the interactive menu

Add a README subsection and an E2E checklist entry.

**Files:**
- Modify: `README.md` — add an `### Interactive menu` subsection at the end of `## Setup` (after the `After npm link, …` line, before `## Run`); add step 8 to `## Verifying it works (manual end-to-end)`.

- [ ] **Step 1: Add the Setup subsection**

In `README.md`, find the line at the end of the Setup section:

```
After `npm link`, the same commands are available as `agent-chat <command>`.
```

Immediately after it, insert:

```markdown

### Interactive menu

Prefer a menu to memorizing flags? Run `agent-chat` with no command in a
terminal (or `agent-chat menu` explicitly) to open an arrow-key interactive
menu over the same commands — link/re-link, logout, allowlist, default language,
token rotate, port, install/uninstall, and show config. It shows the live bridge
status (connected / needs re-link / down) at the top and returns to the menu
after each action.

```bash
npm run cli                  # opens the menu in a terminal
npm run cli -- menu          # the same, explicitly
```

The menu only talks to the running bridge — it does **not** start, stop, or
restart it. When piped or run without a terminal, bare `agent-chat` prints this
help instead of opening the menu. If the bridge is down, the menu links via the
standalone `agent-chat link` command rather than re-linking in place.
```

- [ ] **Step 2: Add the E2E checklist entry**

In `README.md`, in `## Verifying it works (manual end-to-end)`, after step 7 (the re-link step ending `without restarting the bridge.`), add:

```markdown
8. Run `npm run cli` in a terminal → the interactive menu opens with the bridge
   status header; pick an action (e.g. **Show config**) and confirm it runs and
   returns to the menu; pick **Quit** to exit. Then run `npm run cli -- menu |
   cat` (piping stdout makes it non-TTY) and confirm it prints the "needs a
   terminal" error and exits non-zero.
```

- [ ] **Step 3: Typecheck + tests (docs-only sanity)**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all 110 tests pass (no code changed).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document the interactive menu"
```

---

## Notes for the implementer

- **clack cancellation:** every `select`/`text`/`confirm` can be cancelled (Ctrl-C / Esc). The pattern is `const x = await select(...); if (isCancel(x)) return;` — which returns to the caller (a sub-menu returns to the top menu; the top-level `select` cancel falls through to `outro("Bye.")`). This is already wired in the code above; keep it on every prompt.
- **clack return types:** after an `if (isCancel(x)) return;` guard, TypeScript narrows `x` from `string | symbol` (or the option-value union `| symbol`) to the non-symbol type, so the values pass cleanly to `cmd.*`/`run*`. Don't add casts beyond the `scope as Scope` shown (the `SCOPES.map` value is already typed `Scope`, but the explicit cast documents intent at the `runInstall`/`runUninstall` call).
- **Mixing prompt systems:** the no-config branch runs `cmd.init` (Node `readline`) after a clack `confirm` resolves — they never run concurrently, so there's no stdin contention. If manual E2E shows any glitch, that's the place to look.
- **Don't refactor existing commands.** The only edit to existing code is the one-word `export` on `liveRelink`. Everything else is additive.
