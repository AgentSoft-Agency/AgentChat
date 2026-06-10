import { jidToNumber, numberToContactJid } from "./normalize.js";

/** Accepts a plain phone number or a full jid; returns a jid. */
export function resolveRecipient(to: string): string {
  return to.includes("@") ? to : numberToContactJid(to);
}

/** Allowlist holds strictly numeric ids: contact phone digits or group numeric id. */
export function isAllowed(allowlist: string[], jid: string): boolean {
  return allowlist.includes(jidToNumber(jid));
}
