/** Renderer send boundary. A receipt is not proof of execution or completion. */
export type ComposerSubmissionPhase = "pending" | "queued" | "uncertain" | "failed" | "sent" | "cancelled";
export interface ComposerSubmission {
  nonce: string;
  agentId: string;
  prompt: string;
  /** Serialized Tiptap JSON; absent for a plain compatibility draft. */
  richText?: string;
  attachments: readonly { path: string; name: string }[];
  createdAtMs: number;
  replyToId?: string;
  isFork?: boolean;
}
export interface ComposerSubmissionRecord extends ComposerSubmission {
  phase: Exclude<ComposerSubmissionPhase, "cancelled">;
}
export interface ComposerSubmissionQueue {
  submit(input: ComposerSubmission): { nonce: string; completion: Promise<ComposerSubmissionPhase> };
  discard(nonce: string): void;
  cancelQueued(nonce: string): boolean;
  /** Only call with a verified receipt; never infer rejection from a timeout. */
  reconcile(nonce: string, outcome: "sent" | "not-sent"): boolean;
  /** Invalidate a previous account/session without disposing the new owner. */
  reset(): void;
  flush(): void;
  snapshot(): readonly ComposerSubmissionRecord[];
  dispose(): void;
}
interface QueueOptions {
  isTransportDown(): boolean;
  send(input: ComposerSubmission): Promise<void>;
  now?(): number;
  /** Absence of a classifier (or a classifier failure) means outcome unknown. */
  classifyFailure?(error: unknown): "rejected" | "uncertain";
  onPhase?(input: ComposerSubmission & { phase: ComposerSubmissionPhase }): void;
  onFailure?(input: ComposerSubmissionRecord, error: unknown): void;
  onObserverError?(error: unknown): void;
}
interface PendingRecord {
  input: ComposerSubmission;
  fingerprint: string;
  phase: ComposerSubmissionPhase;
  resolve(value: ComposerSubmissionPhase): void;
  completion: Promise<ComposerSubmissionPhase>;
}
/** Only for a provably pre-dispatch failure or an authoritative rejection. */
export class ComposerSubmissionRejectedError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = "ComposerSubmissionRejectedError"; }
}
export class ComposerSubmissionConflictError extends Error {
  readonly code = "submission_nonce_conflict";
  constructor() { super("This send identifier already belongs to a different message."); this.name = "ComposerSubmissionConflictError"; }
}
const fingerprint = (input: ComposerSubmission) => JSON.stringify([
  input.agentId, input.prompt, input.richText ?? null,
  input.attachments.map(({ path, name }) => [path, name]), input.replyToId ?? null, input.isFork === true,
]);
const copyInput = (input: ComposerSubmission): ComposerSubmission => ({ ...input, attachments: input.attachments.map(attachment => ({ ...attachment })) });

/** FIFO per conversation/agent, independent lanes, and lifetime nonce receipts.
 * An uncertain send holds its lane until explicitly reconciled. It is never
 * retried automatically. Dispose this queue at its owning session boundary.
 */
export function createComposerSubmissionQueue(options: QueueOptions): ComposerSubmissionQueue {
  // Terminal records retain nonce receipts until dispose, but are not rendered.
  const records = new Map<string, PendingRecord>();
  const activeByAgent = new Map<string, string>();
  let generation = 0;
  let disposed = false;
  const observe = (callback: (() => void) | undefined) => {
    try { callback?.(); } catch (error) {
      // A view/listener error must not reclassify an acknowledged send as failed.
      try { options.onObserverError?.(error); } catch { /* Diagnostics cannot own queue progress. */ }
    }
  };
  const notify = (record: PendingRecord, phase: ComposerSubmissionPhase) => {
    record.phase = phase;
    observe(() => options.onPhase?.({ ...copyInput(record.input), phase }));
  };
  const current = (record: PendingRecord, epoch: number) => !disposed && generation === epoch && records.get(record.input.nonce) === record && record.phase !== "sent" && record.phase !== "failed" && record.phase !== "cancelled";
  const release = (record: PendingRecord) => {
    if (activeByAgent.get(record.input.agentId) === record.input.nonce) activeByAgent.delete(record.input.agentId);
  };
  const finish = (record: PendingRecord, phase: "sent" | "failed" | "cancelled") => {
    release(record);
    notify(record, phase);
    record.resolve(phase);
  };
  const failure = (record: PendingRecord, epoch: number, error: unknown) => {
    if (!current(record, epoch)) return;
    let rejected = false;
    try { rejected = options.classifyFailure?.(error) === "rejected"; } catch { /* Keep unknown outcomes paused. */ }
    if (rejected) finish(record, "failed");
    else { notify(record, "uncertain"); record.resolve("uncertain"); }
    observe(() => options.onFailure?.({ ...copyInput(record.input), phase: rejected ? "failed" : "uncertain" }, error));
    if (rejected) flushAgent(record.input.agentId, epoch);
  };
  const run = (record: PendingRecord, epoch: number) => {
    if (!current(record, epoch) || options.isTransportDown()) return;
    activeByAgent.set(record.input.agentId, record.input.nonce);
    notify(record, "pending");
    if (!current(record, epoch)) return; // An observer may dispose the owner.
    try {
      void Promise.resolve(options.send(copyInput(record.input))).then(() => {
        if (!current(record, epoch)) return;
        finish(record, "sent");
        flushAgent(record.input.agentId, epoch);
      }, error => failure(record, epoch, error));
    } catch (error) { failure(record, epoch, error); }
  };
  const flushAgent = (agentId: string, epoch: number) => {
    if (disposed || generation !== epoch || options.isTransportDown() || activeByAgent.has(agentId)) return;
    const next = [...records.values()].find(record => record.input.agentId === agentId && record.phase === "queued");
    if (next != null) run(next, epoch);
  };
  const flush = () => {
    const epoch = generation;
    for (const record of records.values()) if (record.phase === "queued") flushAgent(record.input.agentId, epoch);
  };
  const reset = () => {
    generation += 1; activeByAgent.clear();
    for (const record of records.values()) record.resolve("cancelled");
    records.clear();
  };
  return {
    submit(input) {
      if (disposed) return { nonce: input.nonce, completion: Promise.resolve("cancelled") };
      const key = fingerprint(input);
      const previous = records.get(input.nonce);
      if (previous != null) {
        if (previous.fingerprint !== key) throw new ComposerSubmissionConflictError();
        return { nonce: input.nonce, completion: previous.completion };
      }
      let resolve!: PendingRecord["resolve"];
      const completion = new Promise<ComposerSubmissionPhase>(done => { resolve = done; });
      const record: PendingRecord = { input: copyInput(input), fingerprint: key, phase: "queued", resolve, completion };
      records.set(input.nonce, record);
      // Every new request joins the same FIFO path; no newly submitted bypass.
      notify(record, "queued");
      flushAgent(input.agentId, generation);
      return { nonce: input.nonce, completion };
    },
    discard(nonce) {
      const record = records.get(nonce);
      if (record?.phase === "failed") notify(record, "cancelled");
    },
    cancelQueued(nonce) {
      const record = records.get(nonce);
      if (record?.phase !== "queued") return false;
      finish(record, "cancelled");
      flushAgent(record.input.agentId, generation);
      return true;
    },
    reconcile(nonce, outcome) {
      const record = records.get(nonce);
      if (record == null || (record.phase !== "uncertain" && !(record.phase === "pending" && outcome === "sent"))) return false;
      if (outcome !== "sent" && outcome !== "not-sent") return false;
      finish(record, outcome === "sent" ? "sent" : "failed");
      flushAgent(record.input.agentId, generation);
      return true;
    },
    reset,
    flush,
    snapshot() {
      return [...records.values()].filter(record => record.phase !== "sent" && record.phase !== "cancelled")
        .map(record => ({ ...copyInput(record.input), phase: record.phase as ComposerSubmissionRecord["phase"] }));
    },
    dispose() {
      if (disposed) return;
      disposed = true; reset();
    },
  };
}
