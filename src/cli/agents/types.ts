export type Scope = "user" | "project" | "local";

export interface InstallContext {
  repoRoot: string;
  scope: Scope;
}

export interface AgentInstaller {
  id: string;
  label: string;
  install(ctx: InstallContext): Promise<void>;
  uninstall(ctx: InstallContext): Promise<void>;
}

export const SCOPES: readonly Scope[] = ["user", "project", "local"];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}
