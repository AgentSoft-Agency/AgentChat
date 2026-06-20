import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import pino from "pino";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import { clearAuthDir } from "../shared/auth.js";

export interface WhatsAppHandle {
  sock: () => WASocket; // getter — returns the CURRENT socket (changes across reconnects)
  status: () => "connecting" | "qr_available" | "connected" | "needs_relink";
  lastQr: () => string | null;
  lastPairingCode: () => string | null;
  relink: (pairingNumber?: string) => Promise<void>;
  logout: () => Promise<void>;
}

export async function startWhatsApp(
  authDir: string,
  onEvent: (sock: WASocket) => void,
  pairingNumber?: string
): Promise<WhatsAppHandle> {
  const logger = pino({ level: "warn" }) as unknown as ILogger;
  let state: "connecting" | "qr_available" | "connected" | "needs_relink" = "connecting";
  let lastQr: string | null = null;
  let lastPairingCode: string | null = null;
  let current: WASocket;
  let pairing = pairingNumber;
  // Each socket owns a generation; only the newest generation's close handler
  // is allowed to auto-reconnect. A deliberate teardown (relink/logout) bumps
  // the counter first, so the dying socket's close event becomes a no-op.
  let generation = 0;

  let { state: authState, saveCreds } = await useMultiFileAuthState(authDir);

  const connect = async (): Promise<WASocket> => {
    const myGen = ++generation;
    const sock = makeWASocket({ auth: authState, logger });
    current = sock;
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (u) => {
      if (u.qr) { lastQr = u.qr; state = "qr_available"; qrcode.generate(u.qr, { small: true }); }
      if (u.connection === "open") { state = "connected"; lastQr = null; lastPairingCode = null; }
      if (u.connection === "close") {
        if (myGen !== generation) return; // superseded by a deliberate relink/logout
        const code = (u.lastDisconnect?.error as Boom)?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) { state = "needs_relink"; }
        else { state = "connecting"; lastQr = null; void connect(); }
      }
    });
    onEvent(sock);
    if (pairing && !authState.creds.registered) {
      const num = pairing.replace(/[^0-9]/g, "");
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(num);
          lastPairingCode = code;
          console.error(`Pairing code for ${num}: ${code}`);
        } catch (e) {
          console.error("pairing code request failed:", e);
        }
      }, 3000);
    }
    return sock;
  };

  const doRelink = async (newPairing?: string): Promise<void> => {
    generation++;                       // disarm the current socket's reconnect
    try { current?.end?.(undefined); } catch { /* already closed */ }
    clearAuthDir(authDir);
    ({ state: authState, saveCreds } = await useMultiFileAuthState(authDir));
    if (newPairing) pairing = newPairing;
    lastQr = null;
    lastPairingCode = null;
    state = "connecting";
    await connect();                    // fresh socket emits a new QR / pairing code
  };

  const doLogout = async (): Promise<void> => {
    generation++;                       // disarm the current socket's reconnect
    if (state === "connected") {
      try { await current.logout(); } catch { /* best effort */ }
    } else {
      try { current?.end?.(undefined); } catch { /* already closed */ }
    }
    clearAuthDir(authDir);
    ({ state: authState, saveCreds } = await useMultiFileAuthState(authDir));
    lastQr = null;
    lastPairingCode = null;
    state = "needs_relink";
  };

  // Run relink/logout strictly one-at-a-time. Two overlapping operations would
  // otherwise both reach connect() and leave two live sockets ingesting events;
  // the generation counter only disarms dead sockets, it does not serialize.
  let opTail: Promise<unknown> = Promise.resolve();
  const serialize = <T>(op: () => Promise<T>): Promise<T> => {
    const run = opTail.then(op, op); // chain regardless of the prior op's outcome
    opTail = run.then(() => {}, () => {});
    return run;
  };

  const relink = (pairingNumber?: string): Promise<void> => serialize(() => doRelink(pairingNumber));
  const logout = (): Promise<void> => serialize(() => doLogout());

  await connect();
  return {
    sock: () => current,
    status: () => state,
    lastQr: () => lastQr,
    lastPairingCode: () => lastPairingCode,
    relink,
    logout,
  };
}
