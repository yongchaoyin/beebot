import assert from "node:assert/strict";
import test from "node:test";
import { continuityHarness } from "./helpers/continuity-harness.mjs";

const message = (quote, collaboration, content = "Work update") => ({
  type: "text", content, reply_to: quote,
  ...(collaboration ? { collaboration } : { intent: "update" }),
});

// Regression through actual local publication, contract reducer and SQLite.
// Only model/OS boundaries are deterministic fixtures; these are not quality scores.
async function fixture(t, solo = false) {
  const h = await continuityHarness(t);
  const room = solo ? "a" : "room";
  await h.send(solo ? "Deliver both requests" : "@{a} Deliver both requests", room);
  await h.drain();
  const session = h.sessions.get(room);
  const root = h.entries(room).find(e => e.role === "user").id;
  const runtime = new h.runtime.TurnRuntime(h.tm);
  h.tm.ackObligations.fulfillAckObligation = () => {};
  const post = (actor, raw) => solo
    ? runtime.handleAgentUpdate({type: "send-message", message: raw, timestampMs: Date.now()}, session)
    : h.tm.groupChat.postGroupMemberMessage(session, {id: actor, name: actor, description: "Colleague"}, raw.content,
      undefined, h.runtime.prepareGroupPublication(session.dbPath, raw, false));
  const entries = () => h.entries(room);
  const tasks = () => h.runtime.collaborationTasks(entries());
  const owner = solo ? "a" : "b";
  const assign = (extra = {}) => post("a", message(root, {
    action: "assign", title: "Scoped output", deliverable: "A current, checked result",
    criteria: ["Meets this task's requirements"], assignee_id: owner, ...extra,
  }));
  const change = (actor, id, action, extra = {}) => post(actor, message(id, {
    action, task_id: id, expected_version: tasks().get(id).version, ...extra,
  }));
  const evidence = (actor, id, content = "Actual result") => post(actor, message(id, null, content));
  const submit = (id, ref = evidence(owner, id)) => change(owner, id, "submit", {evidence: [{criterion: 0, message_id: ref}]});
  const review = (id, verdict = "approve", ref = evidence("a", id, "Checked the exact result")) => change("a", id, "review", {
    submission_id: tasks().get(id).submission.id, verdict,
    checks: [{criterion: 0, message_id: ref, passed: verdict === "approve"}],
  });
  const rejectsWithoutMutation = (fn, pattern) => {
    const before = JSON.stringify(entries());
    assert.throws(fn, pattern);
    assert.equal(JSON.stringify(entries()), before, "rejected action must not publish or advance work");
  };
  return {...h, entries, tasks, owner, root, post, assign, change, evidence, submit, review, rejectsWithoutMutation};
}

for (const solo of [false, true]) {
  test(`${solo ? "single Bot" : "Group"}: evidence from another assigned task cannot satisfy this task`, async t => {
    const f = await fixture(t, solo), first = f.assign(), second = f.assign({title: "A different request"});
    f.change(f.owner, first, "claim");
    const old = f.evidence(f.owner, first);
    f.change(f.owner, second, "claim");
    f.rejectsWithoutMutation(() => f.submit(second, old), /evidence|result/i);
    assert.equal(f.tasks().get(second).state, "claimed");
  });
}

test("revised requirements cannot reuse a result published under the old contract", async t => {
  const f = await fixture(t), id = f.assign();
  f.change("b", id, "claim"); const old = f.evidence("b", id);
  f.change("a", id, "revise", {deliverable: "Changed output", criteria: ["New required behavior"]});
  f.change("b", id, "resume");
  f.rejectsWithoutMutation(() => f.submit(id, old), /evidence|result/i);
});

test("requested rework requires a fresh publication, not the rejected result ID", async t => {
  const f = await fixture(t), id = f.assign();
  f.change("b", id, "claim"); const old = f.evidence("b", id); f.submit(id, old);
  f.review(id, "changes_requested"); f.change("b", id, "resume");
  f.rejectsWithoutMutation(() => f.submit(id, old), /evidence|result/i);
});

test("review evidence must be published after the exact submission it checks", async t => {
  const f = await fixture(t), id = f.assign(); f.change("b", id, "claim");
  const prematureCheck = f.evidence("a", id, "A plan for checking is not a check of this result");
  f.submit(id);
  f.rejectsWithoutMutation(() => f.review(id, "approve", prematureCheck), /evidence|check|review/i);
});

test("review evidence from another task cannot approve the current submission", async t => {
  const f = await fixture(t), first = f.assign(), second = f.assign({title: "Other task"});
  f.change("b", first, "claim"); f.submit(first);
  const foreignCheck = f.evidence("a", second, "Checked the other task");
  f.rejectsWithoutMutation(() => f.review(first, "approve", foreignCheck), /evidence|check|review/i);
});

test("a previous review cannot be recycled for a new rework submission", async t => {
  const f = await fixture(t), id = f.assign(); f.change("b", id, "claim"); f.submit(id);
  const oldCheck = f.evidence("a", id, "First version failed");
  f.review(id, "changes_requested", oldCheck); f.change("b", id, "resume"); f.submit(id);
  f.rejectsWithoutMutation(() => f.review(id, "approve", oldCheck), /evidence|check|review/i);
});

test("provenance follows a same-task clarification quote without losing the original assignment", async t => {
  const f = await fixture(t), id = f.assign(); f.change("b", id, "claim");
  const clarification = f.evidence("a", id, "Preserve existing behavior");
  const answer = f.evidence("b", clarification, "Implemented per clarification");
  f.submit(id, answer); f.review(id);
  assert.equal(f.tasks().get(id).state, "reviewed");
});

test("revising a group contract cannot turn its owner into their own independent reviewer", async t => {
  const f = await fixture(t), id = f.assign(); f.change("b", id, "claim");
  f.rejectsWithoutMutation(() => f.change("a", id, "revise", {
    deliverable: "Same output", criteria: ["Check"], reviewer_id: "b",
  }), /reviewer|independent/i);
});

test("single Bot: adding the current quote automatically preserves exact action replay identity", async t => {
  const f = await fixture(t, true);
  f.tm.turnRuntime.replyThreadTargets = new Map([[f.sessions.get("a"), f.root]]);
  const raw = {type: "text", content: "I will handle it", collaborationKey: "auto-quote-call", collaboration: {
    action: "assign", title: "Auto-quoted work", deliverable: "Result", criteria: ["Check"], assignee_id: "a",
  }};
  const first = f.post("a", raw);
  const count = f.entries().length;
  assert.equal(f.post("a", raw), first, "same actual tool call must return its original publication");
  assert.equal(f.entries().length, count);
  assert.equal(f.tasks().size, 1);
  f.rejectsWithoutMutation(() => f.post("a", {...raw, content: "Changed meaning"}), /different input/i);
});

test("single Bot: failed off-screen result persistence cannot return a success message ID", async t => {
  const f = await fixture(t, true);
  assert.notEqual(f.tm.sessions.activeSession?.id, "a");
  const before = JSON.stringify(f.entries());
  f.sessions.get("a").db.durable = false;
  assert.throws(() => f.evidence("a", f.root, "Unsaved result"), /persist|sav/i);
  assert.equal(JSON.stringify(f.entries()), before);
});

test("a failed group stream save cannot promote an unsaved preview to a completed reply", async t => {
  const f = await fixture(t), session = f.sessions.get("room");
  f.tm.sessions.activeSession = session; f.tm.sessions.inMemoryTranscriptAgentId = "room";
  const preview = {kind: "send-message", id: "t999s1", message: {type: "text", content: "Preview"}, streaming: true};
  f.runtime.setTranscript([...f.entries(), preview]);
  session.db.durable = false;
  const live = {sealed: [preview.id], currentText: ""};
  const raw = message(f.root, null, "Final result that failed persistence");
  assert.throws(() => f.tm.groupChat.postGroupMemberMessage(session, {id:"b",name:"B",description:""}, raw.content,
    live, f.runtime.prepareGroupPublication(session.dbPath, raw, false)), /sav/i);
  assert.equal(f.runtime.getTranscript().find(e => e.id === preview.id).streaming, true);
  assert.deepEqual(live.sealed, [preview.id], "failed publication must remain eligible for preview cleanup");
  assert.equal(f.entries().some(e => e.id === preview.id), false);
});


test("single Bot: actual active-session persistence failure cannot publish, acknowledge or report success", async t => {
  const f = await fixture(t, true), session = f.sessions.get("a");
  const actual = new f.runtime.SessionRuntime(f.tm); actual.activeSession = session;
  f.tm.roster.applyAgentUpdateToOutline = () => {};
  f.tm.sessions.activeSession = session; f.tm.sessions.inMemoryTranscriptAgentId = "a";
  f.runtime.setTranscript(f.entries()); f.tm.appendEntry = actual.appendEntry.bind(actual);
  let acknowledgements = 0;
  f.tm.ackObligations.fulfillAckObligation = () => { acknowledgements++; };
  session.db.durable = false;
  const before = JSON.stringify(f.runtime.getTranscript()), eventCount = f.events.length;
  assert.throws(() => f.evidence("a", f.root, "Unsaved active result"), /persist|sav/i);
  assert.equal(JSON.stringify(f.runtime.getTranscript()), before);
  assert.equal(f.events.length, eventCount);
  assert.equal(acknowledgements, 0);
});

test("single Bot: real active publication persists exactly once before its UI event and acknowledgement", async t => {
  const f = await fixture(t, true), session = f.sessions.get("a");
  const actual = new f.runtime.SessionRuntime(f.tm); actual.activeSession = session;
  f.tm.roster.applyAgentUpdateToOutline = () => {};
  f.tm.sessions.activeSession = session; f.tm.sessions.inMemoryTranscriptAgentId = "a";
  f.runtime.setTranscript(f.entries()); f.tm.appendEntry = actual.appendEntry.bind(actual);
  const order = [], append = session.db.appendTranscriptEntry;
  session.db.appendTranscriptEntry = entry => { order.push("persist"); return append(entry); };
  f.tm.roster.emit = () => { order.push("publish"); };
  f.tm.ackObligations.fulfillAckObligation = () => { order.push("acknowledge"); };
  const id = f.evidence("a", f.root, "Durable active result");
  assert.deepEqual(order, ["persist", "publish", "acknowledge"]);
  assert.equal(f.entries().filter(e => e.id === id).length, 1);
  assert.equal(f.runtime.getTranscript().filter(e => e.id === id).length, 1);
});
