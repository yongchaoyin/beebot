import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import type { RecordCodec } from "../node/record-codec.js";

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const MAX_RECORD_BYTES = 8 * 1024 * 1024;
export class TenantStorageError extends Error {
  readonly status = 503;
  readonly code = "tenant_storage_unavailable";
  constructor() { super("Protected workspace storage is unavailable. No plaintext fallback is allowed."); }
}
export function tenantId(value: string): string {
  if (!UUID.test(value)) throw new Error("Invalid internal tenant identifier.");
  return value;
}
export interface KeyContext { tenantId: string; keyId: string; purpose: "beebot-control-records-v1" }
export interface WrappedTenantKey extends KeyContext { wrapperId: string; wrapped: string }
export interface TenantKeyWrapper {
  readonly id: string;
  wrap(key: Uint8Array, context: KeyContext, signal?: AbortSignal): Promise<Uint8Array>;
  unwrap(wrapped: Uint8Array, context: KeyContext, signal?: AbortSignal): Promise<Uint8Array>;
}
/** A nonresponsive key service must not pin a request or shutdown forever.
 * Providers should honor abort. If they do not, late returned material is erased
 * rather than exposed to a caller whose authorization/operation has ended. */
async function keyCall(work: (signal: AbortSignal) => Promise<Uint8Array>, signal?: AbortSignal): Promise<Uint8Array> {
  const deadline = AbortSignal.timeout(10_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => { if (!settled) { settled = true; reject(new TenantStorageError()); } };
    combined.addEventListener("abort", abort, { once: true });
    if (combined.aborted) { combined.removeEventListener("abort", abort); abort(); return; }
    void Promise.resolve().then(() => work(combined)).then(value => {
      combined.removeEventListener("abort", abort);
      if (!(value instanceof Uint8Array)) {
        if (!settled) { settled = true; reject(new TenantStorageError()); }
        return;
      }
      if (settled) { value.fill(0); return; }
      settled = true; resolve(value);
    }, () => {
      combined.removeEventListener("abort", abort);
      if (!settled) { settled = true; reject(new TenantStorageError()); }
    });
  });
}
const aad = (value: unknown) => Buffer.from(JSON.stringify(value));
function from64(value: unknown, max: number, exact?: number): Buffer {
  if (typeof value !== "string" || value.length > Math.ceil(max * 4 / 3) ||
      !/^[A-Za-z0-9_-]*$/.test(value)) throw new TenantStorageError();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value || bytes.length > max || exact !== undefined && bytes.length !== exact) throw new TenantStorageError();
  return bytes;
}
function seal(key: Uint8Array, value: Uint8Array, context: Buffer): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(context);
  return Buffer.concat([nonce, cipher.update(value), cipher.final(), cipher.getAuthTag()]);
}
function unseal(key: Uint8Array, value: Buffer, context: Buffer): Buffer {
  if (value.length < 28) throw new TenantStorageError();
  const cipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12), { authTagLength: 16 });
  cipher.setAAD(context); cipher.setAuthTag(value.subarray(-16));
  const decoded = cipher.update(value.subarray(12, -16));
  try { return Buffer.concat([decoded, cipher.final()]); }
  finally { decoded.fill(0); }
}
function contextOf(record: WrappedTenantKey): KeyContext {
  tenantId(record.tenantId); tenantId(record.keyId);
  if (record.purpose !== "beebot-control-records-v1") throw new TenantStorageError();
  return { tenantId: record.tenantId, keyId: record.keyId, purpose: record.purpose };
}

/** Reference wrapping adapter for controlled deployments/tests. The KEK is
 * injected out of band, never persisted here. This is NOT an HSM, remote KMS,
 * execution sandbox, or protection from a compromised control-plane operator. */
export class LocalTenantKeyWrapper implements TenantKeyWrapper {
  #key: Buffer;
  #closed = false;
  constructor(readonly id: string, key: Uint8Array) {
    if (!/^[A-Za-z0-9._:-]{1,120}$/.test(id) || key.byteLength !== 32) throw new TenantStorageError();
    this.#key = Buffer.from(key);
  }
  async wrap(key: Uint8Array, context: KeyContext): Promise<Uint8Array> {
    if (this.#closed || key.byteLength !== 32) throw new TenantStorageError();
    return seal(this.#key, key, aad(["beebot-key-wrap-v1", this.id, context]));
  }
  async unwrap(wrapped: Uint8Array, context: KeyContext): Promise<Uint8Array> {
    if (this.#closed || wrapped.byteLength > 16384) throw new TenantStorageError();
    try { return unseal(this.#key, Buffer.from(wrapped), aad(["beebot-key-wrap-v1", this.id, context])); }
    catch { throw new TenantStorageError(); }
  }
  close(): void { this.#closed = true; this.#key.fill(0); }
}

export async function newTenantKey(id: string, wrapper: TenantKeyWrapper, signal?: AbortSignal): Promise<WrappedTenantKey> {
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(wrapper.id)) throw new TenantStorageError();
  const context: KeyContext = { tenantId: tenantId(id), keyId: randomUUID(), purpose: "beebot-control-records-v1" };
  const key = randomBytes(32);
  try {
    const wrapped = Buffer.from(await keyCall(abort => wrapper.wrap(key, context, abort), signal));
    if (!wrapped.length || wrapped.length > 16384) throw new TenantStorageError();
    return { ...context, wrapperId: wrapper.id, wrapped: wrapped.toString("base64url") };
  } catch { throw new TenantStorageError(); }
  finally { key.fill(0); }
}

/** Synchronous record codec after an asynchronous key-service unwrap. One active
 * data key per tenant database; rotation/migration must be explicit, never a
 * replacement key silently generated after unwrap failure. */
export class TenantRecordCodec implements RecordCodec {
  #key: Buffer;
  #digestKey: Buffer;
  #closed = false;
  readonly binding: string;
  private constructor(readonly tenant: string, readonly keyId: string, key: Uint8Array) {
    this.#key = Buffer.from(key);
    this.#digestKey = Buffer.from(hkdfSync("sha256", key, tenant, "beebot-command-digest-v1", 32));
    this.binding = JSON.stringify({ format: "tenant-aes-256-gcm-v1", tenantId: tenant, keyId });
  }
  static async open(record: WrappedTenantKey, wrapper: TenantKeyWrapper, signal?: AbortSignal): Promise<TenantRecordCodec> {
    let key: Uint8Array | undefined;
    try {
      const context = contextOf(record);
      if (record.wrapperId !== wrapper.id) throw new TenantStorageError();
      key = await keyCall(abort => wrapper.unwrap(from64(record.wrapped, 16384), context, abort), signal);
      if (key.byteLength !== 32) throw new TenantStorageError();
      return new TenantRecordCodec(context.tenantId, context.keyId, key);
    } catch { throw new TenantStorageError(); }
    finally { key?.fill(0); }
  }
  private context(table: string, id: string): Buffer {
    if (this.#closed || !table || table.length > 80 || !id || id.length > 1024) throw new TenantStorageError();
    return aad(["beebot-record-v1", this.binding, table, id]);
  }
  encode(table: string, id: string, value: unknown): string {
    const context = this.context(table, id);
    let plain: Buffer | undefined;
    try {
      plain = Buffer.from(JSON.stringify(value));
      if (plain.length > MAX_RECORD_BYTES) throw new TenantStorageError();
      return "bbt1." + seal(this.#key, plain, context).toString("base64url");
    } catch { throw new TenantStorageError(); }
    finally { plain?.fill(0); }
  }
  decode<T>(table: string, id: string, stored: string): T {
    const context = this.context(table, id);
    let plain: Buffer | undefined;
    try {
      if (!stored.startsWith("bbt1.")) throw new TenantStorageError();
      plain = unseal(this.#key, from64(stored.slice(5), MAX_RECORD_BYTES + 28), context);
      return JSON.parse(plain.toString("utf8")) as T;
    } catch { throw new TenantStorageError(); }
    finally { plain?.fill(0); }
  }
  fingerprint(value: string): string {
    if (this.#closed) throw new TenantStorageError();
    return createHmac("sha256", this.#digestKey).update(value).digest("hex");
  }
  close(): void { this.#closed = true; this.#key.fill(0); this.#digestKey.fill(0); }
}
