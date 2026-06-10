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
    let done = false;
    const settle = (fn: () => void) => { if (!done) { done = true; fn(); } };
    const child = spawn("claude", args, { stdio: "inherit" });
    child.on("error", (err: NodeJS.ErrnoException) => {
      settle(() => {
        if (err.code === "ENOENT") {
          reject(new Error(
            `the 'claude' CLI was not found on PATH.\nRun this manually instead:\n  claude ${args.join(" ")}`
          ));
        } else {
          reject(err);
        }
      });
    });
    child.on("close", (code, signal) => {
      settle(() => {
        if (code === 0) resolvePromise();
        else if (signal) reject(new Error(`'claude ${args.join(" ")}' was killed by ${signal}`));
        else reject(new Error(`'claude ${args.join(" ")}' exited with code ${code}`));
      });
    });
  });
}

export const claudeCode: AgentInstaller = {
  id: "claude-code",
  label: "Claude Code",
  install: (ctx) => runClaude(buildAddArgs(ctx)),
  uninstall: (ctx) => runClaude(buildRemoveArgs(ctx.scope)),
};
