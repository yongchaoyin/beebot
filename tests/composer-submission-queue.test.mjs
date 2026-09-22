import assert from "node:assert/strict";
import test from "node:test";
import { createComposerSubmissionQueue, ComposerSubmissionConflictError, ComposerSubmissionRejectedError } from "../frontend/src/recovered/features/conversation/workspace/submission.ts";
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const message = (nonce, agentId = "room") => ({ nonce, agentId, prompt: nonce, attachments: [], createdAtMs: 1 });
function harness(t, extra = {}) {
  const calls = [], phases = [], gates = [];
  const queue = createComposerSubmissionQueue({ isTransportDown: () => false,
    send: input => { calls.push(input); const gate = deferred(); gates.push(gate); return gate.promise; },
    onPhase: value => phases.push(value), ...extra });
  t.after(() => queue.dispose());
  return { queue, calls, phases, gates };
}
for (const agentId of ["private-bot", "project-group"]) test(`${agentId}: three rapid sends retain FIFO after explicit rejection`, async t => {
  const h = harness(t);
  const a = h.queue.submit(message("a", agentId));
  const b = h.queue.submit(message("b", agentId));
  h.gates[0].reject(new ComposerSubmissionRejectedError("rejected before acceptance"));
  assert.equal(await a.completion, "failed"); await turn();
  const c = h.queue.submit(message("c", agentId));
  assert.deepEqual(h.calls.map(x => x.nonce), ["a", "b"]);
  h.gates[1].resolve(); assert.equal(await b.completion, "sent"); await turn();
  assert.deepEqual(h.calls.map(x => x.nonce), ["a", "b", "c"]);
  h.gates[2].resolve(); assert.equal(await c.completion, "sent");
});
test("same nonce shares pending and terminal receipts without duplicate dispatch", async t => {
  const h = harness(t), input = message("a");
  const a = h.queue.submit(input), duplicate = h.queue.submit({ ...input, createdAtMs: 999 });
  assert.equal(duplicate.completion, a.completion); assert.equal(h.calls.length, 1);
  h.gates[0].resolve(); assert.equal(await duplicate.completion, "sent");
  assert.equal(h.queue.submit(input).completion, a.completion); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.queue.snapshot(), []);
});
for (const patch of [{ prompt: "different" }, { agentId: "other-room" }, { replyToId: "different-parent" }, { attachments: [{ path: "/a", name: "a" }] }, { richText: "changed" }, { isFork: true }]) {
  test(`nonce payload conflict rejects without replacing the original: ${Object.keys(patch)[0]}`, async t => {
    const h = harness(t), input = message("a"), original = h.queue.submit(input);
    assert.throws(() => h.queue.submit({ ...input, ...patch }), ComposerSubmissionConflictError);
    h.gates[0].resolve(); assert.equal(await original.completion, "sent"); assert.equal(h.calls.length, 1);
  });
}
test("unknown acknowledgement freezes just its lane until verified, without replay", async t => {
  const h = harness(t), a = h.queue.submit(message("a"));
  const b = h.queue.submit(message("b"));
  h.gates[0].reject(new Error("acknowledgement lost"));
  assert.equal(await a.completion, "failed");
  assert.equal(h.queue.snapshot()[0].failureKind, "unknown");
  const c = h.queue.submit(message("c")); h.queue.flush();
  assert.deepEqual(h.calls.map(x => x.nonce), ["a"]);
  assert.equal(h.queue.cancelQueued("a"), false);
  const other = h.queue.submit(message("other", "independent"));
  assert.deepEqual(h.calls.map(x => x.nonce), ["a", "other"]);
  h.gates[1].resolve(); assert.equal(await other.completion, "sent");
  assert.equal(h.queue.reconcile("a", "sent"), true);
  assert.deepEqual(h.calls.map(x => x.nonce), ["a", "other", "b"]);
  assert.equal(h.queue.reconcile("a", "sent"), false);
  h.gates[2].resolve(); assert.equal(await b.completion, "sent"); await turn();
  h.gates[3].resolve(); assert.equal(await c.completion, "sent");
  assert.equal(h.calls.filter(x => x.nonce === "a").length, 1);
});
test("verified non-acceptance advances the queue but does not retry the failed message", async t => {
  const h = harness(t), a = h.queue.submit(message("a")); h.queue.submit(message("b"));
  h.gates[0].reject(new Error("timeout")); await a.completion;
  assert.equal(h.queue.reconcile("a", "not-sent"), true);
  assert.deepEqual(h.calls.map(x => x.nonce), ["a", "b"]);
  assert.equal(h.queue.snapshot()[0].phase, "failed");
});
test("offline FIFO, cancellation and reconnect preserve insertion order, not timestamps", async t => {
  let offline = true;
  const h = harness(t, { isTransportDown: () => offline });
  const a = h.queue.submit({ ...message("a"), createdAtMs: 999 });
  const b = h.queue.submit(message("b")); const c = h.queue.submit(message("c"));
  assert.equal(h.queue.cancelQueued("b"), true); assert.equal(await b.completion, "cancelled");
  assert.equal(h.calls.length, 0); offline = false; h.queue.flush(); h.queue.flush();
  assert.deepEqual(h.calls.map(x => x.nonce), ["a"]);
  h.gates[0].resolve(); await a.completion; await turn();
  assert.deepEqual(h.calls.map(x => x.nonce), ["a", "c"]); h.gates[1].resolve(); await c.completion;
});
test("synchronous transport throw is classified and releases the lane", async t => {
  let count = 0;
  const h = harness(t, { send: () => { if (++count === 1) throw new ComposerSubmissionRejectedError("rejected"); return Promise.resolve(); } });
  assert.equal(await h.queue.submit(message("a")).completion, "failed");
  assert.equal(await h.queue.submit(message("b")).completion, "sent");
});
test("view observer failure cannot change an accepted send into a transport failure", async t => {
  const errors = [];
  const h = harness(t, { onPhase: () => { throw new Error("view observer"); }, onObserverError: error => errors.push(error) });
  const a = h.queue.submit(message("a")), b = h.queue.submit(message("b"));
  h.gates[0].resolve(); assert.equal(await a.completion, "sent"); await turn();
  h.gates[1].resolve(); assert.equal(await b.completion, "sent"); assert.ok(errors.length >= 4);
});
test("input and snapshot mutations cannot alter a queued request", async t => {
  let offline = true; const h = harness(t, { isTransportDown: () => offline });
  const input = { ...message("a"), attachments: [{ path: "/safe", name: "original" }] };
  const a = h.queue.submit(input); input.prompt = "changed"; input.attachments[0].path = "/changed";
  h.queue.snapshot()[0].attachments[0].name = "changed";
  offline = false; h.queue.flush();
  assert.equal(h.calls[0].prompt, "a"); assert.deepEqual(h.calls[0].attachments, [{ path: "/safe", name: "original" }]);
  h.gates[0].resolve(); await a.completion;
});
test("dispose settles all waiters and fences late receipts", async t => {
  const h = harness(t), a = h.queue.submit(message("a")), b = h.queue.submit(message("b"));
  h.queue.dispose(); assert.equal(await a.completion, "cancelled"); assert.equal(await b.completion, "cancelled");
  const before = h.phases.length; h.gates[0].resolve(); await turn();
  assert.equal(h.phases.length, before); assert.equal(h.calls.length, 1); assert.deepEqual(h.queue.snapshot(), []);
});
test("authoritative echo wins over a later rejected RPC callback", async t => {
  const h = harness(t), a = h.queue.submit(message("a"));
  const b = h.queue.submit(message("b"));
  assert.equal(h.queue.reconcile("a", "sent"), true);
  assert.equal(await a.completion, "sent");
  h.gates[0].reject(new Error("lost acknowledgement after echo")); await turn();
  assert.equal(h.phases.some(x => x.nonce === "a" && x.phase === "failed"), false);
  assert.deepEqual(h.calls.map(x => x.nonce), ["a", "b"]);
  h.gates[1].resolve(); assert.equal(await b.completion, "sent");
});
test("account reset drops old lanes and fences late callbacks even when a nonce is reused", async t => {
  const h = harness(t), old = h.queue.submit(message("same"));
  const queued = h.queue.submit(message("old-next"));
  h.queue.reset(); assert.equal(await old.completion, "cancelled"); assert.equal(await queued.completion, "cancelled");
  const fresh = h.queue.submit(message("same", "new-account-room"));
  const count = h.phases.length;
  h.gates[0].reject(new Error("old account callback")); await turn();
  assert.equal(h.phases.length, count);
  assert.equal(h.calls.length, 2); assert.equal(h.queue.snapshot()[0].agentId, "new-account-room");
  h.gates[1].resolve(); assert.equal(await fresh.completion, "sent");
});
