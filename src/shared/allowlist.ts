import { jidToNumber, numberToContactJid } from "./normalize.js";
import type { AllowEntry } from "./types.js";

/** Accepts a plain phone number or a full jid; returns a jid. */
export function resolveRecipient(to: string): string {
  return to.includes("@") ? to : numberToContactJid(to);
}

export function isAllowed(allowlist: AllowEntry[], jid: string): boolean {
  return findPolicy(allowlist, jid) !== undefined;
}

/** The policy entry for a jid, or undefined if not allowed. */
export function findPolicy(allowlist: AllowEntry[], jid: string): AllowEntry | undefined {
  const num = jidToNumber(jid);
  return allowlist.find((e) => e.number === num);
}

/** The entry's language if set, else the global default. */
export function resolveLanguage(entry: AllowEntry | undefined, defaultLanguage: string): string {
  return entry?.language ?? defaultLanguage;
}
