/**
 * Reviewed editable counterpart of the pinned send-journal boundary. Owns
 * receipt ordering, reconnect flush and account-epoch fencing in this renderer.
 * Native renderer behavior requires its separate pinned-adapter verification.
 * @evidence src/app/dist/renderer/assets/index-UbX-y3il.js#byteOffset=5674804
 */

export type ComposerSubmissionPhase = "pending" | "queued" | "failed" | "sent" | "cancelled";

export interface ComposerSubmission {
  nonce: string;
  agentId: string;
  prompt: string;
  /** Serialized Tiptap JSON; absent for an empty/plain compatibility draft. */
  richText?: string;
  attachments: readonly { path: string; name: string }[];
  createdAtMs: number;
  replyToId?: string;
  isFork?: boolean;
}

/** Only a failure before dispatch can be known not to have been accepted. */
export class ComposerSubmissionRejectedError extends Error {
  readonly code = "COMPOSER_NOT_DISPATCHED";
}
export class ComposerSubmissionConflictError extends Error {
  readonly code = "COMPOSER_NONCE_CONFLICT";
  constructor() { super("This message identifier already belongs to different content"); }
}
export type ComposerSubmissionFailure = "rejected" | "unknown";
export interface ComposerSubmissionRecord extends ComposerSubmission {
  phase: Exclude<ComposerSubmissionPhase, "cancelled">;
  failureKind?: ComposerSubmissionFailure;
}
export interface ComposerSubmissionQueue {
  submit(input: ComposerSubmission): { nonce: string; completion: Promise<ComposerSubmissionPhase> };
  /** Explicitly dismiss a failed receipt; never replays that message. */
  discard(nonce: string): void;
  cancelQueued(nonce: string): boolean;
  flush(): void;
  snapshot(): readonly ComposerSubmissionRecord[];
  /** Forget a previous account epoch; does not cancel work already on the host. */
  reset(): void;
  dispose(): void;
}
interface QueueOptions {
  isTransportDown(): boolean;
  send(input: ComposerSubmission): Promise<void>;
  now?(): number;
  onPhase?(input: ComposerSubmission & { phase: ComposerSubmissionPhase; failureKind?: ComposerSubmissionFailure }): void;
  onFailure?(input: ComposerSubmissionRecord, error: unknown): void;
}
interface PendingRecord {
  input: ComposerSubmission;
  signature: string;
  phase: Exclude<ComposerSubmissionPhase, "cancelled">;
  failureKind?: ComposerSubmissionFailure;
  resolve(value: ComposerSubmissionPhase): void;
  completion: Promise<ComposerSubmissionPhase>;
}
const copySubmission = (input: ComposerSubmission): ComposerSubmission => ({
  ...input, attachments: input.attachments.map(attachment => ({ ...attachment }))
});
// Timestamp is receipt metadata, not message content. Include routing, rich text
// and attachment identity, not merely the visible prompt.
const signature = (input: ComposerSubmission) => JSON.stringify([
  input.agentId, input.prompt, input.richText ?? null, input.replyToId ?? null,
  input.isFork ?? false, input.attachments.map(({ path, name }) => [path, name])
]);

/** Renderer-local receipt queue. An unknown outcome blocks only its conversation
 * until explicitly dismissed. Reconnection never replays a failed operation.
 * Recent settled receipts are deduplicated in memory; durable deduplication is
 * still the coordinator's responsibility. No external exactly-once guarantee. */
export function createComposerSubmissionQueue(options: QueueOptions): ComposerSubmissionQueue {
  const records = new Map<string, PendingRecord>();
  const recent = new Map<string, PendingRecord>();
  const activeByAgent = new Map<string, string>();
  let generation = 0;
  let disposed = false;
  const live = (record: PendingRecord, epoch: number) => !disposed && generation === epoch && records.get(record.input.nonce) === record;
  // UI observer failures must not turn an accepted send into a transport failure.
  const observe = (callback: () => void) => {
    try { callback(); } catch { console.error("BeeBot submission observer failed"); }
  };
  const notify = (record: PendingRecord, phase: ComposerSubmissionPhase) => observe(() => options.onPhase?.({
    ...copySubmission(record.input), phase, ...(record.failureKind ? { failureKind: record.failureKind } : {})
  }));
  const remember = (record: PendingRecord) => {
    recent.set(record.input.nonce, record);
    if (recent.size > 256) recent.delete(recent.keys().next().value!);
  };
  const release = (record: PendingRecord) => {
    if (activeByAgent.get(record.input.agentId) === record.input.nonce) activeByAgent.delete(record.input.agentId);
  };
  const flushAgent = (agentId: string, epoch: number) => {
    if (disposed || generation !== epoch || options.isTransportDown() || activeByAgent.has(agentId)) return;
    for (const record of records.values()) {
      if (record.input.agentId !== agentId) continue;
      if (record.phase === "failed" && record.failureKind !== "rejected") return;
      if (record.phase === "queued") { run(record, epoch); return; }
    }
  };
  const fail = (record: PendingRecord, epoch: number, error: unknown) => {
    if (!live(record, epoch)) return;
    record.phase = "failed";
    record.failureKind = error instanceof ComposerSubmissionRejectedError ? "rejected" : "unknown";
    release(record);
    record.resolve("failed");
    notify(record, "failed");
    if (live(record, epoch)) observe(() => options.onFailure?.({ ...copySubmission(record.input), phase: "failed", failureKind: record.failureKind }, error));
    // A confirmed local rejection must not strand B, nor let new C overtake B.
    queueMicrotask(() => flushAgent(record.input.agentId, epoch));
  };
  const run = (record: PendingRecord, epoch: number) => {
    if (!live(record, epoch) || options.isTransportDown()) return;
    activeByAgent.set(record.input.agentId, record.input.nonce);
    record.phase = "pending";
    notify(record, "pending");
    if (!live(record, epoch)) return;
    let result: Promise<void>;
    try { result = options.send(copySubmission(record.input)); }
    catch (error) { fail(record, epoch, error); return; }
    void Promise.resolve(result).then(() => {
      if (!live(record, epoch)) return;
      record.phase = "sent";
      records.delete(record.input.nonce);
      release(record);
      remember(record);
      record.resolve("sent");
      notify(record, "sent");
      flushAgent(record.input.agentId, epoch);
    }, error => fail(record, epoch, error));
  };
  const flush = () => {
    const epoch = generation;
    for (const agentId of new Set([...records.values()].map(record => record.input.agentId))) flushAgent(agentId, epoch);
  };
  const reset = () => {
    generation += 1;
    activeByAgent.clear();
    for (const record of records.values()) record.resolve("cancelled");
    records.clear(); recent.clear();
  };
  return {
    submit(input) {
      if (disposed) return { nonce: input.nonce, completion: Promise.resolve("cancelled") };
      const fingerprint = signature(input);
      const existing = records.get(input.nonce) ?? recent.get(input.nonce);
      if (existing) {
        if (existing.signature !== fingerprint) throw new ComposerSubmissionConflictError();
        return { nonce: input.nonce, completion: existing.completion };
      }
      let resolve!: (value: ComposerSubmissionPhase) => void;
      const completion = new Promise<ComposerSubmissionPhase>(done => { resolve = done; });
      const record: PendingRecord = { input: copySubmission(input), signature: fingerprint, phase: "queued", resolve, completion };
      records.set(input.nonce, record);
      // One scheduler handles both new sends and reconnects; never bypass a head.
      flushAgent(input.agentId, generation);
      if (records.get(input.nonce) === record && record.phase === "queued") notify(record, "queued");
      return { nonce: input.nonce, completion };
    },
    discard(nonce) {
      const record = records.get(nonce);
      if (!record || record.phase !== "failed") return;
      records.delete(nonce);
      remember(record);
      flushAgent(record.input.agentId, generation);
    },
    cancelQueued(nonce) {
      const record = records.get(nonce);
      if (!record || record.phase !== "queued") return false;
      records.delete(nonce);
      record.resolve("cancelled");
      remember(record);
      notify(record, "cancelled");
      flushAgent(record.input.agentId, generation);
      return true;
    },
    flush,
    snapshot() {
      return [...records.values()].map(record => ({ ...copySubmission(record.input), phase: record.phase, ...(record.failureKind ? { failureKind: record.failureKind } : {}) }));
    },
    reset,
    dispose() {
      if (disposed) return;
      disposed = true;
      reset();
    }
  };
}
