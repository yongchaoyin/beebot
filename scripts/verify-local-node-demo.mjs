import { testDevice } from "./lib/node-device-fixture.mjs";
// Creates test owners and verifies ONLY the two containers in node-local-demo-compose.yml.
// Keeps their data for the Mac client. Passwords stay in an ignored, mode-0600 file.
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, chmod, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const repo = fileURLToPath(new URL("..", import.meta.url));
const directory = path.join(repo, ".build/local-docker-demo");
const accessFile = path.join(directory, "access.json");
const docker = async (...args) => (await promisify(execFile)("docker", args, { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 })).stdout;
const hash = value => createHash("sha256").update(value).digest("hex");
const nodes = [
  { id: "a", container: "beebot-demo-a", baseUrl: "http://127.0.0.1:17431", name: "BeeBot Docker A" },
  { id: "b", container: "beebot-demo-b", baseUrl: "http://127.0.0.1:17432", name: "BeeBot Docker B" },
];
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
let saved;
try { saved = JSON.parse(await readFile(accessFile, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; saved = { version: 1, nodes: {} }; }
assert.equal(saved.version, 1);
let persistence = Promise.resolve();
function persist() {
  const data = `${JSON.stringify(saved, null, 2)}\n`;
  persistence = persistence.then(async () => {
    const staging = `${accessFile}.tmp`;
    await writeFile(staging, data, { mode: 0o600 });
    await chmod(staging, 0o600);
    await rename(staging, accessFile);
  });
  return persistence;
}
async function waitFor(check, label, timeout = 90_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await check(); if (result) return result; await delay(250); }
  throw new Error(`Timed out: ${label}`);
}
async function healthy(node) {
  try { return (await fetch(`${node.baseUrl}/health`, { signal: AbortSignal.timeout(1500) })).ok; }
  catch { return false; }
}
async function form(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const text = await response.text();
  assert.equal(response.status, 200, `Form returned ${response.status}`);
  const flow_id = /name="flow_id" value="([^"]+)"/.exec(text)?.[1];
  const csrf = /name="csrf" value="([^"]+)"/.exec(text)?.[1];
  assert.ok(flow_id && csrf);
  return { flow_id, csrf, cookie: response.headers.get("set-cookie").split(";")[0] };
}
async function post(node, route, fields, cookie) {
  return (route.startsWith("/oauth/") && route !== "/oauth/authorize" ? node.device.request : fetch)(`${node.baseUrl}${route}`, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { Origin: node.baseUrl, Cookie: cookie } : {}) }, body: new URLSearchParams(fields) });
}
async function login(node) {
  node.device ??= testDevice();
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(24).toString("base64url");
  const redirect_uri = "http://127.0.0.1:54321/oauth/callback";
  const query = new URLSearchParams({ client_id: "beebot-desktop", response_type: "code", scope: "owner:node", state, redirect_uri, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", device_name: "Local Docker verification", dpop_jkt: node.device.jkt });
  const flow = await form(`${node.baseUrl}/oauth/authorize?${query}`);
  const credentials = saved.nodes[node.id];
  const response = await post(node, "/oauth/authorize", { flow_id: flow.flow_id, csrf: flow.csrf, username: credentials.username, password: credentials.password, decision: "allow" }, flow.cookie);
  assert.equal(response.status, 303, `Authorization failed on ${node.id}`);
  const callback = new URL(response.headers.get("location"));
  assert.equal(callback.searchParams.get("state"), state);
  assert.equal(callback.searchParams.get("iss"), node.baseUrl);
  const tokens = await post(node, "/oauth/token", { client_id: "beebot-desktop", grant_type: "authorization_code", code: callback.searchParams.get("code"), code_verifier: verifier, redirect_uri });
  assert.equal(tokens.status, 200);
  node.tokens = await tokens.json();
}
async function api(node, route, body) {
  const response = await node.device.request(`${node.baseUrl}${route}`, { method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(10_000), headers: { Authorization: `DPoP ${node.tokens.access_token}`, "content-type": "application/json", ...(body === undefined ? {} : { "idempotency-key": randomUUID() }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  assert.ok(response.ok, `${node.id} ${route}: ${JSON.stringify(value)}`);
  return value;
}
async function finishGoal(node, prompt) {
  const command = await api(node, "/v1/goals", { botId: saved.nodes[node.id].botId, prompt });
  const detail = await waitFor(async () => {
    const value = await api(node, `/v1/goals/${command.goalId}`);
    return ["review", "failed", "uncertain"].includes(value.goal.status) ? value : null;
  }, `goal ${node.id}`);
  assert.equal(detail.goal.status, "review", detail.goal.error);
  await api(node, `/v1/goals/${command.goalId}/accept`, { expectedVersion: detail.goal.version });
  saved.nodes[node.id].goalIds = [...(saved.nodes[node.id].goalIds ?? []), command.goalId];
  await persist();
  return command.goalId;
}
async function inspectWorkspace(node, peer) {
  const own = hash(saved.nodes[node.id].botId);
  const other = hash(saved.nodes[peer.id].botId);
  const result = await docker("exec", node.container, "node", "--input-type=module", "-e", `
    import fs from 'node:fs';
    const root='/var/lib/beebot-node/runtime-bots/';
    const workspace=root+${JSON.stringify(own)}+'/host/box-workspace/';
    console.log(JSON.stringify({environment:fs.readFileSync(workspace+'environment.txt','utf8').trim(),platform:fs.readFileSync(workspace+'platform.txt','utf8').trim(),runs:fs.readFileSync(workspace+'runs.txt','utf8').trim().split('\\n').length,peerWorkspace:fs.existsSync(root+${JSON.stringify(other)})}));
  `);
  const value = JSON.parse(result);
  assert.equal(value.environment, `node-${node.id}`);
  assert.equal(value.platform, "Linux");
  assert.equal(value.peerWorkspace, false);
  return value;
}

let aStopped = false;
try {
  for (const node of nodes) {
    const [inspection] = JSON.parse(await docker("inspect", node.container));
    assert.equal(inspection.Config.Labels["com.docker.compose.project"], "beebot-local-demo");
    assert.equal(inspection.Config.User, "node");
    assert.deepEqual(Object.keys(inspection.HostConfig.PortBindings), ["7332/tcp"]);
    assert.equal(inspection.HostConfig.PortBindings["7332/tcp"][0].HostIp, "127.0.0.1");
    node.volume = inspection.Mounts.find(mount => mount.Destination === "/var/lib/beebot-node").Name;
    node.network = Object.keys(inspection.NetworkSettings.Networks)[0];
    const [network] = JSON.parse(await docker("network", "inspect", node.network));
    assert.equal(network.Driver, "bridge");
    assert.equal(network.Internal, false);
    await waitFor(() => healthy(node), `health ${node.id}`);
    const identity = await (await fetch(`${node.baseUrl}/v1/node`)).json();
    assert.equal(identity.name, node.name);
    assert.equal((await fetch(`${node.baseUrl}/v1/snapshot`)).status, 401);
    if (!saved.nodes[node.id]) {
      saved.nodes[node.id] = { ...node, username: `owner-${node.id}`, password: randomBytes(24).toString("base64url"), nodeId: identity.id };
      await persist();
    }
    assert.equal(saved.nodes[node.id].nodeId, identity.id);
    const setupResponse = await fetch(`${node.baseUrl}/setup`);
    if (setupResponse.status !== 409) {
      const logs = await docker("logs", node.container);
      const matches = [...logs.matchAll(/http:\/\/127\.0\.0\.1:\d+\/setup\?code=\S+/g)];
      assert.ok(matches.length, `No setup link for ${node.id}`);
      const setup = await form(matches.at(-1)[0]);
      const credentials = saved.nodes[node.id];
      const result = await post(node, "/setup", { flow_id: setup.flow_id, csrf: setup.csrf, username: credentials.username, password: credentials.password }, setup.cookie);
      assert.equal(result.status, 200, `Owner setup ${node.id}`);
    }
    await login(node);
    if (!saved.nodes[node.id].botId) {
      const result = await api(node, "/v1/bots", { name: `Docker ${node.id.toUpperCase()} 验收 Bot`, description: "本机 Docker 验收模式：执行固定的环境检查，文件保留在本节点的独立工作目录。" });
      saved.nodes[node.id].botId = result.bot.id;
      await persist();
    }
  }
  const [a, b] = nodes;
  assert.notEqual(a.volume, b.volume);
  assert.notEqual(a.network, b.network);
  assert.notEqual(saved.nodes.a.nodeId, saved.nodes.b.nodeId);
  assert.notEqual(saved.nodes.a.botId, saved.nodes.b.botId);
  for (const [node, peer] of [[a, b], [b, a]]) {
    const cross = await node.device.request(`${peer.baseUrl}/v1/snapshot`, { headers: { Authorization: `DPoP ${node.tokens.access_token}` } });
    assert.equal(cross.status, 401, "A token must not authenticate with B");
  }
  await Promise.all(nodes.map(node => finishGoal(node, `验证 Docker ${node.id.toUpperCase()} 环境：在自己的工作目录写入环境标识和 Linux 平台，报告结果。`)));
  const before = await Promise.all(nodes.map((node, index) => inspectWorkspace(node, nodes[1 - index])));
  console.log("Both nodes authenticated independently and completed real Shell tasks.");

  // Fault test is limited to the new demo A container. B must remain useful.
  aStopped = true; // Restore A even if Docker stops it but the CLI acknowledgement is lost.
  await docker("stop", "--time", "20", a.container);
  assert.equal(await healthy(a), false);
  assert.equal(await healthy(b), true);
  await finishGoal(b, "Docker A 已停止：再次验证 Docker B 仍可独立执行环境检查并保留文件。");
  const bAfter = await inspectWorkspace(b, a);
  assert.equal(bAfter.runs, before[1].runs + 1, "One additional B goal must execute Shell exactly once");
  await docker("start", a.container); aStopped = false;
  await waitFor(() => healthy(a), "A after restart");
  const aAfter = await inspectWorkspace(a, b);
  assert.deepEqual(aAfter, before[0]);
  for (const node of nodes) {
    const snapshot = await api(node, "/v1/snapshot");
    assert.equal(snapshot.node.id, saved.nodes[node.id].nodeId);
    assert.ok(snapshot.bots.some(bot => bot.id === saved.nodes[node.id].botId));
    const peer = nodes.find(other => other.id !== node.id);
    assert.ok(!snapshot.bots.some(bot => bot.id === saved.nodes[peer.id].botId));
    for (const goalId of saved.nodes[node.id].goalIds) assert.equal(snapshot.goals.find(goal => goal.id === goalId)?.status, "succeeded");
  }
  const result = { verifiedAt: new Date().toISOString(), model: "local deterministic verification fixture", containerIsolation: true, independentAuthentication: true, crossNodeTokensRejected: true, realShell: true, bContinuesWhenAStops: true, persistentRestart: true, nodes: nodes.map(node => ({ id: node.id, container: node.container, url: node.baseUrl, nodeId: saved.nodes[node.id].nodeId, botId: saved.nodes[node.id].botId, volume: node.volume, network: node.network })) };
  await writeFile(path.join(directory, "verification.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
  console.log(`Test account details saved locally: ${accessFile}`);
} finally {
  if (aStopped) await docker("start", nodes[0].container);
  for (const node of nodes) if (node.tokens?.refresh_token) await post(node, "/oauth/revoke", { client_id: "beebot-desktop", token: node.tokens.refresh_token }).catch(() => {});
}
