import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import test from "node:test";
import { WebSocketServer } from "ws";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(tmpdir(), "beebot-client-test-"));
const require = createRequire(import.meta.url);
async function load(name) {
  const file = path.join(temporary, `${name.replaceAll("/", "-")}.cjs`);
  await build({ entryPoints: [path.join(root, "source", `${name}.ts`)], outfile: file, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  return require(file);
}
const { normalizeNodeUrl, authorizeNode, DpopClient } = await load("client-connections/transport");
const { generateDpopKey, exportDpopKey } = await load("shared/security/dpop");
const { NodeConnectionManager } = await load("client-connections/manager");
const { createConnectionPersistence } = await load("client-connections/secure-store");
const { assertTrustedNodeSender } = await load("electron-main/beebot-node/connection-ipc");
test.after(() => rm(temporary, { recursive: true, force: true }));

test("server addresses reject remote cleartext, embedded credentials, paths, and query credentials", () => {
  assert.equal(normalizeNodeUrl(" http://127.0.0.1:9000/ "), "http://127.0.0.1:9000");
  assert.equal(normalizeNodeUrl("https://bot.example.com/"), "https://bot.example.com");
  for (const address of ["http://bot.example.com", "https://token@bot.example.com", "https://bot.example.com/a", "https://bot.example.com/?token=secret", "https://bot.example.com/#secret", "file:///tmp/test"]) assert.throws(() => normalizeNodeUrl(address));
});

async function fakeNode() {
  const tokens = { access_token: "access-private", refresh_token: "refresh-private", expires_in: 600, token_type: "DPoP" };
  let eventMode = "ready", lastSocket, eventNonce = "test-event-nonce-123456", nextIdentityGate;
  let expectedChallenge, nodeId = "test-node", refreshCount = 0, socketCount = 0, trustedDevicesRequired = true;
  const goals = [], accepted = new Map(), requests = [];
  const server = createServer(async (req, res) => {
    let body = "";for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, headers: req.headers, body });
    const json = value => { res.setHeader("Content-Type", "application/json");res.end(JSON.stringify(value)); };
    if (req.url === "/v1/node" && nextIdentityGate) { const gate = nextIdentityGate; nextIdentityGate = undefined; gate.started(); await gate.wait; }
    if (req.url === "/v1/node") return json({ id: nodeId, name: "Test Node", protocolVersion: 1, security: { dpopRequired: true, trustedDevicesRequired } });
    if (req.url === "/.well-known/oauth-authorization-server") return json({
      issuer: baseUrl, authorization_endpoint: baseUrl + "/oauth/authorize", token_endpoint: baseUrl + "/oauth/token", revocation_endpoint: baseUrl + "/oauth/revoke",
      response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"], dpop_signing_alg_values_supported: ["ES256"], authorization_response_iss_parameter_supported: true,
      beebot_dpop_required: true, beebot_trusted_devices_required: trustedDevicesRequired,
    });
    if (req.url === "/oauth/token") {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "authorization_code") assert.equal(createHash("sha256").update(form.get("code_verifier")).digest("base64url"), expectedChallenge);
      else { assert.equal(form.get("refresh_token"), tokens.refresh_token);refreshCount++; }
      return json(tokens);
    }
    if (req.url === "/oauth/revoke") return json({});
    assert.equal(req.headers.authorization, `DPoP ${tokens.access_token}`);
    if (req.url === "/v1/snapshot") return json({ node: { id: nodeId, name: "Test Node" }, bots: [{ id: "bot", name: "Worker" }], goals, cursor: goals.length });
    if (req.url === "/v1/events/ticket") return json({ ticket: "single-use-ticket", nonce: eventNonce });
    if (req.url === "/v1/goals") {
      const key = req.headers["idempotency-key"];
      if (!accepted.has(key)) { goals.push({ id: "goal", ...JSON.parse(body), version: 1, status: "review", result: "Output", createdAt: 1, updatedAt: 1 });accepted.set(key, { commandId: "command", goalId: "goal" }); }
      return json(accepted.get(key));
    }
    if (req.url === "/v1/goals/goal") return json({ goal: goals[0], transcript: [{ role: "assistant", text: "Output" }] });
    if (req.url === "/v1/goals/goal/accept") { assert.equal(JSON.parse(body).expectedVersion, 1);goals[0].status = "succeeded";return json({ goal: goals[0] }); }
    res.statusCode = 404;json({ error: "Not found" });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const wss = new WebSocketServer({ server });
  wss.on("connection", socket => {
    socketCount++;lastSocket=socket;
    socket.once("message", raw => { assert.equal(JSON.parse(raw).ticket, "single-use-ticket");if(eventMode === "ready") socket.send(JSON.stringify({ seq: 1, type: "ready", cursor: goals.length, data: {}, at: Date.now() }));
      else if(eventMode === "reject") {socket.send(JSON.stringify({type:"error",error:"device proof rejected"}));socket.close();} });
  });
  return {
    baseUrl, requests, goals, tokens, get refreshCount() { return refreshCount; }, get socketCount() { return socketCount; },
    async open(url, checkCallbackGuards = false) {
      const auth = new URL(url);assert.equal(auth.pathname, "/oauth/authorize");assert.equal(auth.searchParams.get("code_challenge_method"), "S256");expectedChallenge = auth.searchParams.get("code_challenge");
      const callback = new URL(auth.searchParams.get("redirect_uri"));assert.equal(callback.pathname, "/oauth/callback");
      callback.search = new URLSearchParams({ code: "test-code", state: "wrong-state", iss: baseUrl }).toString();
      assert.equal((await fetch(callback)).status, 400);
      callback.searchParams.set("state", auth.searchParams.get("state"));
      if (checkCallbackGuards) {
        for (const alter of [u=>u.searchParams.set("iss","https://other.example"),u=>u.searchParams.append("code","second"),u=>u.searchParams.set("error","access_denied"),u=>u.searchParams.set("code","x".repeat(513))]) {
          const invalid = new URL(callback); alter(invalid); assert.equal((await fetch(invalid)).status,400);
        }
      }
      assert.equal((await fetch(callback)).status, 200);
      if (checkCallbackGuards) assert.equal((await fetch(callback)).status,400,"callback must be consumed only once");
    },
    holdEvents() { eventMode="hold"; },
    setEventNonce(value) { eventNonce = value; },
    holdNextIdentity(gate) { nextIdentityGate = gate; },
    rejectEvents() { eventMode="reject"; },
    readyEvents() { lastSocket.send(JSON.stringify({type:"ready",cursor:goals.length})); },
    downgradeSecurity() { trustedDevicesRequired = false; },
    changeIdentity() { nodeId = "replacement-node"; },
    disconnect() { for (const socket of wss.clients) socket.close(); },
    async close() { for (const socket of wss.clients) socket.terminate();await new Promise(resolve => wss.close(resolve));server.closeAllConnections();await new Promise(resolve => server.close(resolve)); },
  };
}

test("device login validates state and PKCE; no tokens enter profiles; writes retain idempotency; events reconnect", async () => {
  const node = await fakeNode();let saved = [];
  const persistence = { async load() { return saved; }, async save(data) { saved = structuredClone(data); } };
  const manager = new NodeConnectionManager(persistence, url => node.open(url));
  try {
    const profile = await manager.add(node.baseUrl);
    await manager.login(profile.id);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal((await manager.list())[0].status, "online");
    assert.ok(!JSON.stringify(await manager.list()).includes("private"));
    assert.equal(saved[0].refreshToken, node.tokens.refresh_token);
    assert.equal((await manager.snapshot(profile.id)).bots[0].name, "Worker");
    const key = randomBytes(16).toString("hex");
    await manager.submitGoal(profile.id, { botId: "bot", prompt: "Do useful work" }, key);
    await manager.submitGoal(profile.id, { botId: "bot", prompt: "Do useful work" }, key);
    assert.equal(node.goals.length, 1);
    await manager.accept(profile.id, "goal", 1, randomBytes(16).toString("hex"));
    assert.equal((await manager.goal(profile.id, "goal")).goal.status, "succeeded");
    node.disconnect();await new Promise(resolve => setTimeout(resolve, 1800));
    assert.ok(node.socketCount >= 2);
    assert.equal((await manager.list())[0].status, "online");
    await manager.logout(profile.id);
    assert.equal(saved[0].refreshToken, undefined);
    assert.equal((await manager.list())[0].status, "signed-out");
  } finally { manager.close();await node.close(); }
});

test("saved device session resumes after client restart; changed server identity blocks credential transmission", async () => {
  const node = await fakeNode();let saved = [];
  const persistence = { async load() { return structuredClone(saved); }, async save(data) { saved = structuredClone(data); } };
  let manager = new NodeConnectionManager(persistence, url => node.open(url));
  try {
    const profile = await manager.add(node.baseUrl);await manager.login(profile.id);manager.close();
    manager = new NodeConnectionManager(persistence, () => { throw new Error("Browser should not open for refresh"); });
    await manager.resume(profile.id);
    assert.equal(node.refreshCount, 1);
    manager.close();node.changeIdentity();
    manager = new NodeConnectionManager(persistence, () => {});
    await assert.rejects(manager.resume(profile.id), /identity changed/);
    assert.equal(node.refreshCount, 1);
    const revokedBefore = node.requests.filter(request => request.path === "/oauth/revoke").length;
    await assert.rejects(manager.logout(profile.id), /identity changed/);
    assert.deepEqual(await manager.remove(profile.id), { remoteRevoked: false });
    assert.equal(node.requests.filter(request => request.path === "/oauth/revoke").length, revokedBefore);
    assert.deepEqual(await manager.list(), []);
    assert.deepEqual(saved, []);
  } finally { manager.close();await node.close(); }
});

test("secure persistence encrypts tokens and refuses plaintext fallback", async () => {
  const filename = path.join(temporary, "connections.json");
  const codec = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value.split("").reverse().join("")), decryptString: value => value.toString().split("").reverse().join("") };
  const store = createConnectionPersistence(filename, codec);
  const data = [{ profile: { id: "connection", nodeId: "node", name: "Node", baseUrl: "https://node.example", status: "online" }, refreshToken: "TOP_SECRET_REFRESH", deviceKeyPem: exportDpopKey(generateDpopKey()) }];
  await store.save(data);
  const raw = await readFile(filename, "utf8");assert.ok(!raw.includes("TOP_SECRET_REFRESH"));assert.ok(!raw.includes("accessToken")); assert.ok(!raw.includes("BEGIN PRIVATE KEY"));
  assert.equal((await store.load())[0].refreshToken, "TOP_SECRET_REFRESH");
  const locked = createConnectionPersistence(filename, { ...codec, isEncryptionAvailable: () => false });
  await assert.rejects(locked.load(), /keychain/);
  assert.throws(() => locked.save(data), /keychain/);
});

test("server IPC rejects subframes, unrelated windows, and navigated pages", () => {
  const mainFrame = {};
  const contents = { mainFrame, getURL: () => "file:///app/dist/renderer/index.html#home" };
  const windows = [{ webContents: contents }];
  assertTrustedNodeSender({ sender: contents, senderFrame: mainFrame }, windows, "/app/dist/renderer/index.html");
  assert.throws(() => assertTrustedNodeSender({ sender: contents, senderFrame: {} }, windows, "/app/dist/renderer/index.html"));
  assert.throws(() => assertTrustedNodeSender({ sender: {}, senderFrame: mainFrame }, windows, "/app/dist/renderer/index.html"));
  contents.getURL = () => "https://untrusted.example/";
  assert.throws(() => assertTrustedNodeSender({ sender: contents, senderFrame: mainFrame }, windows, "/app/dist/renderer/index.html"));
});

test("missing trusted-device enforcement blocks enrollment and credential renewal without downgrade", async () => {
  const node = await fakeNode(); let saved = [];
  const persistence = { async load() { return structuredClone(saved); }, async save(value) { saved = structuredClone(value); } };
  let manager = new NodeConnectionManager(persistence, url => node.open(url));
  try {
    const profile = await manager.add(node.baseUrl); await manager.login(profile.id); manager.close();
    node.downgradeSecurity(); const before = node.refreshCount;
    manager = new NodeConnectionManager(persistence, url => node.open(url));
    await assert.rejects(manager.resume(profile.id), /security|identity|approved|device/i);
    assert.equal(node.refreshCount, before, "No saved credential is sent to an insecure endpoint");
    const fresh = new NodeConnectionManager({async load(){return [];},async save(){throw new Error("Must not save an insecure connection");}},()=>assert.fail("Must not open authorization"));
    try { await assert.rejects(fresh.add(node.baseUrl), /security|device|protocol/i); } finally { fresh.close(); }
  } finally { manager.close(); await node.close(); }
});


test("WebSocket open without server ticket confirmation is never online", async () => {
  const node=await fakeNode();node.holdEvents();
  const manager=new NodeConnectionManager({async load(){return[]},async save(){}},url=>node.open(url));
  try {
    const p=await manager.add(node.baseUrl);await manager.login(p.id);
    await new Promise(r=>setTimeout(r,40));assert.equal(node.socketCount,1);
    assert.equal((await manager.list())[0].status,"connecting");
    node.readyEvents();await new Promise(r=>setTimeout(r,30));assert.equal((await manager.list())[0].status,"online");
  } finally {manager.close();await node.close();}
});
test("server rejection of the device event proof never briefly reports online", async () => {
  const node=await fakeNode();node.rejectEvents();const statuses=[];
  const manager=new NodeConnectionManager({async load(){return[]},async save(){}},url=>node.open(url));
  manager.subscribe(()=>{void manager.list().then(items=>statuses.push(...items.map(i=>i.status)));});
  try {
    const p=await manager.add(node.baseUrl);await manager.login(p.id);await new Promise(r=>setTimeout(r,70));
    assert.ok(!statuses.includes("online"));assert.equal((await manager.list())[0].status,"reconnecting");
  } finally {manager.close();await node.close();}
});


test("client callback rejects issuer mismatch, ambiguity, duplicates and reuse before code exchange", async () => {
  const node=await fakeNode(),device=new DpopClient(node.baseUrl,generateDpopKey());
  try {
    const tokens=await authorizeNode(node.baseUrl,url=>node.open(url,true),device,undefined,"Review laptop");
    assert.equal(tokens.token_type,"DPoP");
    assert.equal(node.requests.filter(r=>r.path==="/oauth/token").length,1);
  } finally {await node.close();}
});


function deferred() {
  let resolve; const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test("failed device-key persistence cannot be bypassed by retrying browser login", async () => {
  const node = await fakeNode(); let failKey = false, saved = [], opened = 0;
  const manager = new NodeConnectionManager({
    async load() { return []; },
    async save(records) {
      if (failKey && records.some(r => r.deviceKeyPem)) throw new Error("Test keychain locked");
      saved = structuredClone(records);
    },
  }, async url => { opened++; await node.open(url); });
  try {
    const p = await manager.add(node.baseUrl); failKey = true;
    await assert.rejects(manager.login(p.id), /keychain locked/);
    await assert.rejects(manager.login(p.id), /keychain locked/);
    assert.equal(opened, 0, "no browser approval with an unsaved device key");
    assert.equal(saved[0].deviceKeyPem, undefined);
    failKey = false; await manager.login(p.id);
    assert.equal(opened, 1); assert.ok(saved[0].deviceKeyPem); assert.ok(saved[0].refreshToken);
  } finally { manager.close(); await node.close(); }
});

test("failed token persistence fences protected requests until a durable retry succeeds", async () => {
  const node = await fakeNode(); let failTokens = true, saved = [];
  const manager = new NodeConnectionManager({
    async load() { return []; },
    async save(records) {
      if (failTokens && records.some(r => r.refreshToken)) throw new Error("Test token storage unavailable");
      saved = structuredClone(records);
    },
  }, url => node.open(url));
  try {
    const p = await manager.add(node.baseUrl);
    await assert.rejects(manager.login(p.id), /storage unavailable/);
    const before = node.requests.length;
    await assert.rejects(manager.submitGoal(p.id, { botId: "bot", prompt: "Do not send until saved" }, "durable-session-request"), /storage unavailable/);
    assert.equal(node.requests.length, before, "no protected traffic while credentials are not durable");
    assert.equal(node.goals.length, 0); assert.equal(saved[0].refreshToken, undefined);
    failTokens = false;
    await manager.submitGoal(p.id, { botId: "bot", prompt: "Do not send until saved" }, "durable-session-request");
    assert.equal(node.goals.length, 1); assert.equal(saved[0].refreshToken, node.tokens.refresh_token);
    assert.equal(node.refreshCount, 0, "persist the received credentials, never blindly rotate again");
  } finally { manager.close(); await node.close(); }
});

test("malformed event nonce is rejected before opening a socket or invoking its callbacks", async () => {
  const node = await fakeNode(); node.setEventNonce("invalid");
  const manager = new NodeConnectionManager({ async load() { return []; }, async save() {} }, url => node.open(url));
  try {
    const p = await manager.add(node.baseUrl);
    await assert.rejects(manager.login(p.id), /event (session|challenge)/i);
    assert.equal(node.socketCount, 0); assert.notEqual((await manager.list())[0].status, "online");
  } finally { manager.close(); await node.close(); }
});

test("a new reconnect does not reuse an obsolete in-flight connection attempt", async () => {
  const node = await fakeNode();
  const manager = new NodeConnectionManager({ async load() { return []; }, async save() {} }, url => node.open(url));
  const started = deferred(), release = deferred();
  try {
    const p = await manager.add(node.baseUrl); await manager.login(p.id);
    await new Promise(r => setTimeout(r, 30));
    const count = node.socketCount;
    node.holdNextIdentity({ started: started.resolve, wait: release.promise });
    const old = manager.resume(p.id); void old.catch(() => {}); await started.promise;
    const current = manager.resume(p.id); void current.catch(() => {});
    release.resolve(); await Promise.allSettled([old, current]);
    for (let n = 0; n < 100 && (await manager.list())[0].status !== "online"; n++) await new Promise(r => setTimeout(r, 10));
    assert.equal((await manager.list())[0].status, "online");
    assert.equal(node.socketCount, count + 1, "only the current attempt creates a replacement socket");
  } finally { release.resolve(); manager.close(); await node.close(); }
});

test("cancelling while a device key is saving allows a fresh login without duplicate browser grants", async () => {
  const node = await fakeNode(), started = deferred(), release = deferred();
  let hold = true, opened = 0;
  const manager = new NodeConnectionManager({
    async load() { return []; },
    async save(records) {
      if (hold && records.some(r => r.deviceKeyPem)) { started.resolve(); await release.promise; }
    },
  }, async url => { opened++; await node.open(url); });
  try {
    const p = await manager.add(node.baseUrl);
    const first = manager.login(p.id); const cancelled = assert.rejects(first, /cancelled/);
    await started.promise; await manager.cancelLogin(p.id);
    const second = manager.login(p.id); void second.catch(() => {});
    hold = false; release.resolve();
    await cancelled; await second;
    assert.equal(opened, 1);
    assert.equal(node.requests.filter(r => r.path === "/oauth/token").length, 1);
    assert.equal(node.requests.filter(r => r.path === "/oauth/revoke").length, 0);
  } finally { release.resolve(); manager.close(); await node.close(); }
});

test("concurrent protected requests wait for one durable credential retry", async () => {
  const node = await fakeNode(), started = deferred(), release = deferred();
  let failure = true, heldWrites = 0;
  const manager = new NodeConnectionManager({
    async load() { return []; },
    async save(records) {
      if (!records.some(r => r.refreshToken)) return;
      if (failure) throw new Error("Test credential write failure");
      heldWrites++; started.resolve(); await release.promise;
    },
  }, url => node.open(url));
  try {
    const p = await manager.add(node.baseUrl);
    await assert.rejects(manager.login(p.id), /write failure/); failure = false;
    const send = () => manager.submitGoal(p.id, { botId: "bot", prompt: "One durable task" }, "same-task-key");
    const first = send(), second = send(); void first.catch(() => {}); void second.catch(() => {});
    await started.promise; await new Promise(r => setTimeout(r, 20));
    assert.equal(heldWrites, 1); assert.equal(node.goals.length, 0);
    release.resolve(); await Promise.all([first, second]);
    assert.equal(heldWrites, 1); assert.equal(node.goals.length, 1);
    assert.equal(node.requests.filter(r => r.path === "/oauth/token").length, 1);
  } finally { release.resolve(); manager.close(); await node.close(); }
});

test("local cancellation closes its callback listener even while browser launch is pending", async () => {
  const node = await fakeNode(), launched = deferred(), finishLaunch = deferred(), abort = new AbortController();
  let callback;
  const authorization = authorizeNode(node.baseUrl, async url => {
    callback = new URL(url).searchParams.get("redirect_uri"); launched.resolve(); await finishLaunch.promise;
  }, new DpopClient(node.baseUrl, generateDpopKey()), abort.signal);
  const result = authorization.then(() => "unexpected success", error => error.message);
  try {
    await launched.promise; abort.abort();
    const state = await Promise.race([result, new Promise(r => setTimeout(() => r("still waiting for browser launch"), 150))]);
    assert.match(state, /cancelled/);
    await assert.rejects(fetch(callback), /fetch failed/);
    assert.equal(node.requests.filter(r => r.path === "/oauth/token").length, 0);
  } finally { finishLaunch.resolve(); await result; await node.close(); }
});
