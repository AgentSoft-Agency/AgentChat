export interface Chat {
  jid: string;
  name: string | null;
  isGroup: boolean;
  lastTs: number | null;
}

export interface Message {
  id: string;
  chatJid: string;
  senderJid: string | null;
  fromMe: boolean;
  ts: number;
  type: "text" | "image" | "document" | "audio" | "video" | "other";
  text: string | null;
  mediaPath: string | null;
  rawJson: string;
  seenByLlm: boolean;
}

export interface Contact {
  jid: string;
  pushName: string | null;
  name: string | null;
  phone: string | null;
}

export interface AllowEntry {
  number: string;
  label?: string;
  confirm: boolean;
  language?: string;
}

export interface AppConfig {
  allowlist: AllowEntry[];
  defaultLanguage: string;
  bridgeToken: string;
  bridgePort: number;
}

export interface Draft {
  id: string;
  toJid: string;
  kind: "text" | "media";
  text?: string;
  filePath?: string;
  caption?: string;
  createdAt: number;
}
