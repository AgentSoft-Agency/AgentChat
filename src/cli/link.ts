import { startWhatsApp } from "../bridge/whatsapp.js";

export async function runLink(authDir: string, pairingNumber?: string): Promise<void> {
  console.log(
    pairingNumber
      ? `Requesting a pairing code for ${pairingNumber}…`
      : "Linking — scan the QR below with WhatsApp → Linked Devices → Link a device."
  );
  const handle = await startWhatsApp(authDir, () => {}, pairingNumber);
  const deadline = Date.now() + 120_000;
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
