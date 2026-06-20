# Allowlist menu: split add/update + selectable list — design

## Problem

The interactive menu's `Allowlist` sub-menu currently offers `List entries` /
`Add or update an entry` / `Remove an entry`. "Add" is a merge-upsert, so it
doubles as update — there is no distinct update path, and editing an existing
entry means re-typing its number. The list is a static printout; you can't act
on an entry from it.

## Goals

- Split **Add** (new numbers only) from **Update** (existing entries).
- Make the entry list **selectable**: pick an entry, then Update or Remove it.
- When updating, start each prompt on the entry's **current value**.

## Non-goals

- No change to the config store, the allowlist semantics, the `agent-chat
  allowlist` command, the bridge, or any other menu action (link/logout/
  language/token/port/install/show).
- No new way to **clear** a label/language. Update uses the store's existing
  merge, which can change or set fields but not blank them; clearing means
  Remove + re-Add. (Accepted limitation.)

## Behavior

The `Allowlist` sub-menu becomes:

```
Allowlist
  Add a number
  View / edit entries
  Back
```

### Add a number

1. Prompt for the number (`text`, required).
2. If a normalized-equal number is already on the allowlist, warn
   (`<number> is already on the allowlist. Use 'View / edit entries' to change
   it.`) and return — no overwrite.
3. Otherwise the existing add prompts: label (optional) → confirm choice
   (3-way `select`: `default` / `confirm` / `no-confirm`) → language (optional)
   → upsert via `cmd.allowlist(configFile, "add", number, opts)`.

### View / edit entries

1. If the allowlist is empty, inform (`No allowlist entries yet. Choose 'Add a
   number' to create one.`) and return.
2. Otherwise a `select` listing each entry, plus a `Back` option:
   ```
   Select an entry
     +<number>  <label>  [confirm|no-confirm]  lang:<language>
     …
     Back
   ```
   The per-entry label is built by `formatAllowEntryLabel`. The `Back` option
   uses a sentinel value (`__back__`) that cannot collide with a digits-only
   number.
3. On picking an entry:
   ```
   Entry <number>
     Update
     Remove
     Back
   ```
   - **Update** → label (`text`, `initialValue` = current label or `""`) →
     confirm (`select`, **2 options** `confirm` / `no-confirm`, `initialValue`
     pre-set to the entry's current `confirm`) → language (`text`,
     `initialValue` = current language or `""`) → upsert via
     `cmd.allowlist(configFile, "add", number, opts)`. Because each field is
     pre-filled with the current value, submitting unchanged re-applies the
     same value; the merge means a deliberately-cleared label/language is *not*
     blanked (see Non-goals).
   - **Remove** → `confirm` (`Remove <number> from the allowlist?`); if yes,
     `cmd.allowlist(configFile, "remove", number)`.

## Components

### `src/cli/menu.ts`

Rewrite `allowlistAction(paths)` and add private helpers:

- `addEntry(paths)` — the Add flow above, including the duplicate check.
- `viewEntries(paths)` — load entries, render the selectable list, dispatch to
  `editEntry`.
- `editEntry(paths, entry)` — the Update / Remove / Back choice for one entry.
- `updateEntry(paths, entry)` — the pre-filled update prompts.

Entries are read straight from `loadConfig(paths.configFile).allowlist` (already
a normalized `AllowEntry[]` = `{ number; confirm; label?; language? }`). The
duplicate check normalizes the typed number with `normalizeNumber` (from
`config-store.ts`) and compares against `entry.number`. All writes continue to
go through `cmd.allowlist(...)`; no business logic moves into the menu.

`buildAllowOpts` is reused unchanged: in Update the `confirmChoice` is always
`"confirm"` or `"no-confirm"` (a subset of `ConfirmChoice`), which it already
maps to explicit booleans; in Add the 3-way including `"default"` is unchanged.

### `src/cli/menu-actions.ts`

Add a pure helper:

```
formatAllowEntryLabel(e: AllowEntry): string
```

Returns `+<number>  <label?>  [confirm|no-confirm]  lang:<language?>`, omitting
the label and `lang:` segments when absent. `AllowEntry` is imported from
`../shared/types.js`.

## Error handling & edge cases

- **Cancellation:** every prompt stays `isCancel`-guarded — cancel returns to
  the previous menu level (sub-prompt → entry list / sub-menu; the wrapping
  action try/catch in `runMenu` is unchanged).
- **Empty allowlist:** View / edit entries informs and returns (no empty
  `select`).
- **Duplicate on Add:** warned and aborted, not overwritten.
- **Entry vanished:** if the picked number isn't found after selection (config
  changed underneath), return quietly.
- **Remove confirm:** a `confirm` gates removal of the highlighted entry.

## Testing

- **Unit (vitest):** `formatAllowEntryLabel` — label present/absent, confirm vs
  no-confirm, language present/absent, and a bare number (no label/language).
  Added to `tests/cli/menu-actions.test.ts`.
- **Type-check + manual E2E:** the clack flow (selectable list → Update/Remove,
  pre-filled update prompts, duplicate rejection, empty-list message) is
  verified by `tsc --noEmit` and a manual run, per the repo convention for
  interactive code.

## Docs

No README change: the "Interactive menu" subsection lists `allowlist` among the
actions but does not enumerate the sub-flow, so it stays accurate.
