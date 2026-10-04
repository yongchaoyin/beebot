import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { continuityHarness, deferred } from "./helpers/continuity-harness.mjs";

async function signal(gate, description) {
  let timer;
  try {
    return await Promise.race([
      gate.promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Missing progress signal: ${description}`)), 3000); }),
    ]);
  } finally { clearTimeout(timer); }
}

// Real SendPipeline, transcript SQLite, delivery journal and group queues;
// model work is an explicitly controlled, already-started turn.
async function exerciseMemberChange(t, { keepOriginals, incoming }) {
  const oldStarted = deferred(), oldReleased = deferred(), oldFinished = deferred();
  const initialReplied = deferred(), rejectedInput = deferred(), newcomerStarted = deferred();
  t.after(() => oldReleased.resolve());
  const initialText = "@{a} Delegate the first bounded investigation to B.";
  let h, oldRequestId;
  h = await continuityHarness(t, {
    members: ["a", "b", "c"],
    runMember: async call => {
      if (call.id === "a") {
        const goal = h.entries("room").find(entry => entry.kind === "message" && entry.content === initialText);
        oldRequestId = call.publish({ type: "text", content: "@{b} Inspect the first topic only.",
          purpose: "request", reply_to: goal.id });
      } else if (call.id === "b") {
        oldStarted.resolve();
        await oldReleased.promise;
        if (keepOriginals) call.publish({ type: "text", content: "The original B investigation has finished.",
          purpose: "update", reply_to: oldRequestId });
        oldFinished.resolve();
      } else if (call.id === "c") {
        newcomerStarted.resolve();
        call.publish({ type: "text", content: "I am handling the explicitly sent new request.", purpose: "update" });
      }
      return [];
    },
  });
  const session = h.sessions.get("room");
  const append = session.db.appendTranscriptEntry.bind(session.db);
  session.db.appendTranscriptEntry = entry => {
    const saved = append(entry);
    if (saved !== false && entry.kind === "notice" && entry.code === "group_participants_changed") {
      const original = session.db.getTranscriptEntries().find(item => item.id === entry.replyTo);
      if (original?.content === incoming) rejectedInput.resolve(entry);
    }
    return saved;
  };
  const update = session.db.updateTranscriptEntry.bind(session.db);
  session.db.updateTranscriptEntry = (id, transform) => {
    const saved = update(id, transform);
    if (saved?.kind === "message" && saved.content === initialText && saved.delivery?.state === "replied") initialReplied.resolve(saved);
    return saved;
  };
  const setMembers = memberIds => h.runtime.writeSandGroupConfig(path.dirname(session.dbPath), { version: 1, memberIds });
  setMembers(["a", "b"]);
  try {
    await h.send(initialText);
    await Promise.all([signal(oldStarted, "original B work started"), signal(initialReplied, "A's real handoff completed the initial reply")]);
    assert.equal(h.records("room").find(record => record.id === oldRequestId)?.recipients.b, "processing");

    setMembers(keepOriginals ? ["a", "b", "c"] : ["c"]);
    await h.send(incoming);
    const notice = await signal(rejectedInput, "changed-participant input failed with a persisted notice");
    const input = h.entries("room").find(entry => entry.kind === "message" && entry.content === incoming);
    assert.equal(notice.replyTo, input.id);
    const blockedDelivery = h.records("room").find(record => record.id === input.id);
    assert.equal(blockedDelivery.state, "failed", "a request with no eligible current-run recipient must never become processed/empty");
    assert.notEqual(blockedDelivery.state, "processed");
    assert.deepEqual(h.calls.map(call => call.id), ["a", "b"], "new C must not join or replay the old execution round");
    assert.deepEqual(h.interrupts, [], "rejecting this new input must not interrupt already-started work");
    assert.equal(h.records("room").find(record => record.id === oldRequestId)?.recipients.b, "processing");

    oldReleased.resolve();
    await signal(oldFinished, "previous model work can finish");
    await h.drain();
    if (keepOriginals) {
      const result = h.entries("room").find(entry => entry.kind === "send-message"
        && entry.message?.content === "The original B investigation has finished.");
      assert.ok(result, "a valid existing member's result must not be fenced by the rejected newcomer input");
      assert.equal(result.author.id, "b");
      assert.equal(h.records("room").find(record => record.id === oldRequestId)?.recipients.b, "replied");
    }
    assert.equal(h.tm.groupChat.activeRooms.size, 0);
    assert.deepEqual(h.calls.map(call => call.id), ["a", "b"]);
    assert.equal(h.errors.length, 0);

    const freshText = "@{c} Handle this fresh request after the previous round.";
    await h.send(freshText);
    await signal(newcomerStarted, "new current member starts in a fresh round");
    await h.drain();
    const fresh = h.entries("room").find(entry => entry.kind === "message" && entry.content === freshText);
    const freshDelivery = h.records("room").find(record => record.id === fresh.id);
    assert.deepEqual(freshDelivery.recipients, { c: "replied" });
    assert.deepEqual(h.calls.map(call => call.id), ["a", "b", "c"]);
    assert.equal(h.records("room").find(record => record.id === input.id).state, "failed",
      "the blocked earlier request must not be silently replayed during the fresh round");
    assert.equal(h.entries("room").filter(entry => entry.kind === "notice"
      && entry.code === "group_participants_changed" && entry.replyTo === input.id).length, 1);
  } finally {
    oldReleased.resolve();
    await h.drain();
  }
}

test("replacing every original participant reports an unhandled team request and permits a fresh round", { timeout: 10000 }, async t => {
  await exerciseMemberChange(t, { keepOriginals: false, incoming: "@everyone Begin a separate new investigation." });
});

test("explicitly addressing a newly joined member rejects only that input while original work finishes", { timeout: 10000 }, async t => {
  await exerciseMemberChange(t, { keepOriginals: true, incoming: "@{c} Investigate a new topic independently." });
});
