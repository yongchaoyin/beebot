import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { newTenantKey, TenantRecordCodec, tenantId, type TenantKeyWrapper, type WrappedTenantKey } from "./tenant-crypto.js";

export type MemberRole = "owner" | "editor" | "viewer";
export interface TenantIdentity {
  issuer: string; subject: string;
  deviceRole: "admin" | "operator" | "viewer";
  botIds: "*" | readonly string[];
}
/** Trusted middleware must validate the live session/DPoP and return its current
 * grant on EVERY call. Never implement this by copying request headers/body. */
export type ReadTenantIdentity = () => TenantIdentity;
export interface TenantScope { readonly tenantId: string }
interface ScopeState { reader: ReadTenantIdentity; principal: string; version: number; tenant: string }
interface TenantRow { id: string; status: string; version: number; key_json: string; profile: string }
export class TenantAccessError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const unavailable = () => new TenantAccessError(404, "workspace_unavailable", "Workspace is unavailable.");
const denied = () => new TenantAccessError(403, "workspace_access_denied", "Workspace access is not permitted.");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function privateDirectory(dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const s = lstatSync(dir);
  if (!s.isDirectory() || s.isSymbolicLink() || process.platform !== "win32" &&
      (s.mode & 0o077 || s.uid !== process.getuid?.())) throw new Error("Workspace data directory must be private and owned by the service account.");
  return realpathSync(dir);
}

/** Trusted provisioning/membership directory, NOT a new password or token
 * authority. No HTTP registration route or renderer bridge is exposed here. */
export class TenantDirectory {
  #db: DatabaseSync;
  #scopes = new WeakMap<TenantScope, ScopeState>();
  #closed = false;
  #listeners = new Set<(id: string) => void>();
  readonly root: string;
  readonly #issuers: Set<string>;
  constructor(root: string, issuers: readonly string[]) {
    if (!issuers.length || issuers.length > 64) throw new Error("Configure trusted identity issuers.");
    this.#issuers = new Set(issuers.map(issuer => {
      const u = new URL(issuer);
      if (u.origin !== issuer || u.username || u.password ||
          !(u.protocol === "https:" || u.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(u.hostname))) throw new Error("Invalid identity issuer.");
      return issuer;
    }));
    this.root = privateDirectory(root);
    const file = path.join(this.root, "tenants.sqlite");
    if (existsSync(file) && (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())) throw new Error("Invalid directory database.");
    const fd = openSync(file, constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
    closeSync(fd); chmodSync(file, 0o600);
    this.#db = new DatabaseSync(file);
    try {
      const version = Number(this.#db.prepare("PRAGMA user_version").get()!.user_version);
      if (version > 1) throw new Error("Newer tenant directory format required.");
      this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('provisioning','active','suspended')),
          version INTEGER NOT NULL, key_json TEXT NOT NULL, profile TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS memberships(tenant TEXT NOT NULL REFERENCES tenants(id), principal TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')), version INTEGER NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)),
          PRIMARY KEY(tenant,principal));
        CREATE TABLE IF NOT EXISTS provisions(principal TEXT NOT NULL, request TEXT NOT NULL, digest TEXT NOT NULL,
          tenant TEXT NOT NULL REFERENCES tenants(id), PRIMARY KEY(principal,request));
        PRAGMA user_version=1;`);
      for (const suffix of ["-wal", "-shm"]) if (existsSync(file + suffix)) chmodSync(file + suffix, 0o600);
    } catch (error) { this.#db.close(); throw error; }
  }
  private principal(identity: TenantIdentity): string {
    if (this.#closed || !identity || !this.#issuers.has(identity.issuer) || typeof identity.subject !== "string" ||
        !identity.subject || identity.subject.length > 256 || /[\x00-\x1f\x7f]/.test(identity.subject) ||
        !["admin", "operator", "viewer"].includes(identity.deviceRole) ||
        !(identity.botIds === "*" || Array.isArray(identity.botIds) && identity.botIds.length <= 500 && identity.botIds.every(id => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)))) throw denied();
    return hash(JSON.stringify([identity.issuer, identity.subject]));
  }
  private read(reader: ReadTenantIdentity): { identity: TenantIdentity; principal: string } {
    try { const identity = reader(); return { identity, principal: this.principal(identity) }; }
    catch { throw denied(); }
  }
  private tx<T>(fn: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.#db.exec("COMMIT"); return result; }
    catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }
  private row(id: string): TenantRow {
    try { tenantId(id); } catch { throw unavailable(); }
    if (this.#closed) throw unavailable();
    const row = this.#db.prepare("SELECT * FROM tenants WHERE id=?").get(id) as unknown as TenantRow | undefined;
    if (!row || this.#closed) throw unavailable();
    return row;
  }
  onChange(listener: (id: string) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  private notify(id: string): void { for (const listener of this.#listeners) { try { listener(id); } catch { /* Durable change already applied. */ } } }

  /** Administrative provisioning seam. The platform decides who may provision;
   * this is deliberately NOT wired to today's single-owner public Node API. */
  async provision(reader: ReadTenantIdentity, request: string, name: string, wrapper: TenantKeyWrapper, signal?: AbortSignal): Promise<string> {
    const { identity, principal } = this.read(reader);
    if (identity.deviceRole !== "admin" || identity.botIds !== "*") throw denied();
    if (!/^[\w.:-]{8,128}$/.test(request) || !name.trim() || name.length > 100) throw new Error("Invalid provisioning request.");
    const operation = JSON.stringify([name, wrapper.id]);
    const existing = this.#db.prepare("SELECT tenant,digest FROM provisions WHERE principal=? AND request=?").get(principal, request);
    if (existing) {
      const oldCodec = await TenantRecordCodec.open(this.protectedKey(String(existing.tenant)), wrapper, signal);
      try {
        const current = this.read(reader);
        if (current.principal !== principal || current.identity.deviceRole !== "admin" || current.identity.botIds !== "*") throw denied();
        if (existing.digest !== oldCodec.fingerprint(operation)) throw new TenantAccessError(409, "provision_conflict", "This request was used for different workspace options.");
        return String(existing.tenant);
      } finally { oldCodec.close(); }
    }
    const id = randomUUID(), key = await newTenantKey(id, wrapper, signal);
    const codec = await TenantRecordCodec.open(key, wrapper, signal);
    try {
      const current = this.read(reader);
      if (current.principal !== principal || current.identity.deviceRole !== "admin" || current.identity.botIds !== "*") throw denied();
      const profile = codec.encode("tenant-profile", id, { name }), digest = codec.fingerprint(operation);
      const result = this.tx(() => {
        const prior = this.#db.prepare("SELECT tenant,digest FROM provisions WHERE principal=? AND request=?").get(principal, request);
        if (prior) return null; // Concurrent provision won; validate using its key outside the transaction.
        this.#db.prepare("INSERT INTO tenants VALUES(?, 'provisioning', 1, ?, ?)").run(id, JSON.stringify(key), profile);
        this.#db.prepare("INSERT INTO memberships VALUES(?,?,'owner',1,1)").run(id, principal);
        this.#db.prepare("INSERT INTO provisions VALUES(?,?,?,?)").run(principal, request, digest, id);
        return id;
      });
      if (result !== null) return result;
    } finally { codec.close(); }
    return this.provision(reader, request, name, wrapper, signal);
  }
  /** Called only after the protected business database opens successfully. */
  activateProvisioned(reader: ReadTenantIdentity, id: string, keyId: string): void {
    const { identity, principal } = this.read(reader);
    const member = this.#db.prepare("SELECT role,active FROM memberships WHERE tenant=? AND principal=?").get(id, principal);
    if (!member || member.role !== "owner" || member.active !== 1 || identity.deviceRole !== "admin" || identity.botIds !== "*") throw denied();
    const row = this.row(id), key = JSON.parse(row.key_json) as WrappedTenantKey;
    if (key.keyId !== keyId || row.status !== "provisioning") throw unavailable();
    this.#db.prepare("UPDATE tenants SET status='active',version=version+1 WHERE id=? AND status='provisioning'").run(id);
    this.notify(id);
  }
  /** Operator lifecycle control, intentionally not a tenant-owned HTTP action.
   * Suspension blocks future reads/admission; it does not claim external actions
   * have been rolled back or that a running execution has already stopped. */
  setStatus(id: string, expectedVersion: number, status: "active" | "suspended"): void {
    if (!["active", "suspended"].includes(status)) throw new Error("Invalid tenant status.");
    const row = this.row(id);
    if (row.status === "provisioning" || row.version !== expectedVersion) throw new TenantAccessError(409, "stale_workspace", "Refresh the workspace lifecycle record.");
    const changed = this.#db.prepare("UPDATE tenants SET status=?,version=version+1 WHERE id=? AND version=?").run(status, id, expectedVersion);
    if (Number(changed.changes) !== 1) throw new TenantAccessError(409, "stale_workspace", "Refresh the workspace lifecycle record.");
    this.notify(id);
  }
  /** Minimal operator metadata, no decrypted profile or business contents. */
  inspect(id: string): { id: string; status: string; version: number } {
    const row = this.row(id); return { id: row.id, status: row.status, version: row.version };
  }
  /** Internal key locator; callers must not publish this through client APIs. */
  protectedKey(id: string): WrappedTenantKey {
    const row = this.row(id);
    if (row.status === "suspended") throw unavailable();
    const key = JSON.parse(row.key_json) as WrappedTenantKey;
    if (key.tenantId !== id) throw unavailable();
    return key;
  }
  scope(reader: ReadTenantIdentity, id: string): TenantScope {
    const { principal } = this.read(reader), row = this.row(id);
    const member = this.#db.prepare("SELECT version FROM memberships WHERE tenant=? AND principal=? AND active=1").get(id, principal);
    if (row.status !== "active" || !member) throw unavailable();
    const scope = Object.freeze({ tenantId: id });
    this.#scopes.set(scope, { reader, principal, version: Number(member.version), tenant: id }); return scope;
  }
  assert(scope: TenantScope, action: "read" | "write" | "admin", botId?: string): { tenantId: string; principal: string; botIds: "*" | readonly string[] } {
    const state = this.#scopes.get(scope);
    if (!state || this.#closed) throw denied();
    const { identity, principal } = this.read(state.reader), row = this.row(state.tenant);
    const m = this.#db.prepare("SELECT role,version FROM memberships WHERE tenant=? AND principal=? AND active=1").get(state.tenant, principal);
    if (principal !== state.principal || row.status !== "active" || !m || Number(m.version) !== state.version) throw denied();
    if (action === "write" && (m.role === "viewer" || identity.deviceRole === "viewer") ||
        action === "admin" && (m.role !== "owner" || identity.deviceRole !== "admin" || identity.botIds !== "*") ||
        botId !== undefined && identity.botIds !== "*" && !identity.botIds.includes(botId)) throw denied();
    return { tenantId: state.tenant, principal, botIds: identity.botIds };
  }
  setMember(scope: TenantScope, member: TenantIdentity, role: MemberRole | null, expectedVersion: number): number {
    const { tenantId: id } = this.assert(scope, "admin"), principal = this.principal(member);
    if (role !== null && !["owner", "editor", "viewer"].includes(role)) throw new Error("Invalid workspace role.");
    const version = this.tx(() => {
      this.assert(scope, "admin");
      const old = this.#db.prepare("SELECT role,version,active FROM memberships WHERE tenant=? AND principal=?").get(id, principal);
      if (Number(old?.version ?? 0) !== expectedVersion) throw new TenantAccessError(409, "stale_membership", "Refresh the membership version.");
      const owners = Number(this.#db.prepare("SELECT count(*) AS n FROM memberships WHERE tenant=? AND role='owner' AND active=1").get(id)!.n);
      if (old?.role === "owner" && old.active === 1 && role !== "owner" && owners <= 1) throw denied();
      const next = expectedVersion + 1;
      this.#db.prepare("INSERT INTO memberships VALUES(?,?,?,?,?) ON CONFLICT(tenant,principal) DO UPDATE SET role=excluded.role,version=excluded.version,active=excluded.active")
        .run(id, principal, role ?? "viewer", next, role === null ? 0 : 1);
      return next;
    });
    this.notify(id); return version;
  }
  close(): void { if (this.#closed) return; this.#closed = true; this.#scopes = new WeakMap(); this.#listeners.clear(); this.#db.close(); }
}
