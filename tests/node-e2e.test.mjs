import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import WebSocket from "ws";

const integration = { skip: process.env.BEEBOT_RUNTIME_INTEGRATION !== "1", timeout: 90_000 };
const repo = fileURLToPath(new URL("..", import.meta.url));

test("Mac transport → PKCE → server → real Host → disconnected completion → replay → acceptance → restart", integration, async () => {
  // Only test directories and a deterministic model are used; the Host/tools are real.
  const temporary = await mkdtemp(path.join(os.tmpdir(), "beebot-node-e2e-"));
  const modulePath = path.join(temporary, "system.mjs");
  await build({ stdin: { contents: 'export { BeeBotServer } from "./source/node/server.ts"; export { HostRuntime } from "./source/node/runtime.ts"; export { NodeConnectionManager } from "./source/client-connections/manager.ts"; export { authorizeNode, DpopClient } from "./source/client-connections/transport.ts"; export { generateDpopKey } from "./source/shared/security/dpop.ts";', resolveDir: repo }, outfile: modulePath, bundle: true, platform: "node", format: "esm", target: "node26", banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
  const { BeeBotServer, HostRuntime, NodeConnectionManager, authorizeNode, DpopClient, generateDpopKey } = await import(pathToFileURL(modulePath));
  const portProbe = createServer(); await new Promise(resolve => portProbe.listen(0, "127.0.0.1", resolve));
  const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const config = { version: 1, nodeId: randomUUID(), name: "Integration Node", bindHost: "127.0.0.1", port, publicUrl: origin, maxConcurrentRuns: 2 };
  const dataDir = path.join(temporary, "data");
  const options = { config, dataDir };
  const runtime = () => new HostRuntime({ dataDir, hostEntry: path.join(repo, ".build/node/dist/host/host-main.cjs"), env: { SAND_AGENT_MOCK_RESPONSE: JSON.stringify({ toolCalls: [
    { toolName: "Shell", args: { command: "sleep 1; printf 'server-owned-work' > end-to-end.txt", working_directory: "/workspace", block_until_ms: 2000 } },
    { toolName: "SendMessage", args: { type: "text", content: "The server completed the work while the client was away." } },
  ] }) } });
  let server = new BeeBotServer({ ...options, runtime: runtime() });
  let saved = [];
  const persistence = { async load() { return structuredClone(saved); }, async save(value) { saved = structuredClone(value); } };
  const form = async url => {
    const response = await fetch(url, { redirect: "manual" }); const page = await response.text(); assert.equal(response.status, 200, page);
    return { flow_id: /name="flow_id" value="([^"]+)"/.exec(page)[1], csrf: /name="csrf" value="([^"]+)"/.exec(page)[1], cookie: response.headers.get("set-cookie").split(";")[0] };
  };
  const postForm = async (url, fields, cookie) => fetch(url, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, Cookie: cookie }, body: new URLSearchParams(fields) });
  const password = "integration-only owner passphrase";
  let firstRecoveryCode, profile;
  const openExternal = async url => {
    const browser = await form(url);
    let response = await postForm(new URL("/oauth/authorize", origin), { flow_id: browser.flow_id, csrf: browser.csrf, username: "owner", password, decision: "allow",
      ...(firstRecoveryCode ? { recovery_code: firstRecoveryCode, confirm_recovery: "yes" } : {}) }, browser.cookie);
    firstRecoveryCode = undefined;
    if (response.status === 200) {
      const page = await response.text();
      const requestId = /name="request_id" value="([^"]+)"/.exec(page)?.[1];
      assert.ok(requestId, "Additional event device must request independent approval");
      await client.decideDevice(profile.id, requestId, 1, new URL(url).searchParams.get("dpop_jkt"), { role: "admin", botIds: "*" });
      response = await postForm(`${origin}/oauth/device-approval`, { request_id: requestId, csrf: browser.csrf, decision: "check" }, browser.cookie);
    }
    assert.equal(response.status, 303, await response.text());
    const callback = await fetch(response.headers.get("location")); assert.equal(callback.status, 200);
  };
  let client = new NodeConnectionManager(persistence, openExternal);
  let replay;
  try {
    await server.listen();
    const setup = await form(`${origin}/setup?code=${server.auth.getSetupInfo().code}`);
    const initialized = await postForm(`${origin}/setup`, { flow_id: setup.flow_id, csrf: setup.csrf, username: "owner", password }, setup.cookie);
    assert.equal(initialized.status, 200);
    firstRecoveryCode = /data-recovery-code>([^<]+)</.exec(await initialized.text())?.[1];
    assert.ok(firstRecoveryCode, "First device requires explicit one-time recovery material");
    assert.equal((await fetch(`${origin}/v1/snapshot`)).status, 401);
    profile = await client.add(origin); await client.login(profile.id);
    const eventDevice = new DpopClient(origin, generateDpopKey());
    const eventTokens = await authorizeNode(origin, openExternal, eventDevice);
    const eventHeaders = { "Content-Type": "application/json" };
    const eventCursor = server.store.cursor;
    const created = await client.createBot(profile.id, { name: "Independent writer", description: "Write in your own workspace" }, "create-e2e-bot");
    const command = await client.submitGoal(profile.id, { botId: created.bot.id, prompt: "Create a file in your workspace and report the result" }, "submit-e2e-goal");
    client.close();
    for (let i = 0; i < 600 && !["review", "failed", "uncertain"].includes(server.store.goal(command.goalId).status); i++) await delay(50);
    assert.equal(server.store.goal(command.goalId).status, "review", server.store.goal(command.goalId).error);
    const { ticket, nonce } = await eventDevice.request("/v1/events/ticket", { method: "POST", headers: eventHeaders, body: "{}" }, eventTokens.access_token);
    replay = new WebSocket(`${origin.replace("http:", "ws:")}/v1/events`);
    const replayed = [];
    const replayReady = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Event replay timed out")), 5000);
      replay.on("message", raw => { const event = JSON.parse(raw); replayed.push(event); if (event.type === "ready") { clearTimeout(timeout); resolve(); } });
      replay.on("error", reject);
      replay.on("open", () => replay.send(JSON.stringify({ ticket, proof: eventDevice.eventProof(ticket, nonce), after: eventCursor })));
    });
    await replayReady;
    assert.ok(replayed.some(event => event.data?.goal?.id === command.goalId && event.data.goal.status === "review"));
    const seqs = replayed.filter(event => event.seq).map(event => event.seq);
    assert.deepEqual([...seqs].sort((a, b) => a - b), seqs);
    const revoked = new Promise(resolve => replay.once("close", code => resolve(code)));
    await eventDevice.request("/oauth/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: "beebot-desktop", token: eventTokens.refresh_token }) });
    server.store.createBot(created.bot.ownerId, "event-revocation-check", { name: "Event check", description: "" });
    assert.equal(await revoked, 4401); replay = undefined;
    client = new NodeConnectionManager(persistence, openExternal);
    await client.resume(profile.id);
    const snapshot = await client.snapshot(profile.id); assert.equal(snapshot.goals[0].status, "review");
    const detail = await client.goal(profile.id, command.goalId); assert.match(detail.goal.result, /while the client was away/);
    assert.ok(detail.transcript.some(entry => entry.role === "assistant" && entry.text));
    assert.deepEqual(await client.submitGoal(profile.id, { botId: created.bot.id, prompt: "Create a file in your workspace and report the result" }, "submit-e2e-goal"), command);
    await assert.rejects(client.accept(profile.id, command.goalId, 1, "accept-e2e-stale"));
    await client.accept(profile.id, command.goalId, detail.goal.version, "accept-e2e-result");
    client.close(); await server.close();
    server = new BeeBotServer({ ...options, runtime: runtime() }); await server.listen();
    client = new NodeConnectionManager(persistence, openExternal); await client.resume(profile.id);
    const restored = await client.snapshot(profile.id);
    assert.equal(restored.node.id, config.nodeId); assert.equal(restored.bots[0].id, created.bot.id); assert.equal(restored.goals[0].status, "succeeded");
    await client.logout(profile.id); assert.equal((await client.list())[0].status, "signed-out");
  } finally { replay?.terminate(); client.close(); await server.close(); await rm(temporary, { recursive: true, force: true }); }
});
