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
