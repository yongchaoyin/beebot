import { createHash, createPublicKey, verify } from "node:crypto";

export type ReleaseCode = "INVALID_RELEASE" | "UNTRUSTED_RELEASE" | "EXPIRED_RELEASE" | "RELEASE_ROLLBACK";
export class ReleaseError extends Error {
  constructor(readonly code: ReleaseCode) { super(code); this.name = "ReleaseError"; }
}
export const RELEASE_CONTEXT = "BeeBot Node release manifest v1\n";
export type ReleasePolicy = Readonly<{
  keys: Readonly<Record<string, string>>; // Ed25519 SPKI PEM, shipped with the client. Never supplied by the renderer.
  minimumSequence: number;
  repositories: readonly string[];
}>;
export type NodeRelease = Readonly<{
  format: 1; product: "beebot-node"; channel: "stable"; version: string; sequence: number;
  issuedAt: number; expiresAt: number; installationApi: 1;
  securityProfile: "trusted-devices-dpop-v1";
  images: Readonly<Partial<Record<"linux/amd64" | "linux/arm64", string>>>;
  proxyImage: string; minimumDiskKiB: number;
}>;
export type VerifiedRelease = Readonly<{ manifest: NodeRelease; digest: string; publisher: string }>;
const invalid = (): never => { throw new ReleaseError("INVALID_RELEASE"); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: string[]) {
  if (Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) invalid();
}
function base64(value: unknown, maximum: number): Buffer {
  if (typeof value !== "string" || value.length > maximum * 2 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return invalid();
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > maximum || bytes.toString("base64") !== value) return invalid();
  return bytes;
}
function image(value: unknown, policy: ReleasePolicy): string {
  if (typeof value !== "string" || value.length > 400 || !/^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/.test(value)) return invalid();
  // Exact repository names, not prefix matches; no mutable tags, URL credentials or local image IDs.
  if (!policy.repositories.includes(value.split("@")[0]!)) throw new ReleaseError("UNTRUSTED_RELEASE");
  return value;
}

/** Authenticate exact payload bytes before interpretation. This is release provenance,
 * not proof that an image is safe, available, scanned or successfully deployed. */
export function verifyNodeRelease(text: string, policy: ReleasePolicy, now = Date.now()): VerifiedRelease {
  try {
    if (Buffer.byteLength(text) > 32768 || !Number.isSafeInteger(now) || now < 0) return invalid();
    const envelope = object(JSON.parse(text)); exact(envelope, ["keyId", "payload", "signature"]);
    if (typeof envelope.keyId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(envelope.keyId)) return invalid();
    if (!Object.hasOwn(policy.keys, envelope.keyId)) throw new ReleaseError("UNTRUSTED_RELEASE");
    const payload = base64(envelope.payload, 16384), signature = base64(envelope.signature, 64);
    if (signature.length !== 64) return invalid();
    const key = createPublicKey(policy.keys[envelope.keyId]!);
    if (key.asymmetricKeyType !== "ed25519" || !verify(null, Buffer.concat([Buffer.from(RELEASE_CONTEXT), payload]), key, signature)) throw new ReleaseError("UNTRUSTED_RELEASE");
    const source = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    const m = object(JSON.parse(source));
    exact(m, ["format", "product", "channel", "version", "sequence", "issuedAt", "expiresAt", "installationApi", "securityProfile", "images", "proxyImage", "minimumDiskKiB"]);
    if (m.format !== 1 || m.product !== "beebot-node" || m.channel !== "stable" || m.installationApi !== 1 || m.securityProfile !== "trusted-devices-dpop-v1" ||
        typeof m.version !== "string" || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(m.version) || !Number.isSafeInteger(m.sequence) || Number(m.sequence) < 1 ||
        !Number.isSafeInteger(m.issuedAt) || !Number.isSafeInteger(m.expiresAt) || Number(m.issuedAt) < 0 ||
        Number(m.issuedAt) > now || Number(m.expiresAt) <= Number(m.issuedAt) || Number(m.expiresAt) - Number(m.issuedAt) > 31 * 86400000 ||
        !Number.isSafeInteger(m.minimumDiskKiB) || Number(m.minimumDiskKiB) < 2 * 1048576 || Number(m.minimumDiskKiB) > 1024 * 1048576) return invalid();
    if (now >= Number(m.expiresAt)) throw new ReleaseError("EXPIRED_RELEASE");
    if (!Number.isSafeInteger(policy.minimumSequence) || policy.minimumSequence < 1) return invalid();
    if (Number(m.sequence) < policy.minimumSequence) throw new ReleaseError("RELEASE_ROLLBACK");
    const images = object(m.images), platforms = Object.keys(images);
    if (!platforms.length || platforms.some(p => p !== "linux/amd64" && p !== "linux/arm64")) return invalid();
    const checked: Partial<Record<"linux/amd64" | "linux/arm64", string>> = {};
    for (const platform of platforms) checked[platform as keyof typeof checked] = image(images[platform], policy);
    const manifest = Object.freeze({ ...m, images: Object.freeze(checked), proxyImage: image(m.proxyImage, policy) }) as NodeRelease;
    return Object.freeze({ manifest, publisher: envelope.keyId, digest: createHash("sha256").update(payload).digest("hex") });
  } catch (error) {
    if (error instanceof ReleaseError) throw error;
    return invalid(); // Never return raw parsing, key or network diagnostics.
  }
}
