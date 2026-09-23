import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** Server-derived provenance. Never accept these fields from the request body. */
export interface TaskSource { nodeId: string; deviceJkt: string; sessionId: string }
export interface TaskAuthorization {
  goalId: string; principalId: string; botId: string; acceptedAt: number;
  source: TaskSource | null; revokedAt: number | null; freezeId: string | null;
}
export interface TaskFreeze {
  id: string; principalId: string; scope: "device" | "bot"; target: string;
  actorSessionId: string; requestedAt: number; releasedAt: number | null; version: number;
}
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const jkt = /^[A-Za-z0-9_-]{43}$/;

/** Shares ControlStore's FULL-synchronous transaction. No network credentials are
 * issued here: an accepted task has an independent, revocable server-side grant.
 * Logout/refresh expiry does not revoke that grant. A safety stop does.
 */
export class TaskSecurityLedger {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_authorizations (
        goal_id TEXT PRIMARY KEY REFERENCES goals(id), data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_freezes (
        id TEXT PRIMARY KEY, principal TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('device','bot')),
        target TEXT NOT NULL, data TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS task_freezes_active ON task_freezes(principal,scope,target) WHERE active=1;
    `);
  }
  record(goalId: string, principalId: string, botId: string, acceptedAt: number, source?: TaskSource): void {
    if (source && (!uuid.test(source.nodeId) || !uuid.test(source.sessionId) || !jkt.test(source.deviceJkt) ||
        Object.keys(source).some(key => !["nodeId", "sessionId", "deviceJkt"].includes(key)))) throw new Error("Invalid server task provenance.");
    const grant: TaskAuthorization = { goalId, principalId, botId, acceptedAt, source: source ? { ...source } : null, revokedAt: null, freezeId: null };
    // First acceptance owns attribution forever; retries must never rebind it.
    this.db.prepare("INSERT INTO task_authorizations(goal_id,data) VALUES (?,?)").run(goalId, JSON.stringify(grant));
  }
  authorization(goalId: string): TaskAuthorization | undefined {
    const row = this.db.prepare("SELECT data FROM task_authorizations WHERE goal_id=?").get(goalId);
    return row ? JSON.parse(String(row.data)) as TaskAuthorization : undefined;
  }
  active(principal: string, scope: TaskFreeze["scope"], target: string): TaskFreeze | undefined {
    const row = this.db.prepare("SELECT data FROM task_freezes WHERE principal=? AND scope=? AND target=? AND active=1").get(principal, scope, target);
    return row ? JSON.parse(String(row.data)) as TaskFreeze : undefined;
  }
  list(principal: string): TaskFreeze[] {
    return this.db.prepare("SELECT data FROM task_freezes WHERE principal=? ORDER BY rowid DESC LIMIT 200").all(principal).map(row => JSON.parse(String(row.data)) as TaskFreeze);
  }
  get(id: string, principal: string): TaskFreeze | undefined {
    const row = this.db.prepare("SELECT data FROM task_freezes WHERE id=? AND principal=?").get(id, principal);
    return row ? JSON.parse(String(row.data)) as TaskFreeze : undefined;
  }
  freeze(principal: string, actorSessionId: string, scope: TaskFreeze["scope"], target: string): TaskFreeze {
    if (!(scope === "device" ? jkt : uuid).test(target)) throw new Error("Invalid safety-stop target.");
    const existing = this.active(principal, scope, target);
    if (existing) return existing;
    const record: TaskFreeze = { id: randomUUID(), principalId: principal, scope, target, actorSessionId, requestedAt: Date.now(), releasedAt: null, version: 1 };
    this.db.prepare("INSERT INTO task_freezes VALUES (?,?,?,?,?,1)").run(record.id, principal, scope, target, JSON.stringify(record));
    return record;
  }
  revoke(goalId: string, freeze: TaskFreeze): void {
    const grant = this.authorization(goalId);
    if (!grant) return; // Historic tasks remain explicitly unattributed, not guessed.
    if (grant.revokedAt !== null) return;
    this.db.prepare("UPDATE task_authorizations SET data=? WHERE goal_id=?").run(JSON.stringify({ ...grant, revokedAt: freeze.requestedAt, freezeId: freeze.id }), goalId);
  }
  release(freeze: TaskFreeze): TaskFreeze {
    const next = { ...freeze, releasedAt: Date.now(), version: freeze.version + 1 };
    this.db.prepare("UPDATE task_freezes SET active=0,data=? WHERE id=?").run(JSON.stringify(next), freeze.id);
    return next;
  }
}
