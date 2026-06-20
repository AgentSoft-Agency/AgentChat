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
import { buildAllowOpts, formatStatusLine, formatAllowEntryLabel } from "./menu-actions.js";
import { normalizeNumber } from "./config-store.js";
import type { AllowEntry } from "../shared/types.js";

const nonEmpty = (v: string | undefined) => (v?.trim() ? undefined : "required");

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
        validate: (v) => (/^[0-9]+$/.test((v ?? "").trim()) ? undefined : "enter a positive integer"),
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
    initialValue: (entry.confirm ? "confirm" : "no-confirm") as "confirm" | "no-confirm",
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
