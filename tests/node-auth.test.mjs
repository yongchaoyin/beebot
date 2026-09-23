import { testDevice } from "./helpers/node-device.mjs";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

let temporary;
let NodeAuth;
test.before(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "beebot-node-auth-tests-"));
  const output = path.join(temporary, "auth.mjs");
  await build({ entryPoints: [fileURLToPath(new URL("../source/node/auth.ts", import.meta.url))], outfile: output, bundle: true, format: "esm", platform: "node", target: "node26" });
  ({ NodeAuth } = await import(pathToFileURL(output).href));
});
test.after(() => rm(temporary, { recursive: true, force: true }));

const password = "correct horse battery staple";
const random = () => randomBytes(32).toString("base64url");
const hash = value => createHash("sha256").update(value).digest("base64url");

async function fixture(t, initialize = true) {
  const dataDir = await mkdtemp(path.join(temporary, "node-"));
  let auth;
  const server = createServer(async (req, res) => {
    try {
      res.setHeader("DPoP-Nonce", auth.getDpopNonce());
      const url = new URL(req.url, origin);
      if (await auth.handle(req, res, url)) return;
      if (url.pathname === "/protected") { res.end(JSON.stringify(auth.authenticate(req))); return; }
      if (url.pathname === "/event-ticket") { res.end(JSON.stringify(auth.createEventTicket(auth.authenticate(req)))); return; }
      res.writeHead(404); res.end();
    } catch (error) { res.writeHead(error.status ?? 500); res.end(JSON.stringify({ error: error.code })); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  auth = new NodeAuth({ dataDir, issuer: origin });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); auth.close(); });
  const device = testDevice();
  const request = (endpoint, options = {}) => device.request(`${origin}${endpoint}`, { redirect: "manual", ...options });
  const post = (endpoint, body, headers = {}) => request(endpoint, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(body),
  });
  const form = async endpoint => {
    const response = await request(endpoint); const page = await response.text();
    return {
      response, page, cookie: response.headers.get("set-cookie")?.split(";")[0],
      flow_id: /name="flow_id" value="([^"]+)"/.exec(page)?.[1], csrf: /name="csrf" value="([^"]+)"/.exec(page)?.[1],
    };
  };
  const setup = async () => {
    const setupCode = auth.getSetupInfo().code;
    const browser = await form(`/setup?code=${setupCode}`);
    const response = await post("/setup", { flow_id: browser.flow_id, csrf: browser.csrf, username: "owner", password }, { Origin: origin, Cookie: browser.cookie });
    assert.equal(response.status, 200, await response.text());
    return setupCode;
  };
  const startAuthorization = async (overrides = {}) => {
    const verifier = random(); const state = random();
    const query = new URLSearchParams({ client_id: "beebot-desktop", response_type: "code", scope: "owner:node", state,
      redirect_uri: "http://127.0.0.1:54321/oauth/callback", code_challenge: hash(verifier), code_challenge_method: "S256", device_name: "My Mac", dpop_jkt: device.jkt, ...overrides });
    const browser = await form(`/oauth/authorize?${query}`);
    return { ...browser, verifier, state, query };
  };
  const login = async (flow, overrides = {}, headers = {}) => {
    return post("/oauth/authorize", { flow_id: flow.flow_id, csrf: flow.csrf, username: "owner", password, decision: "allow", ...overrides }, { Origin: origin, Cookie: flow.cookie, ...headers });
  };
  const exchange = (code, verifier, overrides = {}) => post("/oauth/token", { client_id: "beebot-desktop", grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: "http://127.0.0.1:54321/oauth/callback", ...overrides });
  const createSession = async () => {
    const flow = await startAuthorization(); assert.equal(flow.response.status, 200);
    const authorized = await login(flow); assert.equal(authorized.status, 303, await authorized.text());
    const callback = new URL(authorized.headers.get("location"));
    assert.equal(callback.searchParams.get("state"), flow.state); assert.equal(callback.searchParams.get("iss"), origin);
    const code = callback.searchParams.get("code");
    const response = await exchange(code, flow.verifier); assert.equal(response.status, 200);
    return { ...(await response.json()), code, verifier: flow.verifier };
  };
  const refresh = value => post("/oauth/token", { client_id: "beebot-desktop", grant_type: "refresh_token", refresh_token: value });
  const protectedRequest = token => request("/protected", { headers: { Authorization: `DPoP ${token}` } });
  const alterDb = run => { const db = new DatabaseSync(path.join(dataDir, "auth.sqlite")); try { return run(db); } finally { db.close(); } };
  if (initialize) await setup();
  return { get auth() { return auth; }, origin, dataDir, device, request, post, form, setup, startAuthorization, login, exchange, createSession, refresh, protectedRequest, alterDb,
    restart() { auth.close(); auth = new NodeAuth({ dataDir, issuer: origin }); } };
}

test("owner setup is one-time, CSRF-bound, hashed, and survives restart", async t => {
  const f = await fixture(t, false);
  assert.equal(f.auth.getSetupInfo().required, true);
  assert.equal((await f.request("/setup?code=wrong")).status, 403);
  const setupCode = f.auth.getSetupInfo().code;
  const browser = await f.form(`/setup?code=${setupCode}`);
  assert.equal(browser.response.headers.get("referrer-policy"), "same-origin");
  assert.match(browser.response.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(browser.response.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
  const badOrigin = await f.post("/setup", { flow_id: browser.flow_id, csrf: browser.csrf, username: "owner", password }, { Origin: "https://attacker.example", Cookie: browser.cookie });
  assert.equal(badOrigin.status, 403);
  assert.equal((await f.post("/setup", { flow_id: browser.flow_id, csrf: browser.csrf, username: "owner", password }, { Origin: "null", Cookie: browser.cookie })).status, 403);
  assert.equal((await f.post("/setup", { flow_id: browser.flow_id, csrf: browser.csrf, username: "owner", password }, { Origin: f.origin })).status, 403);
  await f.setup();
  assert.deepEqual(f.auth.getSetupInfo(), { required: false });
  assert.equal((await f.request(`/setup?code=${setupCode}`)).status, 409);
  const owner = f.alterDb(db => db.prepare("SELECT * FROM owner").get());
  assert.notEqual(owner.password_hash, password); assert.equal(owner.password_scheme, "scrypt-n131072-r8-p1");
  assert.equal((await stat(path.join(f.dataDir, "auth.sqlite"))).mode & 0o777, 0o600);
  assert.equal(f.alterDb(db => db.prepare("PRAGMA journal_mode").get()).journal_mode, "wal");
  f.restart(); assert.deepEqual(f.auth.getSetupInfo(), { required: false });
  const session = await f.createSession(); assert.equal((await f.protectedRequest(session.access_token)).status, 200);
});

test("only registered loopback redirects and PKCE S256 are accepted; no unsafe redirect is followed", async t => {
  const f = await fixture(t);
  for (const redirect_uri of ["https://evil.example/oauth/callback", "http://localhost:54321/oauth/callback", "http://127.0.0.1:54321/wrong", "http://127.0.0.1:54321/oauth/callback?x=1", "http://evil@127.0.0.1:54321/oauth/callback", "http://127.1:54321/oauth/callback", "http://127.0.0.1:80/oauth/callback", "http://127.0.0.1:54321/a/../oauth/callback"]) {
    const flow = await f.startAuthorization({ redirect_uri }); assert.equal(flow.response.status, 400); assert.equal(flow.response.headers.get("location"), null);
  }
  for (const overrides of [{ code_challenge_method: "plain" }, { client_id: "unknown" }, { response_type: "token" }, { scope: "admin" }, { state: "short" }]) {
    assert.equal((await f.startAuthorization(overrides)).response.status, 400);
  }
  const discovery = await (await f.request("/.well-known/oauth-authorization-server")).json();
  assert.deepEqual(discovery.code_challenge_methods_supported, ["S256"]); assert.equal(discovery.issuer, f.origin);
});

test("authorization verifies browser CSRF, explicit consent, state, verifier, and single-use code", async t => {
  const f = await fixture(t);
  const flow = await f.startAuthorization();
  assert.match(flow.page, /登录并授权此设备/); assert.match(flow.page, /My Mac/);
  assert.equal((await f.login(flow, { csrf: "wrong" })).status, 403);
  assert.equal((await f.login(flow, {}, { Origin: "https://attacker.example" })).status, 403);
  assert.equal((await f.login(flow, {}, { Origin: "null" })).status, 403);
  const authorized = await f.login(flow); assert.equal(authorized.status, 303);
  assert.match(authorized.headers.get("content-security-policy"), /http:\/\/127\.0\.0\.1:54321\/oauth\/callback/);
  const callback = new URL(authorized.headers.get("location"));
  assert.equal(callback.searchParams.get("state"), flow.state); assert.equal(callback.searchParams.get("iss"), f.origin);
  assert.equal(callback.searchParams.has("access_token"), false);
  const code = callback.searchParams.get("code");
  assert.equal((await f.exchange(code, random())).status, 400);
  assert.equal((await f.exchange(code, flow.verifier, { redirect_uri: "http://127.0.0.1:54322/oauth/callback" })).status, 400);
  const exchanged = await f.exchange(code, flow.verifier); assert.equal(exchanged.status, 200);
  const tokens = await exchanged.json(); assert.equal(tokens.expires_in, 300); assert.equal(tokens.scope, "owner:node");
  assert.equal((await f.protectedRequest(tokens.access_token)).status, 200);
  assert.equal((await f.exchange(code, flow.verifier)).status, 400);
  assert.equal((await f.protectedRequest(tokens.access_token)).status, 401, "code replay revokes its device family");
  assert.equal((await f.login(flow)).status, 403, "form also consumed exactly once");
});

test("denying authorization redirects with state but never issues a session", async t => {
  const f = await fixture(t); const flow = await f.startAuthorization();
  const response = await f.login(flow, { decision: "deny", username: "", password: "" });
  assert.equal(response.status, 303); const callback = new URL(response.headers.get("location"));
  assert.equal(callback.searchParams.get("error"), "access_denied"); assert.equal(callback.searchParams.get("state"), flow.state);
  assert.equal(f.alterDb(db => db.prepare("SELECT count(*) AS count FROM auth_sessions").get()).count, 0);
});

test("refresh rotates credentials and replay revokes only the affected device family", async t => {
  const f = await fixture(t); const first = await f.createSession(); const second = await f.createSession();
  const refreshed = await f.refresh(first.refresh_token); assert.equal(refreshed.status, 200); const next = await refreshed.json();
  assert.notEqual(next.refresh_token, first.refresh_token); assert.notEqual(next.access_token, first.access_token);
  assert.equal((await f.protectedRequest(next.access_token)).status, 200);
  f.restart(); assert.equal((await f.protectedRequest(next.access_token)).status, 200, "sessions survive a server restart");
  assert.equal((await f.refresh(first.refresh_token)).status, 400);
  assert.equal((await f.protectedRequest(next.access_token)).status, 401);
  assert.equal((await f.refresh(next.refresh_token)).status, 400);
  assert.equal((await f.protectedRequest(second.access_token)).status, 200);
  const hashes = f.alterDb(db => db.prepare("SELECT hash FROM auth_tokens").all()).map(row => row.hash);
  assert.ok(!hashes.includes(second.access_token)); assert.ok(hashes.includes(hash(second.access_token)));
});

test("event tickets are single-use and every session check observes revocation", async t => {
  const f = await fixture(t); const tokens = await f.createSession();
  const identity = await (await f.protectedRequest(tokens.access_token)).json();
  const headers = { Authorization: `DPoP ${tokens.access_token}` };
  const ticket = await (await f.request("/event-ticket", { headers })).json();
  assert.deepEqual(f.auth.redeemEventTicket(ticket.ticket, f.device.proof(`${f.origin}/v1/events`, "GET", ticket.ticket, ticket.nonce)), identity);
  assert.throws(() => f.auth.redeemEventTicket(ticket.ticket, f.device.proof(`${f.origin}/v1/events`, "GET", ticket.ticket, ticket.nonce)), { status: 401 });
  const pending = await (await f.request("/event-ticket", { headers })).json();
  assert.equal((await f.post("/oauth/revoke", { client_id: "beebot-desktop", token: tokens.refresh_token })).status, 200);
  assert.throws(() => f.auth.assertSession(identity.sessionId), { status: 401 });
  assert.throws(() => f.auth.redeemEventTicket(pending.ticket, f.device.proof(`${f.origin}/v1/events`, "GET", pending.ticket, pending.nonce)), { status: 401 });
  assert.equal((await f.protectedRequest(tokens.access_token)).status, 401);
  assert.equal((await f.post("/oauth/revoke", { client_id: "beebot-desktop", token: "unknown" })).status, 200);
});

test("access, refresh idle, and absolute family expiry are enforced", async t => {
  const f = await fixture(t); const tokens = await f.createSession();
  f.alterDb(db => db.prepare("UPDATE auth_tokens SET expires=? WHERE hash=?").run(Date.now() - 1, hash(tokens.access_token)));
  assert.equal((await f.protectedRequest(tokens.access_token)).status, 401);
  const refreshed = await (await f.refresh(tokens.refresh_token)).json();
  assert.equal((await f.protectedRequest(refreshed.access_token)).status, 200);
  f.alterDb(db => db.prepare("UPDATE auth_sessions SET idle_expires=?").run(Date.now() - 1));
  assert.equal((await f.protectedRequest(refreshed.access_token)).status, 401);
  assert.equal((await f.refresh(refreshed.refresh_token)).status, 400);
  const another = await f.createSession();
  f.alterDb(db => db.prepare("UPDATE auth_sessions SET absolute_expires=?").run(Date.now() - 1));
  assert.equal((await f.protectedRequest(another.access_token)).status, 401);
  assert.equal((await f.refresh(another.refresh_token)).status, 400);
});

test("auth routes reject cross-origin token requests, repeated parameters, oversized bodies and wrong methods", async t => {
  const f = await fixture(t, false);
  assert.equal((await f.request("/unhandled")).status, 404);
  assert.equal((await f.request("/oauth/token")).status, 405);
  assert.equal((await f.post("/oauth/token", { client_id: "beebot-desktop", grant_type: "refresh_token", refresh_token: random() }, { Origin: "https://evil.example" })).status, 403);
  const duplicate = await f.request("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "client_id=beebot-desktop&client_id=evil" });
  assert.equal(duplicate.status, 400);
  const oversized = await f.request("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "x=" + "a".repeat(17 * 1024) });
  assert.equal(oversized.status, 413);
  assert.equal((await f.request("/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 415);
  for (let count = 0; count < 20; count++) await f.request("/setup?code=bad");
  const limited = await f.request("/setup?code=bad"); assert.equal(limited.status, 429); assert.ok(limited.headers.get("retry-after"));
});

test("non-loopback plaintext and issuer credentials are never accepted", () => {
  for (const issuer of ["http://192.168.1.5:8080", "http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com?token=secret"]) {
    assert.throws(() => new NodeAuth({ dataDir: temporary, issuer }), /HTTPS origin/);
  }
});
