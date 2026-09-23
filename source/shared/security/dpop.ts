/** BeeBot's ES256 profile of RFC 9449 and RFC 7638, using Node/OpenSSL.
 * No encryption algorithm or key-exchange protocol is implemented here.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify, type KeyObject } from "node:crypto";

export interface DpopPublicKey { kty: "EC"; crv: "P-256"; x: string; y: string }
export interface DpopSigningKey { readonly publicKey: DpopPublicKey; readonly thumbprint: string; readonly privateKey: KeyObject }
export class DpopError extends Error {
  constructor(readonly code: "invalid_dpop_proof" | "use_dpop_nonce", message: string) { super(message); this.name = "DpopError"; }
}
const fail = (): never => { throw new DpopError("invalid_dpop_proof", "Invalid or replayed device proof."); };
export function sha256url(value: string): string { return createHash("sha256").update(value).digest("base64url"); }
function decode(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return fail();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) return fail();
  return decoded;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function json(value: string): Record<string, unknown> {
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(decode(value));
  // JSON.parse validates grammar, but would silently accept duplicate member names.
  // Scan complete JSON string tokens (including escapes), never punctuation inside them.
  // This keeps the strict JOSE profile independent of bundler-specific parser exports.
  const parsed = JSON.parse(raw);
  const stack: (Set<string> | null)[] = [];
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|[{}\[\]]/g;
  for (let match; (match = tokens.exec(raw));) {
    const token = match[0];
    if (token === "{" || token === "[") {
      if (stack.length >= 8) return fail();
      stack.push(token === "{" ? new Set<string>() : null);
    } else if (token === "}" || token === "]") stack.pop();
    else if (/^\s*:/.test(raw.slice(tokens.lastIndex))) {
      const keys = stack.at(-1); if (!keys) return fail();
      const name: string = JSON.parse(token);
      if (keys.has(name)) return fail();
      keys.add(name);
    }
  }
  return object(parsed);
}
export function publicJwk(value: unknown): DpopPublicKey {
  const key = object(value);
  // A public EC key only; never accept private, remote, symmetric or certificate keys.
  if (Object.keys(key).some(k => !["kty", "crv", "x", "y"].includes(k)) || key.kty !== "EC" || key.crv !== "P-256" ||
      typeof key.x !== "string" || typeof key.y !== "string" || decode(key.x).length !== 32 || decode(key.y).length !== 32) return fail();
  const result: DpopPublicKey = { kty: "EC", crv: "P-256", x: key.x, y: key.y };
  createPublicKey({ key: result, format: "jwk" }); // also validates that this is an EC public key
  return result;
}
export function jwkThumbprint(value: unknown): string {
  const key = publicJwk(value);
  return sha256url(JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y }));
}
export function generateDpopKey(): DpopSigningKey {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return signingKey(privateKey);
}
function signingKey(privateKey: KeyObject): DpopSigningKey {
  if (privateKey.type !== "private" || privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") return fail();
  const publicKey = publicJwk(createPublicKey(privateKey).export({ format: "jwk" }));
  return { privateKey, publicKey, thumbprint: jwkThumbprint(publicKey) };
}
export function importDpopKey(pem: string): DpopSigningKey {
  if (typeof pem !== "string" || pem.length > 4096 || !pem.startsWith("-----BEGIN PRIVATE KEY-----")) return fail();
  return signingKey(createPrivateKey(pem));
}
export function exportDpopKey(key: DpopSigningKey): string { return key.privateKey.export({ format: "pem", type: "pkcs8" }).toString(); }
export function dpopTarget(address: string): string {
  const url = new URL(address);
  if (url.username || url.password || !["https:", "http:"].includes(url.protocol)) return fail();
  url.search = ""; url.hash = "";
  return url.href;
}
export function createDpopProof(key: DpopSigningKey, method: string, uri: string, options: { nonce?: string; accessToken?: string; now?: number } = {}): string {
  const header = Buffer.from(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk: key.publicKey })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ jti: randomUUID(), htm: method, htu: dpopTarget(uri), iat: Math.floor((options.now ?? Date.now()) / 1000),
    ...(options.accessToken === undefined ? {} : { ath: sha256url(options.accessToken) }), ...(options.nonce === undefined ? {} : { nonce: options.nonce }) })).toString("base64url");
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), { key: key.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${header}.${payload}.${signature}`;
}
export function verifyDpopProof(proof: string | undefined, options: { method: string; uri: string; thumbprint?: string; accessToken?: string; nonces: readonly string[]; now?: number }): { thumbprint: string; jti: string; expiresAt: number } {
  try {
    if (typeof proof !== "string" || proof.length > 4096) return fail();
    const parts = proof.split("."); if (parts.length !== 3) return fail();
    const header = json(parts[0]!), payload = json(parts[1]!), signature = decode(parts[2]!);
    if (header.typ !== "dpop+jwt" || header.alg !== "ES256" || Object.keys(header).some(k => !["typ", "alg", "jwk"].includes(k)) || signature.length !== 64) return fail();
    const key = publicJwk(header.jwk), thumbprint = jwkThumbprint(key);
    if (options.thumbprint !== undefined && thumbprint !== options.thumbprint) return fail();
    if (!verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key: createPublicKey({ key, format: "jwk" }), dsaEncoding: "ieee-p1363" }, signature)) return fail();
    const now = Math.floor((options.now ?? Date.now()) / 1000);
    if (Object.keys(payload).some(k => !["jti", "htm", "htu", "iat", "ath", "nonce"].includes(k)) ||
        typeof payload.jti !== "string" || !/^[A-Za-z0-9._~-]{16,128}$/.test(payload.jti) ||
        !Number.isSafeInteger(payload.iat) || Number(payload.iat) < now - 120 || Number(payload.iat) > now + 30 ||
        payload.htm !== options.method || typeof payload.htu !== "string" || payload.htu !== dpopTarget(options.uri)) return fail();
    if (options.accessToken === undefined ? payload.ath !== undefined : payload.ath !== sha256url(options.accessToken)) return fail();
    // Nonces are unpredictable server challenges, not client-chosen timestamps.
    if (typeof payload.nonce !== "string" || !options.nonces.includes(payload.nonce)) throw new DpopError("use_dpop_nonce", "A fresh server nonce is required.");
    return { thumbprint, jti: payload.jti, expiresAt: (Number(payload.iat) + 121) * 1000 };
  } catch (error) { if (error instanceof DpopError) throw error; return fail(); }
}
