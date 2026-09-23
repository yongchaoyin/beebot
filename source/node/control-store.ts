import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { TaskSecurityLedger, type TaskSource, type TaskFreeze } from "./task-security.js";
import type { BotAvatar } from "../shared/agents/bot-avatar.js";

export type GoalStatus = "queued" | "running" | "review" | "succeeded" | "failed" | "cancelling" | "cancelled" | "uncertain";
export interface Bot extends BotAvatar { id: string; name: string; description: string; ownerId: string; createdAt: number }
export interface Goal {
  id: string; botId: string; ownerId: string; taskId: string; prompt: string; status: GoalStatus;
  securityStop?: { freezeId: string; requestedAt: number };
  result: string | null; error: string | null; createdAt: number; updatedAt: number; version: number;
}
export interface Task { id: string; goalId: string; botId: string; status: GoalStatus; currentRunId: string | null }
export interface Run { id: string; taskId: string; status: GoalStatus; startedAt: number; finishedAt: number | null }
export interface NodeEvent { seq: number; type: string; data: unknown; at: number }
export class ControlError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
type Row = Record<string, unknown>;
function decode<T>(row: Row | undefined): T | undefined { return row ? JSON.parse(String(row.data)) as T : undefined; }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return "{" + entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

/** One local writer, FULL synchronous commits. Commands, projections and events commit together. */
export class ControlStore {
  private readonly db: DatabaseSync;
  private readonly lock: DatabaseSync;
  readonly taskSecurity: TaskSecurityLedger;
  private readonly listeners = new Set<() => void>();
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    for (const name of ["controller-lock.sqlite", "control.sqlite"]) {
      const file = path.join(dataDir, name);
      if (existsSync(file) && (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())) throw new Error("Control databases must be regular files.");
      closeSync(openSync(file, "a", 0o600)); chmodSync(file, 0o600);
    }
    this.lock = new DatabaseSync(path.join(dataDir, "controller-lock.sqlite"));
    try { this.lock.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE"); }
    catch { this.lock.close(); throw new Error("This data directory already has an active BeeBot server."); }
    this.db = new DatabaseSync(path.join(dataDir, "control.sqlite"));
    try {
    const version = Number(this.db.prepare("PRAGMA user_version").get()!.user_version);
    if (version > 2) throw new Error("This node database requires a newer BeeBot server.");
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS bots(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transcripts(goal_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands(principal TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(principal,key));
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL);
      PRAGMA user_version=2;`);
    this.taskSecurity = new TaskSecurityLedger(this.db);
    for (const name of ["control.sqlite-wal", "control.sqlite-shm"]) if (existsSync(path.join(dataDir, name))) chmodSync(path.join(dataDir, name), 0o600);
    } catch (error) { this.db.close(); this.lock.close(); throw error; }
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private tx<T>(fn: () => T): T {
    const before = this.cursor;
    this.db.exec("BEGIN IMMEDIATE");
    let result: T;
    try { result = fn(); this.db.exec("COMMIT"); }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
    if (this.cursor !== before) for (const listener of this.listeners) { try { listener(); } catch {} }
    return result;
  }
  private put<T extends { id: string }>(table: "bots" | "goals" | "tasks" | "runs", value: T): void {
    this.db.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(value.id, JSON.stringify(value));
  }
  private event(type: string, data: unknown): void {
    this.db.prepare("INSERT INTO events(type,data,at) VALUES(?,?,?)").run(type, JSON.stringify(data), Date.now());
  }
  private command<T>(principal: string, key: string, operation: unknown, fn: () => T): T {
    if (!/^[\w.:-]{8,128}$/.test(key)) throw new ControlError(400, "invalid_idempotency_key", "An Idempotency-Key of 8–128 safe characters is required.");
    const digest = createHash("sha256").update(canonical(operation)).digest("hex");
    return this.tx(() => {
      const existing = this.db.prepare("SELECT digest,response FROM commands WHERE principal=? AND key=?").get(principal, key);
      if (existing) {
        if (existing.digest !== digest) throw new ControlError(409, "idempotency_conflict", "This command key was already used with different input.");
        return JSON.parse(String(existing.response)) as T;
      }
      const result = fn();
      this.db.prepare("INSERT INTO commands VALUES(?,?,?,?)").run(principal, key, digest, JSON.stringify(result));
      return result;
    });
  }
  bots(ownerId?: string): Bot[] { return this.db.prepare("SELECT data FROM bots ORDER BY rowid").all().map(row => decode<Bot>(row)!).filter(bot => !ownerId || bot.ownerId === ownerId); }
  goals(ownerId?: string): Goal[] { return this.db.prepare("SELECT data FROM goals ORDER BY rowid DESC").all().map(row => decode<Goal>(row)!).filter(goal => !ownerId || goal.ownerId === ownerId); }
  bot(id: string): Bot {
    const bot = decode<Bot>(this.db.prepare("SELECT data FROM bots WHERE id=?").get(id));
    if (!bot) throw new ControlError(404, "bot_not_found", "Bot not found.");
    return bot;
  }
  goal(id: string, ownerId?: string): Goal {
    const goal = decode<Goal>(this.db.prepare("SELECT data FROM goals WHERE id=?").get(id));
    if (!goal || ownerId && goal.ownerId !== ownerId) throw new ControlError(404, "goal_not_found", "Goal not found.");
    return goal;
  }
  task(id: string): Task { return decode<Task>(this.db.prepare("SELECT data FROM tasks WHERE id=?").get(id))!; }
  run(id: string): Run { return decode<Run>(this.db.prepare("SELECT data FROM runs WHERE id=?").get(id))!; }
  transcript(goalId: string): unknown[] { return decode<unknown[]>(this.db.prepare("SELECT data FROM transcripts WHERE goal_id=?").get(goalId)) ?? []; }
  get cursor(): number { return Number(this.db.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM events").get()!.seq); }
  events(after: number, limit = 256): NodeEvent[] {
    return this.db.prepare("SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?").all(after, limit).map(row => ({ seq: Number(row.seq), type: String(row.type), data: JSON.parse(String(row.data)), at: Number(row.at) }));
  }
  createBot(ownerId: string, key: string, input: { name: string; description: string } & BotAvatar): { bot: Bot } {
    return this.command(ownerId, key, ["createBot", input], () => {
      const bot: Bot = { ...input, id: randomUUID(), ownerId, createdAt: Date.now() };
      this.put("bots", bot); this.event("bot.created", { bot }); return { bot };
    });
  }
  submitGoal(ownerId: string, key: string, input: { botId: string; prompt: string }, source?: TaskSource): { commandId: string; goalId: string } {
    return this.command(ownerId, key, ["submitGoal", input], () => {
      // An authorized retry of an already committed command returns its original
      // receipt, even after a freeze; it never re-dispatches or claims no acceptance.
      if (this.taskSecurity.active(ownerId, "bot", input.botId) || source && this.taskSecurity.active(ownerId, "device", source.deviceJkt)) {
        throw new ControlError(423, "task_security_frozen", "Safety stop is active. An administrator must inspect the affected work; no new task was submitted.");
      }
      const bot = this.bot(input.botId);
      if (bot.ownerId !== ownerId) throw new ControlError(404, "bot_not_found", "Bot not found.");
      if (this.goals(ownerId).some(goal => goal.botId === bot.id && ["uncertain", "cancelling"].includes(goal.status))) throw new ControlError(409, "bot_fenced", "This Bot has an interrupted execution that requires reconciliation. Create a separate Bot for new work.");
      const now = Date.now();
      const goal: Goal = { id: randomUUID(), taskId: randomUUID(), ownerId, botId: bot.id, prompt: input.prompt, status: "queued", result: null, error: null, createdAt: now, updatedAt: now, version: 1 };
      this.put("goals", goal); this.put("tasks", { id: goal.taskId, goalId: goal.id, botId: bot.id, status: "queued", currentRunId: null } as Task);
      this.taskSecurity.record(goal.id, ownerId, bot.id, now, source);
      this.event("goal.created", { goal }); return { commandId: randomUUID(), goalId: goal.id };
    });
  }
  start(goalId: string): { goal: Goal; run: Run; bot: Bot } | undefined {
    return this.tx(() => {
      const goal = this.goal(goalId);
      if (goal.status !== "queued" || goal.securityStop || this.taskSecurity.authorization(goal.id)?.revokedAt != null ||
          this.taskSecurity.active(goal.ownerId, "bot", goal.botId)) return undefined;
      const source = this.taskSecurity.authorization(goal.id)?.source;
      if (source && this.taskSecurity.active(goal.ownerId, "device", source.deviceJkt)) return undefined;
      const blocked = this.goals().some(other => other.id !== goal.id && other.botId === goal.botId && ["running", "cancelling", "uncertain"].includes(other.status));
      if (blocked) return undefined;
      const run: Run = { id: randomUUID(), taskId: goal.taskId, status: "running", startedAt: Date.now(), finishedAt: null };
      this.put("runs", run);
      this.put("tasks", { ...this.task(goal.taskId), status: "running", currentRunId: run.id });
      const started = this.updateGoal(goal, "running");
      return { goal: started, run, bot: this.bot(goal.botId) };
    });
  }
  private updateGoal(goal: Goal, status: GoalStatus, fields: Partial<Goal> = {}): Goal {
    const next = { ...goal, ...fields, status, version: goal.version + 1, updatedAt: Date.now() };
    this.put("goals", next); this.put("tasks", { ...this.task(goal.taskId), status });
    this.event("goal.updated", { goal: next }); return next;
  }
  finish(goalId: string, runId: string, status: "review" | "failed" | "uncertain" | "cancelled", fields: { result?: string; error?: string; transcript?: unknown[] }): void {
    this.tx(() => {
      const goal = this.goal(goalId); const task = this.task(goal.taskId);
      if (!["running", "cancelling"].includes(goal.status) || task.currentRunId !== runId) return;
      // Safety revocation wins over late success/failure. Keep evidence, but never
      // promote revoked work to an accepted delivery or unblock this Bot silently.
      if (goal.securityStop || this.taskSecurity.authorization(goal.id)?.revokedAt != null) {
        status = "uncertain";
        fields = { ...fields, error: "Security stop requested. This attempt will not resume automatically. Inspect its workspace and external effects before reconciliation." };
      }
      // A completion concurrent with cancellation is still inspectable; never discard its result.
      this.updateGoal(goal, status, { result: fields.result ?? null, error: fields.error ?? null });
      this.put("runs", { ...this.run(runId), status, finishedAt: Date.now() });
      if (fields.transcript) this.db.prepare("INSERT OR REPLACE INTO transcripts VALUES(?,?)").run(goal.id, JSON.stringify(fields.transcript));
    });
  }
  cancel(ownerId: string, key: string, goalId: string): { goal: Goal } {
    return this.command(ownerId, key, ["cancel", goalId], () => {
      const goal = this.goal(goalId, ownerId);
      if (goal.status === "queued") return { goal: this.updateGoal(goal, "cancelled") };
      if (goal.status === "running") return { goal: this.updateGoal(goal, "cancelling") };
      if (["cancelled", "cancelling"].includes(goal.status)) return { goal };
      throw new ControlError(409, "invalid_state", "This execution can no longer be cancelled.");
    });
  }
  accept(ownerId: string, key: string, goalId: string, expectedVersion: number): { goal: Goal } {
    return this.command(ownerId, key, ["accept", goalId, expectedVersion], () => {
      const goal = this.goal(goalId, ownerId);
      if (goal.status !== "review" || goal.version !== expectedVersion) throw new ControlError(409, "stale_review", "Refresh the result before accepting it.");
      return { goal: this.updateGoal(goal, "succeeded") };
    });
  }
  reconciliationResult(ownerId: string, key: string, goalId: string, expectedVersion: number, note: string): { goal: Goal } | undefined {
    const previous = this.db.prepare("SELECT digest,response FROM commands WHERE principal=? AND key=?").get(ownerId, key);
    if (!previous) return undefined;
    const digest = createHash("sha256").update(canonical(["reconcile", goalId, expectedVersion, note])).digest("hex");
    if (digest !== previous.digest) throw new ControlError(409, "idempotency_conflict", "This command key was already used with different input.");
    return JSON.parse(String(previous.response)) as { goal: Goal };
  }
  reconcile(ownerId: string, key: string, goalId: string, expectedVersion: number, note: string): { goal: Goal } {
    return this.command(ownerId, key, ["reconcile", goalId, expectedVersion, note], () => {
      const goal = this.goal(goalId, ownerId);
      if (goal.status !== "uncertain" || goal.version !== expectedVersion) throw new ControlError(409, "stale_review", "Refresh this interrupted result before reconciling it.");
      const decision = { id: randomUUID(), goalId, ownerId, kind: "manual-reconciliation", note, at: Date.now(), runId: this.task(goal.taskId).currentRunId };
      this.db.prepare("INSERT INTO decisions VALUES(?,?,?)").run(decision.id, goalId, JSON.stringify(decision));
      return { goal: this.updateGoal(goal, "failed", { error: `Interrupted attempt closed after owner inspection: ${note}` }) };
    });
  }
  recoverInterrupted(): void {
    this.tx(() => {
      for (const goal of this.goals()) {
        if (!["running", "cancelling"].includes(goal.status)) continue;
        this.updateGoal(goal, "uncertain", { error: "Server restarted during execution. This attempt will not be automatically repeated; inspect its workspace and external effects." });
        const task = this.task(goal.taskId);
        if (task.currentRunId) this.put("runs", { ...this.run(task.currentRunId), status: "uncertain", finishedAt: Date.now() });
      }
    });
  }
  /** Freeze and every affected projection commit together before callers may report success. */
  freezeTasks(ownerId: string, actorSessionId: string, key: string, scope: TaskFreeze["scope"], target: string): { freeze: TaskFreeze } {
    if (scope === "bot" && this.bot(target).ownerId !== ownerId) throw new ControlError(404, "bot_not_found", "Bot not found.");
    return this.command(ownerId, key, ["freezeTasks", scope, target], () => {
      const freeze = this.taskSecurity.freeze(ownerId, actorSessionId, scope, target);
      for (const goal of this.goals(ownerId)) {
        if (scope === "bot" ? goal.botId !== target : this.taskSecurity.authorization(goal.id)?.source?.deviceJkt !== target) continue;
        this.taskSecurity.revoke(goal.id, freeze);
        if (!["queued", "running", "cancelling", "uncertain", "review"].includes(goal.status) || goal.securityStop) continue;
        const status = goal.status === "queued" ? "cancelled" : goal.status === "running" ? "cancelling" : goal.status;
        this.updateGoal(goal, status, { securityStop: { freezeId: freeze.id, requestedAt: freeze.requestedAt },
          error: goal.status === "queued" ? "Security stop: this queued task was cancelled before dispatch. It will not be replayed."
            : "Security stop: stopping or inspection is required. Completed external actions cannot be undone." });
      }
      this.event("security.tasks_frozen", { principalId: ownerId, actorSessionId, freezeId: freeze.id, scope, target });
      return { freeze };
    });
  }
  releaseBotFreeze(ownerId: string, actorSessionId: string, key: string, freezeId: string, expectedVersion: number): { freeze: TaskFreeze } {
    return this.command(ownerId, key, ["releaseBotFreeze", freezeId, expectedVersion], () => {
      const freeze = this.taskSecurity.get(freezeId, ownerId);
      if (!freeze || freeze.scope !== "bot") throw new ControlError(404, "not_found", "Unknown Bot safety stop.");
      if (freeze.releasedAt !== null || freeze.version !== expectedVersion) throw new ControlError(409, "stale_freeze", "Refresh this safety stop before releasing it.");
      if (this.goals(ownerId).some(goal => goal.botId === freeze.target && ["running", "cancelling", "uncertain"].includes(goal.status))) {
        throw new ControlError(409, "inspection_required", "Confirm all running or uncertain attempts stopped and inspect their external effects before releasing the Bot.");
      }
      const next = this.taskSecurity.release(freeze);
      // This lifts only the Bot's admission fence. Revoked task grants stay revoked.
      this.event("security.bot_released", { principalId: ownerId, actorSessionId, freezeId, target: freeze.target });
      return { freeze: next };
    });
  }
  taskSafetySnapshot(ownerId: string): unknown {
    const goals = this.goals(ownerId);
    const unattributed = goals.filter(goal => !this.taskSecurity.authorization(goal.id)?.source && ["queued", "running", "cancelling", "uncertain", "review"].includes(goal.status));
    return { unattributedActiveTasks: unattributed.length, freezes: this.taskSecurity.list(ownerId).map(freeze => {
      const affected = goals.filter(goal => freeze.scope === "bot" ? goal.botId === freeze.target : this.taskSecurity.authorization(goal.id)?.source?.deviceJkt === freeze.target);
      return { ...freeze, cancelledBeforeDispatch: affected.filter(goal => goal.securityStop && goal.status === "cancelled").length,
        stopping: affected.filter(goal => goal.securityStop && ["running", "cancelling"].includes(goal.status)).length,
        needsInspection: affected.filter(goal => goal.securityStop && ["uncertain", "review"].includes(goal.status)).length };
    }) };
  }
  taskSecurityEvents(ownerId: string): unknown[] {
    return this.db.prepare("SELECT seq,at,type,data FROM events WHERE type LIKE 'security.%' AND json_extract(data,'$.principalId')=? ORDER BY seq DESC LIMIT 200").all(ownerId).map(row => {
      const data = JSON.parse(String(row.data));
      return { seq: Number(row.seq), time: Number(row.at), kind: String(row.type), session_id: data.actorSessionId, subject_id: data.target };
    });
  }
  close(): void { this.listeners.clear(); this.db.close(); this.lock.exec("ROLLBACK"); this.lock.close(); }
}
