import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer as createProbe } from "node:net";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { testDevice } from "./helpers/node-device.mjs";

const output = await mkdtemp(path.join(tmpdir(), "beebot-tenant-http-code-"));
await build({ stdin: { contents: `export * from './source/hosting/index.ts'; export * from './source/node/auth.ts'; export * from './source/hosting/http-body.ts';`, resolveDir: path.resolve(import.meta.dirname, "..") },
  outfile: path.join(output, "server.mjs"), bundle: true, platform: "node", format: "esm", target: "node26" });
const api = await import(pathToFileURL(path.join(output, "server.mjs")));
test.after(() => rm(output, { recursive: true, force: true }));
const password = "test-only-tenant-password-2026";
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function fixture(t, { accounts = ["alice", "bob"], wrapperFactory } = {}) {
  const probe = createProbe(); await new Promise(r => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const origin = `http://127.0.0.1:${port}`, dataDir = await mkdtemp(path.join(tmpdir(), "beebot-catalog-"));
  const baseWrapper = new api.LocalTenantKeyWrapper("test-only-external-kek", randomBytes(32));
  const wrapper = wrapperFactory ? wrapperFactory(baseWrapper) : baseWrapper;
  const config = { version: 1, nodeId: randomUUID(), name: "Catalog test", bindHost: "127.0.0.1", port, publicUrl: origin, maxConcurrentRuns: 2 };
  let server = new api.HostedCatalogServer({ config, dataDir, keyWrapper: wrapper });
  await server.listen();
  t.after(async () => { await server.close(); baseWrapper.close(); await rm(dataDir, { recursive: true, force: true }); });
  const users = {};
  for (const name of accounts) {
    const u = { name, codes: [] };
    const result = await server.auth.provisionInvitedAccount(name, password, (_id, codes) => { u.codes = codes; });
    u.principalId = result.principalId;
    u.workspace = await server.provisionWorkspace(result.principalId, `provision-${name}`, `${name} private workspace`);
    users[name] = u;
  }
  async function form(url) {
    const r = await fetch(url); const text = await r.text(); assert.equal(r.status, 200, text);
    return { flow_id: /name="flow_id" value="([^"]+)"/.exec(text)[1], csrf: /name="csrf" value="([^"]+)"/.exec(text)[1], cookie: r.headers.get("set-cookie").split(";")[0] };
  }
  const post = (route, fields, browser) => fetch(origin + route, { method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, Cookie: browser.cookie }, body: new URLSearchParams(fields) });
  async function login(name, { recovery, device = testDevice(), expect = 303, overridePassword } = {}) {
    const verifier = randomUUID() + randomUUID(), redirect = "http://127.0.0.1:54321/oauth/callback";
    const q = new URLSearchParams({ client_id: "beebot-desktop", response_type: "code", scope: "account:workspaces", state: randomUUID(), redirect_uri: redirect,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", dpop_jkt: device.jkt });
    const browser = await form(origin + "/oauth/authorize?" + q);
    const code = recovery === undefined ? users[name]?.codes.shift() : recovery;
    const r = await post("/oauth/authorize", { ...browser, username: name, password: overridePassword ?? password, decision: "allow",
      ...(code ? { recovery_code: code, confirm_recovery: "yes" } : {}) }, browser);
    assert.equal(r.status, expect, await r.clone().text());
    const exchange = async response => {
      const target = new URL(response.headers.get("location")); assert.equal(target.searchParams.get("iss"), origin);
      const grant = await device.request(origin + "/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: "beebot-desktop", grant_type: "authorization_code", code: target.searchParams.get("code"), code_verifier: verifier, redirect_uri: redirect }) });
      assert.equal(grant.status, 200, await grant.clone().text()); const tokens = await grant.json(); assert.equal(tokens.scope, "account:workspaces");
      const request = (route, body, headers = {}) => device.request(origin + route, {
        method: body === undefined ? "GET" : "POST", headers: { Authorization: `DPoP ${tokens.access_token}`, "Content-Type": "application/json", "Idempotency-Key": randomUUID(), ...headers },
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
      return { device, tokens, request };
    };
    if (expect === 303) return exchange(r);
    return { response: r, browser, device, exchange, post };
  }
  const scope = name => server.directory.scope(() => ({ issuer: origin, subject: users[name].principalId, deviceRole: "admin", botIds: "*" }), users[name].workspace);
  return { origin, dataDir, config, wrapper, users, login, scope, get server() { return server; },
    async restart() { await server.close(); server = new api.HostedCatalogServer({ config, dataDir, keyWrapper: wrapper }); await server.listen(); } };
}
const snapshotPath = u => `/v1/workspaces/${u.workspace}/snapshot`;
const botsPath = u => `/v1/workspaces/${u.workspace}/bots`;
const newBot = name => ({ name, description: "Own job only" });

// Actual shared HTTP listener, password checks, PKCE, DPoP, device trust,
// SQLite and crypto. No injected identity callback authenticates these requests.
test("A and B sign in at one origin and receive only their encrypted workspace records", async t => {
  const f = await fixture(t), a = await f.login("alice"), b = await f.login("bob");
  const pa = botsPath(f.users.alice), pb = botsPath(f.users.bob);
  const ba = await (await a.request(pa, newBot("Alice secret"), { "Idempotency-Key": "same-command" })).json();
  const bb = await (await b.request(pb, newBot("Bob secret"), { "Idempotency-Key": "same-command" })).json();
  assert.ok(ba.bot && bb.bot); assert.notEqual(ba.bot.id, bb.bot.id);
  assert.deepEqual((await (await a.request("/v1/workspaces")).json()).workspaces.map(w => w.id), [f.users.alice.workspace]);
  assert.deepEqual((await (await b.request("/v1/workspaces")).json()).workspaces.map(w => w.id), [f.users.bob.workspace]);
  assert.equal((await (await a.request(`/v1/workspaces/${f.users.alice.workspace}`)).json()).name, "alice private workspace");
  assert.equal((await a.request(snapshotPath(f.users.bob))).status, 404);
  assert.equal((await b.request(`${pa}/${ba.bot.id}`)).status, 404);
  assert.equal((await a.request(`${pa}/${bb.bot.id}`)).status, 404);
  const events = await (await a.request(`/v1/workspaces/${f.users.alice.workspace}/events?after=0`)).json();
  assert.equal(events.workspaceId, f.users.alice.workspace); assert.equal(events.events.length, 1); assert.ok(!JSON.stringify(events).includes("Bob secret"));
  const repeat = await (await a.request(pa, newBot("Alice secret"), { "Idempotency-Key": "same-command" })).json();
  assert.equal(repeat.bot.id, ba.bot.id);
  assert.equal((await a.request(pa, newBot("different"), { "Idempotency-Key": "same-command" })).status, 409);
  for (const suffix of ["", "-wal"]) {
    const bytes = await readFile(path.join(f.dataDir, "tenants", "workspaces", f.users.alice.workspace, "control.sqlite" + suffix));
    assert.ok(!bytes.includes(Buffer.from("Alice secret"))); assert.ok(!bytes.includes(Buffer.from("Own job only")));
  }
  await f.restart();
  assert.equal((await (await a.request(snapshotPath(f.users.alice))).json()).bots[0].id, ba.bot.id);
  assert.equal((await b.request(snapshotPath(f.users.alice))).status, 404);
});

test("copied tokens, forged tenant headers and unauthenticated calls cannot access the catalog", async t => {
  const f = await fixture(t, { accounts: ["alice"] }), a = await f.login("alice"), thief = testDevice();
  const route = snapshotPath(f.users.alice);
  assert.equal((await fetch(f.origin + route)).status, 401);
  assert.equal((await fetch(f.origin + route, { headers: { Authorization: `Bearer ${a.tokens.access_token}` } })).status, 401);
  assert.equal((await thief.request(f.origin + route, { headers: { Authorization: `DPoP ${a.tokens.access_token}` } })).status, 401);
  assert.equal((await a.request(route, undefined, { "X-Tenant-ID": f.users.alice.workspace })).status, 400);
  assert.equal((await a.request(route, undefined, { Origin: "https://attacker.invalid" })).status, 403);
  const proof = a.device.proof(f.origin + route, "GET", a.tokens.access_token, f.server.auth.getDpopNonce());
  const headers = { Authorization: `DPoP ${a.tokens.access_token}`, DPoP: proof };
  assert.equal((await fetch(f.origin + route, { headers })).status, 200);
  assert.equal((await fetch(f.origin + route, { headers })).status, 401);
});

test("no public setup, registration, legacy fallback or execution acceptance exists", async t => {
  const f = await fixture(t, { accounts: ["alice"] }), a = await f.login("alice");
  assert.deepEqual(f.server.auth.getSetupInfo(), { required: false });
  assert.equal((await fetch(f.origin + "/setup")).status, 404);
  const meta = await (await fetch(f.origin + "/v1/node")).json();
  assert.equal(meta.protocolVersion, 2); assert.equal(meta.execution, "unavailable");
  for (const route of ["/register", "/v1/accounts", "/v1/snapshot", "/v1/goals", "/v1/events/ticket"]) assert.equal((await a.request(route, {})).status, 404);
  const bot = (await (await a.request(botsPath(f.users.alice), newBot("Storage only"))).json()).bot;
  const r = await a.request(`/v1/workspaces/${f.users.alice.workspace}/goals`, { botId: bot.id, prompt: "do not execute" });
  assert.equal(r.status, 503); assert.equal((await r.json()).error, "tenant_execution_unavailable");
  const snap = await (await a.request(snapshotPath(f.users.alice))).json(); assert.equal(snap.cursor, 1); assert.equal(snap.execution, "unavailable");
});

test("unknown accounts and wrong passwords do not create identities or bypass recovery", async t => {
  const f = await fixture(t, { accounts: ["alice"] });
  const unknown = await f.login("unknown", { expect: 401, recovery: "" });
  const wrong = await f.login("alice", { expect: 401, recovery: "", overridePassword: "wrong-but-long-password" });
  assert.match(await unknown.response.text(), /Incorrect username or password/);
  assert.match(await wrong.response.text(), /Incorrect username or password/);
  const pending = await f.login("alice", { expect: 200, recovery: "" });
  assert.match(await pending.response.text(), /等待可信设备批准/);
  assert.equal(f.server.auth.hasInvitedAccount("unknown"), false);
});

test("recovery codes and device recovery affect only the authenticated account", async t => {
  const f = await fixture(t), a = await f.login("alice"), b = await f.login("bob");
  const wrong = await f.login("bob", { expect: 403, recovery: f.users.alice.codes[0] });
  assert.equal(wrong.response.status, 403);
  assert.equal((await a.request(snapshotPath(f.users.alice))).status, 200);
  assert.equal((await b.request(snapshotPath(f.users.bob))).status, 200);
  const replacement = await f.login("alice");
  assert.equal((await a.request(snapshotPath(f.users.alice))).status, 401);
  assert.equal((await replacement.request(snapshotPath(f.users.alice))).status, 200);
  assert.equal((await b.request(snapshotPath(f.users.bob))).status, 200);
});

test("new device needs its own account administrator; cross-account approval is rejected", async t => {
  const f = await fixture(t), a = await f.login("alice"), b = await f.login("bob");
  const pending = await f.login("alice", { expect: 200, recovery: "" });
  const page = await pending.response.text(), requestId = /name="request_id" value="([^"]+)"/.exec(page)[1];
  const decision = { expectedVersion: 1, thumbprint: pending.device.jkt, grant: { role: "viewer", botIds: "*" } };
  assert.equal((await b.request(`/v1/security/requests/${requestId}/approve`, decision)).status, 404);
  assert.equal((await a.request(`/v1/security/requests/${requestId}/approve`, decision)).status, 200);
  const callback = await pending.post("/oauth/device-approval", { request_id: requestId, csrf: pending.browser.csrf, decision: "check" }, pending.browser);
  assert.equal(callback.status, 303);
  const viewer = await pending.exchange(callback);
  assert.equal((await viewer.request(snapshotPath(f.users.alice))).status, 200);
  assert.equal((await viewer.request(botsPath(f.users.alice), newBot("no write"))).status, 403);
  assert.equal((await viewer.request("/v1/security/sessions")).status, 403);
  const sessions = await (await a.request("/v1/security/sessions")).json();
  const device = sessions.devices.find(d => d.jkt === pending.device.jkt);
  assert.equal((await a.request(`/v1/security/devices/${device.jkt}/block`, { expectedVersion: device.version })).status, 200);
  assert.equal((await viewer.request(snapshotPath(f.users.alice))).status, 401);
  assert.equal((await b.request(snapshotPath(f.users.bob))).status, 200);
});

test("workspace membership and scoped device ceilings both apply after login", async t => {
  const f = await fixture(t), a = await f.login("alice"), b = await f.login("bob");
  const bMember = { issuer: f.origin, subject: f.users.bob.principalId, deviceRole: "admin", botIds: "*" };
  f.server.directory.setMember(f.scope("alice"), bMember, "viewer", 0);
  assert.equal((await b.request(snapshotPath(f.users.alice))).status, 200);
  assert.equal((await b.request(botsPath(f.users.alice), newBot("no"))).status, 403);
  f.server.directory.setMember(f.scope("alice"), bMember, null, 1);
  assert.equal((await b.request(snapshotPath(f.users.alice))).status, 404);
  const state = f.server.directory.inspect(f.users.alice.workspace);
  f.server.directory.setStatus(state.id, state.version, "suspended");
  assert.equal((await a.request(snapshotPath(f.users.alice))).status, 404);
  assert.equal((await b.request(snapshotPath(f.users.bob))).status, 200);
});

test("strict bodies and canonical URLs reject ambiguous or authority-bearing input", async t => {
  const f = await fixture(t, { accounts: ["alice"] }), a = await f.login("alice"), route = botsPath(f.users.alice);
  for (const body of ['{"name":"one","name":"two","description":""}', '{"name":"one","na\\u006de":"two","description":""}', "[]", newBot("x").name,
    { ...newBot("x"), ownerId: "other" }, { ...newBot("x"), tenantId: f.users.alice.workspace }]) assert.equal((await a.request(route, body)).status, 400);
  assert.equal((await a.request(route, { name: "x", description: "x".repeat(33000) })).status, 413);
  assert.equal((await a.request(route, newBot("x"), { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await a.request(route, newBot("x"), { "Content-Encoding": "gzip" })).status, 415);
  for (const tail of ["?after=0&after=1", "?after=-1", "?after=1e2", "?after=9007199254740992", "?token=secret"]) {
    assert.equal((await a.request(`/v1/workspaces/${f.users.alice.workspace}/events${tail}`)).status, 400);
  }
  assert.equal((await a.request("/v1/workspaces?after=../../escape")).status, 400);
  const hostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(f.origin + snapshotPath(f.users.alice), { headers: { Host: "attacker.invalid" } }, res => {
      res.resume(); res.on("end", () => resolve(res.statusCode));
    }); req.on("error", reject); req.end();
  });
  assert.equal(hostStatus, 400);
});

test("revocation while a JSON body is arriving prevents the mutation", async t => {
  const f = await fixture(t, { accounts: ["alice"] }), a = await f.login("alice"), route = botsPath(f.users.alice);
  const session = (await (await a.request("/v1/security/sessions")).json()).currentSessionId;
  const arrived = deferred(), authenticate = f.server.auth.authenticate.bind(f.server.auth);
  f.server.auth.authenticate = req => { const identity = authenticate(req); arrived.resolve(identity); return identity; };
  const result = new Promise((resolve, reject) => {
    const req = httpRequest(f.origin + route, { method: "POST", headers: {
      Authorization: `DPoP ${a.tokens.access_token}`, DPoP: a.device.proof(f.origin + route, "POST", a.tokens.access_token, f.server.auth.getDpopNonce()),
      "Content-Type": "application/json", "Idempotency-Key": randomUUID(), "Transfer-Encoding": "chunked" } }, res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject); req.write('{"name":"late",');
    void arrived.promise.then(() => {
      f.server.auth.changeSession({ principalId: f.users.alice.principalId, sessionId: session }, session);
      req.end('"description":""}');
    }).catch(reject);
  });
  assert.ok([401, 403].includes(await result));
  assert.equal((await f.server.workspaces.snapshot(f.scope("alice"))).bots.length, 0);
});

test("permission removal during key unwrap prevents plaintext response and writes", async t => {
  let pause = false; const entered = deferred(), gate = deferred();
  const f = await fixture(t, { accounts: ["alice"], wrapperFactory: base => ({ id: base.id, wrap: (...args) => base.wrap(...args),
    async unwrap(...args) { if (pause) { entered.resolve(); await gate.promise; } return base.unwrap(...args); } }) });
  const a = await f.login("alice");
  await f.server.workspaces.release(f.scope("alice")); pause = true;
  const result = a.request(snapshotPath(f.users.alice)); await entered.promise;
  const state = f.server.directory.inspect(f.users.alice.workspace); f.server.directory.setStatus(state.id, state.version, "suspended"); gate.resolve();
  const response = await result; assert.ok([403, 404].includes(response.status)); assert.ok(!(await response.text()).includes("alice private"));
});

test("account provisioning rolls back on failed recovery persistence and never overwrites", async t => {
  const f = await fixture(t, { accounts: [] });
  await assert.rejects(f.server.auth.provisionInvitedAccount("new-user", password, () => { throw new Error("test persistence failure"); }), /persistence failure/);
  const created = await f.server.auth.provisionInvitedAccount("NEW-USER", password, () => {});
  assert.ok(f.server.auth.hasInvitedAccount(created.principalId));
  await assert.rejects(f.server.auth.provisionInvitedAccount("new-user", password, () => {}), { code: "account_exists" });
  const db = new DatabaseSync(path.join(f.dataDir, "accounts", "auth.sqlite"));
  try { assert.equal(db.prepare("SELECT count(*) AS n FROM owner").get().n, 1); assert.equal(db.prepare("SELECT count(*) AS n FROM auth_recovery_codes").get().n, 8); }
  finally { db.close(); }
});

test("single-owner and hosted authorities refuse implicit mode conversion", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "beebot-auth-mode-")); t.after(() => rm(root, { recursive: true, force: true }));
  const origin = "https://auth.example.test", legacy = path.join(root, "legacy"), hosted = path.join(root, "hosted");
  let auth = new api.NodeAuth({ dataDir: legacy, issuer: origin });
  await assert.rejects(auth.provisionInvitedAccount("alice", password, () => {}), /unavailable/); auth.close();
  assert.throws(() => new api.NodeAuth({ dataDir: legacy, issuer: origin, accountMode: "invited" }), /mode mismatch/);
  auth = new api.NodeAuth({ dataDir: hosted, issuer: origin, accountMode: "invited" }); auth.close();
  assert.throws(() => new api.NodeAuth({ dataDir: hosted, issuer: origin }), /mode mismatch/);
  auth = new api.NodeAuth({ dataDir: legacy, issuer: origin }); assert.equal(auth.getSetupInfo().required, true); auth.close();
});

test("hosted root ownership and identity survive restarts without a second controller", async t => {
  const f = await fixture(t, { accounts: [] });
  assert.throws(() => new api.HostedCatalogServer({ config: f.config, dataDir: f.dataDir, keyWrapper: f.wrapper }), /active controller/);
  await f.server.close();
  assert.throws(() => new api.HostedCatalogServer({ config: { ...f.config, nodeId: randomUUID() }, dataDir: f.dataDir, keyWrapper: f.wrapper }), /identity changed/);
  await f.restart(); assert.equal((await fetch(f.origin + "/health")).status, 200);
});

test("JSON parser rejects invalid UTF8, duplicate nested fields, depth and primitive values", () => {
  for (const value of [Buffer.from([0xff]), Buffer.from('{"x":{"a":1,"a":2}}'), Buffer.from('{"x":' + "[".repeat(9) + "0" + "]".repeat(9) + "}"), Buffer.from("null")]) assert.throws(() => api.parseCatalogObject(value), { code: "invalid_request" });
  assert.deepEqual(api.parseCatalogObject(Buffer.from('{"name":"} [ : \\\" test","x":{"a":1}}')), { name: '} [ : " test', x: { a: 1 } });
});

test("key-service failure returns a sanitized error and leaves another tenant usable", async t => {
  let unavailableTenant;
  const f = await fixture(t, { wrapperFactory: base => ({ id: base.id, wrap: (...args) => base.wrap(...args),
    async unwrap(data, context, signal) { if (context.tenantId === unavailableTenant) throw new Error("private-provider-key-and-path"); return base.unwrap(data, context, signal); } }) });
  const a = await f.login("alice"), b = await f.login("bob");
  await f.server.workspaces.release(f.scope("alice")); unavailableTenant = f.users.alice.workspace;
  const response = await a.request(snapshotPath(f.users.alice)); assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("private-provider-key-and-path"));
  assert.equal((await b.request(snapshotPath(f.users.bob))).status, 200);
});

test("a disconnected client cannot mutate after its pending key lookup completes", async t => {
  let pause = false; const entered = deferred(), gate = deferred();
  const f = await fixture(t, { accounts: ["alice"], wrapperFactory: base => ({ id: base.id, wrap: (...args) => base.wrap(...args),
    async unwrap(...args) { if (pause) { entered.resolve(); await gate.promise; } return base.unwrap(...args); } }) });
  const a = await f.login("alice"), route = botsPath(f.users.alice);
  await f.server.workspaces.release(f.scope("alice")); pause = true;
  const resClosed = deferred(); f.server.http.on("request", (_req, res) => res.once("close", () => resClosed.resolve()));
  const req = httpRequest(f.origin + route, { method: "POST", headers: {
    Authorization: `DPoP ${a.tokens.access_token}`, DPoP: a.device.proof(f.origin + route, "POST", a.tokens.access_token, f.server.auth.getDpopNonce()),
    "Content-Type": "application/json", "Idempotency-Key": randomUUID() } });
  req.on("error", () => {}); req.end(JSON.stringify(newBot("cancelled"))); await entered.promise;
  req.destroy(); await resClosed.promise; pause = false; gate.resolve();
  // The subsequent read shares the same pending cell open and observes the
  // cancelled request's authorization check, not a guessed time delay.
  assert.equal((await f.server.workspaces.snapshot(f.scope("alice"))).bots.length, 0);
});

test("workspace pagination enumerates memberships only, never another account's spaces", async t => {
  const f = await fixture(t), a = await f.login("alice");
  const second = await f.server.provisionWorkspace(f.users.alice.principalId, "second-workspace", "Second");
  const page = f.server.directory.memberships(() => ({ issuer: f.origin, subject: f.users.alice.principalId, deviceRole: "admin", botIds: "*" }), "", 1);
  assert.equal(page.workspaces.length, 1); assert.ok(page.nextCursor);
  const response = await a.request("/v1/workspaces?after=" + page.nextCursor); assert.equal(response.status, 200);
  const next = await response.json(); assert.equal(next.workspaces.length, 1);
  assert.deepEqual(new Set([...page.workspaces, ...next.workspaces].map(w => w.id)), new Set([f.users.alice.workspace, second]));
  assert.ok(!JSON.stringify(next).includes(f.users.bob.workspace));
});

test("one account's stalled requests hit its cap without denying another account", async t => {
  let tenant; const entered = deferred(), gate = deferred(); let blocked = 0;
  const f = await fixture(t, { wrapperFactory: base => ({ id: base.id, wrap: (...args) => base.wrap(...args),
    async unwrap(bytes, context, signal) { if (context.tenantId === tenant) { entered.resolve(); await gate.promise; } return base.unwrap(bytes, context, signal); } }) });
  const a = await f.login("alice"), b = await f.login("bob"); await f.server.workspaces.release(f.scope("alice")); tenant = f.users.alice.workspace;
  const authenticate = f.server.auth.authenticate.bind(f.server.auth), four = deferred();
  f.server.auth.authenticate = req => { const id = authenticate(req); if (id.principalId === f.users.alice.principalId && ++blocked === 4) four.resolve(); return id; };
  const requests = Array.from({ length: 4 }, () => a.request(snapshotPath(f.users.alice)));
  await entered.promise; await four.promise;
  const excess = await a.request(snapshotPath(f.users.alice)); assert.equal(excess.status, 429); assert.equal(excess.headers.get("retry-after"), "1");
  assert.equal((await b.request(snapshotPath(f.users.bob))).status, 200);
  gate.resolve(); for (const response of await Promise.all(requests)) { assert.equal(response.status, 200); await response.arrayBuffer(); }
});

test("async recovery persistence is rejected before committing an account", async t => {
  const f = await fixture(t, { accounts: [] });
  await assert.rejects(f.server.auth.provisionInvitedAccount("async-user", password, async () => {}), /synchronously/);
  const result = await f.server.auth.provisionInvitedAccount("async-user", password, () => {}); assert.ok(result.principalId);
});
