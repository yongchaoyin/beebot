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
const { normalizeNodeUrl, authorizeNode } = await load("client-connections/transport");
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
  const tokens = { access_token: "access-private", refresh_token: "refresh-private", expires_in: 600, token_type: "Bearer" };
  let expectedChallenge, nodeId = "test-node", refreshCount = 0, socketCount = 0;
  const goals = [], accepted = new Map(), requests = [];
  const server = createServer(async (req, res) => {
    let body = "";for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, headers: req.headers, body });
    const json = value => { res.setHeader("Content-Type", "application/json");res.end(JSON.stringify(value)); };
    if (req.url === "/v1/node") return json({ id: nodeId, name: "Test Node", protocolVersion: 1 });
    if (req.url === "/oauth/token") {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "authorization_code") assert.equal(createHash("sha256").update(form.get("code_verifier")).digest("base64url"), expectedChallenge);
      else { assert.equal(form.get("refresh_token"), tokens.refresh_token);refreshCount++; }
      return json(tokens);
    }
    if (req.url === "/oauth/revoke") return json({});
    assert.equal(req.headers.authorization, `Bearer ${tokens.access_token}`);
    if (req.url === "/v1/snapshot") return json({ node: { id: nodeId, name: "Test Node" }, bots: [{ id: "bot", name: "Worker" }], goals, cursor: goals.length });
    if (req.url === "/v1/events/ticket") return json({ ticket: "single-use-ticket" });
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
    socketCount++;
    socket.once("message", raw => { assert.equal(JSON.parse(raw).ticket, "single-use-ticket");socket.send(JSON.stringify({ seq: 1, type: "ready", data: {}, at: Date.now() })); });
  });
  return {
    baseUrl, requests, goals, tokens, get refreshCount() { return refreshCount; }, get socketCount() { return socketCount; },
    async open(url) {
      const auth = new URL(url);assert.equal(auth.pathname, "/oauth/authorize");assert.equal(auth.searchParams.get("code_challenge_method"), "S256");expectedChallenge = auth.searchParams.get("code_challenge");
      const callback = new URL(auth.searchParams.get("redirect_uri"));assert.equal(callback.pathname, "/oauth/callback");
      callback.search = new URLSearchParams({ code: "test-code", state: "wrong-state", iss: baseUrl }).toString();
      assert.equal((await fetch(callback)).status, 400);
      callback.searchParams.set("state", auth.searchParams.get("state"));
      assert.equal((await fetch(callback)).status, 200);
    },
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
  const data = [{ profile: { id: "connection", nodeId: "node", name: "Node", baseUrl: "https://node.example", status: "online" }, refreshToken: "TOP_SECRET_REFRESH" }];
  await store.save(data);
  const raw = await readFile(filename, "utf8");assert.ok(!raw.includes("TOP_SECRET_REFRESH"));assert.ok(!raw.includes("accessToken"));
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
