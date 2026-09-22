/**
 * Renderer-side acknowledgement state extracted from the shipped send journal
 * and transcript overlay boundary. It deliberately has no transport or UI
 * dependency; ProductionRenderer remains the owner of mounting and dispatch.
 *
 * @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5664545 (optimistic entry identity)
 * @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5674804 (MHn send-journal controller)
 * @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5681500 (noteEchoReconciled)
 * @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5705447 (fVn transcript overlay reconciliation)
 */

export type AcknowledgementPhase = "pending" | "queued" | "dispatching" | "accepted-awaiting-echo" | "failed" | "uncertain";
export type AcknowledgementEntryKind = "message" | "user-attachment";

export interface AcknowledgementEntry {
  id: string;
  kind: AcknowledgementEntryKind;
  clientNonce: string;
}

export interface AcknowledgementRecord {
  accountSlot: string | null;
  agentId: string;
  nonce: string;
  priorNonces: readonly string[];
  entries: readonly AcknowledgementEntry[];
  phase: AcknowledgementPhase;
  failedAtMs?: number;
}

export interface ProjectedOptimisticEntry {
  entry: AcknowledgementEntry;
  accountSlot: string | null;
  agentId: string;
  nonce: string;
  phase: AcknowledgementPhase;
}

export interface AcknowledgementSnapshot {
  generation: number;
  accountSlot: string | null;
  agentId: string | null;
  records: readonly AcknowledgementRecord[];
  optimisticEntries: readonly ProjectedOptimisticEntry[];
}

export interface TranscriptAcknowledgementEvent {
  id: string;
  kind: AcknowledgementEntryKind;
  clientNonce?: string;
}

export interface TranscriptAcknowledgementController {
  getSnapshot(): AcknowledgementSnapshot;
  subscribe(listener: () => void): () => void;
  setScope(accountSlot: string | null, agentId: string | null): void;
  insertOptimistic(record: Omit<AcknowledgementRecord, "priorNonces"> & { priorNonces?: readonly string[] }): boolean;
  markDispatching(accountSlot: string | null, nonce: string): boolean;
  markAcceptedAwaitingEcho(accountSlot: string | null, nonce: string): boolean;
  markUncertain(accountSlot: string | null, nonce: string): boolean;
  markFailed(accountSlot: string | null, nonce: string, failedAtMs: number): boolean;
  retryFailed(input: {
    accountSlot: string | null;
    agentId: string;
    nonce: string;
    freshNonce: string;
    entries: readonly AcknowledgementEntry[];
    phase?: Exclude<AcknowledgementPhase, "accepted-awaiting-echo" | "failed" | "uncertain">;
  }): boolean;
  ingestTranscriptEvent(input: { accountSlot: string | null; agentId: string; entry: TranscriptAcknowledgementEvent }): boolean;
  reconcileEcho(input: { accountSlot: string | null; agentId: string; nonce: string; echoedNonce?: string }): boolean;
  removeOptimistic(input: { accountSlot: string | null; nonce: string }): boolean;
  reset(): void;
  dispose(): void;
}

const RESEND_PREFIX = "sand-resend-v1:";

function logicalNonce(nonce: string): string {
  if (!nonce.startsWith(RESEND_PREFIX)) return nonce;
  const encoded = nonce.slice(RESEND_PREFIX.length);
  const separator = encoded.indexOf(":");
  if (separator <= 0) return nonce;
  const lengthText = encoded.slice(0, separator);
  if (!/^[1-9]\d*$/.test(lengthText)) return nonce;
  const length = Number(lengthText);
  if (!Number.isSafeInteger(length)) return nonce;
  const start = separator + 1;
  const end = start + length;
  return encoded[end] === ":" && end + 1 < encoded.length ? encoded.slice(start, end) : nonce;
}

function scopeKey(accountSlot: string | null, agentId: string): string {
  return `${accountSlot ?? "anonymous"}\u0000${agentId}`;
}

function recordMatches(record: AcknowledgementRecord, nonce: string): boolean {
  const eventLogicalNonce = logicalNonce(nonce);
  return record.nonce === nonce
    || logicalNonce(record.nonce) === eventLogicalNonce
    || record.priorNonces.some((candidate) => candidate === nonce || logicalNonce(candidate) === eventLogicalNonce);
}

function cloneRecord(record: AcknowledgementRecord): AcknowledgementRecord {
  return { ...record, priorNonces: [...record.priorNonces], entries: [...record.entries] };
}

export function createTranscriptAcknowledgementController(): TranscriptAcknowledgementController {
  const records = new Map<string, AcknowledgementRecord>();
  const seenEchoKinds = new Map<string, Map<string, AcknowledgementEntryKind>>();
  const listeners = new Set<() => void>();
  let generation = 0;
  let accountSlot: string | null = null;
  let agentId: string | null = null;
  let disposed = false;

  const emit = () => {
    if (!disposed) for (const listener of [...listeners]) listener();
  };
  const removeRecord = (key: string): boolean => {
    const removed = records.delete(key);
    seenEchoKinds.delete(key);
    return removed;
  };
  const findRecord = (slot: string | null, nonce: string): [string, AcknowledgementRecord] | null => {
    for (const [key, record] of records) {
      if (record.accountSlot === slot && recordMatches(record, nonce)) return [key, record];
    }
    return null;
  };
  const publish = (changed: boolean): boolean => {
    if (changed) emit();
    return changed;
  };
  const getSnapshot = (): AcknowledgementSnapshot => {
    const visible = [...records.values()].filter((record) => record.accountSlot === accountSlot && record.agentId === agentId);
    return {
      generation,
      accountSlot,
      agentId,
      records: visible.map(cloneRecord),
      optimisticEntries: visible.flatMap((record) => record.entries.map((entry) => ({ entry: { ...entry }, accountSlot: record.accountSlot, agentId: record.agentId, nonce: record.nonce, phase: record.phase })))
    };
  };

  return {
    getSnapshot,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setScope(nextAccountSlot, nextAgentId) {
      if (disposed || (accountSlot === nextAccountSlot && agentId === nextAgentId)) return;
      if (accountSlot !== nextAccountSlot) {
        generation += 1;
        records.clear();
        seenEchoKinds.clear();
      }
      accountSlot = nextAccountSlot;
      agentId = nextAgentId;
      emit();
    },
    insertOptimistic(input) {
      if (disposed || input.nonce.length === 0 || input.agentId.length === 0 || records.has(scopeKey(input.accountSlot, input.agentId) + `\u0000${input.nonce}`)) return false;
      if (input.entries.length === 0 || input.entries.some((entry) => entry.clientNonce !== input.nonce)) return false;
      if (input.entries.some((entry) => entry.kind === "user-attachment" && !entry.id.includes(input.nonce))) return false;
      const key = scopeKey(input.accountSlot, input.agentId) + `\u0000${input.nonce}`;
      records.set(key, { ...input, priorNonces: [...(input.priorNonces ?? [])], entries: [...input.entries] });
      seenEchoKinds.set(key, new Map());
      return publish(true);
    },
    markDispatching(slot, nonce) {
      const match = findRecord(slot, nonce);
      if (match == null || match[1].phase === "failed") return false;
      if (match[1].phase === "dispatching") return true;
      records.set(match[0], { ...match[1], phase: "dispatching" });
      return publish(true);
    },
    markAcceptedAwaitingEcho(slot, nonce) {
      const match = findRecord(slot, nonce);
      if (match == null || match[1].phase === "failed") return false;
      if (match[1].phase === "accepted-awaiting-echo") return true;
      records.set(match[0], { ...match[1], phase: "accepted-awaiting-echo" });
      return publish(true);
    },
    markUncertain(slot, nonce) {
      const match = findRecord(slot, nonce);
      if (match == null || match[1].phase === "failed" || match[1].phase === "accepted-awaiting-echo") return false;
      records.set(match[0], { ...match[1], phase: "uncertain" });
      return publish(true);
    },
    markFailed(slot, nonce, failedAtMs) {
      const match = findRecord(slot, nonce);
      if (match == null || !Number.isFinite(failedAtMs)) return false;
      records.set(match[0], { ...match[1], phase: "failed", failedAtMs });
      return publish(true);
    },
    retryFailed(input) {
      const match = findRecord(input.accountSlot, input.nonce);
      if (match == null || match[1].agentId !== input.agentId || match[1].phase !== "failed" || input.freshNonce.length === 0 || input.entries.length === 0) return false;
      if (input.entries.some((entry) => entry.clientNonce !== input.freshNonce)) return false;
      removeRecord(match[0]);
      const key = scopeKey(input.accountSlot, input.agentId) + `\u0000${input.freshNonce}`;
      records.set(key, { accountSlot: input.accountSlot, agentId: input.agentId, nonce: input.freshNonce, priorNonces: [...match[1].priorNonces, match[1].nonce], entries: [...input.entries], phase: input.phase ?? "pending" });
      seenEchoKinds.set(key, new Map());
      return publish(true);
    },
    ingestTranscriptEvent(input) {
      if (disposed || input.accountSlot !== accountSlot || input.agentId !== agentId || input.entry.clientNonce == null) return false;
      const match = findRecord(input.accountSlot, input.entry.clientNonce);
      if (match == null) return false;
      const [key, record] = match;
      const seen = seenEchoKinds.get(key) ?? new Map<string, AcknowledgementEntryKind>();
      if (seen.has(input.entry.id)) return false;
      seen.set(input.entry.id, input.entry.kind);
      seenEchoKinds.set(key, seen);
      const hasMessage = record.entries.some((entry) => entry.kind === "message");
      const echoedMessages = input.entry.kind === "message";
      const attachmentCount = [...seen.values()].filter((kind) => kind === "user-attachment").length;
      const expectedAttachments = record.entries.filter((entry) => entry.kind === "user-attachment").length;
      const complete = echoedMessages || (!hasMessage && expectedAttachments > 0 && attachmentCount >= expectedAttachments);
      if (!complete) {
        publish(true);
        return false;
      }
      removeRecord(key);
      return publish(true);
    },
    reconcileEcho(input) {
      if (disposed || input.accountSlot !== accountSlot) return false;
      const match = findRecord(input.accountSlot, input.nonce);
      if (match == null || match[1].agentId !== input.agentId) return false;
      removeRecord(match[0]);
      return publish(true);
    },
    removeOptimistic(input) {
      if (disposed) return false;
      const match = findRecord(input.accountSlot, input.nonce);
      if (match == null) return false;
      removeRecord(match[0]);
      return publish(true);
    },
    reset() {
      if (disposed) return;
      generation += 1;
      records.clear();
      seenEchoKinds.clear();
      emit();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      records.clear();
      seenEchoKinds.clear();
      listeners.clear();
    }
  };
}
