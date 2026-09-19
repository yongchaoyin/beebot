// Runs the packaged server with temporary data and a local HTTP model fixture.
// No real model credentials, existing accounts, or public ports are used.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const entry = process.argv[2] ?? fileURLToPath(new URL("../.build/node/node/main.mjs", import.meta.url));
const dataDir = await mkdtemp(path.join(os.tmpdir(), "beebot-packaged-smoke-"));
const hash = value => createHash("sha256").update(value).digest("hex");
let modelCalls = 0;
let controller;
let controllerExit;
let output = "";
const model = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  assert.equal(req.headers.authorization, "Bearer fixture-only");
  assert.equal(input.model, "container-fixture");
  assert.ok(input.tools.some(tool => tool.function.name === "Shell"));
  const index = modelCalls++;
  const action = [
    { name: "Shell", arguments: JSON.stringify({ command: "uname -s > smoke-platform.txt", working_directory: "/workspace", block_until_ms: 1000 }) },
    { name: "SendMessage", arguments: JSON.stringify({ type: "text", content: "Packaged server completed its real shell task." }) },
  ][index];
  res.writeHead(200, { "content-type": "text/event-stream" });
  const envelope = { id: `fixture-${index}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "container-fixture" };
  res.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta: { role: "assistant", ...(action ? { tool_calls: [{ index: 0, id: `call-${index}`, type: "function", function: action }] } : { content: "" }) }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta: {}, finish_reason: action ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`);
  res.end("data: [DONE]\n\n");
});
await new Promise((resolve, reject) => { model.once("error", reject); model.listen(0, "127.0.0.1", resolve); });
const probe = createServer();
await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const password = "isolated-container-smoke-passphrase";
async function waitFor(check, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (controller?.exitCode !== null && controller?.exitCode !== undefined) throw new Error(`Packaged server exited: ${output.slice(-2000)}`);
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error("Packaged server smoke timed out");
}
async function start() {
  output = "";
  controller = spawn(process.execPath, [entry, "start", "--data-dir", dataDir], { env: { PATH: process.env.PATH, HOME: process.env.HOME, CUSTOM_API_KEY: "fixture-only" }, stdio: ["ignore", "pipe", "pipe"] });
  controllerExit = new Promise((resolve, reject) => { controller.once("exit", resolve); controller.once("error", reject); });
  controller.stdout.on("data", chunk => { output += chunk; });
  controller.stderr.on("data", chunk => { output += chunk; });
  await waitFor(async () => { try { return (await fetch(`${origin}/health`)).ok; } catch { return false; } });
}
async function stop() {
  if (!controller || controller.exitCode !== null || controller.signalCode !== null) return;
  controller.kill("SIGTERM");
  const timer = setTimeout(() => controller.kill("SIGKILL"), 15_000);
  try { await controllerExit; } finally { clearTimeout(timer); }
}
async function form(url) {
  const response = await fetch(url);
  const page = await response.text();
  assert.equal(response.status, 200, page);
  return { flow_id: /name="flow_id" value="([^"]+)"/.exec(page)[1], csrf: /name="csrf" value="([^"]+)"/.exec(page)[1], cookie: response.headers.get("set-cookie").split(";")[0] };
}
async function postForm(route, fields, cookie) {
  return fetch(`${origin}${route}`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { Origin: origin, Cookie: cookie } : {}) }, body: new URLSearchParams(fields) });
}
try {
  await promisify(execFile)(process.execPath, [entry, "init", "--data-dir", dataDir]);
  const configFile = path.join(dataDir, "node.json");
  const config = JSON.parse(await readFile(configFile, "utf8"));
  Object.assign(config, { port, publicUrl: origin, model: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, modelId: "container-fixture", apiKeyEnv: "CUSTOM_API_KEY" } });
  await writeFile(configFile, JSON.stringify(config));
  await start();
  const setupUrl = await waitFor(() => /http:\/\/127\.0\.0\.1:\d+\/setup\?code=\S+/.exec(output)?.[0]);
  const setup = await form(setupUrl);
  assert.equal((await postForm("/setup", { flow_id: setup.flow_id, csrf: setup.csrf, username: "owner", password }, setup.cookie)).status, 200);
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const redirect = "http://127.0.0.1:54321/oauth/callback";
  const query = new URLSearchParams({ client_id: "beebot-desktop", response_type: "code", scope: "owner:node", state, redirect_uri: redirect, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", device_name: "Packaged smoke" });
  const authorization = await form(`${origin}/oauth/authorize?${query}`);
  const consent = await postForm("/oauth/authorize", { flow_id: authorization.flow_id, csrf: authorization.csrf, username: "owner", password, decision: "allow" }, authorization.cookie);
  assert.equal(consent.status, 303);
  const callback = new URL(consent.headers.get("location"));
  assert.equal(callback.searchParams.get("state"), state);
  const exchange = await postForm("/oauth/token", { client_id: "beebot-desktop", grant_type: "authorization_code", code: callback.searchParams.get("code"), code_verifier: verifier, redirect_uri: redirect });
  assert.equal(exchange.status, 200);
  const credentials = await exchange.json();
  const api = async (route, body, key) => {
    const response = await fetch(`${origin}${route}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${credentials.access_token}`, "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    assert.ok(response.ok, JSON.stringify(value));
    return value;
  };
  assert.equal((await fetch(`${origin}/v1/snapshot`)).status, 401);
  const created = await api("/v1/bots", { name: "Packaged Linux worker", description: "Use your own workspace" }, "smoke-create");
  const submitted = await api("/v1/goals", { botId: created.bot.id, prompt: "Write the platform name to a file and report completion" }, "smoke-submit");
  const detail = await waitFor(async () => { const value = await api(`/v1/goals/${submitted.goalId}`); return ["review", "failed", "uncertain"].includes(value.goal.status) ? value : undefined; });
  assert.equal(detail.goal.status, "review", detail.goal.error);
  assert.match(detail.goal.result, /real shell task/);
  assert.equal((await readFile(path.join(dataDir, "runtime-bots", hash(created.bot.id), "host/box-workspace/smoke-platform.txt"), "utf8")).trim(), os.type());
  await api(`/v1/goals/${submitted.goalId}/accept`, { expectedVersion: detail.goal.version }, "smoke-accept");
  await stop();
  await start();
  const snapshot = await api("/v1/snapshot");
  assert.equal(snapshot.node.id, config.nodeId);
  assert.equal(snapshot.bots[0].id, created.bot.id);
  assert.equal(snapshot.goals[0].status, "succeeded");
  console.log(JSON.stringify({ platform: process.platform, architecture: process.arch, uid: process.getuid?.(), packagedCli: true, authentication: "PKCE", realHostShell: true, realHttpAdapter: true, persistentRestart: true, model: "local test fixture" }));
} finally {
  await stop();
  model.closeAllConnections();
  await new Promise(resolve => model.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}
