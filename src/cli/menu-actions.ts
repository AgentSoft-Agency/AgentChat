import type { AllowOpts } from "./config-store.js";

export type ConfirmChoice = "default" | "confirm" | "no-confirm";

/** Assemble allowlist upsert options from interactive answers.
 *  Blank label/language are omitted; the "default" confirm choice leaves
 *  confirm unset so config-store's merge preserves any existing value. */
export function buildAllowOpts(a: { label: string; confirmChoice: ConfirmChoice; language: string }): AllowOpts {
  const opts: AllowOpts = {};
  const label = a.label.trim();
  if (label) opts.label = label;
  if (a.confirmChoice === "confirm") opts.confirm = true;
  else if (a.confirmChoice === "no-confirm") opts.confirm = false;
  const language = a.language.trim();
  if (language) opts.language = language;
  return opts;
}

export interface ProbeResult {
  reachable: boolean;
  state?: string;
}

const STATE_WORDS: Record<string, string> = {
  connected: "connected",
  needs_relink: "needs re-link",
  connecting: "connecting",
  qr_available: "QR ready",
};

/** One-line bridge status header: glyph + state word + port. */
export function formatStatusLine(probe: ProbeResult, port: number): string {
  if (!probe.reachable) return `Bridge: ○ down  ·  port ${port}`;
  const state = probe.state ?? "unknown";
  const glyph = state === "connected" ? "●" : "◍";
  const word = STATE_WORDS[state] ?? state;
  return `Bridge: ${glyph} ${word}  ·  port ${port}`;
}

export type LaunchDecision = "menu" | "help" | "error-needs-tty";

/** Routing for bare `agent-chat` and the explicit `agent-chat menu`. */
export function chooseLaunch(input: { command: string | undefined; isTTY: boolean }): LaunchDecision {
  if (input.command === "menu") return input.isTTY ? "menu" : "error-needs-tty";
  return input.isTTY ? "menu" : "help"; // no command
}
