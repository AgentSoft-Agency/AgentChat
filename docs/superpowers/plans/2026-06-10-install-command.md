# Agent Install Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `agent-chat install`/`uninstall` so users register the MCP server into an AI agent (Claude Code first) without hand-editing config.

**Architecture:** Make `paths()` honor `AGENT_CHAT_HOME` so the spawned server finds `data/` from any cwd. An extensible agent registry maps an id → an installer; the Claude Code installer builds an argv (pure, tested) and runs the official `claude mcp add`/`claude mcp remove` via a thin `spawn` adapter. A pre-flight guards against registering a server that can't boot. New CLI commands dispatch from `index.ts`.

**Tech Stack:** TypeScript (ESM/NodeNext), `node:child_process` (`spawn`), `node:url` (`fileURLToPath`); `vitest`. Reuses `src/shared/paths.ts` and `src/cli/config-store.ts` conventions.

**Spec:** `docs/superpowers/specs/2026-06-10-install-command-design.md`

---

## File structure

```
src/cli/
  install.ts            # repoRoot(), preflight(), runInstall/runUninstall/listAgents
  agents/
    types.ts            # Scope, InstallContext, AgentInstaller
    claude-code.ts      # buildAddArgs/buildRemoveArgs (pure) + install/uninstall (spawn)
    registry.ts         # list()/get()
  index.ts              # + install/uninstall dispatch, --scope parsing  (modified)
src/shared/
  paths.ts              # + AGENT_CHAT_HOME override  (modified)
tests/
  shared/paths.test.ts  # + env-override cases  (modified)
  cli/agents.test.ts    # registry + buildAddArgs/buildRemoveArgs  (new)
  cli/install.test.ts   # preflight  (new)
```

Pure logic (`paths` override, registry, argv builders, preflight) is unit-tested.
`runClaude` (spawn) and the `index.ts` dispatch are `tsc`-gated + a manual
round-trip against the real `claude` CLI.

---

## Task 1: `paths()` honors `AGENT_CHAT_HOME`

**Files:**
- Modify: `src/shared/paths.ts`
- Test: `tests/shared/paths.test.ts`

- [ ] **Step 1: Write the failing test** (append to `tests/shared/paths.test.ts`, inside the existing `describe("paths", ...)` block)

```ts
  it("uses AGENT_CHAT_HOME/data when the env var is set", () => {
    const prev = process.env.AGENT_CHAT_HOME;
    process.env.AGENT_CHAT_HOME = "/opt/agent-chat";
    try {
      const p = paths();
      expect(p.dataDir).toBe("/opt/agent-chat/data");
      expect(p.configFile).toBe("/opt/agent-chat/data/config.json");
    } finally {
      if (prev === undefined) delete process.env.AGENT_CHAT_HOME;
      else process.env.AGENT_CHAT_HOME = prev;
    }
  });

  it("an explicit dataDir argument overrides AGENT_CHAT_HOME", () => {
    const prev = process.env.AGENT_CHAT_HOME;
    process.env.AGENT_CHAT_HOME = "/opt/agent-chat";
    try {
      expect(paths("/tmp/x").dataDir).toBe("/tmp/x");
    } finally {
      if (prev === undefined) delete process.env.AGENT_CHAT_HOME;
      else process.env.AGENT_CHAT_HOME = prev;
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/paths.test.ts`
Expected: FAIL — `dataDir` is `<cwd>/data`, not `/opt/agent-chat/data`.

- [ ] **Step 3: Implement** — replace the `paths` function body's default in `src/shared/paths.ts`

```ts
export function paths(dataDir = defaultDataDir()): Paths {
  return {
    dataDir,
    dbFile: join(dataDir, "whatsapp.db"),
    authDir: join(dataDir, "auth"),
    mediaDir: join(dataDir, "media"),
    configFile: join(dataDir, "config.json"),
  };
}

function defaultDataDir(): string {
  const home = process.env.AGENT_CHAT_HOME;
  return home ? join(home, "data") : resolve(process.cwd(), "data");
}
```

(Keep the existing `import { join, resolve } from "node:path";` and the `Paths` interface unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/paths.test.ts`
Expected: PASS (new cases + the existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/shared/paths.ts tests/shared/paths.test.ts
git commit -m "feat(paths): honor AGENT_CHAT_HOME for the data dir"
```

---

## Task 2: Agent installer types

**Files:**
- Create: `src/cli/agents/types.ts`

- [ ] **Step 1: Implement**

```ts
export type Scope = "user" | "project" | "local";

export interface InstallContext {
  repoRoot: string;
  scope: Scope;
}

export interface AgentInstaller {
  id: string;
  label: string;
  install(ctx: InstallContext): Promise<void>;
  uninstall(ctx: InstallContext): Promise<void>;
}

export const SCOPES: readonly Scope[] = ["user", "project", "local"];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/cli/agents/types.ts
git commit -m "feat(cli): agent installer types"
```

---

## Task 3: Claude Code argv builders (pure, TDD)

**Files:**
- Create: `src/cli/agents/claude-code.ts`
- Test: `tests/cli/agents.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildAddArgs, buildRemoveArgs } from "../../src/cli/agents/claude-code.js";

describe("claude-code argv builders", () => {
  it("builds the `claude mcp add` argv with env, scope and the -- command boundary", () => {
    const args = buildAddArgs({ repoRoot: "/home/u/agent-chat", scope: "user" });
    expect(args).toEqual([
      "mcp", "add", "agent-chat",
      "-s", "user",
      "-e", "AGENT_CHAT_HOME=/home/u/agent-chat",
      "--",
      "/home/u/agent-chat/node_modules/.bin/tsx",
      "/home/u/agent-chat/src/mcp/index.ts",
    ]);
  });

  it("passes the chosen scope through", () => {
    const args = buildAddArgs({ repoRoot: "/r", scope: "project" });
    expect(args.slice(0, 5)).toEqual(["mcp", "add", "agent-chat", "-s", "project"]);
  });

  it("builds the `claude mcp remove` argv", () => {
    expect(buildRemoveArgs("user")).toEqual(["mcp", "remove", "agent-chat", "-s", "user"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/agents.test.ts`
Expected: FAIL — cannot find module `claude-code.js`.

- [ ] **Step 3: Implement** (`src/cli/agents/claude-code.ts`)

```ts
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { AgentInstaller, InstallContext, Scope } from "./types.js";

const SERVER_NAME = "agent-chat";

export function buildAddArgs(ctx: InstallContext): string[] {
  return [
    "mcp", "add", SERVER_NAME,
    "-s", ctx.scope,
    "-e", `AGENT_CHAT_HOME=${ctx.repoRoot}`,
    "--",
    join(ctx.repoRoot, "node_modules/.bin/tsx"),
    join(ctx.repoRoot, "src/mcp/index.ts"),
  ];
}

export function buildRemoveArgs(scope: Scope): string[] {
  return ["mcp", "remove", SERVER_NAME, "-s", scope];
}

function runClaude(args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("claude", args, { stdio: "inherit" });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new Error(
          `the 'claude' CLI was not found on PATH.\nRun this manually instead:\n  claude ${args.join(" ")}`
        ));
      } else {
        reject(err);
      }
    });
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`'claude ${args.join(" ")}' exited with code ${code}`));
    });
  });
}

export const claudeCode: AgentInstaller = {
  id: "claude-code",
  label: "Claude Code",
  install: (ctx) => runClaude(buildAddArgs(ctx)),
  uninstall: (ctx) => runClaude(buildRemoveArgs(ctx.scope)),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/agents.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add src/cli/agents/claude-code.ts tests/cli/agents.test.ts
git commit -m "feat(cli): claude-code installer argv builders"
```

---

## Task 4: Agent registry (TDD)

**Files:**
- Create: `src/cli/agents/registry.ts`
- Test: `tests/cli/agents.test.ts` (extend)

- [ ] **Step 1: Write the failing test** (append to `tests/cli/agents.test.ts`)

```ts
import { listAgents, getAgent } from "../../src/cli/agents/registry.js";

describe("agent registry", () => {
  it("lists claude-code", () => {
    expect(listAgents().map((a) => a.id)).toContain("claude-code");
  });

  it("gets an installer by id", () => {
    expect(getAgent("claude-code").label).toBe("Claude Code");
  });

  it("throws for an unknown id, naming the valid ids", () => {
    expect(() => getAgent("nope")).toThrow(/unknown agent 'nope'.*claude-code/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/agents.test.ts`
Expected: FAIL — cannot find module `registry.js`.

- [ ] **Step 3: Implement** (`src/cli/agents/registry.ts`)

```ts
import type { AgentInstaller } from "./types.js";
import { claudeCode } from "./claude-code.js";

const AGENTS: AgentInstaller[] = [claudeCode];

export function listAgents(): AgentInstaller[] {
  return AGENTS;
}

export function getAgent(id: string): AgentInstaller {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) {
    const ids = AGENTS.map((a) => a.id).join(", ");
    throw new Error(`unknown agent '${id}'. Supported: ${ids}`);
  }
  return agent;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/agents.test.ts`
Expected: PASS (registry + argv-builder tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/agents/registry.ts tests/cli/agents.test.ts
git commit -m "feat(cli): agent registry"
```

---

## Task 5: Pre-flight + command handlers (TDD for preflight)

**Files:**
- Create: `src/cli/install.ts`
- Test: `tests/cli/install.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/cli/install.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths } from "../../src/shared/paths.js";
import { preflight } from "../../src/cli/install.js";

function tmpHome(): string {
  const home = mkdtempSync(join(tmpdir(), "agentchat-home-"));
  mkdirSync(join(home, "data"), { recursive: true });
  return home;
}

describe("preflight", () => {
  it("throws when config.json is missing", () => {
    const p = paths(join(tmpHome(), "data"));
    expect(() => preflight(p)).toThrow(/init/i);
  });

  it("returns linked=false when config exists but no creds", () => {
    const home = tmpHome();
    writeFileSync(join(home, "data", "config.json"), "{}");
    const p = paths(join(home, "data"));
    expect(preflight(p)).toEqual({ linked: false });
  });

  it("returns linked=true when creds.json exists", () => {
    const home = tmpHome();
    writeFileSync(join(home, "data", "config.json"), "{}");
    mkdirSync(join(home, "data", "auth"), { recursive: true });
    writeFileSync(join(home, "data", "auth", "creds.json"), "{}");
    const p = paths(join(home, "data"));
    expect(preflight(p)).toEqual({ linked: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/install.test.ts`
Expected: FAIL — cannot find module `install.js`.

- [ ] **Step 3: Implement** (`src/cli/install.ts`)

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { paths, type Paths } from "../shared/paths.js";
import { getAgent, listAgents } from "./agents/registry.js";
import type { Scope } from "./agents/types.js";

/** Absolute repo root, derived from this module's location (src/cli/install.ts → ../..). */
export function repoRoot(): string {
  return join(fileURLToPath(import.meta.url), "..", "..", "..");
}

export function preflight(p: Paths): { linked: boolean } {
  if (!existsSync(p.configFile)) {
    throw new Error("No config found. Run 'agent-chat init' first.");
  }
  return { linked: existsSync(join(p.authDir, "creds.json")) };
}

export async function runInstall(agentId: string, scope: Scope): Promise<void> {
  const agent = getAgent(agentId);
  const root = repoRoot();
  const { linked } = preflight(paths());
  await agent.install({ repoRoot: root, scope });
  console.log(`\n✅ registered the agent-chat MCP server with ${agent.label} (${scope} scope).`);
  console.log("   Restart Claude Code to pick it up.");
  if (!linked) console.log("   ⚠ not linked yet — run 'agent-chat link' before using it.");
}

export async function runUninstall(agentId: string, scope: Scope): Promise<void> {
  const agent = getAgent(agentId);
  await agent.uninstall({ repoRoot: repoRoot(), scope });
  console.log(`✅ removed the agent-chat MCP server from ${agent.label} (${scope} scope).`);
}

export function listAgentsForDisplay(): void {
  console.log("Supported agents:");
  for (const a of listAgents()) console.log(`  ${a.id}  —  ${a.label}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/install.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add src/cli/install.ts tests/cli/install.test.ts
git commit -m "feat(cli): install preflight and command handlers"
```

---

## Task 6: Wire `install`/`uninstall` into the dispatcher

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Add the import** — after the existing `import { runLink } from "./link.js";` line in `src/cli/index.ts`, add:

```ts
import { runInstall, runUninstall, listAgentsForDisplay } from "./install.js";
import { isScope, type Scope } from "./agents/types.js";
```

- [ ] **Step 2: Extend the help text** — in the `HELP` template string, add these lines after the `link` line:

```
  agent-chat install [<agent>] [--scope user|project|local]   register the MCP into an agent
  agent-chat uninstall <agent> [--scope ...]                  remove it
```

- [ ] **Step 3: Add the dispatch cases** — in the `switch (command)` block, add these cases before `case "show":`

```ts
    case "install": {
      const { values, positionals } = parseArgs({
        args: rest, options: { scope: { type: "string" } }, allowPositionals: true,
      });
      const agentId = positionals[0];
      if (!agentId) { listAgentsForDisplay(); break; }
      const scope = (values.scope ?? "user");
      if (!isScope(scope)) throw new Error(`invalid --scope '${scope}' (use user|project|local)`);
      await runInstall(agentId, scope as Scope);
      break;
    }
    case "uninstall": {
      const { values, positionals } = parseArgs({
        args: rest, options: { scope: { type: "string" } }, allowPositionals: true,
      });
      const agentId = positionals[0];
      if (!agentId) throw new Error("usage: agent-chat uninstall <agent> [--scope ...]");
      const scope = (values.scope ?? "user");
      if (!isScope(scope)) throw new Error(`invalid --scope '${scope}' (use user|project|local)`);
      await runUninstall(agentId, scope as Scope);
      break;
    }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Smoke-test the no-spawn paths** (these don't invoke `claude`)

```bash
npm run cli -- install 2>&1 | grep -vE '^(>|$)'        # lists: claude-code — Claude Code
npm run cli -- install claude-code --scope bogus; echo "exit=$?"   # invalid scope → error + exit 1
npm run cli -- uninstall; echo "exit=$?"                # usage error → exit 1
npm run cli -- help 2>&1 | grep -i install              # help shows install/uninstall
```
Expected: `install` (no arg) lists `claude-code`; bogus scope → `error: invalid --scope 'bogus' ...` and `exit=1`; `uninstall` with no agent → usage error + `exit=1`; help lists the new commands.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(cli): install/uninstall dispatch"
```

---

## Task 7: README — "Use it from Claude Code"

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a section** after the "Tools" section in `README.md`:

````markdown
## Use it from Claude Code

Register the MCP server with Claude Code (user scope) straight from the CLI:

```bash
npm run cli -- install claude-code     # runs `claude mcp add` under the hood
# restart Claude Code — the WhatsApp tools are now available
npm run cli -- uninstall claude-code   # to remove it
```

`agent-chat install` with no argument lists the supported agents. Other scopes:
`--scope project` (a `.mcp.json` in the current directory) or `--scope local`.

Requirements: the `claude` CLI must be on your `PATH`, and this repo must stay in
place (the server is registered to run from here, with `AGENT_CHAT_HOME` pointing
at it so it finds your `data/`). Run `agent-chat init` (and `link`) first.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: install/uninstall for Claude Code"
```

---

## Task 8: Manual round-trip (real `claude` CLI)

**Files:** none (manual checklist — needs the `claude` binary and `data/config.json` present).

- [ ] **Step 1:** `npm run cli -- install claude-code` → exits 0, prints the success + restart message.
- [ ] **Step 2:** `claude mcp list` → shows `agent-chat` (user scope). Confirm the registered command/env are correct (absolute `tsx`, `src/mcp/index.ts`, `AGENT_CHAT_HOME` = this repo). NOTE: if the installed `claude mcp add` flag syntax differs (e.g. `-e`/`-s`/`--` handling), adjust `buildAddArgs` to match and re-run Tasks 3 & 6.
- [ ] **Step 3:** In a *different* directory, confirm the server boots and finds config — e.g. `AGENT_CHAT_HOME=$(pwd) /bin/sh -c 'cd /tmp && printf "%s\n%s\n" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"t\",\"version\":\"0\"}}}" "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}" | timeout 40 '"$(pwd)"'/node_modules/.bin/tsx '"$(pwd)"'/src/mcp/index.ts'` lists the tools (proves `AGENT_CHAT_HOME` makes it cwd-independent).
- [ ] **Step 4:** `npm run cli -- uninstall claude-code` → `claude mcp list` no longer shows `agent-chat`.
- [ ] **Step 5:** Final commit if any tweak to `buildAddArgs` was needed.

```bash
git add -A && git commit -m "chore: install round-trip verified" --allow-empty
```

---

## Self-review notes

- **Spec coverage:** `AGENT_CHAT_HOME` enabler (Task 1); `AgentInstaller`/`Scope`/`isScope` (Task 2); claude-code argv builders + spawn adapter + ENOENT message (Task 3); registry list/get/unknown (Task 4); preflight hard-error/linked + handlers + repoRoot via `import.meta.url` (Task 5); `--scope` parsing, no-arg lists agents, dispatch (Task 6); README (Task 7); manual round-trip incl. cwd-independence proof (Task 8). All spec sections map to a task.
- **Type consistency:** `Scope`, `InstallContext`, `AgentInstaller` (Task 2) are reused unchanged in Tasks 3–6; `buildAddArgs(ctx: InstallContext)` / `buildRemoveArgs(scope: Scope)` signatures match their call sites; `getAgent`/`listAgents` names match between registry (Task 4) and install.ts (Task 5); `paths`/`Paths` import in install.ts matches `src/shared/paths.ts`.
- **Known risk to verify (Task 8):** the exact `claude mcp add` flag syntax (`-s`, `-e`, `--`) is asserted in the Task 3 unit test against our expected argv; if the installed `claude` differs, the manual round-trip catches it and `buildAddArgs` is the single place to adjust.
- **YAGNI:** only `claude-code` is implemented; the registry makes more agents additive without touching the dispatch.
