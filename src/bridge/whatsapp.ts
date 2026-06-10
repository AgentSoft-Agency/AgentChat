import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import pino from "pino";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";

export interface WhatsAppHandle {
  sock: () => WASocket; // getter — returns the CURRENT socket (changes across reconnects)
  status: () => "connecting" | "connected" | "needs_relink";
  lastQr: () => string | null;
}

export async function startWhatsApp(
  authDir: string,
  onEvent: (sock: WASocket) => void
): Promise<WhatsAppHandle> {
  const logger = pino({ level: "warn" }) as unknown as ILogger;
  let state: "connecting" | "connected" | "needs_relink" = "connecting";
  let lastQr: string | null = null;
  let current: WASocket;

  const { state: authState, saveCreds } = await useMultiFileAuthState(authDir);

  const connect = async (): Promise<WASocket> => {
    const sock = makeWASocket({ auth: authState, logger });
    current = sock;
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (u) => {
      if (u.qr) { lastQr = u.qr; qrcode.generate(u.qr, { small: true }); }
      if (u.connection === "open") { state = "connected"; lastQr = null; }
      if (u.connection === "close") {
        const code = (u.lastDisconnect?.error as Boom)?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) { state = "needs_relink"; }
        else { state = "connecting"; lastQr = null; void connect(); }
      }
    });
    onEvent(sock);
    return sock;
  };

  await connect();
  return { sock: () => current, status: () => state, lastQr: () => lastQr };
}
