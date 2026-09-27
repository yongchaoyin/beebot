import assert from "node:assert/strict";
import test from "node:test";
import { continuityHarness, deferred } from "./helpers/continuity-harness.mjs";

const publicMessages = h => h.entries("room").filter(entry => entry.kind === "send-message");
const userMessages = h => h.entries("room").filter(entry => entry.kind === "message" && entry.role === "user");
const text = (content, extra = {}) => ({ type: "text", content, ...extra });

async function signal(gate, description) {
  let timer;
  try {
    return await Promise.race([
      gate.promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Missing progress signal: ${description}`)), 3000); }),
    ]);
  } finally { clearTimeout(timer); }
}

function noFailures(h) {
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.interrupts, []);
  assert.equal(h.entries("room").some(entry => entry.kind === "notice" && entry.code === "delivery_failed"), false);
  assert.equal(h.runtime.projectCollaboration(h.entries("room")).size, 0,
    "ordinary questions and advice must not manufacture formal tasks");
}

// Real active-room SendPipeline, publication, SQLite transcripts, delivery
// journals and group queues. Only model/OS work is controlled. The explicit
// publication catch below does not substitute for the SendMessage tool wrapper.
test("a plain question to the user stays visible and second/third sends continue without waking peers", { timeout: 10000 }, async t => {
  const secondStarted = deferred(), releaseSecond = deferred();
  t.after(() => releaseSecond.resolve());
  let h, questionId;
  h = await continuityHarness(t, { members: ["a", "b", "c"], runMember: async (call, turn) => {
    assert.equal(call.id, "a");
    if (turn === 1) questionId = call.publish(text("Which part should I inspect first?", { purpose: "request" }));
    if (turn === 2) {
      secondStarted.resolve();
      await releaseSecond.promise;
      call.publish(text("Should I keep this to keyboard navigation?", { purpose: "request" }));
    }
    if (turn === 3) call.publish(text("I will discuss keyboard navigation only; no files were changed.", { purpose: "update" }));
    return [];
  } });
  await h.tm.sessions.ensureActionTarget("room");
  try {
    await h.send("@{a} Help me choose a review scope; discuss only, do not edit files.");
    await h.drain();
    const question = publicMessages(h).find(entry => entry.id === questionId);
    assert.ok(question);
    assert.equal(question.message.type, "text", "a natural question needs no widget");
    assert.equal(question.replyTo, userMessages(h)[0].id);
    assert.equal(question.decisionContext, undefined);
    assert.ok(h.runtime.getTranscript().some(entry => entry.id === questionId), "the active conversation receives the actual publication");
    assert.deepEqual(h.calls.map(call => call.id), ["a"]);
    assert.equal(h.records("room").find(record => record.id === questionId), undefined, "a human question creates no peer delivery obligation");

    await h.send("Start with keyboard navigation.", "room", { replyToId: questionId });
    await signal(secondStarted, "the user's quoted answer starts its question author");
    await h.send("Also keep the discussion brief; still do not edit files.");
    assert.deepEqual(h.calls.map(call => call.id), ["a", "a"], "the third send queues while the same Bot is busy");
    releaseSecond.resolve();
    await h.drain();

    const users = userMessages(h), replies = publicMessages(h);
    assert.equal(users.length, 3);
    assert.equal(users[1].replyTo, questionId);
    assert.deepEqual(h.calls.map(call => call.id), ["a", "a", "a"]);
    assert.match(h.calls[1].prompt, /Start with keyboard navigation/);
    assert.match(h.calls[2].prompt, /Also keep the discussion brief/);
    assert.equal(replies.length, 3);
    assert.equal(replies[1].replyTo, users[1].id);
    assert.equal(replies[2].replyTo, users[2].id);
    for (const user of users) assert.deepEqual(h.records("room").find(record => record.id === user.id).recipients, { a: "replied" });
    for (const reply of replies) assert.equal(h.records("room").find(record => record.id === reply.id), undefined);
    noFailures(h);
  } finally { releaseSecond.resolve(); await h.drain(); }
});

test("a request quoting the user still routes actual peer mentions and rejects invented names before publication", { timeout: 10000 }, async t => {
  let h, goalId, requestId, peerQuestionId, rejected = 0;
  h = await continuityHarness(t, { members: ["a", "b", "c"], runMember: async (call, turn) => {
    if (call.id === "a" && turn === 1) {
      goalId = userMessages(h)[0].id;
      const beforeEntries = h.entries("room").length, beforeEvents = h.events.length;
      assert.throws(() => call.publish(text("@小鱼 Please inspect keyboard focus only.", { purpose: "request", reply_to: goalId })),
        error => error.code === "unknown_group_member" && /Current Bot members:.*@\{a\}.*@\{b\}.*@\{c\}/.test(error.message));
      rejected++;
      assert.equal(h.entries("room").length, beforeEntries);
      assert.equal(h.events.length, beforeEvents, "invalid requests must not enter active UI before validation");
      requestId = call.publish(text("@{b} Please inspect keyboard focus only; provide advice, do not edit.", { purpose: "request", reply_to: goalId }));
    } else if (call.id === "b") {
      peerQuestionId = call.publish(text("Should I include the toolbar in that keyboard review?", { purpose: "request" }));
    } else if (call.id === "a" && turn === 2) {
      call.publish(text("The toolbar is within the requested discussion; no implementation was changed.", { purpose: "update", reply_to: goalId }));
    }
    return [];
  } });
  await h.tm.sessions.ensureActionTarget("room");
  await h.send("@{a} Discuss the keyboard focus behavior only; no changes are authorized.");
  await h.drain();
  assert.equal(rejected, 1);
  assert.deepEqual(h.calls.map(call => call.id), ["a", "b", "a"]);
  const request = publicMessages(h).find(entry => entry.id === requestId);
  const peerQuestion = publicMessages(h).find(entry => entry.id === peerQuestionId);
  assert.equal(request.replyTo, goalId);
  assert.equal(peerQuestion.replyTo, requestId, "a request implicitly quoted to a real peer remains peer-directed");
  assert.deepEqual(h.records("room").find(record => record.id === requestId).recipients, { b: "replied" });
  assert.deepEqual(Object.keys(h.records("room").find(record => record.id === peerQuestionId).recipients), ["a"]);
  assert.equal(JSON.stringify(h.entries("room")).includes("小鱼"), false);
  assert.equal(JSON.stringify(h.events).includes("小鱼"), false);
  noFailures(h);
});

test("a truly unaddressed direct publication returns an actionable recipient error and cannot forge a user quote", async t => {
  const h = await continuityHarness(t), room = h.sessions.get("room");
  await h.tm.sessions.ensureActionTarget("room");
  const author = { id: "a", name: "A", description: "" };
  const content = "Please inspect keyboard focus only.";
  for (const forged of [false, true]) {
    const message = text(content, { purpose: "request", ...(forged ? { replyToUser: true } : {}) });
    const publication = { content, message, ...(forged ? { replyToUser: true } : {}) };
    const entriesBefore = h.entries("room"), eventsBefore = h.events.length;
    assert.throws(() => h.tm.groupChat.postGroupMemberMessage(room, author, content, undefined, publication), error => {
      assert.equal(error.name, "GroupRecipientRequiredError");
      assert.equal(error.code, "group_recipient_required");
      assert.match(error.message, /Nothing was published/);
      assert.match(error.message, /current member/);
      assert.match(error.message, /reply_to the actual user message/);
      assert.doesNotMatch(error.message, /The addressed Bot|not a member of this group/);
      return true;
    });
    assert.deepEqual(h.entries("room"), entriesBefore);
    assert.equal(h.events.length, eventsBefore);
  }
  assert.equal(h.calls.length, 0);
  noFailures(h);
});

test("a controlled runner corrects a recipient error in the same coalesced turn without widening or duplicating the request", { timeout: 10000 }, async t => {
  const firstStarted = deferred(), releaseFirst = deferred(), corrected = deferred(), peerStarted = deferred();
  t.after(() => releaseFirst.resolve());
  const scope = "Please inspect keyboard focus only; provide advice and do not change files.";
  const secondText = "@{a} Please inspect keyboard focus only; provide advice and do not change files.";
  const thirdText = "@{a} Keep that same review scope and include the toolbar.";
  let h, goalId, requestId, caught = 0;
  const activations = [];
  h = await continuityHarness(t, { members: ["a", "b", "c"], runMember: async (call, turn) => {
    if (call.id === "a" && turn === 1) {
      firstStarted.resolve();
      await releaseFirst.promise;
      call.publish(text("I have read the discussion boundary.", { purpose: "update" }));
    } else if (call.id === "a" && turn === 2) {
      const entriesBefore = h.entries("room").length, eventsBefore = h.events.length;
      try { call.publish(text(scope, { purpose: "request" })); assert.fail("coalesced triggers must not invent a user reply target"); }
      catch (error) { assert.equal(error.code, "group_recipient_required"); caught++; }
      assert.equal(h.entries("room").length, entriesBefore);
      assert.equal(h.events.length, eventsBefore);
      goalId = userMessages(h).find(entry => entry.content === secondText).id;
      requestId = call.publish(text(`@{b} ${scope}`, { purpose: "request", reply_to: goalId }));
      call.publish(text("I asked B for advice within the same keyboard review scope.", { purpose: "update", reply_to: goalId }));
      corrected.resolve();
    } else if (call.id === "b") {
      assert.match(call.prompt, /Please inspect keyboard focus only; provide advice and do not change files/);
      peerStarted.resolve();
      call.publish(text("My advice is to inspect toolbar focus order; this fixture performs no external work.", { purpose: "update", reply_to: requestId }));
    } else assert.fail(`Unexpected activation: ${call.id} turn ${turn}`);
    return [];
  } });
  const run = h.tm.groupChat.runGroupMemberTurn.bind(h.tm.groupChat);
  h.tm.groupChat.runGroupMemberTurn = (...args) => {
    activations.push({ memberId: args[1].member.id, sourceIds: [...(args[1].sourceMessageIds ?? [])] });
    return run(...args);
  };
  await h.tm.sessions.ensureActionTarget("room");
  try {
    await h.send("@{a} We are discussing possible checks; do not change anything.");
    await signal(firstStarted, "first Bot turn is still running");
    await h.send(secondText);
    await h.send(thirdText);
    releaseFirst.resolve();
    await Promise.all([signal(corrected, "the same model turn corrected its unpublished request"), signal(peerStarted, "one real peer received the corrected request")]);
    await h.drain();
    const users = userMessages(h), messages = publicMessages(h);
    assert.equal(caught, 1);
    assert.deepEqual(h.calls.map(call => call.id), ["a", "a", "b"]);
    assert.deepEqual(activations[1], { memberId: "a", sourceIds: [users[1].id, users[2].id] });
    assert.deepEqual(activations[2], { memberId: "b", sourceIds: [requestId] }, "the peer receives only its corrected assignment, not the entire original trigger set");
    assert.match(h.calls[1].prompt, /Keep that same review scope and include the toolbar/);
    assert.equal(messages.filter(entry => entry.message.content === scope).length, 0);
    assert.equal(messages.filter(entry => entry.message.content === `@{b} ${scope}`).length, 1);
    assert.equal(messages.find(entry => entry.id === requestId).replyTo, goalId);
    assert.deepEqual(h.records("room").find(record => record.id === requestId).recipients, { b: "replied" });
    assert.equal(messages.filter(entry => entry.author.id === "b").length, 1);
    assert.equal(h.tm.groupChat.activeRooms.size, 0);
    noFailures(h);
  } finally { releaseFirst.resolve(); await h.drain(); }
});
