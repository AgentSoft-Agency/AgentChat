import { createInterface } from "node:readline/promises";
import { existsSync, readFileSync } from "node:fs";
import * as store from "./config-store.js";

function requireConfig(configFile: string): store.RawConfig {
  if (!existsSync(configFile)) {
    throw new Error("No config found. Run 'agent-chat init' first.");
  }
  return store.readConfig(configFile);
}

interface Asker {
  (prompt: string): Promise<string>;
  close(): void;
}

function makeAsker(): Asker {
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (async (q: string) => (await rl.question(q)).trim()) as Asker;
    ask.close = () => rl.close();
    return ask;
  }
  // Non-interactive: consume all piped stdin, answer prompts in order.
  const lines = readFileSync(0, "utf8").split("\n");
  let i = 0;
  const ask = (async (q: string) => {
    process.stdout.write(q);
    return (lines[i++] ?? "").trim();
  }) as Asker;
  ask.close = () => {};
  return ask;
}

export async function init(configFile: string, force: boolean): Promise<void> {
  if (existsSync(configFile) && !force) {
    throw new Error(`config already exists at ${configFile} (use --force to overwrite)`);
  }
  let config = store.createDefault();
  const ask = makeAsker();
  try {
    const portAns = await ask(`Bridge port [${config.bridgePort}]: `);
    if (portAns) config = store.setPort(config, Number(portAns));
    const num = await ask("First allowed number (blank to skip): ");
    if (num) {
      const label = await ask("Label (optional): ");
      config = store.addAllowlist(config, num, { label: label || undefined });
    }
  } finally {
    ask.close();
  }
  store.writeConfig(configFile, config);
  console.log(`\n✅ wrote ${configFile} (token generated, mode 600). Next: agent-chat link`);
}

export function allowlist(
  configFile: string,
  sub: string | undefined,
  number: string | undefined,
  opts: store.AllowOpts = {}
): void {
  if (sub === "list") {
    const entries = store.listAllowlist(requireConfig(configFile));
    if (entries.length === 0) { console.log("(no entries)"); return; }
    for (const e of entries) console.log(formatEntry(e));
    return;
  }
  if (sub === "add") {
    if (!number) throw new Error("usage: agent-chat allowlist add <number> [--label <name>] [--confirm|--no-confirm] [--lang <language>]");
    store.writeConfig(configFile, store.addAllowlist(requireConfig(configFile), number, opts));
    const tags = [
      opts.confirm === false ? "no-confirm" : opts.confirm === true ? "confirm" : null,
      opts.language ? `lang:${opts.language}` : null,
    ].filter(Boolean).join(", ");
    console.log(`✅ added ${store.normalizeNumber(number)}${opts.label ? ` (${opts.label})` : ""}${tags ? ` [${tags}]` : ""}`);
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

function formatEntry(e: { number: string; label?: string; confirm: boolean; language?: string }): string {
  const parts = [e.number];
  if (e.label) parts.push(e.label);
  parts.push(e.confirm ? "[confirm]" : "[no-confirm]");
  if (e.language) parts.push(`lang:${e.language}`);
  return "  " + parts.join("  ");
}

export function defaultLanguage(configFile: string, language: string): void {
  store.writeConfig(configFile, store.setDefaultLanguage(requireConfig(configFile), language));
  console.log(`✅ default language set to ${language.trim()}`);
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
  console.log(`port:     ${c.bridgePort}`);
  console.log(`token:    ${c.bridgeToken ? "•••• (set)" : "(missing)"}`);
  console.log(`language: ${c.defaultLanguage ?? "English"}`);
  const entries = store.listAllowlist(c);
  console.log(`allowlist (${entries.length}):`);
  for (const e of entries) console.log(formatEntry(e));
}
