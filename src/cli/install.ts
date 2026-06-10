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
