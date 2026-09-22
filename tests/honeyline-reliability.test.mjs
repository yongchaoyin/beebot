import assert from "node:assert/strict";
import test from "node:test";
import { createComposerSubmissionQueue, ComposerSubmissionRejectedError, ComposerSubmissionConflictError } from "../frontend/src/recovered/features/conversation/workspace/submission.ts";
import { workLabel } from "../frontend/src/honeyline/status.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const input = (nonce, agentId = "bot-a", extra = {}) => ({ nonce, agentId, prompt: nonce, attachments: [], createdAtMs: 1, ...extra });
function rig(t, extra = {}) {
  const calls = [], pending = new Map(), phases = [];
  let offline = false;
  const queue = createComposerSubmissionQueue({
    isTransportDown: () => offline,
    send: value => { calls.push(value); const gate = deferred(); pending.set(value.nonce, gate); return gate.promise; },
    onPhase: value => phases.push(value), ...extra,
  });
  t.after(() => queue.dispose());
  return { queue, calls, pending, phases, offline: value => { offline = value; }, order: () => calls.map(value => value.nonce) };
}
for (const conversation of ["bot-a", "group-project"]) {
  test(`${conversation}: second and third sends remain FIFO`, async t => {
    const r = rig(t); const receipts = ["A", "B", "C"].map(n => r.queue.submit(input(n, conversation)));
    assert.deepEqual(r.order(), ["A"]);
    for (const n of ["A", "B", "C"]) { r.pending.get(n).resolve(); await tick(); }
    assert.deepEqual(r.order(), ["A", "B", "C"]);
    assert.deepEqual(await Promise.all(receipts.map(r => r.completion)), ["sent", "sent", "sent"]);
  });
  test(`${conversation}: known local rejection advances B before new C`, async t => {
    const r = rig(t); const a = r.queue.submit(input("A", conversation)); r.queue.submit(input("B", conversation));
    r.pending.get("A").reject(new ComposerSubmissionRejectedError("not dispatched")); await a.completion;
    r.queue.submit(input("C", conversation)); await tick();
    assert.deepEqual(r.order(), ["A", "B"]);
    r.pending.get("B").resolve(); await tick(); assert.deepEqual(r.order(), ["A", "B", "C"]);
    assert.equal(r.queue.snapshot().find(x => x.nonce === "A").failureKind, "rejected");
  });
  test(`${conversation}: unknown outcome holds FIFO across reconnect, never auto-replays`, async t => {
    const r = rig(t); const a = r.queue.submit(input("A", conversation)); r.queue.submit(input("B", conversation));
    r.pending.get("A").reject(new Error("connection lost")); await a.completion;
    r.queue.submit(input("C", conversation)); r.offline(true); r.queue.flush(); r.offline(false); r.queue.flush();
    assert.deepEqual(r.order(), ["A"]);
    assert.equal(r.queue.snapshot()[0].failureKind, "unknown");
    r.queue.discard("A"); assert.deepEqual(r.order(), ["A", "B"]);
    r.pending.get("B").resolve(); await tick(); assert.deepEqual(r.order(), ["A", "B", "C"]);
  });
}
test("unknown receipt in one conversation does not block another Bot or group", async t => {
  const r = rig(t); const a = r.queue.submit(input("A")); r.pending.get("A").reject(new Error("unknown")); await a.completion;
  r.queue.submit(input("B")); r.queue.submit(input("G", "group-project")); r.queue.submit(input("D", "bot-d"));
  assert.deepEqual(r.order(), ["A", "G", "D"]);
});
for (const state of ["pending", "queued", "sent", "failed"]) test(`duplicate nonce in ${state} reuses the exact receipt`, async t => {
  const r = rig(t); if (state === "queued") r.offline(true);
  const a = r.queue.submit(input("same"));
  if (state === "sent") { r.pending.get("same").resolve(); await a.completion; }
  if (state === "failed") { r.pending.get("same").reject(new Error("unknown")); await a.completion; }
  const b = r.queue.submit(input("same", "bot-a", { createdAtMs: 999 }));
  assert.equal(a.completion, b.completion);
  if (state === "queued") { r.offline(false); r.queue.flush(); }
  if (state === "pending" || state === "queued") { r.pending.get("same").resolve(); assert.equal(await a.completion, "sent"); }
  assert.equal(r.calls.length, 1);
});
for (const change of [{ prompt: "different" }, { agentId: "other" }, { richText: "{}" }, { replyToId: "other-work" }, { isFork: true }, { attachments: [{ path: "/x", name: "x" }] }]) {
  test(`nonce conflict includes ${Object.keys(change)[0]} without overwriting original`, async t => {
    const r = rig(t); const a = r.queue.submit(input("same"));
    assert.throws(() => r.queue.submit({ ...input("same"), ...change }), ComposerSubmissionConflictError);
    r.pending.get("same").resolve(); assert.equal(await a.completion, "sent"); assert.equal(r.calls.length, 1);
  });
}
test("queued content and snapshots cannot be mutated by callers", async t => {
  const r = rig(t); r.offline(true);
  const original = input("A", "bot-a", { attachments: [{ path: "/original", name: "file" }], replyToId: "work-1" });
  r.queue.submit(original); original.prompt = "mutated"; original.attachments[0].path = "/changed";
  const snapshot = r.queue.snapshot(); snapshot[0].prompt = "changed again"; snapshot[0].attachments[0].path = "/snapshot";
  r.offline(false); r.queue.flush();
  assert.equal(r.calls[0].prompt, "A"); assert.equal(r.calls[0].attachments[0].path, "/original"); assert.equal(r.calls[0].replyToId, "work-1");
});
test("synchronous transport exception settles and holds the receipt", async t => {
  const r = rig(t, { send() { throw new Error("synchronous transport failure"); } });
  const a = r.queue.submit(input("A")); assert.equal(await a.completion, "failed");
  assert.equal(r.queue.snapshot()[0].failureKind, "unknown");
});
test("only explicitly typed pre-dispatch rejection is safe; status-looking error strings are not", async t => {
  const r = rig(t); const a = r.queue.submit(input("A")); r.pending.get("A").reject(new Error("400 rejected before acceptance")); await a.completion;
  assert.equal(r.queue.snapshot()[0].failureKind, "unknown");
});
test("cancel queued B never cancels running A and permits C", async t => {
  const r = rig(t); r.queue.submit(input("A")); const b = r.queue.submit(input("B")); r.queue.submit(input("C"));
  assert.equal(r.queue.cancelQueued("A"), false); assert.equal(r.queue.cancelQueued("B"), true); assert.equal(await b.completion, "cancelled");
  r.pending.get("A").resolve(); await tick(); assert.deepEqual(r.order(), ["A", "C"]);
});
test("dispose fences late successes and failures and settles every receipt", async t => {
  const r = rig(t); const a = r.queue.submit(input("A")), b = r.queue.submit(input("B")), c = r.queue.submit(input("C", "other"));
  r.queue.dispose(); const before = r.phases.length; r.pending.get("A").resolve(); r.pending.get("C").reject(new Error("late")); await tick();
  assert.deepEqual(await Promise.all([a.completion, b.completion, c.completion]), ["cancelled", "cancelled", "cancelled"]);
  assert.deepEqual(r.queue.snapshot(), []); assert.equal(r.phases.length, before);
});
test("recent settled deduplication never becomes an extra visible transcript", async t => {
  const r = rig(t); const a = r.queue.submit(input("A")); r.pending.get("A").resolve(); await a.completion;
  assert.deepEqual(r.queue.snapshot(), []); assert.equal(await r.queue.submit(input("A")).completion, "sent"); assert.equal(r.calls.length, 1);
});
test("re-entrant phase observers cannot duplicate an in-flight send", async t => {
  let receipt, queue;
  const r = rig(t, { onPhase: value => { if (value.phase === "pending") receipt = queue.submit(value); } }); queue = r.queue;
  const original = queue.submit(input("A")); assert.equal(original.completion, receipt.completion); assert.equal(r.calls.length, 1);
});
for (const waitingReason of ["Waiting for Agent B", "resource busy", "Permission needed"]) test(`free text does not assign user responsibility: ${waitingReason}`, () => {
  assert.equal(workLabel({ waitingReason, isRunning: true }).state, "waiting");
});
test("explicit user requests take precedence over wait text and running status", () => {
  assert.equal(workLabel({ awaitingUserResponse: { id: "permission-1" }, waitingReason: "dependency", isRunning: true }).state, "attention");
  assert.equal(workLabel({ awaitingUserResponse: true }).state, "attention");
  for (const malformed of ["", "false", 0, [], false]) assert.equal(workLabel({ awaitingUserResponse: malformed }), null);
});
test("account reset settles and forgets old receipts, fences late results, allows a fresh epoch", async t => {
  const r=rig(t); const old=r.queue.submit(input("same")); const queued=r.queue.submit(input("old-queued")); const prior=r.pending.get("same");
  r.queue.reset(); const count=r.phases.length;
  assert.deepEqual(await Promise.all([old.completion,queued.completion]),["cancelled","cancelled"]);
  const fresh=r.queue.submit(input("same","bot-a",{prompt:"new account"}));
  prior.resolve(); await tick(); assert.equal(r.queue.snapshot()[0].phase,"pending");
  assert.equal(r.phases.length,count+1);
  r.pending.get("same").resolve(); assert.equal(await fresh.completion,"sent");
  assert.deepEqual(r.order(),["same","same"]);
});
test("a long series of synchronous local rejections cannot overflow recursive queue draining", async t => {
  let offline=true, calls=0;
  const r=rig(t,{isTransportDown:()=>offline,send(){calls++;throw new ComposerSubmissionRejectedError("not dispatched");}});
  const receipts=Array.from({length:2000},(_,i)=>r.queue.submit(input(String(i))));
  offline=false;r.queue.flush();await Promise.all(receipts.map(r=>r.completion));assert.equal(calls,2000);
});
