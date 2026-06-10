#!/usr/bin/env -S npx tsx
import { parseArgs } from "node:util";
import { paths } from "../shared/paths.js";
import * as cmd from "./commands.js";
import { runLink } from "./link.js";
import { runInstall, runUninstall, listAgentsForDisplay } from "./install.js";
import { isScope, type Scope } from "./agents/types.js";

const HELP = `agent-chat — configure @agentsoft/agent-chat

Usage:
  agent-chat init [--force]                       create data/config.json
  agent-chat link [--pair <number>]               link your WhatsApp account
  agent-chat allowlist list
  agent-chat allowlist add <number> [--label <name>]
  agent-chat allowlist remove <number>
  agent-chat token rotate                         generate a new bridge token
  agent-chat port <number>                        set the bridge port
  agent-chat install [<agent>] [--scope user|project|local]   register the MCP into an agent
  agent-chat uninstall <agent> [--scope ...]                  remove it
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
      if (!rest[0]) throw new Error("usage: agent-chat port <number>");
      cmd.setPort(p.configFile, rest[0]);
      break;
    }
    case "install": {
      const { values, positionals } = parseArgs({
        args: rest, options: { scope: { type: "string" } }, allowPositionals: true,
      });
      const agentId = positionals[0];
      if (!agentId) { listAgentsForDisplay(); break; }
      const scope = values.scope ?? "user";
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
      const scope = values.scope ?? "user";
      if (!isScope(scope)) throw new Error(`invalid --scope '${scope}' (use user|project|local)`);
      await runUninstall(agentId, scope as Scope);
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
