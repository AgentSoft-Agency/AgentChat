import qrcode from "qrcode-terminal";
import type { Paths } from "../shared/paths.js";
import { loadConfig } from "../shared/config.js";
import { httpBridgeControl, type BridgeControl } from "./bridge-control.js";
import { decideLinkAction } from "./relink-actions.js";
import { startWhatsApp } from "../bridge/whatsapp.js";

const LINK_TIMEOUT_MS = 120_000;

export async function runLink(p: Paths, pairingNumber?: string): Promise<void> {
  const config = loadConfig(p.configFile);
  const ctl = httpBridgeControl(config.bridgePort, config.bridgeToken);
  const probe = await ctl.probe();
  const action = decideLinkAction(probe);

  if (action === "already-linked") {
    console.log("Already linked. Run 'agent-chat logout' first to link a different account.");
    return;
  }
  if (action === "live-relink") {
    await liveRelink(ctl, pairingNumber);
    return;
  }
  await standaloneLink(p.authDir, pairingNumber);
}

/** Drive a re-link through the already-running bridge — no restart. */
export async function liveRelink(ctl: BridgeControl, pairingNumber?: string): Promise<void> {
  console.log(
    pairingNumber
      ? `Requesting a pairing code for ${pairingNumber} on the running bridge…`
      : "Re-linking the running bridge — scan the QR below with WhatsApp → Linked Devices → Link a device."
  );
  await ctl.relink(pairingNumber);

  const deadline = Date.now() + LINK_TIMEOUT_MS;
  let shownQr: string | null = null;
  let shownPair: string | null = null;
  while (Date.now() < deadline) {
    const q = await ctl.fetchQr();
    if (q.state === "connected") {
      console.log("✅ linked successfully.");
      return;
    }
    if (q.qr && q.qr !== shownQr) { shownQr = q.qr; qrcode.generate(q.qr, { small: true }); }
    if (q.pairingCode && q.pairingCode !== shownPair) {
      shownPair = q.pairingCode;
      console.log(`Pairing code: ${q.pairingCode}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("timed out after 120s waiting to link. Re-run 'agent-chat link'.");
}

/** Bridge not running: link a standalone socket (the original flow). */
async function standaloneLink(authDir: string, pairingNumber?: string): Promise<void> {
  console.log(
    pairingNumber
      ? `Requesting a pairing code for ${pairingNumber}…`
      : "Linking — scan the QR below with WhatsApp → Linked Devices → Link a device."
  );
  const handle = await startWhatsApp(authDir, () => {}, pairingNumber);
  const deadline = Date.now() + LINK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const s = handle.status();
    if (s === "connected") {
      console.log("✅ linked successfully.");
      process.exit(0);
    }
    if (s === "needs_relink") {
      console.error("❌ logged out before linking completed — re-run 'agent-chat link'.");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error("❌ timed out after 120s waiting to link. Re-run 'agent-chat link'.");
  process.exit(1);
}
