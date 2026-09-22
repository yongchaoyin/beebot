import assert from "node:assert/strict";
import test from "node:test";
import { dirname } from "node:path";
import { continuityHarness } from "./helpers/continuity-harness.mjs";

// Actual publication, state projection and SQLite. Only model/OS I/O is replaced.
function work(h) {
  const session = h.sessions.get("room");
  session.db.appendTranscriptEntry({ id: "goal", kind: "message", role: "user", content: "Deliver the tested change." });
  let sequence = 0;
  const tasks = () => h.runtime.projectCollaboration(h.entries("room"));
  const publish = (actor, message) => h.tm.groupChat.postGroupMemberMessage(session, { id: actor, name: actor }, message.content,
    undefined, h.runtime.prepareGroupPublication(session.dbPath, message, false));
  const action = (actor, value) => publish(actor, { type: "text", content: "Recorded work update", purpose: "update",
    collaboration: { request_id: `command-${++sequence}`, ...value } });
  const assign = (extra = {}) => action("a", { action: "assign", goal_message_id: "goal", assignee: "b", reviewer: "a",
    title: "Check the change", criteria: ["Matches the requirement"], ...extra });
  const command = (actor, id, type, extra = {}) => action(actor, { action: type, task_id: id,
    expected_version: tasks().get(id).version, ...extra });
  const result = (actor, id, content = "Delivered implementation") => publish(actor,
    { type: "text", content, purpose: "update", reply_to: id, work_on: id });
  const submit = (id, actor = "b") => {
    command(actor, id, "claim"); const evidence = result(actor, id);
    command(actor, id, "submit", { result_ids: [evidence], evidence_ids: [evidence] }); return evidence;
  };
  const review = (id, evidence, extra = {}) => command("a", id, "review", { submission_id: tasks().get(id).submission.id,
    verdict: "accept", checks: [{ criterion: 0, passed: true, evidence_ids: [evidence], note: "Inspected this exact result" }], ...extra });
  const finish = resultId => action("a", { action: "finish", goal_message_id: "goal",
    expected_tasks: [...tasks().values()].map(item => ({ id: item.id, version: item.version })), result_ids: [resultId] });
  return { session, tasks, publish, action, assign, command, result, submit, review, finish };
}

test("independent review evidence is pinned, not silently replaced before final delivery", async t => {
  const h = await continuityHarness(t), w = work(h), id = w.assign(), result = w.submit(id);
  const inspection = w.result("a", id, "Independent test: expected behavior passed");
  w.review(id, inspection);
  w.session.db.updateTranscriptEntry(inspection, entry => ({ ...entry, message: { ...entry.message, content: "Independent test: failed" } }));
  assert.throws(() => w.finish(result), /work_evidence_changed/,
    "finish must verify the evidence actually used by the reviewer, not merely hash its current contents");
  assert.equal(h.runtime.projectCompletions(h.entries("room")).size, 0);
});

test("unchanged independent review evidence permits closure and is preserved in the receipt", async t => {
  const h = await continuityHarness(t), w = work(h), id = w.assign(), result = w.submit(id);
  const inspection = w.result("a", id, "Independent checks passed"); w.review(id, inspection);
  assert.deepEqual(w.tasks().get(id).review.manifest.map(item => item.id), [inspection]);
  w.finish(result);
  assert.equal(h.runtime.projectCompletions(h.entries("room")).size, 1);
});

test("a peer cannot accept work after its assignee leaves the group", async t => {
  const h = await continuityHarness(t, { members: ["a", "b", "c"] }), w = work(h), id = w.assign(), result = w.submit(id);
  h.runtime.writeSandGroupConfig(dirname(w.session.dbPath), { version: 1, memberIds: ["a", "c"] });
  assert.throws(() => w.review(id, result), /work_member_unavailable/);
  assert.equal(w.tasks().get(id).state, "review");
});

test("reaccepted prerequisites wake previously accepted but obsolete dependent work", async t => {
  const h = await continuityHarness(t, { members: ["a", "b", "c"] }), w = work(h);
  const upstream = w.assign(), first = w.submit(upstream); w.review(upstream, first);
  const downstream = w.assign({ assignee: "c", dependencies: [upstream] });
  const second = w.submit(downstream, "c"); w.review(downstream, second);
  const previous = w.tasks().get(downstream).version;
  w.session.db.appendTranscriptEntry({ id: "correction", kind: "message", role: "user", content: "Change the required behavior", replyTo: upstream });
  w.command("a", upstream, "revise", { source_message_id: "correction", title: "Updated behavior", criteria: ["New behavior"] });
  const updated = w.submit(upstream), accepted = w.review(upstream, updated);
  const event = h.entries("room").find(entry => entry.id === accepted).collaborationEvent;
  assert.ok(event.wake.includes("c"), "C needs an event to recheck obsolete accepted work; the user should not have to chase it");
  assert.equal(w.tasks().get(downstream).version, previous, "notification must not auto-claim or execute dependent work");
  assert.equal(h.runtime.workIsAccepted(w.tasks().get(downstream), w.tasks()), false);
  w.command("c", downstream, "claim");
  assert.equal(w.tasks().get(downstream).state, "claimed");
});

test("legacy unpinned review remains readable but requires re-review before closure", async t => {
  const h = await continuityHarness(t), w = work(h), id = w.assign(), result = w.submit(id), reviewId = w.review(id, result);
  // A history produced before the review-evidence field existed must not be
  // rejected as corrupt or upgraded to a claimed verification that never ran.
  w.session.db.updateTranscriptEntry(reviewId, entry => {
    delete entry.collaborationEvent.task.review.manifest; return entry;
  });
  assert.equal(w.tasks().get(id).state, "accepted");
  assert.equal(h.runtime.workIsAccepted(w.tasks().get(id), w.tasks()), false);
  assert.throws(() => w.finish(result), /work_finish_incomplete/);
  w.review(id, result);
  assert.equal(h.runtime.workIsAccepted(w.tasks().get(id), w.tasks()), true);
  w.finish(result);
});

test("historical user review is explicitly re-checkable inline, not silently migrated", async t => {
  const h = await continuityHarness(t), w = work(h), id = w.assign({ reviewer: "user" }); w.submit(id);
  const controls = new h.runtime.CollaborationControls(h.tm);
  const request = task => ({ agentId: "room", reviewToken: task.reviewToken, review: {
    action: "review", request_id: `user-${task.version}`, task_id: id, expected_version: task.version,
    submission_id: task.submission.id, verdict: "accept",
    checks: [{ criterion: 0, passed: true, evidence_ids: task.submission.resultIds, note: "Checked the current evidence" }],
  } });
  const saved = await controls.review(request((await controls.snapshot({ agentId: "room" })).tasks[0])); await h.drain();
  w.session.db.updateTranscriptEntry(saved.messageId, entry => { delete entry.collaborationEvent.task.review.manifest; return entry; });
  const snapshot = await controls.snapshot({ agentId: "room" }), legacy = snapshot.tasks[0];
  assert.equal(legacy.reviewNeedsRefresh, true); assert.equal(legacy.canReview, true);
  assert.equal(legacy.acceptedForCurrentInputs, false);
  assert.equal(w.tasks().get(id).review.manifest, undefined, "reading history must not manufacture a new evidence pin");
  await controls.review(request(legacy)); await h.drain();
  assert.equal((await controls.snapshot({ agentId: "room" })).tasks[0].reviewNeedsRefresh, false);
  w.finish(w.tasks().get(id).submission.resultIds[0]);
});
