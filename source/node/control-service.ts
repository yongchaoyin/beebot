import { ControlError, ControlStore } from "./control-store.js";
import type { RuntimeBot, RuntimeInput, RuntimeResult } from "./runtime.js";

export interface BotRuntime { execute(input: RuntimeInput, signal: AbortSignal): Promise<RuntimeResult>; reconcile?(bot: RuntimeBot, runId: string): Promise<void>; close(): Promise<void> }
export class ControlService {
  private readonly active = new Map<string, AbortController>();
  private stopping = false;
  private scheduled = false;
  private started = false;
  private closePromise: Promise<void> | undefined;
  private readonly reconciling = new Set<string>();
  failure: Error | undefined;
  private readonly unsubscribe: () => void;
  private readonly executions = new Set<Promise<void>>();
  constructor(readonly store: ControlStore, private readonly runtime: BotRuntime, private readonly concurrency = 2, autoStart = true) {
    store.recoverInterrupted();
    this.unsubscribe = store.subscribe(() => {
      try { this.abortCancelled(); this.schedule(); } catch (error) { this.fail(error); }
    });
    if (autoStart) this.start();
  }
  start(): void { this.started = true; this.schedule(); }
  private fail(error: unknown): void {
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.stopping = true;
    console.error("[beebot-node] task ledger unavailable; execution stopped", this.failure);
    for (const abort of this.active.values()) abort.abort();
    void this.runtime.close().catch(() => {});
  }
  private schedule(): void {
    if (!this.started || this.stopping || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; if (!this.stopping) { try { this.pump(); } catch (error) { this.fail(error); } } });
  }
  private abortCancelled(): void {
    for (const [id, abort] of this.active) if (this.store.goal(id).status === "cancelling") abort.abort();
  }
  private pump(): void {
    this.abortCancelled();
    for (const goal of this.store.goals().reverse()) {
      if (this.active.size >= this.concurrency) break;
      if (goal.status !== "queued") continue;
      const start = this.store.start(goal.id);
      if (!start) continue;
      const abort = new AbortController(); this.active.set(goal.id, abort);
      // A synchronous ledger subscriber may revoke between durable start and
      // dispatch. Do not rely on a runtime honoring a pre-aborted signal.
      if (this.store.goal(goal.id).securityStop) abort.abort();
      const work = (async () => {
        try {
          if (abort.signal.aborted) throw new Error("Execution authorization was revoked before runtime dispatch.");
          const result = await this.runtime.execute({ runId: start.run.id, bot: start.bot, prompt: start.goal.prompt }, abort.signal);
          this.store.finish(goal.id, start.run.id, "review", { result: result.text, transcript: result.transcript });
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? error.code : "uncertain";
          // Interrupted tools may have made external changes. Keep this Bot fenced until reconciliation.
          const status = code === "failed" ? "failed" : "uncertain";
          this.store.finish(goal.id, start.run.id, status, { error: error instanceof Error ? error.message : "Execution result could not be confirmed." });
        } finally { this.active.delete(goal.id); this.schedule(); }
      })();
      this.executions.add(work); void work.catch(error => this.fail(error)).finally(() => this.executions.delete(work));
    }
  }
  async reconcile(ownerId: string, key: string, goalId: string, expectedVersion: number, note: string, authorize?: () => void): Promise<unknown> {
    if (this.stopping) throw new ControlError(503, "unavailable", "The task controller is unavailable.");
    if (!/^[\w.:-]{8,128}$/.test(key)) throw new ControlError(400, "invalid_idempotency_key", "A valid command key is required.");
    authorize?.();
    const cached = this.store.reconciliationResult(ownerId, key, goalId, expectedVersion, note);
    if (cached) return cached;
    const goal = this.store.goal(goalId, ownerId);
    if (goal.status !== "uncertain" || goal.version !== expectedVersion) throw new ControlError(409, "stale_review", "Refresh the result before reconciliation.");
    if (this.reconciling.has(goalId)) throw new ControlError(409, "reconciliation_pending", "An inspection is already being recorded.");
    if (!this.runtime.reconcile) throw new ControlError(503, "unavailable", "This runtime cannot reconcile interrupted attempts.");
    this.reconciling.add(goalId);
    try {
      const runId = this.store.task(goal.taskId).currentRunId!;
      try { await this.runtime.reconcile(this.store.bot(goal.botId), runId); }
      catch (error) {
        console.error("[beebot-node] Bot reconciliation remains blocked", error);
        throw new ControlError(409, "reconciliation_blocked", "The previous execution could not be confirmed stopped. Keep this Bot paused and inspect its server logs.");
      }
      authorize?.(); // Runtime inspection yields; permission may have been revoked in flight.
      return this.store.reconcile(ownerId, key, goalId, expectedVersion, note);
    } finally { this.reconciling.delete(goalId); }
  }
  close(): Promise<void> {
    this.closePromise ??= (async () => {
      this.stopping = true; this.unsubscribe();
      for (const abort of this.active.values()) abort.abort();
      await this.runtime.close();
      await Promise.allSettled([...this.executions]);
    })();
    return this.closePromise;
  }
}
