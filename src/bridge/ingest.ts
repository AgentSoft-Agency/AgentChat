import type { Store } from "../shared/store.js";
import { normalizeMessage } from "../shared/normalize.js";

export function ingestMessagesUpsert(store: Store, event: { messages: any[] }): void {
  for (const raw of event.messages) {
    const m = normalizeMessage(raw);
    if (m) store.upsertMessage(m);
  }
}

export function ingestContactsUpsert(store: Store, contacts: any[]): void {
  for (const c of contacts) {
    if (!c?.id) continue;
    store.upsertContact({
      jid: c.id, pushName: c.notify ?? null, name: c.name ?? null,
      phone: c.id.includes("@s.whatsapp.net") ? c.id.split("@")[0] : null,
    });
  }
}
