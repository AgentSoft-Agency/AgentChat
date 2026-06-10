import { downloadMediaMessage, type AnyMessageContent, type WAMessage, type WASocket } from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import { writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import { paths } from "../shared/paths.js";
import { loadConfig } from "../shared/config.js";
import { openDb } from "../shared/db.js";
import { Store } from "../shared/store.js";
import { ingestMessagesUpsert, ingestContactsUpsert } from "./ingest.js";
import { startWhatsApp } from "./whatsapp.js";
import { createBridgeApi } from "./api.js";

const p = paths();
const config = loadConfig(p.configFile);
const store = new Store(openDb(p.dbFile));
mkdirSync(p.mediaDir, { recursive: true });

const handle = await startWhatsApp(p.authDir, (sock: WASocket) => {
  sock.ev.on("messages.upsert", (e) => ingestMessagesUpsert(store, e));
  sock.ev.on("contacts.upsert", (c) => ingestContactsUpsert(store, c));
  sock.ev.on("groups.upsert", (groups) => {
    for (const g of groups) {
      if (g?.id) store.upsertChatName(g.id, g.subject ?? null, true);
    }
  });
}, process.env.AGENT_CHAT_PAIRING_NUMBER);

const mediaLogger = pino({ level: "warn" }) as unknown as ILogger;

async function saveMediaFor(id: string): Promise<void> {
  const m = store.getMessage(id);
  if (!m || m.type === "text" || m.mediaPath) return;
  const raw = JSON.parse(m.rawJson) as WAMessage;
  const buf = await downloadMediaMessage(
    raw,
    "buffer",
    {},
    { logger: mediaLogger, reuploadRequest: handle.sock().updateMediaMessage }
  );
  const file = join(p.mediaDir, `${id}`);
  await writeFile(file, buf as Buffer);
  store.setMediaPath(id, file);
}

const api = createBridgeApi({
  token: config.bridgeToken,
  sendText: async (jid, text) => {
    const r = await handle.sock().sendMessage(jid, { text });
    return r?.key?.id ?? "";
  },
  sendMedia: async (jid, filePath, caption) => {
    const ext = (filePath.split(".").pop() ?? "").toLowerCase();
    const fileName = filePath.split("/").pop();
    const isImage = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
    const isAudio = ["mp3", "ogg", "m4a", "opus", "aac", "wav"].includes(ext);
    const isVideo = ["mp4", "mov", "mkv", "webm", "3gp"].includes(ext);
    let content: AnyMessageContent;
    if (isImage) content = { image: { url: filePath }, caption };
    else if (isAudio) content = { audio: { url: filePath }, mimetype: ext === "ogg" || ext === "opus" ? "audio/ogg; codecs=opus" : "audio/mpeg" };
    else if (isVideo) content = { video: { url: filePath }, caption };
    else content = { document: { url: filePath }, mimetype: "application/octet-stream", fileName, caption };
    const r = await handle.sock().sendMessage(jid, content);
    return r?.key?.id ?? "";
  },
  status: () => ({ state: handle.status(), qr: handle.lastQr() }),
  downloadMedia: async (messageId: string) => {
    await saveMediaFor(messageId);
    const m = store.getMessage(messageId);
    if (!m?.mediaPath) throw new Error(`no media for ${messageId}`);
    return m.mediaPath;
  },
});

api.listen(config.bridgePort, "127.0.0.1", () =>
  console.error(`bridge api on 127.0.0.1:${config.bridgePort}`)
);
