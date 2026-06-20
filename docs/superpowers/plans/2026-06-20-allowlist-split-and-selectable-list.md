# Allowlist menu: split add/update + selectable list — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the interactive menu's `Allowlist` sub-menu into `Add a number` / `View / edit entries` / `Back`, where Add rejects duplicates and the entry list is selectable (pick → Update or Remove), with Update prompts pre-filled from the entry's current values.

**Architecture:** A pure label-formatter (`formatAllowEntryLabel`) joins `src/cli/menu-actions.ts`'s other tested helpers; the rest is a rewrite of `allowlistAction` in `src/cli/menu.ts` into small clack-driven helpers (`addEntry`, `viewEntries`, `editEntry`, `updateEntry`) that read entries from `loadConfig(...).allowlist` and write through the existing `cmd.allowlist(...)`. No store, command, or bridge logic changes.

**Tech Stack:** TypeScript (ESM, NodeNext, `.js` import extensions), `tsx`, `@clack/prompts`, `vitest`.

## Global Constraints

- **No change** to `config-store.ts`, `commands.ts`, the `agent-chat allowlist` command, the bridge, or any non-allowlist menu action. All allowlist writes go through `cmd.allowlist(configFile, "add"|"remove", number, opts?)`.
- **Add** is for new numbers only: if a normalized-equal number already exists, warn and return without overwriting.
- **Update** pre-fills each prompt with the entry's current value; it uses the store's merge (via `cmd.allowlist(... "add" ...)`), so it can change/set fields but cannot blank an existing label/language.
- **Update's confirm prompt has exactly two options** (`confirm` / `no-confirm`), `initialValue` set to the entry's current `confirm`. **Add's confirm prompt keeps the three options** (`default` / `confirm` / `no-confirm`).
- ESM NodeNext: intra-repo imports use `.js` extensions on `.ts` sources; `@clack/prompts` imports take no extension.
- Every clack prompt stays `isCancel`-guarded. The `View / edit entries` `Back` option uses the sentinel value `"__back__"` (cannot collide with a digits-only number).
- Conventional Commits (commit-msg hook); pre-commit runs `npm run typecheck && npm test` — both must pass per commit.
- Reuse `buildAllowOpts` unchanged (it already maps `"confirm"`/`"no-confirm"` to explicit booleans and omits blank label/language). Reuse `normalizeNumber` from `config-store.ts` for the duplicate check.

---

### Task 1: `formatAllowEntryLabel` pure helper

A pure formatter turning an allowlist entry into a one-line `select` label. Lives beside the other tested pure helpers.

**Files:**
- Modify: `src/cli/menu-actions.ts` (add the function + an `AllowEntry` type import)
- Test: `tests/cli/menu-actions.test.ts` (add a describe block + extend the import)

**Interfaces:**
- Consumes: `AllowEntry` from `src/shared/types.ts` — `{ number: string; label?: string; confirm: boolean; language?: string }`.
- Produces: `formatAllowEntryLabel(e: AllowEntry): string` → `+<number>  <label?>  [confirm|no-confirm]  lang:<language?>`, segments joined by two spaces, label and `lang:` omitted when absent.

- [ ] **Step 1: Write the failing tests**

In `tests/cli/menu-actions.test.ts`, extend the existing import line to add `formatAllowEntryLabel`:

```ts
import { buildAllowOpts, formatStatusLine, chooseLaunch, formatAllowEntryLabel } from "../../src/cli/menu-actions.js";
```

Then add this describe block at the end of the file:

```ts
describe("formatAllowEntryLabel", () => {
  it("renders a bare number with just the confirm flag", () => {
    expect(formatAllowEntryLabel({ number: "5215512345678", confirm: true })).toBe("+5215512345678  [confirm]");
  });
  it("includes label and language with no-confirm", () => {
    expect(
      formatAllowEntryLabel({ number: "5215599999999", label: "Mom", confirm: false, language: "Spanish" })
    ).toBe("+5215599999999  Mom  [no-confirm]  lang:Spanish");
  });
  it("includes a label without language", () => {
    expect(formatAllowEntryLabel({ number: "5215500000000", label: "Work", confirm: true })).toBe(
      "+5215500000000  Work  [confirm]"
    );
  });
  it("includes language without a label", () => {
    expect(formatAllowEntryLabel({ number: "5215511111111", confirm: false, language: "English" })).toBe(
      "+5215511111111  [no-confirm]  lang:English"
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/cli/menu-actions.test.ts`
Expected: FAIL — `formatAllowEntryLabel is not a function` / no exported member `formatAllowEntryLabel` (the 4 new tests fail; the existing 11 still pass).

- [ ] **Step 3: Write the implementation**

In `src/cli/menu-actions.ts`, add an import for `AllowEntry` near the existing `AllowOpts` import:

```ts
import type { AllowEntry } from "../shared/types.js";
```

Then add this function (place it after `buildAllowOpts`):

```ts
/** One-line label for an allowlist entry in a select prompt:
 *  `+<number>  <label?>  [confirm|no-confirm]  lang:<language?>`. */
export function formatAllowEntryLabel(e: AllowEntry): string {
  const parts = [`+${e.number}`];
  if (e.label) parts.push(e.label);
  parts.push(e.confirm ? "[confirm]" : "[no-confirm]");
  if (e.language) parts.push(`lang:${e.language}`);
  return parts.join("  ");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/cli/menu-actions.test.ts`
Expected: PASS — 15 tests (11 existing + 4 new).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass (114 = 110 prior + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/cli/menu-actions.ts tests/cli/menu-actions.test.ts
git commit -m "feat(cli): formatAllowEntryLabel helper for the allowlist menu"
```

---

### Task 2: Rewrite `allowlistAction` (split add/update + selectable list)

Replace the single `allowlistAction` with the new hub structure and its helpers. Pure orchestration over the existing command and config — no business logic added.

**Files:**
- Modify: `src/cli/menu.ts` — extend imports (lines 13-14 area), replace `allowlistAction` (lines 148-190)

**Interfaces:**
- Consumes:
  - `formatAllowEntryLabel(e: AllowEntry): string` from `./menu-actions.js` (Task 1)
  - `buildAllowOpts(a: { label: string; confirmChoice: ConfirmChoice; language: string }): AllowOpts` from `./menu-actions.js` (existing)
  - `normalizeNumber(input: string): string` from `./config-store.js` (existing)
  - `AllowEntry` from `../shared/types.js` — `{ number: string; label?: string; confirm: boolean; language?: string }`
  - `loadConfig(configFile): AppConfig` (existing; `AppConfig.allowlist` is `AllowEntry[]`)
  - `cmd.allowlist(configFile, sub, number, opts?)` (existing)
  - clack `select`, `text`, `confirm`, `isCancel`, `log` (already imported in `menu.ts`)
- Produces: no new exports (all helpers are private to `menu.ts`).

- [ ] **Step 1: Extend the imports in `menu.ts`**

Change the menu-actions import (currently line 14) to add `formatAllowEntryLabel`:

```ts
import { buildAllowOpts, formatStatusLine, formatAllowEntryLabel } from "./menu-actions.js";
```

Add two imports after it:

```ts
import { normalizeNumber } from "./config-store.js";
import type { AllowEntry } from "../shared/types.js";
```

(`AppConfig` is already imported from `../shared/types.js` on line 4; the new `AllowEntry` import is a separate `import type` line — that's fine.)

- [ ] **Step 2: Replace `allowlistAction`**

Replace the entire existing `allowlistAction` function (currently lines 148-190, from `async function allowlistAction(paths: Paths): Promise<void> {` through its closing brace) with the following five functions:

```ts
async function allowlistAction(paths: Paths): Promise<void> {
  const sub = await select({
    message: "Allowlist",
    options: [
      { value: "add", label: "Add a number" },
      { value: "view", label: "View / edit entries" },
      { value: "back", label: "Back" },
    ],
  });
  if (isCancel(sub) || sub === "back") return;
  if (sub === "add") {
    await addEntry(paths);
    return;
  }
  await viewEntries(paths);
}

async function addEntry(paths: Paths): Promise<void> {
  const number = await text({ message: "Number (digits)", validate: nonEmpty });
  if (isCancel(number)) return;

  const normalized = normalizeNumber(number);
  const config = loadConfig(paths.configFile);
  if (config.allowlist.some((e) => e.number === normalized)) {
    log.warn(`${normalized} is already on the allowlist. Use 'View / edit entries' to change it.`);
    return;
  }

  const label = await text({ message: "Label (optional)", placeholder: "" });
  if (isCancel(label)) return;
  const confirmChoice = await select({
    message: "Require confirmation before this contact's messages reach the agent?",
    options: [
      { value: "default", label: "Use the default (require confirmation)" },
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

async function viewEntries(paths: Paths): Promise<void> {
  const config = loadConfig(paths.configFile);
  if (config.allowlist.length === 0) {
    log.info("No allowlist entries yet. Choose 'Add a number' to create one.");
    return;
  }

  const picked = await select({
    message: "Select an entry",
    options: [
      ...config.allowlist.map((e) => ({ value: e.number, label: formatAllowEntryLabel(e) })),
      { value: "__back__", label: "Back" },
    ],
  });
  if (isCancel(picked) || picked === "__back__") return;

  const entry = config.allowlist.find((e) => e.number === picked);
  if (!entry) return; // config changed underneath us
  await editEntry(paths, entry);
}

async function editEntry(paths: Paths, entry: AllowEntry): Promise<void> {
  const op = await select({
    message: `Entry +${entry.number}`,
    options: [
      { value: "update", label: "Update" },
      { value: "remove", label: "Remove" },
      { value: "back", label: "Back" },
    ],
  });
  if (isCancel(op) || op === "back") return;

  if (op === "remove") {
    const ok = await confirm({ message: `Remove ${entry.number} from the allowlist?` });
    if (isCancel(ok) || !ok) return;
    cmd.allowlist(paths.configFile, "remove", entry.number);
    return;
  }

  await updateEntry(paths, entry);
}

async function updateEntry(paths: Paths, entry: AllowEntry): Promise<void> {
  const label = await text({ message: "Label", initialValue: entry.label ?? "" });
  if (isCancel(label)) return;
  const confirmChoice = await select({
    message: "Require confirmation before this contact's messages reach the agent?",
    initialValue: entry.confirm ? "confirm" : "no-confirm",
    options: [
      { value: "confirm", label: "Yes — require confirmation" },
      { value: "no-confirm", label: "No — deliver without confirmation" },
    ],
  });
  if (isCancel(confirmChoice)) return;
  const language = await text({ message: "Language (optional)", initialValue: entry.language ?? "" });
  if (isCancel(language)) return;

  const opts = buildAllowOpts({ label, confirmChoice, language });
  cmd.allowlist(paths.configFile, "add", entry.number, opts);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. This confirms the clack types resolve (the `select` value unions, the `initialValue` on the update confirm matching its `"confirm" | "no-confirm"` options, and `buildAllowOpts` accepting the `confirmChoice`).

- [ ] **Step 4: Confirm the routing still works (non-interactive) + full suite**

The allowlist flow itself is interactive (needs a TTY) and is verified by a human in Step 5. These confirm nothing else broke:

```bash
npm run cli -- menu | cat   # → "error: interactive menu needs a terminal..."; exit 1
npm run cli -- help         # → prints help (menu line present)
npm run typecheck && npm test
```

Expected: the first prints the needs-a-terminal error (`echo $?` → 1); help prints; typecheck clean; all 114 tests pass (no automated tests added this task).

- [ ] **Step 5: Manual E2E note (for the human after merge)**

In a real terminal: `npm run cli` → `Allowlist`:
- **Add a number** with a new number → completes; re-running Add with the same number → warns it already exists and returns.
- **View / edit entries** → the list shows each entry via `formatAllowEntryLabel`; selecting one → `Update` re-shows current values pre-filled and saves changes; `Remove` confirms then deletes; `Back` returns. With no entries, it shows the "No allowlist entries yet" message.

- [ ] **Step 6: Commit**

```bash
git add src/cli/menu.ts
git commit -m "feat(cli): split allowlist add/update with a selectable list"
```

---

## Notes for the implementer

- **Don't touch `config-store.ts` / `commands.ts`.** Update intentionally relies on `addAllowlist`'s merge; the inability to blank a label/language is an accepted limitation (Remove + re-Add to clear).
- **clack narrowing:** after `if (isCancel(x)) return;`, `x` narrows from `string | symbol` to `string` (or the option-value union), so `label`/`language` pass to `buildAllowOpts` as `string` and `picked`/`number` are `string`. No casts needed beyond what's shown.
- **`nonEmpty`** is the existing module-level helper in `menu.ts` (`(v: string | undefined) => v?.trim() ? undefined : "required"`) — reuse it; don't redefine it.
- The `view` value, `"__back__"` sentinel, and the per-entry `value: e.number` all type as `string`, so each `select`'s `picked`/`sub`/`op` is `string | symbol`; the `=== "..."` comparisons are valid.
