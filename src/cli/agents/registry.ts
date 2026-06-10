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
