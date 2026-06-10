import type { Message } from "./types.js";

export function isGroupJid(jid: string): boolean {
  return jid.endsWith("@g.us");
}

export function jidToNumber(jid: string): string {
  const userPart = jid.split("@")[0] ?? "";
  return userPart.split(":")[0].replace(/[^0-9]/g, "");
}

export function numberToContactJid(input: string): string {
  const digits = input.replace(/[^0-9]/g, "");
  return `${digits}@s.whatsapp.net`;
}

type MediaKind = "image" | "document" | "audio" | "video";
const MEDIA_KEYS: Record<string, MediaKind> = {
  imageMessage: "image",
  documentMessage: "document",
  audioMessage: "audio",
  videoMessage: "video",
};

export function normalizeMessage(raw: any): Message | null {
  if (!raw?.key?.id || !raw?.key?.remoteJid || !raw?.message) return null;
  const content = raw.message;

  let type: Message["type"] = "other";
  let text: string | null = null;

  if (typeof content.conversation === "string") {
    type = "text";
    text = content.conversation;
  } else if (content.extendedTextMessage?.text != null) {
    type = "text";
    text = content.extendedTextMessage.text;
  } else {
    for (const [key, kind] of Object.entries(MEDIA_KEYS)) {
      if (content[key]) {
        type = kind;
        text = content[key].caption ?? null;
        break;
      }
    }
  }

  if (type === "other" && text === null) return null;

  const tsRaw = raw.messageTimestamp;
  const ts = typeof tsRaw === "object" && tsRaw?.toNumber ? tsRaw.toNumber() : Number(tsRaw ?? 0);

  return {
    id: raw.key.id,
    chatJid: raw.key.remoteJid,
    senderJid: raw.key.participant ?? (raw.key.fromMe ? null : raw.key.remoteJid),
    fromMe: !!raw.key.fromMe,
    ts,
    type,
    text,
    mediaPath: null,
    rawJson: JSON.stringify(raw),
    seenByLlm: false,
  };
}
