import { isGroupJid, jidToNumber } from "../shared/normalize.js";

/** Minimal structural type for the part of the Baileys socket we need. */
export interface WhatsAppLookup {
  onWhatsApp: (
    ...numbers: string[]
  ) => Promise<Array<{ jid: string; exists: boolean }> | undefined>;
}

/**
 * Resolve a recipient jid to the canonical WhatsApp jid that messages must be
 * sent to. WhatsApp's `onWhatsApp` lookup normalizes the number to the form it
 * is actually registered under (e.g. it auto-inserts the Mexican mobile "1", so
 * `529995062019` resolves to `5219995062019@s.whatsapp.net`). Without this, a
 * mis-formatted number is accepted into a PENDING state and silently never
 * delivered.
 *
 * Group jids are addressed directly and pass through unchanged. Throws if the
 * number is not a registered WhatsApp user, so the caller surfaces a clear
 * error instead of a silent non-delivery.
 */
export async function resolveSendJid(sock: WhatsAppLookup, toJid: string): Promise<string> {
  if (isGroupJid(toJid)) return toJid;
  const number = jidToNumber(toJid);
  const results = await sock.onWhatsApp(number);
  const hit = results?.[0];
  if (!hit?.exists) {
    throw new Error(`recipient is not on WhatsApp: ${number}`);
  }
  return hit.jid;
}
