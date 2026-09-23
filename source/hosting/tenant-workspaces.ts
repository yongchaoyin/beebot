import { botSchema } from "./workspace-validation.js";
import { createHash } from "node:crypto";
import path from "node:path";
import { ControlStore, type Bot } from "../node/control-store.js";
import type { Identity, NodeAuth } from "../node/auth.js";
import { TenantAccessError, TenantDirectory, privateDirectory, type ReadTenantIdentity, type TenantScope } from "./tenant-directory.js";
import { TenantRecordCodec, type TenantKeyWrapper } from "./tenant-crypto.js";

/** Adapter to the EXISTING live device grant. Call only after authenticate(req).
 * The configured issuer is from the server, never a client-supplied field.
 * This does not turn NodeAuth's single-owner account model into multi-user SSO. */
export function nodeTenantIdentity(auth: Pick<NodeAuth, "grant">, configuredIssuer: string, identity: Identity): ReadTenantIdentity {
  const captured = Object.freeze({ ...identity });
  return () => {
    const grant = auth.grant(captured);
    return { issuer: configuredIssuer, subject: captured.principalId, deviceRole: grant.role, botIds: grant.botIds };
  };
}
interface Cell { store: ControlStore; codec: TenantRecordCodec; expiresAt: number; expiry: ReturnType<typeof setTimeout> }
const refuse = () => new TenantAccessError(403, "workspace_access_denied", "Workspace access is not permitted.");
const requestKey = (principal: string, value: string): string => {
  if (!/^[\w.:-]{8,128}$/.test(value)) throw new TenantAccessError(400, "invalid_idempotency_key", "Use an 8–128 character command identifier.");
  return createHash("sha256").update(JSON.stringify([principal, value])).digest("hex");
};

/** Storage-only control-plane seam. Normal Node clients are not redirected here.
 * No Shell, provider key, task dispatch, attachment path or public registration
 * is exposed until an enforced tenant execution boundary and full auth routing
 * are integrated and independently tested. */
export class TenantWorkspaces {
  #cells = new Map<string, Cell>();
  #pending = new Map<string, Promise<Cell>>();
  #closed = false;
  #abort = new AbortController();
  #unwatch: () => void;
  readonly #root: string;
  constructor(
    private readonly directory: TenantDirectory,
    private readonly wrapper: TenantKeyWrapper,
    private readonly maxOpen = 32,
    private readonly maxBots = 100,
    private readonly keyLeaseMs = 60_000,
  ) {
    if (!Number.isInteger(maxOpen) || maxOpen < 1 || maxOpen > 1000 ||
        !Number.isInteger(maxBots) || maxBots < 1 || maxBots > 10000 ||
        !Number.isInteger(keyLeaseMs) || keyLeaseMs < 1 || keyLeaseMs > 60_000) throw new Error("Invalid workspace capacity.");
    this.#root = privateDirectory(path.join(directory.root, "workspaces"));
    this.#unwatch = directory.onChange(id => this.evict(id));
  }
  private evict(id: string): void {
    const cell = this.#cells.get(id);
    if (cell) { this.#cells.delete(id); clearTimeout(cell.expiry); try { cell.store.close(); } finally { cell.codec.close(); } }
  }
  private async open(id: string): Promise<Cell> {
    if (this.#closed) throw refuse();
    const cached = this.#cells.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached;
    if (cached) this.evict(id);
    const pending = this.#pending.get(id);
    if (pending) return pending;
    if (this.#cells.size + this.#pending.size >= this.maxOpen) {
      throw new TenantAccessError(503, "workspace_capacity", "Workspace storage capacity is full; retry after idle workspaces are closed.");
    }
    const work = (async () => {
      const key = this.directory.protectedKey(id);
      const codec = await TenantRecordCodec.open(key, this.wrapper, this.#abort.signal);
      try {
        if (this.#closed) throw refuse();
        const current = this.directory.protectedKey(id);
        if (current.keyId !== key.keyId || current.wrapped !== key.wrapped || current.wrapperId !== key.wrapperId) throw refuse();
        const dir = privateDirectory(path.join(this.#root, id));
        const store = new ControlStore(dir, codec);
        const expiresAt = Date.now() + this.keyLeaseMs;
        const expiry = setTimeout(() => {
          if (this.#cells.get(id)?.codec === codec) this.evict(id);
        }, this.keyLeaseMs);
        expiry.unref();
        const cell = { store, codec, expiresAt, expiry }; this.#cells.set(id, cell); return cell;
      } catch (error) { codec.close(); throw error; }
    })();
    this.#pending.set(id, work);
    try { return await work; }
    finally { if (this.#pending.get(id) === work) this.#pending.delete(id); }
  }
  async provision(reader: ReadTenantIdentity, command: string, name: string): Promise<string> {
    if (this.#closed) throw refuse();
    const id = await this.directory.provision(reader, command, name, this.wrapper, this.#abort.signal);
    const cell = await this.open(id);
    if (this.directory.inspect(id).status === "provisioning") this.directory.activateProvisioned(reader, id, cell.codec.keyId);
    this.directory.scope(reader, id); // Recheck the live session after asynchronous key acquisition.
    return id;
  }
  async createBot(scope: TenantScope, command: string, input: { name: string; description: string; avatarShape?: Bot["avatarShape"]; avatarColor?: Bot["avatarColor"] }): Promise<{ bot: Bot }> {
    let access = this.directory.assert(scope, "write");
    if (access.botIds !== "*") throw refuse();
    // Public routing must also apply its normal schema validation; never accept
    // ownerId/tenantId overrides or arbitrary extra keys at this boundary.
    const value = botSchema.parse(input);
    const cell = await this.open(access.tenantId);
    access = this.directory.assert(scope, "write");
    if (access.botIds !== "*") throw refuse();
    const key = requestKey(access.principal, command);
    // Capacity is enforced transactionally with the receipt in ControlStore.
    return cell.store.createBot(access.tenantId, key, value, this.maxBots);
  }
  async describe(scope: TenantScope): Promise<{ id: string; name: string; execution: "unavailable" }> {
    const access = this.directory.assert(scope, "read"), cell = await this.open(access.tenantId);
    this.directory.assert(scope, "read");
    const profile = cell.codec.decode<{ name: string }>("tenant-profile", access.tenantId, this.directory.profileEnvelope(scope));
    return { id: access.tenantId, name: profile.name, execution: "unavailable" };
  }
  async snapshot(scope: TenantScope): Promise<{ bots: Bot[]; cursor: number; execution: "unavailable" }> {
    let access = this.directory.assert(scope, "read");
    const cell = await this.open(access.tenantId);
    access = this.directory.assert(scope, "read");
    return { bots: cell.store.bots(access.tenantId).filter(bot => access.botIds === "*" || access.botIds.includes(bot.id)),
      cursor: cell.store.cursor, execution: "unavailable" };
  }
  async bot(scope: TenantScope, id: string): Promise<Bot> {
    let access = this.directory.assert(scope, "read", id);
    const cell = await this.open(access.tenantId);
    access = this.directory.assert(scope, "read", id);
    const bot = cell.store.bot(id);
    if (bot.ownerId !== access.tenantId) throw refuse();
    return bot;
  }
  /** Cursors and event contents are local to the cell. Device-scoped readers
   * receive only events for Bots they can read; no raw security audit is exposed. */
  async events(scope: TenantScope, after: number): Promise<{ cursor: number; events: unknown[] }> {
    if (!Number.isSafeInteger(after) || after < 0) throw new TenantAccessError(400, "invalid_cursor", "Use a valid event cursor.");
    let access = this.directory.assert(scope, "read");
    const cell = await this.open(access.tenantId);
    access = this.directory.assert(scope, "read");
    const batch = cell.store.events(after);
    const events = batch.filter(event => {
      if (!["bot.created", "goal.created", "goal.updated"].includes(event.type)) return false;
      const data = event.data as { bot?: Bot; goal?: { botId: string; ownerId: string } };
      const owner = data.bot?.ownerId ?? data.goal?.ownerId;
      const botId = data.bot?.id ?? data.goal?.botId;
      return owner === access.tenantId && botId !== undefined && (access.botIds === "*" || access.botIds.includes(botId));
    });
    return { cursor: batch.at(-1)?.seq ?? Math.min(after, cell.store.cursor), events };
  }
  async submitGoal(scope: TenantScope, botId: string): Promise<never> {
    this.directory.assert(scope, "write", botId); await this.bot(scope, botId);
    this.directory.assert(scope, "write", botId);
    throw new TenantAccessError(503, "tenant_execution_unavailable", "Hosted execution is not enabled. No task was accepted or dispatched.");
  }
  async release(scope: TenantScope): Promise<void> {
    const { tenantId: id } = this.directory.assert(scope, "read");
    await this.#pending.get(id);
    this.directory.assert(scope, "read"); this.evict(id);
  }
  async close(): Promise<void> {
    this.#closed = true; this.#abort.abort(); this.#unwatch();
    await Promise.allSettled([...this.#pending.values()]);
    for (const id of [...this.#cells.keys()]) this.evict(id);
  }
}
