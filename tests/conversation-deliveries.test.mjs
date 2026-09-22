import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadContinuityRuntime } from "./helpers/load-continuity-runtime.mjs";

async function setup(t) {
  const r = await loadContinuityRuntime(t), dbPath = path.join(r.directory, "agent", "agent.db");
  return { ...r, dbPath, ledger: new r.ConversationDeliveries(), journal: path.join(path.dirname(dbPath), "conversation-deliveries.v1.json") };
}

test("queued and running obligations survive restart without invoking or replaying work", async t => {
  const h = await setup(t);
  h.ledger.queue(h.dbPath, "queued"); h.ledger.route(h.dbPath, "running", ["a", "b"]);
  h.ledger.settle(h.dbPath, "running", "a", "processing");
  const reopened = new h.ConversationDeliveries();
  const recovery = reopened.recover(h.dbPath);
  assert.equal(recovery.length, 2); assert.ok(recovery.every(entry => entry.state === "needs-review"));
  assert.equal(recovery.find(r => r.id === "running").recipients.a, "needs-review");
  assert.equal(recovery.find(r => r.id === "running").recipients.b, "needs-review");
  // Only the notice writer can mark recovery shown; a crash before it can retry.
  assert.equal(new h.ConversationDeliveries().recover(h.dbPath).length, 2);
  for (const entry of recovery) reopened.markRecoveryNotified(h.dbPath, entry.id);
  assert.equal(new h.ConversationDeliveries().recover(h.dbPath).length, 0);
});

test("completed work is not redelivered and active-process messages are not orphaned", async t => {
  const h = await setup(t);
  h.ledger.route(h.dbPath, "done", ["a"]); h.ledger.settle(h.dbPath, "done", "a", "replied");
  h.ledger.queue(h.dbPath, "current"); assert.deepEqual(h.ledger.recover(h.dbPath), []);
  assert.deepEqual(new h.ConversationDeliveries().recover(h.dbPath).map(r => r.id), ["current"]);
});

test("per-recipient progress cannot be settled by another Bot", async t => {
  const h = await setup(t);
  h.ledger.route(h.dbPath, "m", ["a", "b"]);
  assert.throws(() => h.ledger.settle(h.dbPath, "m", "outside", "replied"), /does not own/);
  h.ledger.settle(h.dbPath, "m", "a", "replied"); assert.equal(h.ledger.list(h.dbPath)[0].state, "queued");
  h.ledger.settle(h.dbPath, "m", "b", "failed"); assert.equal(h.ledger.list(h.dbPath)[0].state, "failed");
  assert.equal(h.ledger.list(h.dbPath)[0].recipients.a, "replied");
});

test("copies returned to callers cannot mutate persisted delivery facts", async t => {
  const h = await setup(t), entry = h.ledger.route(h.dbPath, "m", ["a"]);
  entry.recipients.a = "replied"; h.ledger.list(h.dbPath)[0].state = "failed";
  assert.equal(h.ledger.list(h.dbPath)[0].state, "queued");
  assert.equal(new h.ConversationDeliveries().list(h.dbPath)[0].recipients.a, "queued");
});

test("corrupt recovery metadata fails closed and is not overwritten", async t => {
  const h = await setup(t); mkdirSync(path.dirname(h.dbPath), { recursive: true });
  writeFileSync(h.journal, '{"version":100,"records":[]}');
  assert.throws(() => h.ledger.queue(h.dbPath, "new"), /invalid/);
  assert.equal(readFileSync(h.journal, "utf8"), '{"version":100,"records":[]}');
});

test("delivery files use private permissions and leave no temporary partial records", async t => {
  const h = await setup(t); h.ledger.route(h.dbPath, "m", ["a"]); h.ledger.settle(h.dbPath, "m", "a", "processing");
  assert.deepEqual(readdirSync(path.dirname(h.dbPath)), ["conversation-deliveries.v1.json"]);
  const { statSync } = await import("node:fs");
  assert.equal(statSync(h.journal).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(h.journal, "utf8")).records[0].state, "processing");
});

test("same message IDs in different conversations retain independent ownership", async t => {
  const h = await setup(t), second = path.join(h.directory, "other", "agent.db");
  h.ledger.route(h.dbPath, "m", ["a"]); h.ledger.route(second, "m", ["b"]);
  h.ledger.settle(second, "m", "b", "replied");
  assert.equal(h.ledger.list(h.dbPath)[0].state, "queued"); assert.equal(h.ledger.list(second)[0].state, "replied");
});

test("stopping pending work never claims already-started external effects were cancelled", async t => {
  const h = await setup(t); h.ledger.route(h.dbPath, "m", ["a", "b"]); h.ledger.settle(h.dbPath, "m", "a", "processing");
  const [record] = h.ledger.pause(h.dbPath);
  assert.equal(record.state, "needs-review"); assert.equal(record.recipients.a, "needs-review"); assert.equal(record.recipients.b, "cancelled");
});
