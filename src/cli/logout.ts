import type { Paths } from "../shared/paths.js";
import { loadConfig } from "../shared/config.js";
import { httpBridgeControl } from "./bridge-control.js";
import { decideLogoutAction } from "./relink-actions.js";
import { clearAuthDir } from "../shared/auth.js";

export async function runLogout(p: Paths): Promise<void> {
  const config = loadConfig(p.configFile);
  const ctl = httpBridgeControl(config.bridgePort, config.bridgeToken);
  const probe = await ctl.probe();

  if (decideLogoutAction(probe.reachable) === "bridge-logout") {
    await ctl.logout();
    console.log(
      "Logged out. The device was removed from your WhatsApp Linked Devices. " +
        "Run 'agent-chat link' to reconnect."
    );
    return;
  }

  clearAuthDir(p.authDir);
  console.log(
    "Local session cleared. The bridge wasn't running, so this device may still " +
      "appear in your phone's Linked Devices until WhatsApp expires it. " +
      "Run 'agent-chat link' to reconnect."
  );
}
