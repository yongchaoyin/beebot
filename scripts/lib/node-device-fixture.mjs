// Independent RFC 9449 test client (does not call the production signer/verifier).
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
export function testDevice() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  const hash = value => createHash("sha256").update(value).digest("base64url");
  const jkt = hash(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }));
  const nonces = new Map();
  function proof(uri, method = "GET", token, nonce = nonces.get(new URL(uri).origin), overrides = {}, headerOverrides = {}) {
    const url = new URL(uri); url.search = ""; url.hash = "";
    const header = Buffer.from(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk, ...headerOverrides })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ jti: randomUUID(), htm: method, htu: url.href, iat: Math.floor(Date.now() / 1000),
      ...(token === undefined ? {} : { ath: hash(token) }), ...(nonce === undefined ? {} : { nonce }), ...overrides })).toString("base64url");
    return `${header}.${payload}.${sign("sha256", Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  }
  async function request(uri, options = {}) {
    uri = String(uri); const origin = new URL(uri).origin;
    for (let n = 0; n < 2; n++) {
      const headers = new Headers(options.headers);
      // Fixture Nodes restart on the same port; do not reuse their closed pool sockets.
      headers.set("Connection", "close");
      const auth = headers.get("authorization"); const token = auth?.startsWith("DPoP ") ? auth.slice(5) : undefined;
      headers.set("DPoP", proof(uri, options.method ?? "GET", token));
      const res = await fetch(uri, { redirect: "manual", ...options, headers });
      if (res.headers.has("dpop-nonce")) nonces.set(origin, res.headers.get("dpop-nonce"));
      if (n === 0 && [400,401].includes(res.status) && res.headers.has("dpop-nonce")) {
        const error = await res.clone().json().catch(() => ({}));
        if (error.error === "use_dpop_nonce") { await res.arrayBuffer(); continue; }
      }
      return res;
    }
  }
  return { jkt, jwk, privateKey, proof, request, nonces };
}
