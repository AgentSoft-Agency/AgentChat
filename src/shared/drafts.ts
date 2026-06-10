import { randomUUID } from "node:crypto";
import type { Draft } from "./types.js";

export class DraftStore {
  private drafts = new Map<string, Draft>();
  constructor(private ttlMs = 5 * 60_000, private clock: () => number = () => Date.now()) {}

  create(input: Omit<Draft, "id" | "createdAt">): Draft {
    const draft: Draft = { ...input, id: randomUUID(), createdAt: this.clock() };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  consume(id: string): Draft | null {
    const d = this.drafts.get(id);
    if (!d) return null;
    this.drafts.delete(id);
    if (this.clock() - d.createdAt > this.ttlMs) return null;
    return d;
  }
}
