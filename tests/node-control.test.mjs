import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const temporary = await mkdtemp(path.join(os.tmpdir(), "beebot-control-tests-"));
for (const file of ["control-store", "control-service", "config"]) await build({ entryPoints: [fileURLToPath(new URL(`../source/node/${file}.ts`, import.meta.url))], outfile: path.join(temporary, `${file}.mjs`), bundle: true, format: "esm", platform: "node", target: "node26" });
const { ControlStore } = await import(pathToFileURL(path.join(temporary, "control-store.mjs")));
const { ControlService } = await import(pathToFileURL(path.join(temporary, "control-service.mjs")));
const { validateConfig } = await import(pathToFileURL(path.join(temporary, "config.mjs")));
test.after(() => rm(temporary, { recursive: true, force: true }));
const fixture = async t => {
  const data = await mkdtemp(path.join(temporary, "store-"));
  const store = new ControlStore(data); t.after(() => store.close()); return { store, data };
};
const waitFor = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(5); } assert.fail("condition timed out"); };

test("accepted commands are durable and idempotent, conflicts and owners are enforced", async t => {
  const { store } = await fixture(t);
  const input = { name: "Writer", description: "Writes" };
  const first = store.createBot("owner", "create-key", input);
  const cursor = store.cursor;
  assert.deepEqual(store.createBot("owner", "create-key", { description: "Writes", name: "Writer" }), first);
  assert.equal(store.cursor, cursor);
  assert.throws(() => store.createBot("owner", "create-key", { ...input, name: "Other" }), { status: 409 });
  assert.throws(() => store.submitGoal("intruder", "goal-key-1", { botId: first.bot.id, prompt: "Hi" }), { status: 404 });
  const command = store.submitGoal("owner", "goal-key-1", { botId: first.bot.id, prompt: "Hi" });
  assert.deepEqual(store.submitGoal("owner", "goal-key-1", { botId: first.bot.id, prompt: "Hi" }), command);
  const goal = store.goal(command.goalId); const task = store.task(goal.taskId);
  assert.equal(task.goalId, goal.id); assert.equal(task.currentRunId, null);
  assert.throws(() => store.goal(goal.id, "intruder"), { status: 404 });
  assert.equal(store.events(0).length, 2);
});

test("Bot avatar choices survive restart and command replay without changing legacy Bots", async t => {
  const data = await mkdtemp(path.join(temporary, "avatars-"));
  let store = new ControlStore(data); t.after(() => store.close());
  const input = { name: "Designer", description: "Designs", avatarColor: "violet", avatarShape: "hex" };
  const created = store.createBot("owner", "avatar-key", input);
  const legacy = store.createBot("owner", "legacy-key", { name: "Original", description: "" }).bot;
  store.close(); store = new ControlStore(data);
  assert.deepEqual(store.bot(created.bot.id), created.bot);
  assert.deepEqual(store.bots("owner"), [created.bot, legacy]);
  assert.deepEqual(store.events(0)[0].data.bot, created.bot);
  const cursor = store.cursor;
  assert.deepEqual(store.createBot("owner", "avatar-key", input), created);
  assert.equal(store.cursor, cursor);
  assert.throws(() => store.createBot("owner", "avatar-key", { ...input, avatarColor: "green" }), { status: 409 });
  assert.equal(Object.hasOwn(store.bot(legacy.id), "avatarColor"), false);
  assert.equal(Object.hasOwn(store.bot(legacy.id), "avatarShape"), false);
});

test("review needs a matching version, preserves transcript, and acceptance is idempotent", async t => {
  const { store } = await fixture(t);
  const { bot } = store.createBot("owner", "bot-key-1", { name: "One", description: "" });
  const { goalId } = store.submitGoal("owner", "goal-key-1", { botId: bot.id, prompt: "Work" });
  const { run } = store.start(goalId);
  store.finish(goalId, "stale-attempt", "review", { result: "Wrong" }); assert.equal(store.goal(goalId).status, "running");
  store.finish(goalId, run.id, "review", { result: "Done", transcript: [{ role: "assistant", text: "Done" }] });
  const review = store.goal(goalId); assert.equal(review.status, "review");
  assert.throws(() => store.accept("owner", "accept-key", goalId, review.version - 1), { status: 409 });
  const accepted = store.accept("owner", "accept-key", goalId, review.version);
  assert.equal(accepted.goal.status, "succeeded");
  assert.deepEqual(store.accept("owner", "accept-key", goalId, review.version), accepted);
  assert.equal(store.transcript(goalId)[0].text, "Done");
});

test("restart preserves queued work, fences interrupted work and prevents a second controller", async t => {
  const data = await mkdtemp(path.join(temporary, "restart-"));
  let store = new ControlStore(data);
  assert.throws(() => new ControlStore(data), /active BeeBot server/);
  const { bot } = store.createBot("owner", "bot-key-1", { name: "One", description: "" });
  const first = store.submitGoal("owner", "goal-key-1", { botId: bot.id, prompt: "Work" });
  const second = store.submitGoal("owner", "goal-key-2", { botId: bot.id, prompt: "More" });
  store.start(first.goalId); store.close(); store = new ControlStore(data); t.after(() => store.close());
  store.recoverInterrupted();
  assert.equal(store.goal(first.goalId).status, "uncertain");
  assert.equal(store.goal(second.goalId).status, "queued");
  assert.equal(store.start(second.goalId), undefined);
  assert.throws(() => store.submitGoal("owner", "goal-key-3", { botId: bot.id, prompt: "Retry" }), { code: "bot_fenced" });
});

test("scheduler serializes each Bot, runs separate Bots concurrently, and runs without a client", async t => {
  const { store } = await fixture(t);
  const a = store.createBot("owner", "bot-key-a", { name: "A", description: "" }).bot;
  const b = store.createBot("owner", "bot-key-b", { name: "B", description: "" }).bot;
  const pending = [];
  const runtime = { execute(input) { return new Promise(resolve => pending.push({ input, resolve })); }, async close() {} };
  const service = new ControlService(store, runtime, 2); t.after(() => service.close());
  const a1 = store.submitGoal("owner", "goal-a-1", { botId: a.id, prompt: "A1" });
  const a2 = store.submitGoal("owner", "goal-a-2", { botId: a.id, prompt: "A2" });
  const b1 = store.submitGoal("owner", "goal-b-1", { botId: b.id, prompt: "B1" });
  await waitFor(() => pending.length === 2);
  assert.deepEqual(pending.map(item => item.input.prompt), ["A1", "B1"]);
  pending[0].resolve({ text: "A1 result", transcript: [] }); pending[1].resolve({ text: "B1 result", transcript: [] });
  await waitFor(() => pending.length === 3);
  assert.equal(pending[2].input.prompt, "A2"); pending[2].resolve({ text: "A2 result", transcript: [] });
  await waitFor(() => [a1, a2, b1].every(item => store.goal(item.goalId).status === "review"));
});

test("queued cancellation is final; running cancellation waits for stop and stays uncertain", async t => {
  const { store } = await fixture(t);
  const { bot } = store.createBot("owner", "bot-key-1", { name: "A", description: "" });
  let stop;
  const runtime = { execute(_input, signal) { return new Promise((_resolve, reject) => { signal.addEventListener("abort", () => { stop = () => reject(Object.assign(new Error("Stopped; effects unknown"), { code: "cancelled" })); }); }); }, async close() { stop?.(); } };
  const service = new ControlService(store, runtime, 1); t.after(() => service.close());
  const first = store.submitGoal("owner", "goal-key-1", { botId: bot.id, prompt: "Work" });
  const queued = store.submitGoal("owner", "goal-key-2", { botId: bot.id, prompt: "Work later" });
  await waitFor(() => store.goal(first.goalId).status === "running");
  assert.equal(store.cancel("owner", "cancel-key-2", queued.goalId).goal.status, "cancelled");
  assert.equal(store.cancel("owner", "cancel-key-1", first.goalId).goal.status, "cancelling");
  await waitFor(() => stop); assert.equal(store.goal(first.goalId).status, "cancelling");
  stop(); await waitFor(() => store.goal(first.goalId).status === "uncertain");
});

test("remote config requires HTTPS while loopback remains simple", () => {
  const config = { version: 1, nodeId: "72f5ebd7-3bfc-4f90-9b44-a35b3c64c9bf", name: "Test", port: 7331, publicUrl: "http://127.0.0.1:7331" };
  assert.equal(validateConfig(config).bindHost, "127.0.0.1");
  assert.throws(() => validateConfig({ ...config, publicUrl: "http://example.com" }), /HTTPS/);
  assert.throws(() => validateConfig({ ...config, bindHost: "0.0.0.0" }), /loopback/);
  assert.throws(() => validateConfig({ ...config, publicUrl: "https://bot.example.com", bindHost: "0.0.0.0" }), /Without TLS/);
  assert.equal(validateConfig({ ...config, publicUrl: "https://bot.example.com", bindHost: "0.0.0.0", tlsTermination: "trusted-proxy" }).publicUrl, "https://bot.example.com");
});

test("explicit inspection preserves Bot identity, closes the uncertain attempt, and never replays it", async t => {
  const { store } = await fixture(t);
  const { bot } = store.createBot("owner", "bot-key-1", { name: "Persistent", description: "" });
  const interrupted = store.submitGoal("owner", "goal-key-1", { botId: bot.id, prompt: "Old attempt" });
  const { run } = store.start(interrupted.goalId);
  store.recoverInterrupted();
  let reconciliations = 0;
  const runtime = { execute() { assert.fail("Reconciliation must not execute the old prompt"); }, async reconcile(actual, runId) { assert.equal(actual.id, bot.id); assert.equal(runId, run.id); reconciliations++; }, async close() {} };
  const service = new ControlService(store, runtime, 1); t.after(() => service.close());
  const version = store.goal(interrupted.goalId).version;
  await assert.rejects(service.reconcile("owner", "inspect-1", interrupted.goalId, version - 1, "Checked all external effects"), { status: 409 });
  assert.equal(reconciliations, 0);
  const result = await service.reconcile("owner", "inspect-1", interrupted.goalId, version, "Checked all external effects");
  assert.equal(result.goal.status, "failed"); assert.equal(result.goal.botId, bot.id);
  assert.deepEqual(await service.reconcile("owner", "inspect-1", interrupted.goalId, version, "Checked all external effects"), result);
  assert.equal(reconciliations, 1);
  await service.close();
  const continuation = store.submitGoal("owner", "goal-key-2", { botId: bot.id, prompt: "New work after inspection" });
  assert.equal(store.goal(continuation.goalId).status, "queued");
  assert.equal(store.run(run.id).status, "uncertain", "the original attempt remains an uncertain historical fact");
});

test("execution starts only after controller activation, and a ledger write failure stops dispatch", async t => {
  const { store } = await fixture(t);
  const { bot } = store.createBot("owner", "bot-key-1", { name: "One", description: "" });
  const { goalId } = store.submitGoal("owner", "goal-key-1", { botId: bot.id, prompt: "Do work" });
  let closed = false;
  const runtime = { execute() { assert.fail("No execution is allowed when durable dispatch fails"); }, async close() { closed = true; } };
  const service = new ControlService(store, runtime, 1, false); t.after(() => service.close());
  await delay(5); assert.equal(store.goal(goalId).status, "queued");
  store.start = () => { throw new Error("simulated disk write failure"); };
  const log = console.error;
  try {
    console.error = () => {};
    service.start(); await waitFor(() => service.failure);
  } finally { console.error = log; }
  assert.match(service.failure.message, /disk write failure/); assert.equal(closed, true);
  assert.equal(store.goal(goalId).status, "queued");
});
