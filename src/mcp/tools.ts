import type { Store } from "../shared/store.js";
import type { BridgeClient } from "./bridge-client.js";
import { DraftStore } from "../shared/drafts.js";
import { resolveRecipient, isAllowed } from "../shared/allowlist.js";
import { isGroupJid } from "../shared/normalize.js";

export class ToolCore {
  constructor(
    private store: Store,
    private bridge: BridgeClient,
    private drafts: DraftStore,
    private allowlist: string[]
  ) {}

  listChats(limit = 20) { return this.store.listChats(limit); }
  getMessages(chat: string, limit = 50, before?: number) {
    return this.store.getMessages(resolveRecipient(chat), limit, before);
  }
  searchMessages(query: string, limit = 20) { return this.store.search(query, limit); }
  listContacts(query = "") { return this.store.findContacts(query); }
  getNewMessages(limit = 50) { return this.store.takeUnseen(limit); }
  status() { return this.bridge.status(); }

  draftMessage(to: string, text: string): { draftId: string; toJid: string; preview: string } {
    const jid = resolveRecipient(to);
    if (!isAllowed(this.allowlist, jid)) throw new Error(`recipient not allowed: ${to}`);
    const d = this.drafts.create({ toJid: jid, kind: "text", text });
    return { draftId: d.id, toJid: jid, preview: `To ${jid}${isGroupJid(jid) ? " (group)" : ""}: ${text}` };
  }

  draftMedia(to: string, filePath: string, caption?: string): { draftId: string; toJid: string; preview: string } {
    const jid = resolveRecipient(to);
    if (!isAllowed(this.allowlist, jid)) throw new Error(`recipient not allowed: ${to}`);
    const d = this.drafts.create({ toJid: jid, kind: "media", filePath, caption });
    return { draftId: d.id, toJid: jid, preview: `To ${jid}: [media ${filePath}] ${caption ?? ""}` };
  }

  async downloadMedia(messageId: string): Promise<{ path: string }> {
    const path = await this.bridge.downloadMedia(messageId);
    return { path };
  }

  async sendDraft(draftId: string): Promise<{ id: string }> {
    const d = this.drafts.consume(draftId);
    if (!d) throw new Error(`unknown or expired draft: ${draftId}`);
    if (!isAllowed(this.allowlist, d.toJid)) throw new Error(`recipient not allowed: ${d.toJid}`);
    const id =
      d.kind === "text"
        ? await this.bridge.sendText(d.toJid, d.text ?? "")
        : await this.bridge.sendMedia(d.toJid, d.filePath ?? "", d.caption);
    return { id };
  }
}
