# Interactive CLI menu — design

## Problem

`agent-chat` today is a flag/subcommand CLI: `agent-chat link`, `agent-chat
allowlist add <number> --label … --no-confirm --lang …`, `agent-chat token
rotate`, and so on. Managing the server means remembering the command names and
their flags. There is no single place to see the bridge's current state and pick
an action from a list.

## Goals

- An arrow-key **interactive menu** that is a front-end over the existing
  commands: link / re-link, logout, allowlist (list/add/remove), default
  language, token rotate, port, install / uninstall, show.
- The menu shows the **live bridge state** (connected / needs_relink /
  connecting / down) and port at the top, refreshed after every action.
- Launch with bare `agent-chat` on a TTY, or `agent-chat menu` explicitly.
- The menu reuses the existing command logic verbatim — it adds navigation and
  input prompts, **not** new business logic.

## Non-goals

- **No process control.** The menu does not start, stop, or restart the bridge
  (PM2/systemd). It talks to the already-running bridge over HTTP, exactly like
  the commands do today.
- No change to any existing subcommand's behavior or flags.
- No new read/send/MCP surface, allowlist semantics, or config schema changes.

## Tech

- `@clack/prompts` for the interactive prompts (arrow-key `select`, `text`,
  `confirm`, `isCancel`). One new runtime dependency, chosen for its small size
  and built-in styling.

## Behavior

```bash
agent-chat                 # no command, TTY      → opens the menu
agent-chat menu            # explicit             → opens the menu
agent-chat | cat           # no command, non-TTY  → prints help (unchanged)
agent-chat help            # → prints help (unchanged)
agent-chat menu  </dev/null # non-TTY             → error: needs a terminal
agent-chat link            # and every other subcommand → runs as today
```

### Menu structure

```
agent-chat — interactive
Bridge: ● connected   ·   port 7766

❯ Link / re-link account
  Log out
  Allowlist            → list · add · remove
  Default language
  Rotate token
  Set port
  Install / uninstall an agent  → install · uninstall → pick agent + scope
  Show config
  Quit
```

- The top-level menu is a clack `select`. Choosing an item runs the action, lets
  its normal console output print, then redraws the menu — re-probing the bridge
  so the status header is current.
- **Allowlist** and **Install / uninstall** are nested `select`s.
- Inputs that are flags today become prompts. Example — **Allowlist → add**:
  - number (`text`, required, validated non-empty digits)
  - label (`text`, optional → omitted when blank)
  - "Require confirmation before this contact's messages reach the agent?"
    (`confirm` → maps to `--confirm` / `--no-confirm`; leaving the default maps
    to neither, i.e. `confirm: undefined`)
  - language (`text`, optional → omitted when blank)
  - then calls `cmd.allowlist(configFile, "add", number, opts)`.
- **Set port** = `text` (numeric) → `cmd.setPort`. **Default language** = `text`
  → `cmd.defaultLanguage`. **Show config** → `cmd.show`. **Install / uninstall**
  → pick a registered agent (`select` from `listAgents()`) and a scope (`select`
  user / project / local) → `runInstall` / `runUninstall`.

### Status header

On entry and after each action, the menu calls
`httpBridgeControl(port, token).probe()` (already used by `link`/`logout`) and
renders one line: a state glyph + word and the port. `probe()` already returns
`{ reachable: false }` on connection-refused, rendered as "down". The probe is
best-effort; a failure renders "down" and never blocks the menu.

## Components

### New: `src/cli/menu.ts`

Exports `runMenu(p: Paths): Promise<void>`. A thin orchestration loop that owns
**no business logic**. It:

- loads config for the port/token used by the status probe;
- renders the status header and the top-level `select`;
- dispatches each choice to the existing functions — `cmd.allowlist`,
  `cmd.defaultLanguage`, `cmd.tokenRotate`, `cmd.setPort`, `cmd.show`, `cmd.init`,
  `runLink`, `runLogout`, `runInstall`, `runUninstall`;
- wraps each action so a thrown error is shown and control returns to the menu;
- loops until the user picks Quit or cancels at the top level.

### New: `src/cli/menu-actions.ts`

Pure, TTY-free helpers so the logic is unit-testable without driving clack:

- `buildAllowOpts(answers): AllowOpts` — assemble `{ label?, confirm?, language? }`
  from the collected answers (blank label/language omitted; confirm default →
  `undefined`).
- `formatStatusLine(probe): string` — map `{ reachable, state }` to the header
  string (glyph + word + port).
- `chooseLaunch({ command, isTTY }): "menu" | "help" | "error-needs-tty"` — the
  no-arg/TTY/`menu` routing decision.

`menu.ts` consumes these; clack prompt wiring stays in `menu.ts` and is not unit
tested (verified by typecheck + manual E2E, per repo convention).

### Modified: `src/cli/index.ts`

- Add a `menu` case → `await runMenu(p)`.
- For the no-command case, branch on `process.stdout.isTTY`: TTY → `runMenu(p)`;
  non-TTY → print `HELP` (today's behavior).
- Add a `menu` line to `HELP`.

### Modified: `src/cli/link.ts`

Move the `process.exit(...)` calls out of `standaloneLink` so `runLink` returns
on success and throws on failure/timeout instead of exiting the process. This
lets the menu call `runLink` and loop back to the menu afterward. The
`index.ts` `link` dispatcher relies on the existing top-level `main().catch`
(exit 1 on throw) for the failure exit code; success falls through to a normal
exit 0. No tests assert the current `process.exit` behavior (only the pure
`decideLinkAction` in `relink-actions.ts` is tested), so this is safe, and it
cleanly separates exit-code policy from link logic.

## Error handling & edge cases

- **No config yet:** the menu needs port/token for the status probe. On entry,
  if `config.json` is missing, the menu offers "Run init now?" → runs `cmd.init`
  → reloads config → continues. `init` keeps its own readline flow; it runs
  before any clack prompt, so the two prompt systems never overlap.
- **Cancellation:** clack `isCancel` (Ctrl-C / Esc) inside a sub-prompt returns
  to the top-level menu; at the top level it quits cleanly with a short outro.
- **Action errors:** each action is wrapped — a thrown error (invalid port,
  bridge unreachable, link timeout) is shown as a message and control returns to
  the menu rather than crashing the process.
- **Destructive actions:** Log out and Rotate token require a `confirm` step
  first. Rotate token's existing message already notes it requires restarting the
  bridge and the MCP client.
- **Non-TTY `menu`:** `agent-chat menu` without a TTY prints a clear error
  ("interactive menu needs a terminal; use `agent-chat <command>` instead") and
  exits non-zero, rather than letting clack fail obscurely.

## Testing

- **Unit (vitest):** the pure helpers in `menu-actions.ts` —
  `buildAllowOpts` (blank-field omission, confirm default → `undefined`),
  `formatStatusLine` (reachable/down/each state), and `chooseLaunch` (the
  no-arg/TTY/`menu`/non-TTY routing). Mirrors how `relink-actions.ts` is tested.
- **Type-check + manual E2E:** the clack prompt wiring follows the repo
  convention that interactive/live code is verified by `tsc --noEmit` and the
  manual checklist. Add to the README "Verifying it works" checklist:
  - `agent-chat` on a terminal opens the menu; the status header reflects the
    bridge state; each action runs and returns to the menu.
  - `agent-chat menu </dev/null` prints the needs-a-terminal error and exits
    non-zero.

## Docs

Update `README.md`: add an "Interactive menu" subsection describing `agent-chat`
(no-arg, TTY) and `agent-chat menu`, and that it wraps the same commands with no
process control. Note that bare `agent-chat` opens the menu on a terminal and
still prints help when piped.
