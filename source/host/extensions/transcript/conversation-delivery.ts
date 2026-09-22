import { randomUUID } from "node:crypto";
import { appendEntry, getTranscript, updateEntry } from "./transcript-store.js";
import type { TranscriptEntry, TranscriptManagerLike } from "./transcript-hub.js";

export type DeliveryPhase = "queued" | "processing" | "responded" | "silent" | "failed" | "cancelled" | "uncertain" | "paused";
export interface RecipientDelivery {
  readonly botId: string;
  readonly phase: DeliveryPhase;
  readonly attempt?: string;
  readonly owner?: string;
  readonly updatedAt: number;
  readonly replyIds?: readonly string[];
}
export interface ConversationInput {
  readonly prompt: string;
  readonly attachmentPaths: readonly string[];
  readonly richText?: string;
  readonly replyToId?: string;
  readonly isFork?: boolean;
}
export interface ConversationDelivery {
  readonly version: 1;
  readonly conversationId: string;
  readonly messageId: string;
  readonly revision: number;
  readonly inputDigest?: string;
  readonly input?: ConversationInput;
  readonly recipients: readonly RecipientDelivery[];
}

const processOwner = randomUUID();
const phases = new Set<DeliveryPhase>(["queued", "processing", "responded", "silent", "failed", "cancelled", "uncertain", "paused"]);
export function deliveryOf(entry: TranscriptEntry, conversationId: string): ConversationDelivery | undefined {
  const value = entry.beebotDelivery as ConversationDelivery | undefined;
  if (value == null) return undefined;
  if (value.version !== 1 || value.conversationId !== conversationId || value.messageId !== entry.id
    || !Number.isSafeInteger(value.revision) || !Array.isArray(value.recipients)
    || value.revision < 1
    || value.recipients.some(item => item == null || typeof item.botId !== "string" || !item.botId || !phases.has(item.phase)
      || !Number.isFinite(item.updatedAt)
      || (item.phase === "processing" && (typeof item.attempt !== "string" || typeof item.owner !== "string")))
    || new Set(value.recipients.map(item => item.botId)).size !== value.recipients.length) {
    throw new Error("Invalid conversation delivery record; no work was replayed.");
  }
  return value;
}

/** Stamp this onto the source echo before its first SQLite append. */
export function initialConversationDelivery(conversationId: string, messageId: string, botIds: readonly string[], input: ConversationInput, inputDigest?: string): ConversationDelivery {
  if (!botIds.length || botIds.some(id => typeof id !== "string" || !id)) throw new Error("A message needs an available recipient.");
  return { version: 1, conversationId, messageId, revision: 1, input,
    ...(inputDigest ? { inputDigest } : {}),
    recipients: [...new Set(botIds)].map(botId => ({ botId, phase: "queued", updatedAt: Date.now() })),
  };
}

/** Delivery metadata lives on the durable source message, not in an ephemeral turn. */
export class ConversationDeliveries {
  constructor(readonly tm: TranscriptManagerLike, readonly session: any) {}

  read(messageId: string): ConversationDelivery | undefined {
    const entry = typeof this.session.db.getEntryById === "function"
      ? this.session.db.getEntryById(messageId)
      : this.session.db.getTranscriptEntries().find((item: TranscriptEntry) => item.id === messageId);
    return entry == null ? undefined : deliveryOf(entry, this.session.id);
  }

  accept(messageId: string, botIds: readonly string[], input?: ConversationInput): ConversationDelivery {
    const existing = this.read(messageId);
    if (existing) return existing; // Recipients are fixed at acceptance; new members do not inherit old requests.
    if (!botIds.length || botIds.some(id => !id)) throw new Error("This message has no available recipient.");
    return this.write(messageId, previous => previous ?? {
      version: 1, conversationId: this.session.id, messageId, revision: 0,
      ...(input ? { input } : {}),
      recipients: [...new Set(botIds)].map(botId => ({ botId, phase: "queued", updatedAt: Date.now() })),
    });
  }

  start(messageId: string, botId: string): string | undefined {
    const current = this.read(messageId)?.recipients.find(item => item.botId === botId);
    if (current?.phase !== "queued") return undefined;
    const attempt = randomUUID();
    this.change(messageId, botId, item => item.phase === "queued"
      ? { botId, phase: "processing", attempt, owner: processOwner, updatedAt: Date.now() } : item);
    return attempt;
  }

  settle(messageId: string, botId: string, attempt: string, phase: Exclude<DeliveryPhase, "queued" | "processing">, replyIds: readonly string[] = []): void {
    this.change(messageId, botId, item => item.phase === "processing" && item.attempt === attempt && item.owner === processOwner
      ? { botId, phase, updatedAt: Date.now(), ...(replyIds.length ? { replyIds: [...replyIds] } : {}) } : item);
  }

  cancelQueued(messageId: string): void {
    const current = this.read(messageId);
    if (!current) return;
    for (const item of current.recipients) if (item.phase === "queued")
      this.change(messageId, item.botId, value => value.phase === "queued"
        ? { botId: value.botId, phase: "cancelled", updatedAt: Date.now() } : value);
  }

  pauseQueued(): void {
    for (const entry of this.session.db.getTranscriptEntries() as TranscriptEntry[]) {
      const record = deliveryOf(entry, this.session.id);
      if (!record) continue;
      for (const item of record.recipients) if (item.phase === "queued")
        this.change(entry.id, item.botId, current => current.phase === "queued"
          ? { botId: current.botId, phase: "paused", updatedAt: Date.now() } : current);
    }
  }

  stop(messageId?: string): void {
    for (const entry of this.session.db.getTranscriptEntries() as TranscriptEntry[]) {
      if (messageId && entry.id !== messageId) continue;
      const record = deliveryOf(entry, this.session.id);
      if (!record) continue;
      for (const item of record.recipients) {
        if (item.phase !== "queued" && item.phase !== "processing") continue;
        this.change(entry.id, item.botId, current => current.phase === "queued"
          ? { botId: current.botId, phase: "cancelled", updatedAt: Date.now() }
          : current.phase === "processing" ? { botId: current.botId, phase: "uncertain", updatedAt: Date.now() } : current);
      }
    }
  }

  /** Running work from another Host process is unknown, never automatically retried. */
  recover(): { queued: TranscriptEntry[]; uncertain: TranscriptEntry[] } {
    const queued: TranscriptEntry[] = [], uncertain: TranscriptEntry[] = [];
    for (const entry of this.session.db.getTranscriptEntries() as TranscriptEntry[]) {
      const value = deliveryOf(entry, this.session.id);
      if (!value) continue;
      let stale = false;
      for (const item of value.recipients) if (item.phase === "processing" && item.owner !== processOwner) {
        this.change(entry.id, item.botId, current => current.phase === "processing" && current.owner !== processOwner
          ? { botId: current.botId, phase: "uncertain", updatedAt: Date.now() } : current);
        stale = true;
      }
      if (stale) uncertain.push(entry);
      if (value.recipients.some(item => item.phase === "queued")) queued.push(entry);
    }
    return { queued, uncertain };
  }

  private change(messageId: string, botId: string, change: (item: RecipientDelivery) => RecipientDelivery): void {
    this.write(messageId, previous => {
      if (!previous) throw new Error("Delivery was not durably accepted.");
      return { ...previous, recipients: previous.recipients.map(item => item.botId === botId ? change(item) : item) };
    });
  }

  private write(messageId: string, change: (previous: ConversationDelivery | undefined) => ConversationDelivery): ConversationDelivery {
    let written: ConversationDelivery | undefined;
    const saved = this.session.db.updateTranscriptEntry(messageId, (entry: TranscriptEntry) => {
      const previous = deliveryOf(entry, this.session.id);
      written = { ...change(previous), revision: (previous?.revision ?? 0) + 1 };
      return { ...entry, beebotDelivery: written };
    });
    if (!saved || !written) throw new Error("Message delivery could not be saved. No new work was started.");
    // Persist before broadcasting. Never mutate a different conversation's visible transcript.
    if (this.tm.sessions.activeSession?.id === this.session.id
      && this.tm.sessions.inMemoryTranscriptAgentId === this.session.id) {
      const live = updateEntry(messageId, entry => ({ ...entry, beebotDelivery: written }));
      if (live) this.tm.roster.emit({ type: "updated", entry: live });
    }
    return written;
  }
}

/** A runtime notice is not a colleague's speech and must not wake the group. */
export function postConversationNotice(tm: TranscriptManagerLike, session: any, sourceId: string, code: string, text: string): void {
  const entries = session.db.getTranscriptEntries() as TranscriptEntry[];
  const id = `beebot-notice-${sourceId}-${code}`;
  if (entries.some(entry => entry.id === id)) return;
  const entry: TranscriptEntry = {
    id, kind: "send-message", timestampMs: Date.now(), replyTo: sourceId,
    message: { type: "text", content: text, reply_to: sourceId },
    author: { id: "beebot-system", name: "BeeBot" },
    beebotNotice: { code, sourceId },
  };
  if (session.db.appendTranscriptEntry(entry) === false)
    throw new Error("A conversation notice could not be saved.");
  if (tm.sessions.activeSession?.id === session.id && tm.sessions.inMemoryTranscriptAgentId === session.id) {
    if (!getTranscript().some(item => item.id === id)) {
      appendEntry(entry);
      tm.roster.emit({ type: "appended", entry });
      tm.sessions.markActiveSessionArrival?.(session);
    }
  } else {
    tm.sessionStore.markSessionActivity(session);
    void tm.roster.emitAgentUpdate(session.id);
  }
}
