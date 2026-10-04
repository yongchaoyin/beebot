import assert from "node:assert/strict";
import test from "node:test";
import { continuityHarness, deferred, until } from "./helpers/continuity-harness.mjs";

const MEMBERS = ["a", "b", "c", "d"];
const GOAL = "@everyone Prepare the release review together; inspect only, do not deploy.";
const scopes = [
  { title: "Assemble the review index", criterion: "List the three peer reports; do not repeat their checks" },
  { title: "Inspect keyboard navigation", criterion: "Check only focus order and keyboard shortcuts; do not change code" },
  { title: "Inspect translation coverage", criterion: "Check only Chinese and English labels; do not change code" },
  { title: "Inspect package metadata", criterion: "Check only version and bundle identity; do not launch or deploy" },
];

// Model reasoning and work attempts are controlled fixtures. Message building,
// publication, SQLite work records, routing and exclusive run queues are real.
// These tests do not claim a tool-execution sandbox or semantic task deduplication.
async function sendMessage(h, call, message) {
  const built = await h.runtime.buildSandSendMessage({}, message, {
    getIngestAttachment: () => undefined,
    onSendMessage: () => undefined,
  });
  return call.publish(built);
}
const text = (content, extra = {}) => ({ type: "text", purpose: "update", content, ...extra });
const tasks = h => h.runtime.projectCollaboration(h.entries("room"));
const userMessages = (h, room = "room") => h.entries(room).filter(entry => entry.kind === "message" && entry.role === "user");
const publicMessages = h => h.entries("room").filter(entry => entry.kind === "send-message");
function captureActivations(h) {
  const activations = [], run = h.tm.groupChat.runGroupMemberTurn.bind(h.tm.groupChat);
  h.tm.groupChat.runGroupMemberTurn = (...args) => {
    const request = args[1];
    activations.push({ memberId: request.member.id, sourceIds: [...(request.sourceMessageIds ?? [])] });
    return run(...args);
  };
  return activations;
}
function scopeView(prompt) {
  const marker = "Existing division for explicitly focused user goals (scope previews, not new assignments):\n";
  assert.ok(prompt.includes(marker), "the actual runner prompt includes the current shared-goal view");
  return prompt.split(marker)[1].split("\nShared-goal scope coverage:")[0]
    .split("\n").filter(Boolean).map(line => JSON.parse(line));
}

async function divisionHarness(t, { failWorker = false } = {}) {
  const releaseCoordinator = deferred(); t.after(releaseCoordinator.resolve);
  const attempts = [], assignments = new Map(), reports = new Map();
  let h, coordinator, goalId, failingMember;
  async function claimAndAttempt(call, taskId) {
    const before = tasks(h).get(taskId);
    assert.equal(before.assignee, call.id);
    const claimId = await sendMessage(h, call, text(`I own only: ${before.title}.`, {
      reply_to: taskId,
      collaboration: { action: "claim", request_id: `claim-${taskId}`, task_id: taskId, expected_version: before.version },
    }));
    assert.ok(claimId);
    const claimed = tasks(h).get(taskId);
    assert.equal(claimed.state, "claimed");
    assert.equal(claimed.claimedBy, call.id);
    // Simulated executor observation, deliberately after the real durable claim.
    attempts.push({ simulated: true, actor: call.id, taskId, goalId: claimed.goalId, scope: claimed.title, criteria: claimed.criteria });
    if (call.id === failingMember) throw new Error("Simulated worker provider failure after its recorded claim");
    if (call.id === coordinator) await until(() => reports.size === (failWorker ? 2 : 3));
    const content = call.id === coordinator
      ? `Fixture review index; only simulated work was performed. Peer reports: ${[...reports].map(([actor, id]) => `${actor}: [report](sand-msg:${id})`).join(", ")}.`
      : `Fixture observation for ${claimed.title}; no production tool was run.`;
    const resultId = await sendMessage(h, call, text(content, { reply_to: taskId, work_on: taskId }));
    assert.ok(resultId); reports.set(call.id, resultId);
    return resultId;
  }
  h = await continuityHarness(t, { members: MEMBERS, runMember: async (call, turn) => {
    if (turn !== 1) {
      await sendMessage(h, call, text("The separate follow-up was read; previous work was not repeated.", { reply_to: userMessages(h).at(-1).id }));
      return [];
    }
    if (coordinator === undefined) {
      coordinator = call.id; goalId = userMessages(h)[0].id;
      const order = [coordinator, ...MEMBERS.filter(id => id !== coordinator)];
      failingMember = failWorker ? order[1] : undefined;
      await releaseCoordinator.promise;
      for (const [index, memberId] of order.entries()) {
        const scope = scopes[index];
        const taskId = await sendMessage(h, call, text(`@{${memberId}} ${scope.title}. ${scope.criterion}.`, {
          reply_to: goalId,
          collaboration: { action: "assign", request_id: `assign-${memberId}`, goal_message_id: goalId,
            assignee: memberId, title: scope.title, criteria: [scope.criterion] },
        }));
        assert.ok(taskId); assignments.set(memberId, taskId);
      }
      const ownTaskId = assignments.get(coordinator), resultId = await claimAndAttempt(call, ownTaskId);
      assert.equal([...tasks(h).values()].filter(task => task.state === "claimed").length, 4);
      // A failed peer leaves the index incomplete. Successful fixture reports
      // support only this index criterion, never a claim of production execution.
      if (!failWorker) {
        await sendMessage(h, call, text("The fixture review index contains all three peer report references.", {
          reply_to: ownTaskId,
          collaboration: { action: "submit", request_id: "submit-index", task_id: ownTaskId,
            expected_version: tasks(h).get(ownTaskId).version, result_ids: [resultId], evidence_ids: [resultId] },
        }));
        const submitted = tasks(h).get(ownTaskId);
        await sendMessage(h, call, text("I checked the fixture index against its one criterion; all three report references are present.", {
          reply_to: ownTaskId,
          collaboration: { action: "self-check", request_id: "check-index", task_id: ownTaskId,
            expected_version: submitted.version, submission_id: submitted.submission.id,
            checks: [{ criterion: 0, passed: true, evidence_ids: [resultId],
              note: "All three distinct peer report references are in the index; this checks fixture evidence, not production execution." }] },
        }));
      }
    } else {
      const owned = [...tasks(h).values()].filter(task => task.assignee === call.id);
      assert.equal(owned.length, 1);
      assert.match(call.prompt, /Your actual activation messages/);
      assert.match(call.prompt, /Recorded work commitments/);
      assert.match(call.systemPrompt, /A recipient owns only its addressed assignment/);
      const view = scopeView(call.prompt);
      assert.equal(view.find(row => row.id === owned[0].id)?.contextOnly, false);
      const coordinatorScope = view.find(row => row.assignee === coordinator);
      assert.ok(coordinatorScope); assert.equal(coordinatorScope.contextOnly, true);
      await claimAndAttempt(call, owned[0].id);
    }
    return [];
  } });
  const activations = captureActivations(h);
  return { h, attempts, assignments, reports, activations, releaseCoordinator, coordinator: () => coordinator, goalId: () => goalId, failingMember: () => failingMember };
}

test("four colleagues receive one team kickoff followed by distinct real assignments and claims", { timeout: 15000 }, async t => {
  const d = await divisionHarness(t), { h } = d;
  await h.send(GOAL, "room", { clientNonce: "one-team-goal" });
  await until(() => h.calls.length === 1);
  assert.equal(tasks(h).size, 0); assert.equal(d.attempts.length, 0);
  assert.deepEqual(d.activations, [{ memberId: d.coordinator(), sourceIds: [d.goalId()] }]);
  assert.deepEqual(Object.keys(h.records("room").find(record => record.id === d.goalId()).recipients), [d.coordinator()]);
  await h.send(GOAL, "room", { clientNonce: "one-team-goal" });
  assert.equal(h.calls.length, 1, "a blocked coordinator does not cause original-goal fanout or nonce replay");
  d.releaseCoordinator.resolve(); await h.drain();
  assert.deepEqual(h.errors, []);
  assert.equal(h.calls.length, 4); assert.equal(tasks(h).size, 4);
  assert.deepEqual(new Set(d.attempts.map(attempt => attempt.actor)), new Set(MEMBERS));
  assert.deepEqual(new Set(d.attempts.map(attempt => attempt.scope)), new Set(scopes.map(scope => scope.title)));
  assert.ok(d.attempts.every(attempt => attempt.simulated && attempt.goalId === d.goalId() && attempt.scope !== GOAL));
  for (const memberId of MEMBERS.filter(id => id !== d.coordinator())) {
    const taskId = d.assignments.get(memberId), activation = d.activations.find(item => item.memberId === memberId);
    assert.deepEqual(activation.sourceIds, [taskId], "a worker is activated by its assignment, not another copy of the original goal");
    const assignment = publicMessages(h).find(entry => entry.id === taskId);
    assert.equal(assignment.author.id, d.coordinator());
    assert.equal(assignment.replyTo, d.goalId());
    assert.ok(assignment.message.content.includes(`@{${memberId}}`));
    assert.deepEqual(Object.keys(h.records("room").find(record => record.id === taskId).recipients), [memberId]);
    assert.equal(tasks(h).get(taskId).state, "claimed", "a fixture attempt is not fabricated completion");
  }
  assert.equal(d.activations.filter(item => item.sourceIds.includes(d.goalId())).length, 1);
  const ownTask = tasks(h).get(d.assignments.get(d.coordinator()));
  assert.equal(ownTask.state, "completed"); assert.equal(ownTask.selfCheck.actor, d.coordinator());
  assert.equal(h.runtime.workIsCompleted(ownTask, tasks(h)), true);
  const index = publicMessages(h).find(entry => entry.id === d.reports.get(d.coordinator()));
  for (const [actor, id] of d.reports) if (actor !== d.coordinator()) assert.ok(index.message.content.includes(`sand-msg:${id}`));
  assert.equal(publicMessages(h).filter(entry => entry.author.id === d.coordinator()).length, 8,
    "four assignments plus the coordinator's claim, result, submission and self-check must fit one turn");
  assert.deepEqual(h.interrupts, []);
});

test("independent opinions use a real peer discussion and retain each Bot's own authorship", { timeout: 15000 }, async t => {
  let h, first, discussionId, goalId; const opinions = new Map();
  h = await continuityHarness(t, { members: MEMBERS, runMember: async call => {
    assert.equal(opinions.has(call.id), false);
    if (first === undefined) {
      first = call.id; goalId = userMessages(h)[0].id;
      opinions.set(call.id, await sendMessage(h, call, text(`My independent view: ${call.id} prefers verifying the constraints first.`, { reply_to: goalId })));
      discussionId = await sendMessage(h, call, { type: "text", purpose: "discussion", reply_to: goalId,
        content: "@everyone Give your own independent view of this proposal; this is discussion only, do not execute it." });
    } else {
      opinions.set(call.id, await sendMessage(h, call, text(`My independent view: ${call.id} would examine a different tradeoff.`, { reply_to: discussionId })));
    }
    return [];
  } });
  const activations = captureActivations(h);
  await h.send("@everyone Please each give an independent opinion; do not make changes."); await h.drain();
  assert.deepEqual(h.errors, []); assert.equal(h.calls.length, 4); assert.equal(tasks(h).size, 0);
  for (const [memberId, messageId] of opinions) assert.equal(publicMessages(h).find(entry => entry.id === messageId).author.id, memberId);
  assert.deepEqual(activations.filter(item => item.memberId !== first).map(item => item.sourceIds), [[discussionId], [discussionId], [discussionId]]);
  assert.equal(activations.filter(item => item.sourceIds.includes(goalId)).length, 1);
});

test("second and third group supplements stay with the busy team listener and are not lost", { timeout: 15000 }, async t => {
  const gate = deferred(); t.after(gate.resolve); let h, first;
  h = await continuityHarness(t, { members: MEMBERS, runMember: async (call, turn) => {
    first ??= call.id;
    if (turn === 1) await gate.promise;
    await sendMessage(h, call, text("I read the pending constraints; no execution was performed.", { reply_to: userMessages(h).at(-1).id }));
    return [];
  } });
  const activations = captureActivations(h);
  await h.send(GOAL); await until(() => h.calls.length === 1);
  await h.send("Second constraint: keep the existing draft.");
  await h.send("Third constraint: keep the existing permissions.");
  assert.equal(h.calls.length, 1); assert.deepEqual(h.interrupts, []);
  gate.resolve(); await h.drain();
  const ids = userMessages(h).map(entry => entry.id);
  assert.equal(ids.length, 3); assert.ok(h.calls.length >= 2);
  assert.ok(h.calls.every(call => call.id === first));
  assert.deepEqual(activations.flatMap(item => item.sourceIds), ids);
  assert.match(h.calls.slice(1).map(call => call.prompt).join("\n"), /keep the existing draft/);
  assert.match(h.calls.slice(1).map(call => call.prompt).join("\n"), /keep the existing permissions/);
  assert.ok(ids.every(id => ["processed", "replied"].includes(h.records("room").find(record => record.id === id).state)));
  assert.equal(tasks(h).size, 0); assert.deepEqual(h.errors, []);
});

test("single Bot retains all three sends in order while the first controlled model turn is busy", { timeout: 15000 }, async t => {
  const gate = deferred(); t.after(gate.resolve);
  const h = await continuityHarness(t, { members: MEMBERS, runDirect: async ({ prompt }) => { if (prompt === "First private question") await gate.promise; } });
  await h.send("First private question", "a"); await until(() => h.directCalls.length === 1);
  await h.send("Second private question", "a"); await h.send("Third private question", "a");
  assert.equal(h.directCalls.length, 1); assert.deepEqual(h.interrupts, []);
  gate.resolve(); await h.drain();
  assert.deepEqual(h.directCalls.map(call => call.prompt), ["First private question", "Second private question", "Third private question"]);
  assert.equal(h.records("a").length, 3); assert.ok(h.records("a").every(record => record.state === "replied"));
  assert.equal(h.calls.length, 0); assert.equal(userMessages(h, "room").length, 0);
});

test("a failed claimed worker is not replayed or silently reassigned while independent colleagues continue", { timeout: 15000 }, async t => {
  const d = await divisionHarness(t, { failWorker: true }), { h } = d;
  await h.send(GOAL, "room", { clientNonce: "failed-worker-goal" }); await until(() => h.calls.length === 1);
  d.releaseCoordinator.resolve(); await h.drain();
  assert.equal(h.calls.length, 4); assert.equal(d.attempts.length, 4); assert.equal(h.errors.length, 1);
  const failedTaskId = d.assignments.get(d.failingMember());
  assert.equal(tasks(h).get(failedTaskId).state, "claimed");
  assert.equal(h.records("room").find(record => record.id === failedTaskId).recipients[d.failingMember()], "failed");
  assert.ok(h.entries("room").some(entry => entry.kind === "notice" && JSON.stringify(entry).includes("delivery_failed")));
  await h.send(GOAL, "room", { clientNonce: "failed-worker-goal" }); await h.drain();
  assert.equal(h.calls.length, 4); assert.equal(d.attempts.length, 4);
  const healthy = MEMBERS.find(id => id !== d.coordinator() && id !== d.failingMember());
  await h.send(`@{${healthy}} Explain the available evidence only; do not retry another colleague's operation.`); await h.drain();
  assert.equal(h.calls.length, 5); assert.equal(d.attempts.length, 4);
  assert.equal(tasks(h).get(failedTaskId).assignee, d.failingMember());
});

test("Stop prevents late assignments and queued supplements; an accepted nonce never replays the old team goal", { timeout: 15000 }, async t => {
  const gate = deferred(); t.after(gate.resolve); let h, first, goalId; const lateIds = [];
  h = await continuityHarness(t, { members: MEMBERS, runMember: async call => {
    if (first === undefined) {
      first = call.id; goalId = userMessages(h)[0].id; await gate.promise;
      const target = MEMBERS.find(id => id !== first);
      lateIds.push(await sendMessage(h, call, text(`@{${target}} This late assignment must not start.`, {
        reply_to: goalId, collaboration: { action: "assign", request_id: "late-assignment", goal_message_id: goalId,
          assignee: target, title: "Late inspection", criteria: ["Never run after Stop"] },
      })));
    } else await sendMessage(h, call, text("I can answer the new question without restarting the stopped goal.", { reply_to: userMessages(h).at(-1).id }));
    return [];
  } });
  await h.send(GOAL, "room", { clientNonce: "stopped-team-goal" }); await until(() => h.calls.length === 1);
  await h.send("Keep this queued supplement with the original request.");
  const result = await h.tm.sendPipeline.stopConversation("room");
  assert.equal(result.accepted, true); assert.equal(result.externalEffectsUndone, false);
  gate.resolve(); await h.drain();
  assert.equal(h.calls.length, 1); assert.deepEqual(lateIds, [undefined]); assert.equal(tasks(h).size, 0);
  assert.equal(h.records("room").find(record => record.id === goalId).state, "needs-review");
  assert.equal(h.records("room").find(record => record.id === userMessages(h)[1].id).state, "cancelled");
  assert.deepEqual(h.interrupts.map(item => item.id), [first]);
  await h.send(GOAL, "room", { clientNonce: "stopped-team-goal" }); await h.drain(); assert.equal(h.calls.length, 1);
  const target = MEMBERS.find(id => id !== first);
  await h.send(`@{${target}} Separate read-only question: what information would be needed next?`); await h.drain();
  assert.equal(h.calls.length, 2); assert.equal(h.calls.at(-1).id, target); assert.equal(tasks(h).size, 0);
});
