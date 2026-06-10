import type { Store } from "../shared/store.js";
import type { BridgeClient } from "./bridge-client.js";
import { DraftStore } from "../shared/drafts.js";
import { resolveRecipient, isAllowed, findPolicy, resolveLanguage } from "../shared/allowlist.js";
import { isGroupJid } from "../shared/normalize.js";
import type { AllowEntry } from "../shared/types.js";

export class ToolCore {
  constructor(
    private store: Store,
    private bridge: BridgeClient,
    private drafts: DraftStore,
    private allowlist: AllowEntry[],
    private defaultLanguage: string
  ) {}

  listChats(limit = 20, query?: string) { return this.store.listChats(limit, query); }
  getMessages(chat: string, limit = 50, before?: number) {
    return this.store.getMessages(resolveRecipient(chat), limit, before);
  }
  searchMessages(query: string, chat?: string, limit = 20) {
    return this.store.search(query, limit, chat ? resolveRecipient(chat) : undefined);
  }
  listContacts(query = "") {
    return this.store.findContacts(query).map((c) => {
      const policy = findPolicy(this.allowlist, c.jid);
      return policy
        ? { ...c, onAllowlist: true as const, requiresConfirmation: policy.confirm, language: resolveLanguage(policy, this.defaultLanguage) }
        : { ...c, onAllowlist: false as const };
    });
  }
  getNewMessages(limit = 50) { return this.store.takeUnseen(limit); }
  status() { return this.bridge.status(); }

  draftMessage(to: string, text: string) {
    const jid = resolveRecipient(to);
    const policy = findPolicy(this.allowlist, jid);
    if (!policy) throw new Error(`recipient not allowed: ${to}`);
    const d = this.drafts.create({ toJid: jid, kind: "text", text });
    return {
      draftId: d.id,
      toJid: jid,
      preview: `To ${jid}${isGroupJid(jid) ? " (group)" : ""}: ${text}`,
      requiresConfirmation: policy.confirm,
      language: resolveLanguage(policy, this.defaultLanguage),
    };
  }

  draftMedia(to: string, filePath: string, caption?: string) {
    const jid = resolveRecipient(to);
    const policy = findPolicy(this.allowlist, jid);
    if (!policy) throw new Error(`recipient not allowed: ${to}`);
    const d = this.drafts.create({ toJid: jid, kind: "media", filePath, caption });
    return {
      draftId: d.id,
      toJid: jid,
      preview: `To ${jid}: [media ${filePath}] ${caption ?? ""}`,
      requiresConfirmation: policy.confirm,
      language: resolveLanguage(policy, this.defaultLanguage),
    };
  }

  /** One-shot text send. Server-permitted only for confirm:false numbers. */
  async sendMessage(to: string, text: string): Promise<{ id: string }> {
    const jid = resolveRecipient(to);
    const policy = findPolicy(this.allowlist, jid);
    if (!policy) throw new Error(`recipient not allowed: ${to}`);
    if (policy.confirm) {
      throw new Error(
        `recipient ${policy.number} requires confirmation — use draft_message then send_draft`
      );
    }
    return { id: await this.bridge.sendText(jid, text) };
  }

  async downloadMedia(messageId: string): Promise<{ path: string }> {
    return { path: await this.bridge.downloadMedia(messageId) };
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
