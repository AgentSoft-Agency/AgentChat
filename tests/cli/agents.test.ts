import { describe, it, expect } from "vitest";
import { buildAddArgs, buildRemoveArgs } from "../../src/cli/agents/claude-code.js";
import { listAgents, getAgent } from "../../src/cli/agents/registry.js";

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
