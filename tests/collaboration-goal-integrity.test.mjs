import assert from "node:assert/strict";
import test from "node:test";
import { continuityHarness } from "./helpers/continuity-harness.mjs";

// Real publication handlers and SQLite; only the model and OS work are fixtures.
function work(h, surface) {
  const session = h.sessions.get(surface === "single" ? "a" : "room");
  const owner = surface === "single" ? "a" : "b";
  const turn = new h.runtime.TurnRuntime(h.tm);
  if (surface === "single") h.tm.turnRuntime = turn;
  h.tm.ackObligations.fulfillAckObligation = () => {};
  let sequence = 0;
  const publish = (actor, message) => surface === "single"
    ? turn.handleAgentUpdate({ type: "send-message", message, timestampMs: ++sequence }, session)
    : h.tm.groupChat.postGroupMemberMessage(session, { id: actor, name: actor }, message.content,
      undefined, h.runtime.prepareGroupPublication(session.dbPath, message, false));
  const post = (actor, collaboration) => publish(actor, { type: "text", purpose: "update", content: "Recorded work update", collaboration });
  const tasks = () => h.runtime.projectCollaboration(session.db.getTranscriptEntries());
  const goal = id => session.db.appendTranscriptEntry({ id, kind: "message", role: "user", content: `Deliver ${id}` });
  const assign = (goalId, assignee = owner) => post("a", { action: "assign", request_id: `assign-${++sequence}`,
    goal_message_id: goalId, assignee, title: `Inspect ${goalId}`, criteria: ["Report the actual fixture observation"] });
  const command = (actor, id, action, rest = {}) => post(actor, { action, task_id: id,
    expected_version: tasks().get(id).version, request_id: `command-${++sequence}`, ...rest });
  const result = (reference, content = "Controlled fixture observation; no production work was executed.") => publish(owner,
    { type: "text", purpose: "update", content, reply_to: reference });
  const complete = id => {
    command(owner, id, "claim");
    const evidence = result(id);
    command(owner, id, "submit", { result_ids: [evidence], evidence_ids: [evidence] });
    command(owner, id, "self-check", { submission_id: tasks().get(id).submission.id,
      checks: [{ criterion: 0, passed: true, evidence_ids: [evidence], note: "Checked the recorded fixture observation" }] });
    return evidence;
  };
  const finish = (goalId, resultIds) => post("a", { action: "finish", request_id: `finish-${++sequence}`,
    goal_message_id: goalId, expected_tasks: [...tasks().values()].filter(task => task.goalId === goalId)
      .map(task => ({ id: task.id, version: task.version })), result_ids: resultIds });
  return { session, owner, publish, post, tasks, goal, assign, command, result, complete, finish };
}

for (const surface of ["single", "group"]) {
  test(`${surface}: unrelated published results cannot become another goal's final delivery`, async t => {
    const h = await continuityHarness(t), w = work(h, surface);
    w.goal("first-goal"); w.goal("second-goal");
    const first = w.assign("first-goal"), second = w.assign("second-goal");
    const current = w.complete(first), foreign = w.complete(second);
    const before = w.session.db.getTranscriptEntries();
    assert.throws(() => w.finish("first-goal", [foreign]), /work_finish_result_scope/);
    assert.deepEqual(w.session.db.getTranscriptEntries(), before, "rejection must not publish a completion or change ownership");
    assert.throws(() => w.finish("first-goal", [w.tasks().get(first).selfCheck.id]), /work_finish_result_scope/,
      "a successful check receipt is not the delivered result");
    const unlinked = w.publish(w.owner, { type: "text", purpose: "update", content: "Fresh unrelated observation" });
    assert.throws(() => w.finish("first-goal", [unlinked]), /work_finish_result_scope/);
    const mixed = w.publish(w.owner, { type: "text", purpose: "update", content: "Contradictory result references", reply_to: first, work_on: second });
    assert.throws(() => w.finish("first-goal", [mixed]), /work_finish_result_scope/);
    const summary = w.result(first, "Current checked fixture result summary.");
    const receiptId = w.finish("first-goal", [current, summary]);
    assert.equal(h.runtime.projectCompletions(w.session.db.getTranscriptEntries()).get("first-goal").id, receiptId);
    assert.equal(w.tasks().get(second).state, "completed", "the other goal remains intact");
  });

  test(`${surface}: current submitted results can close a multi-task goal even when published before later submissions`, async t => {
    const h = await continuityHarness(t), w = work(h, surface);
    w.goal("goal");
    const first = w.assign("goal"), second = w.assign("goal");
    const early = w.complete(first), later = w.complete(second);
    w.finish("goal", [early, later]);
    const receipt = h.runtime.projectCompletions(w.session.db.getTranscriptEntries()).get("goal");
    assert.deepEqual(receipt.manifest.map(item => item.id), [early, later]);
    assert.equal(h.runtime.completionIsCurrent(receipt, w.tasks()), true);
  });

  test(`${surface}: an old same-goal summary does not deliver a newer work attempt`, async t => {
    const h = await continuityHarness(t), w = work(h, surface);
    w.goal("goal"); const id = w.assign("goal"), oldResult = w.complete(id);
    const oldSummary = w.result("goal", "Summary of the first checked version.");
    w.finish("goal", [oldResult, oldSummary]);
    w.session.db.appendTranscriptEntry({ id: "correction", kind: "message", role: "user", content: "Inspect the revised outcome", replyTo: id });
    w.command("a", id, "revise", { source_message_id: "correction", title: "Revised fixture", criteria: ["Report the revised observation"] });
    const fresh = w.complete(id);
    assert.throws(() => w.finish("goal", [oldSummary]), /work_finish_result_stale/);
    assert.throws(() => w.finish("goal", [oldResult]), /work_finish_result_stale/);
    assert.equal(h.runtime.completionIsCurrent(h.runtime.projectCompletions(w.session.db.getTranscriptEntries()).get("goal"), w.tasks()), false);
    w.finish("goal", [fresh]);
    assert.equal(h.runtime.completionIsCurrent(h.runtime.projectCompletions(w.session.db.getTranscriptEntries()).get("goal"), w.tasks()), true);
  });

  test(`${surface}: simultaneous same-version claims yield one durable claim and one controlled work attempt`, async t => {
    const h = await continuityHarness(t), w = work(h, surface);
    w.goal("goal"); const id = w.assign("goal"), attempts = [];
    const claim = requestId => ({ action: "claim", task_id: id, expected_version: 1, request_id: requestId });
    const publishAndAttempt = requestId => Promise.resolve().then(() => {
      const messageId = w.post(w.owner, claim(requestId));
      attempts.push({ simulated: true, owner: w.owner, taskId: id, messageId });
      return messageId;
    });
    const outcomes = await Promise.allSettled([publishAndAttempt("racing-one"), publishAndAttempt("racing-two")]);
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    assert.match(outcomes.find(result => result.status === "rejected").reason.message, /work_version_conflict/);
    assert.equal(attempts.length, 1);
    assert.equal(w.tasks().get(id).claimedBy, w.owner);
    assert.equal(w.tasks().get(id).version, 2);
    assert.equal(w.post(w.owner, claim("racing-one")), attempts[0].messageId, "exact transport retry reuses the saved claim");
    assert.equal(w.session.db.getTranscriptEntries().filter(entry => entry.collaborationEvent?.task.state === "claimed").length, 1);
    if (surface === "group") assert.throws(() => w.command("a", id, "claim"), /work_not_owner/);
  });
}
