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
