import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TranscriptEntry, TranscriptManagerLike } from "./transcript-hub.js";
import { appendEntry, updateEntry } from "./transcript-store.js";

export type DeliveryState = "queued" | "processing" | "processed" | "replied" | "failed" | "needs-review" | "cancelled";
export interface ConversationDelivery {
  id: string;
  owner: string;
  updatedAt: number;
  state: DeliveryState;
  recipients: Record<string, DeliveryState>;
  recoveryNotified?: boolean;
  responses?: Record<string, string[]>;
  systemResponse?: { id: string; kind: "recorded-work-status" };
}
const states = new Set<DeliveryState>(["queued", "processing", "processed", "replied", "failed", "needs-review", "cancelled"]);
const unfinished = (state: DeliveryState) => ["queued", "processing", "needs-review"].includes(state);
const FILE = "conversation-deliveries.v1.json";
const LIMIT = 1024;

/** Durable handling obligations, separate from send acceptance and external effects.
 * An interrupted process never implies that an external operation did not happen.
 * Orphans require user review; they are NOT silently executed a second time.
 */
export class ConversationDeliveries {
  private readonly owner = randomUUID();
  private readonly cache = new Map<string, Map<string, ConversationDelivery>>();
  constructor(private readonly now: () => number = Date.now) {}

  private load(dbPath: string): Map<string, ConversationDelivery> {
    const path = join(dirname(dbPath), FILE);
    const cached = this.cache.get(path);
    if (cached) return cached;
    const records = new Map<string, ConversationDelivery>();
    if (existsSync(path)) {
      const file: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!file || typeof file !== "object" || (file as any).version !== 1 || !Array.isArray((file as any).records) || (file as any).records.length > LIMIT) throw new Error("Conversation recovery data is invalid; no work was replayed.");
      for (const item of (file as any).records) {
        if (!item || typeof item.id !== "string" || !item.id || typeof item.owner !== "string" || !states.has(item.state) || !Number.isFinite(item.updatedAt) || !item.recipients || typeof item.recipients !== "object" || Array.isArray(item.recipients) || Object.values(item.recipients).some(value => !states.has(value as DeliveryState))) throw new Error("Conversation recovery entry is invalid; no work was replayed.");
        if (item.responses != null && (typeof item.responses !== "object" || Array.isArray(item.responses) || Object.entries(item.responses).some(([actor, ids]) => !Object.hasOwn(item.recipients, actor) || !Array.isArray(ids) || ids.length > 64 || ids.some(id => typeof id !== "string" || !id || id.length > 256)))) throw new Error("Conversation response references are invalid.");
        if (item.systemResponse != null && (item.systemResponse.kind !== "recorded-work-status"
          || typeof item.systemResponse.id !== "string" || !item.systemResponse.id || item.systemResponse.id.length > 256
          || item.state !== "replied" || Object.keys(item.recipients).length !== 0)) throw new Error("Invalid system status response record.");
        if (records.has(item.id)) throw new Error("Duplicate conversation recovery identity.");
        records.set(item.id, { ...item, recipients: { ...item.recipients } });
      }
    }
    this.cache.set(path, records);
    return records;
  }

  private commit(dbPath: string, next: Map<string, ConversationDelivery>): void {
    if (next.size > LIMIT) {
      for (const record of [...next.values()].sort((a, b) => a.updatedAt - b.updatedAt)) {
        if (next.size <= LIMIT) break;
        if (!unfinished(record.state)) next.delete(record.id);
      }
    }
    if (next.size > LIMIT) throw new Error("Too many unresolved messages. Review pending work before sending more.");
    const dir = dirname(dbPath), path = join(dir, FILE), temp = `${path}.${randomUUID()}.tmp`;
    mkdirSync(dir, { recursive: true });
    let fd: number | undefined;
    try {
      fd = openSync(temp, "wx", 0o600);
      writeFileSync(fd, JSON.stringify({ version: 1, records: [...next.values()] }));
      fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temp, path);
      // Persist the directory entry as well as the file contents.
      const directoryFd = openSync(dir, "r");
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
      this.cache.set(path, next);
    } finally {
      if (fd !== undefined) closeSync(fd);
      rmSync(temp, { force: true });
    }
  }

  queue(dbPath: string, id: string): ConversationDelivery {
    const current = this.load(dbPath), existing = current.get(id);
    if (existing) return structuredClone(existing);
    const entry: ConversationDelivery = { id, owner: this.owner, state: "queued", recipients: {}, updatedAt: this.now() };
    this.commit(dbPath, new Map(current).set(id, entry));
    return structuredClone(entry);
  }

  route(dbPath: string, id: string, actors: readonly string[]): ConversationDelivery {
    this.queue(dbPath, id);
    return this.change(dbPath, id, entry => {
      if (entry.systemResponse) {
        if (actors.length) throw new Error("A system-answered status request cannot be routed for execution.");
        return;
      }
      for (const actor of actors) if (!Object.hasOwn(entry.recipients, actor)) Object.defineProperty(entry.recipients, actor, { value: "queued", writable: true, configurable: true, enumerable: true });
      if (Object.keys(entry.recipients).length === 0) entry.state = "processed";
    });
  }

  settle(dbPath: string, id: string, actor: string, state: DeliveryState): ConversationDelivery {
    return this.change(dbPath, id, entry => {
      if (!Object.hasOwn(entry.recipients, actor)) throw new Error("The Bot does not own this message delivery.");
      entry.recipients[actor] = state;
      const values = Object.values(entry.recipients);
      entry.state = values.includes("processing") ? "processing" : values.includes("queued") ? "queued" : values.includes("needs-review") ? "needs-review" : values.includes("failed") ? "failed" : values.includes("replied") ? "replied" : values.every(value => value === "cancelled") ? "cancelled" : "processed";
    });
  }

  /** Only an addressed recipient can attach a real, durably published response.
   * Replying to an older request can resolve its response status without
   * declaring the task complete or replaying the original work.
   */
  recordResponse(dbPath: string, id: string, actor: string, responseId: string): ConversationDelivery | undefined {
    const prior = this.load(dbPath).get(id);
    if (!prior || !Object.hasOwn(prior.recipients, actor)) return;
    if (!responseId || responseId.length > 256) throw new Error("Invalid response identity.");
    return this.change(dbPath, id, entry => {
      const ids = [...new Set([...(entry.responses?.[actor] ?? []), responseId])].slice(-64);
      entry.responses = { ...entry.responses, [actor]: ids };
    });
  }

  /** System status is separate from a Bot reply. It may only settle an otherwise
   * unrouted request; it must never clear another recipient's pending obligation. */
  recordSystemResponse(dbPath: string, id: string, responseId: string): ConversationDelivery {
    if (!responseId || responseId.length > 256) throw new Error("Invalid system response identity.");
    return this.change(dbPath, id, entry => {
      if (Object.keys(entry.recipients).length || entry.systemResponse && entry.systemResponse.id !== responseId)
        throw new Error("The request already has a different response or recipient.");
      if (!entry.systemResponse && entry.state !== "queued") throw new Error("The request can no longer receive a status response.");
      entry.state = "replied";
      entry.systemResponse = {id: responseId, kind: "recorded-work-status"};
    });
  }

  private change(dbPath: string, id: string, mutate: (entry: ConversationDelivery) => void): ConversationDelivery {
    const current = this.load(dbPath), prior = current.get(id);
    if (!prior) throw new Error("Message delivery was not saved before execution.");
    const next = structuredClone(prior);
    mutate(next); next.updatedAt = this.now();
    this.commit(dbPath, new Map(current).set(id, next));
    return structuredClone(next);
  }

  /** One notice per orphan, including work accepted but never started. */
  recover(dbPath: string): ConversationDelivery[] {
    const current = this.load(dbPath), next = new Map(current), recovered: ConversationDelivery[] = [];
    for (const entry of current.values()) {
      if (entry.owner === this.owner || !unfinished(entry.state) || entry.recoveryNotified) continue;
      const orphan = structuredClone(entry);
      orphan.state = "needs-review"; orphan.updatedAt = this.now();
      for (const actor of Object.keys(orphan.recipients)) if (unfinished(orphan.recipients[actor]!)) orphan.recipients[actor] = "needs-review";
      next.set(orphan.id, orphan); recovered.push(orphan);
    }
    if (recovered.length) this.commit(dbPath, next);
    return recovered;
  }

  markRecoveryNotified(dbPath: string, id: string): void {
    this.change(dbPath, id, entry => { entry.recoveryNotified = true; });
  }

  has(dbPath: string, id: string): boolean { return this.load(dbPath).has(id); }

  /** An explicit stop or a room-wide failure never turns unresolved work into success. */
  pause(dbPath: string): ConversationDelivery[] {
    const changed: ConversationDelivery[] = [];
    for (const entry of this.load(dbPath).values()) {
      if (entry.owner !== this.owner || !unfinished(entry.state)) continue;
      changed.push(this.change(dbPath, entry.id, next => {
        next.state = next.state === "processing" ? "needs-review" : "cancelled";
        for (const actor of Object.keys(next.recipients)) {
          const state = next.recipients[actor]!;
          if (unfinished(state)) next.recipients[actor] = state === "processing" ? "needs-review" : "cancelled";
        }
      }));
    }
    return changed;
  }

  list(dbPath: string): ConversationDelivery[] { return structuredClone([...this.load(dbPath).values()]); }
}

/** Existing transcript mutations make status visible in both single and group chats. */
export function publishDelivery(tm: TranscriptManagerLike, session: any, record: ConversationDelivery): void {
  const transform = (entry: TranscriptEntry): TranscriptEntry => ({ ...entry, delivery: { state: record.state, recipients: record.recipients, ...(record.responses ? { responses: record.responses } : {}), ...(record.systemResponse ? {systemResponse: record.systemResponse} : {}), updatedAt: record.updatedAt } });
  const persisted = session.db.updateTranscriptEntry(record.id, transform);
  const live = tm.sessions.inMemoryTranscriptAgentId === session.id ? updateEntry(record.id, transform) : null;
  const entry = live ?? persisted;
  if (entry) tm.roster.emit({ type: "updated", entry }, session.id);
}

export function appendConversationNotice(tm: TranscriptManagerLike, session: any, text: string, replyTo?: string, code?: string): void {
  // Deterministic recovery notice identities make a crash between writing the
  // notice and marking the journal safe to retry without duplicate messages.
  const id = code === "delivery_recovery" && replyTo ? `notice-delivery-recovery-${replyTo}` : `notice-delivery-${randomUUID()}`;
  if (session.db.getTranscriptEntries().some((entry: TranscriptEntry) => entry.id === id)) return;
  const entry: TranscriptEntry = { kind: "notice", id, text, timestampMs: Date.now(), ...(replyTo ? { replyTo } : {}), ...(code ? { code } : {}) };
  if (session.db.appendTranscriptEntry(entry) === false) throw new Error("Could not persist the conversation status. No work was replayed.");
  if (tm.sessions.activeSession?.id === session.id && tm.sessions.inMemoryTranscriptAgentId === session.id) {
    appendEntry(entry); tm.roster.emit({ type: "appended", entry }, session.id);
  } else void tm.roster.emitAgentUpdate(session.id);
}
