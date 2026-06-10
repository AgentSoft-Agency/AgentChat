# `agent-chat install` — register the MCP into an agent — Design

**Date:** 2026-06-10
**Status:** Approved (pending spec review)

## Overview

Add `install` / `uninstall` commands to the `agent-chat` CLI so a user can
register the project's stdio MCP server into an AI agent's configuration without
hand-editing config files. The first (and only currently implemented) target is
**Claude Code**, registered **user-scoped** by default via the official
`claude mcp add` CLI. The command is built on an extensible agent registry so
additional targets (Cursor, Claude Desktop, etc.) are a small future addition.

## Goals

- `agent-chat install claude-code` registers the MCP server with Claude Code.
- `agent-chat uninstall claude-code` removes it.
- `agent-chat install` (no agent) lists the supported agents.
- The registered server finds its `data/` (config, DB, media) regardless of the
  directory the agent launches it from.
- Pre-flight checks prevent wiring up a server that can't boot.

## Non-goals

- No implementation of agents other than Claude Code (registry is structured for
  them; only `claude-code` ships).
- No changes to the MCP tools, the bridge, or send/allowlist enforcement.
- No management of the agent itself (starting/restarting Claude Code is the
  user's job; we print the reminder).

## The enabler: location-independent data dir

Today `paths()` resolves `data/` from `process.cwd()`. Claude Code spawns the
stdio server from *its* working directory, not the repo, so `data/config.json`
would not be found. Fix:

- `paths()` honors an **`AGENT_CHAT_HOME`** environment variable: when set,
  `dataDir = join(AGENT_CHAT_HOME, "data")`; when unset, it falls back to the
  current `resolve(process.cwd(), "data")` (so running the bridge/CLI/MCP from
  the repo is unchanged).
- The installer sets `AGENT_CHAT_HOME=<absolute repo root>` in the registered
  server's environment, so the server locates its data from any cwd.

This is the only change to existing runtime code; it is additive and backward
compatible.

## Command surface

```
agent-chat install [<agent>] [--scope user|project|local]   # default scope: user
agent-chat uninstall <agent> [--scope user|project|local]
agent-chat install                                          # no agent → list supported agents
```

Unknown agent id → error listing the valid ids. Invalid `--scope` → error.

## Components

- **`src/cli/agents/types.ts`** — the `AgentInstaller` interface and shared
  types:
  ```ts
  export type Scope = "user" | "project" | "local";
  export interface InstallContext { repoRoot: string; scope: Scope; }
  export interface AgentInstaller {
    id: string;                 // e.g. "claude-code"
    label: string;              // e.g. "Claude Code"
    install(ctx: InstallContext): Promise<void>;
    uninstall(ctx: InstallContext): Promise<void>;
  }
  ```

- **`src/cli/agents/claude-code.ts`** — the Claude Code installer.
  - **Pure argv builders** (unit-tested):
    - `buildAddArgs(ctx)` → the argv passed to `claude`:
      ```
      ["mcp","add","agent-chat","-s",<scope>,
       "-e", "AGENT_CHAT_HOME=" + repoRoot,
       "--",
       join(repoRoot,"node_modules/.bin/tsx"),
       join(repoRoot,"src/mcp/index.ts")]
      ```
    - `buildRemoveArgs(scope)` → `["mcp","remove","agent-chat","-s",scope]`
  - **`install`/`uninstall`** run `claude` with those args via a small
    `runClaude(args)` adapter (spawn, inherit stdio, reject on non-zero exit).
    If the `claude` binary is not found on PATH, throw an error that prints the
    exact command to run by hand.

- **`src/cli/agents/registry.ts`** — `list(): AgentInstaller[]` and
  `get(id): AgentInstaller` (unknown id throws an error naming the valid ids).
  Holds the single `claudeCode` entry.

- **`src/cli/install.ts`** — command handlers:
  - `repoRoot()` — resolves the absolute repo root from this module's location
    (`fileURLToPath(import.meta.url)` → up to the package root), so it is correct
    no matter the cwd.
  - `preflight(paths)` — throws if `data/config.json` is missing
    ("No config found. Run 'agent-chat init' first."); returns whether the
    account is linked (`data/auth/creds.json` exists) so the caller can warn.
  - `runInstall(agentId, scope)` — preflight → `registry.get(agentId).install({repoRoot, scope})` → print success + "restart Claude Code to pick it up" (and a "not linked yet — run agent-chat link" warning when applicable).
  - `runUninstall(agentId, scope)` — `registry.get(agentId).uninstall(...)`.
  - `listAgents()` — print the registry's ids + labels.

- **`src/cli/index.ts`** — add `install` and `uninstall` dispatch, parse
  `--scope` (default `user`, validate the value) and the positional agent id.

## Behavior details

- **Default scope** is `user`. `--scope project` registers in `.mcp.json` in the
  cwd; `--scope local` is Claude Code's local scope. The value is passed through
  to `claude mcp add -s <scope>`.
- **Pre-flight** is a hard error on a missing config (don't register a server
  that immediately crashes on boot); a soft warning when not linked.
- **Success output** tells the user to restart Claude Code so it picks up the new
  server, and (if needed) to run `agent-chat link` first.

## Error handling

- `claude` binary absent → clear error + the exact `claude mcp add …` command to
  paste. (Detected by spawn `ENOENT` or an explicit `command -v` style check.)
- Non-zero exit from `claude` → surface its stderr/stdout; exit non-zero.
- Unknown agent id → error listing supported ids.
- Invalid `--scope` → error listing valid scopes.
- All failures exit non-zero, consistent with the rest of the CLI.

## Testing (TDD)

Unit-tested pure logic:
- `paths()` honors `AGENT_CHAT_HOME` (and falls back to cwd when unset).
- `registry` — `list` returns claude-code; `get("claude-code")` works;
  `get("nope")` throws naming valid ids.
- `buildAddArgs` — exact argv for a given repoRoot + scope, including the
  `-e AGENT_CHAT_HOME=<repo>` pair and the `--` boundary before the command.
- `buildRemoveArgs` — exact argv for a given scope.
- `preflight` — throws when `config.json` absent; reports linked=true/false based
  on `auth/creds.json` (temp dir).

`runClaude` (the `spawn`) and the `index.ts` dispatch are thin adapters verified
by `tsc` and a manual `install` → (restart) → `uninstall` round-trip against the
real `claude` CLI.

## Files

```
src/cli/
  install.ts            # repoRoot, preflight, runInstall/runUninstall/listAgents
  agents/
    types.ts            # Scope, InstallContext, AgentInstaller
    registry.ts         # list/get
    claude-code.ts      # buildAddArgs/buildRemoveArgs (pure) + install/uninstall (spawn)
  index.ts              # + install/uninstall dispatch, --scope parsing  (modified)
src/shared/
  paths.ts              # + AGENT_CHAT_HOME override  (modified)
tests/
  shared/paths.test.ts          # + env-override cases  (modified)
  cli/install.test.ts           # registry, buildAddArgs/buildRemoveArgs, preflight  (new)
```

## Docs

README gains a short "Use it from Claude Code" section:

```bash
npm run cli -- install claude-code     # registers the MCP server (user scope)
# restart Claude Code; the WhatsApp tools are now available
npm run cli -- uninstall claude-code   # to remove
```

Note that `install`/`uninstall` require the `claude` CLI on PATH, and that the
server is registered to run from this repo (so keep the repo in place).
