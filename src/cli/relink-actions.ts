export type LinkAction = "already-linked" | "live-relink" | "standalone";

export function decideLinkAction(probe: { reachable: boolean; state?: string }): LinkAction {
  if (!probe.reachable) return "standalone";
  return probe.state === "connected" ? "already-linked" : "live-relink";
}

export type LogoutAction = "bridge-logout" | "local-clear";

export function decideLogoutAction(reachable: boolean): LogoutAction {
  return reachable ? "bridge-logout" : "local-clear";
}
