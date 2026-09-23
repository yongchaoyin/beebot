import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DeviceGrant } from "./auth.js";

const MINUTE = 60_000;
export type EnrollmentRequest = {
  redirectUri: string; challenge: string; state: string; deviceName: string; dpopJkt: string;
};
export type TrustedDevice = {
  principal_id: string; jkt: string; device_name: string; grant_json: string;
  status: "approved" | "blocked"; created_at: number; updated_at: number; version: number;
};
export type PendingDevice = {
  id: string; principal_id: string; jkt: string; device_name: string; request_json: string;
  csrf_hash: string; status: "pending" | "approved" | "denied" | "cancelled" | "issued";
  created_at: number; expires: number; version: number;
};
export class EnrollmentError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const rejected = () => new EnrollmentError(403, "device_not_approved", "This device is not approved. Use an existing trusted administrator or the explicit recovery process.");

/** Durable device trust is separate from expiring OAuth sessions. This store shares
 * NodeAuth's SQLite transaction, so approvals, recovery and audit commit together.
 * There is deliberately no 'zero devices means trust the next password login' path.
 */
export class DeviceEnrollmentStore {
  constructor(private readonly db: DatabaseSync, private readonly issuer: string,
    private readonly validate: (value: unknown) => DeviceGrant,
    private readonly record: (kind: string, principal: string, actor: string, subject: string) => void,
    private readonly quarantined: (principal: string, jkt: string) => boolean = () => false) {
    const existed = !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_trusted_devices'").get();
    db.exec(`
      CREATE TABLE IF NOT EXISTS auth_trusted_devices (
        principal_id TEXT NOT NULL REFERENCES owner(principal_id), jkt TEXT NOT NULL,
        device_name TEXT NOT NULL, grant_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('approved','blocked')),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL,
        PRIMARY KEY(principal_id,jkt)
      );
      CREATE TABLE IF NOT EXISTS auth_device_requests (
        id TEXT PRIMARY KEY, principal_id TEXT NOT NULL REFERENCES owner(principal_id), jkt TEXT NOT NULL,
        device_name TEXT NOT NULL, request_json TEXT NOT NULL, csrf_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','approved','denied','cancelled','issued')),
        created_at INTEGER NOT NULL, expires INTEGER NOT NULL, version INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS auth_device_requests_owner ON auth_device_requests(principal_id,created_at);
      CREATE TABLE IF NOT EXISTS auth_recovery_codes (
        hash TEXT PRIMARY KEY, principal_id TEXT NOT NULL REFERENCES owner(principal_id),
        created_at INTEGER NOT NULL, used_at INTEGER
      );
    `);
    if (!existed) this.migrateEstablishedSessions();
  }
  private transaction<T>(run: () => T): T {
    if (this.db.isTransaction) return run();
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = run(); this.db.exec("COMMIT"); return result; }
    catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  private migrateEstablishedSessions(): void {
    // Existing bound approvals are imported once, using the intersection rather
    // than the union of rights for a key. Expired/revoked sessions never create trust.
    const now = Date.now();
    const rows = this.db.prepare("SELECT principal_id,dpop_jkt,device_name,grant_json FROM auth_sessions WHERE dpop_jkt IS NOT NULL AND revoked_at IS NULL AND idle_expires>? AND absolute_expires>? ORDER BY created_at").all(now, now);
    const groups = new Map<string, { principal: string; jkt: string; name: string; grant: DeviceGrant }>();
    for (const row of rows) {
      const principal = String(row.principal_id), jkt = String(row.dpop_jkt), key = `${principal}:${jkt}`;
      const grant = this.validate(JSON.parse(String(row.grant_json))), previous = groups.get(key);
      groups.set(key, { principal, jkt, name: String(row.device_name), grant: previous ? intersectGrants(previous.grant, grant) : grant });
    }
    for (const group of groups.values()) {
      this.put(group.principal, group.jkt, group.name, group.grant);
      this.record("device.migrated", group.principal, "migration", group.jkt);
    }
  }
  device(principal: string, jkt: string): TrustedDevice | undefined {
    return this.db.prepare("SELECT * FROM auth_trusted_devices WHERE principal_id=? AND jkt=?").get(principal, jkt) as TrustedDevice | undefined;
  }
  trusted(principal: string, jkt: string): TrustedDevice {
    const row = this.device(principal, jkt);
    if (!row || row.status !== "approved") throw rejected();
    return row;
  }
  private put(principal: string, jkt: string, name: string, raw: DeviceGrant): void {
    const grant = this.validate(raw), now = Date.now();
    this.db.prepare(`INSERT INTO auth_trusted_devices(principal_id,jkt,device_name,grant_json,status,created_at,updated_at,version)
      VALUES (?,?,?,?,'approved',?,?,1) ON CONFLICT(principal_id,jkt) DO UPDATE SET
      device_name=excluded.device_name,grant_json=excluded.grant_json,status='approved',updated_at=excluded.updated_at,version=version+1`)
      .run(principal, jkt, name, JSON.stringify(grant), now, now);
  }
  list(principal: string) {
    this.prune();
    return {
      devices: (this.db.prepare("SELECT * FROM auth_trusted_devices WHERE principal_id=? ORDER BY updated_at DESC LIMIT 200").all(principal) as TrustedDevice[])
        .map(({ principal_id: _, grant_json, ...row }) => ({ ...row, grant: this.validate(JSON.parse(grant_json)) })),
      requests: (this.db.prepare("SELECT id,jkt,device_name,status,created_at,expires,version FROM auth_device_requests WHERE principal_id=? AND status='pending' AND expires>? ORDER BY created_at DESC LIMIT 20").all(principal, Date.now())),
      recoveryCodesRemaining: Number((this.db.prepare("SELECT count(*) AS n FROM auth_recovery_codes WHERE principal_id=? AND used_at IS NULL").get(principal) as { n: number }).n),
    };
  }
  request(principal: string, request: EnrollmentRequest, csrfHash: string): PendingDevice {
    return this.transaction(() => {
      this.prune();
      if (this.device(principal, request.dpopJkt)?.status === "blocked") throw rejected();
      const pending = Number((this.db.prepare("SELECT count(*) AS n FROM auth_device_requests WHERE principal_id=? AND status='pending' AND expires>?").get(principal, Date.now()) as { n: number }).n);
      if (pending >= 10) throw new EnrollmentError(429, "too_many_device_requests", "Too many pending device requests. Ask the administrator to review them.");
      const id = randomUUID(), now = Date.now();
      this.db.prepare("INSERT INTO auth_device_requests VALUES (?,?,?,?,?,?,'pending',?,?,1)")
        .run(id, principal, request.dpopJkt, request.deviceName, JSON.stringify(request), csrfHash, now, now + 5 * MINUTE);
      this.record("device.requested", principal, "pending", id);
      return this.pending(id);
    });
  }
  pending(id: string): PendingDevice {
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id)) throw new EnrollmentError(400, "invalid_request", "Invalid device request.");
    const row = this.db.prepare("SELECT * FROM auth_device_requests WHERE id=?").get(id) as PendingDevice | undefined;
    if (!row || row.expires <= Date.now()) throw new EnrollmentError(410, "device_request_expired", "Device request expired. Start sign-in again.");
    return row;
  }
  decide(principal: string, actor: string, id: string, version: number, jkt: string, grant?: DeviceGrant): void {
    this.transaction(() => {
      const row = this.pending(id);
      if (row.principal_id !== principal) throw new EnrollmentError(404, "not_found", "Unknown device request.");
      if (row.status !== "pending" || row.version !== version || row.jkt !== jkt) throw new EnrollmentError(409, "stale_device_request", "The device request changed. Refresh before deciding.");
      if (grant) {
        if (this.device(principal, jkt)) throw new EnrollmentError(409, "device_already_decided", "This device key was already approved or blocked. Start a new sign-in.");
        const count = Number((this.db.prepare("SELECT count(*) AS n FROM auth_trusted_devices WHERE principal_id=?").get(principal) as { n: number }).n);
        if (count >= 200) throw new EnrollmentError(409, "device_limit", "The Node device limit has been reached.");
        this.put(principal, jkt, row.device_name, grant);
      }
      this.db.prepare("UPDATE auth_device_requests SET status=?,version=version+1 WHERE id=?").run(grant ? "approved" : "denied", id);
      this.record(grant ? "device.approved" : "device.denied", principal, actor, id);
    });
  }
  finish(id: string, status: "issued" | "cancelled"): void {
    const row = this.pending(id);
    if (status === "issued" && row.status !== "approved" || status === "cancelled" && !["pending", "approved"].includes(row.status)) {
      throw new EnrollmentError(409, "stale_device_request", "Device request is no longer available.");
    }
    this.db.prepare("UPDATE auth_device_requests SET status=?,version=version+1 WHERE id=?").run(status, id);
  }
  updateGrant(principal: string, jkt: string, grant: DeviceGrant): string[] {
    const row = this.trusted(principal, jkt);
    this.protectLastAdmin(principal, row, grant.role !== "admin");
    this.put(principal, jkt, row.device_name, grant);
    this.db.prepare("UPDATE auth_sessions SET grant_json=? WHERE principal_id=? AND dpop_jkt=? AND revoked_at IS NULL").run(JSON.stringify(grant), principal, jkt);
    this.db.prepare("DELETE FROM auth_codes WHERE principal_id=? AND dpop_jkt=?").run(principal, jkt);
    return this.sessionIds(principal, jkt);
  }
  block(principal: string, actor: string, jkt: string, version: number, beforeBlock?: () => void): string[] {
    return this.transaction(() => {
      const row = this.trusted(principal, jkt);
      if (row.version !== version) throw new EnrollmentError(409, "stale_device", "Device permissions changed. Refresh before blocking it.");
      this.protectLastAdmin(principal, row, true);
      beforeBlock?.();
      this.db.prepare("UPDATE auth_trusted_devices SET status='blocked',updated_at=?,version=version+1 WHERE principal_id=? AND jkt=?").run(Date.now(), principal, jkt);
      const ids = this.sessionIds(principal, jkt);
      this.db.prepare("UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE principal_id=? AND dpop_jkt=?").run(Date.now(), principal, jkt);
      this.db.prepare("DELETE FROM auth_codes WHERE principal_id=? AND dpop_jkt=?").run(principal, jkt);
      this.db.prepare("UPDATE auth_device_requests SET status='denied',version=version+1 WHERE principal_id=? AND jkt=? AND status IN ('pending','approved')").run(principal, jkt);
      this.record("device.blocked", principal, actor, jkt);
      return ids;
    });
  }
  private protectLastAdmin(principal: string, row: TrustedDevice, removing: boolean): void {
    if (!removing || this.validate(JSON.parse(row.grant_json)).role !== "admin") return;
    const others = this.db.prepare("SELECT jkt,grant_json FROM auth_trusted_devices WHERE principal_id=? AND jkt!=? AND status='approved'").all(principal, row.jkt);
    if (!others.some(other => !this.quarantined(principal, String(other.jkt)) && this.validate(JSON.parse(String(other.grant_json))).role === "admin")) {
      throw new EnrollmentError(409, "last_trusted_administrator", "Approve another administrator device before removing the last one. Recovery is a separate explicit operation.");
    }
  }
  private sessionIds(principal: string, jkt?: string): string[] {
    const rows = jkt === undefined
      ? this.db.prepare("SELECT id FROM auth_sessions WHERE principal_id=? AND revoked_at IS NULL").all(principal)
      : this.db.prepare("SELECT id FROM auth_sessions WHERE principal_id=? AND dpop_jkt=? AND revoked_at IS NULL").all(principal, jkt);
    return rows.map(row => String(row.id));
  }
  private recoveryHash(principal: string, code: string): string {
    return createHash("sha256").update(JSON.stringify(["beebot-recovery-v1", this.issuer, principal, code])).digest("base64url");
  }
  rotateRecoveryCodes(principal: string, actor: string, persist?: (codes: string[]) => void): string[] {
    return this.transaction(() => {
      const codes = Array.from({ length: 8 }, () => randomBytes(32).toString("base64url"));
      this.db.prepare("DELETE FROM auth_recovery_codes WHERE principal_id=?").run(principal);
      for (const code of codes) this.db.prepare("INSERT INTO auth_recovery_codes VALUES (?,?,?,NULL)").run(this.recoveryHash(principal, code), principal, Date.now());
      persist?.(codes); // CLI fsync failure rolls back rather than replacing the usable set.
      this.record("recovery.codes_rotated", principal, actor, principal);
      return codes;
    });
  }
  recover(principal: string, request: EnrollmentRequest, code: string): string[] {
    return this.transaction(() => {
      if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw rejected();
      const result = this.db.prepare("UPDATE auth_recovery_codes SET used_at=? WHERE hash=? AND principal_id=? AND used_at IS NULL").run(Date.now(), this.recoveryHash(principal, code), principal);
      if (Number(result.changes) !== 1) throw rejected();
      const ids = this.sessionIds(principal);
      this.db.prepare("UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE principal_id=?").run(Date.now(), principal);
      this.db.prepare("DELETE FROM auth_codes WHERE principal_id=?").run(principal);
      this.db.prepare("UPDATE auth_trusted_devices SET status='blocked',updated_at=?,version=version+1 WHERE principal_id=?").run(Date.now(), principal);
      this.db.prepare("UPDATE auth_device_requests SET status='cancelled',version=version+1 WHERE principal_id=? AND status IN ('pending','approved')").run(principal);
      this.put(principal, request.dpopJkt, request.deviceName, { role: "admin", botIds: "*" });
      this.record("recovery.device_replaced", principal, "recovery", request.dpopJkt);
      return ids;
    });
  }
  private prune(): void {
    this.db.prepare("DELETE FROM auth_device_requests WHERE expires<=?").run(Date.now());
  }
}

export function intersectGrants(left: DeviceGrant, right: DeviceGrant): DeviceGrant {
  const rank = { viewer: 0, operator: 1, admin: 2 } as const;
  const role = rank[left.role] <= rank[right.role] ? left.role : right.role;
  const botIds = left.botIds === "*" ? right.botIds : right.botIds === "*" ? left.botIds : left.botIds.filter(id => right.botIds.includes(id));
  return { role, botIds: botIds === "*" ? "*" : [...botIds] };
}
