import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { botRoleRecordSchema, botRoleUpdateSchema, type BotRoleRecord } from "../../shared/bot-role.js";
import { assertValidSandAgentId } from "../storage/agent-paths.js";

/** Host-owned metadata separate from profile.json / update_state. Synchronous
 * CAS and append-only revisions make user edits and acknowledgement retries safe.
 * This is an API authority boundary, not OS isolation on a shared computer. */
export class BotRoleStore {
  readonly path: string;
  constructor(readonly root: string, readonly now: () => number = Date.now) {
    this.path = join(root, ".bot-roles.sqlite");
  }
  private open(write: boolean): DatabaseSync | null {
    if (!write && !existsSync(this.path)) return null;
    if (write) mkdirSync(this.root, {recursive:true});
    const db = new DatabaseSync(this.path, {readOnly: !write});
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      if (write) db.exec(`CREATE TABLE IF NOT EXISTS bot_role_revisions (
        bot_id TEXT NOT NULL, revision INTEGER NOT NULL, request_id TEXT NOT NULL,
        digest TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(bot_id, revision), UNIQUE(bot_id, request_id))`);
      return db;
    } catch (error) { db.close(); throw error; }
  }
  private decode(row: Record<string, unknown> | undefined, botId: string): BotRoleRecord | null {
    if (!row) return null;
    const record = botRoleRecordSchema.parse(JSON.parse(String(row.payload)));
    if (record.botId !== botId || record.revision !== row.revision) throw new Error("bot_role_corrupt: Role identity/version does not match its record.");
    return record;
  }
  read(botId: string): BotRoleRecord | null {
    assertValidSandAgentId(botId);
    const db = this.open(false); if (!db) return null;
    try { return this.decode(db.prepare("SELECT revision,payload FROM bot_role_revisions WHERE bot_id=? ORDER BY revision DESC LIMIT 1").get(botId),botId); }
    finally { db.close(); }
  }
  /** Called only after an explicit Bot deletion has removed its session. */
  forget(botId: string): void {
    assertValidSandAgentId(botId);
    if (!existsSync(this.path)) return;
    const db = this.open(true)!;
    try { db.prepare("DELETE FROM bot_role_revisions WHERE bot_id=?").run(botId); }
    finally { db.close(); }
  }
  update(raw: unknown): {record: BotRoleRecord; replayed: boolean} {
    const args = botRoleUpdateSchema.parse(raw); assertValidSandAgentId(args.agentId);
    const digest = createHash("sha256").update(JSON.stringify([args.expectedRevision,args.role])).digest("hex");
    const db = this.open(true)!;
    try {
      db.exec("BEGIN IMMEDIATE");
      const repeated = db.prepare("SELECT revision,payload,digest FROM bot_role_revisions WHERE bot_id=? AND request_id=?").get(args.agentId,args.requestId);
      if (repeated) {
        if (repeated.digest !== digest) throw new Error("bot_role_request_conflict: This request was used for different role input. Refresh before editing.");
        const record = this.decode(repeated,args.agentId)!; db.exec("COMMIT"); return {record,replayed:true};
      }
      const current = this.decode(db.prepare("SELECT revision,payload FROM bot_role_revisions WHERE bot_id=? ORDER BY revision DESC LIMIT 1").get(args.agentId),args.agentId);
      if ((current?.revision ?? 0) !== args.expectedRevision) throw new Error("bot_role_stale: The role has changed. Read the current version; do not automatically reapply an old edit.");
      const record = botRoleRecordSchema.parse({format:1,botId:args.agentId,revision:args.expectedRevision+1,confirmedBy:"user",updatedAt:this.now(),role:args.role});
      db.prepare("INSERT INTO bot_role_revisions(bot_id,revision,request_id,digest,payload) VALUES(?,?,?,?,?)")
        .run(args.agentId,record.revision,args.requestId,digest,JSON.stringify(record));
      db.exec("COMMIT"); return {record,replayed:false};
    } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
    finally { db.close(); }
  }
}
