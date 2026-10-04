import assert from "node:assert/strict";
import test from "node:test";
import { continuityHarness } from "./helpers/continuity-harness.mjs";

const work = (id, extra = {}) => ({
  id, goalId: "shared-goal", creator: "a", assignee: "b", reviewer: "self",
  reviewPolicy: "owner", title: `Scope ${id}`, criteria: [`Deliver only ${id}`],
  dependencies: [], version: 1, scopeVersion: 1, state: "offered",
  evidenceIds: [], updatedBy: "a", updatedMessageId: id, ...extra,
});
const taskMap = values => new Map(values.map(value => [value.id, value]));
const scopeRows = context => {
  const body = context.split("Existing division for explicitly focused user goals (scope previews, not new assignments):\n")[1];
  assert.ok(body, "the actual execution prompt must contain the shared-goal section");
  return body.split("\nShared-goal scope coverage:")[0].split("\n").filter(Boolean).map(line => JSON.parse(line));
};

function setupWork(h) {
  const session = h.sessions.get("room");
  const appendUser = (id, content, replyTo) => session.db.appendTranscriptEntry({
    id, kind: "message", role: "user", content, ...(replyTo ? { replyTo } : {}),
  });
  const publish = message => h.tm.groupChat.postGroupMemberMessage(session, { id: "a", name: "A" }, message.content,
    undefined, h.runtime.prepareGroupPublication(session.dbPath, message, false));
  appendUser("shared-goal", "Compare the current product and make a divided recommendation; do not edit files.");
  const assign = (requestId, assignee, title, goalId = "shared-goal") => publish({
    type: "text", content: `@{${assignee}} ${title}`, purpose: "request",
    collaboration: { action: "assign", request_id: requestId, goal_message_id: goalId,
      assignee, reviewer: "self", title, criteria: [`Publish evidence for ${title} only`] },
  });
  const first = assign("experience", "b", "Inspect the interaction and accessibility");
  const second = assign("runtime", "c", "Inspect routing and execution boundaries");
  return { session, appendUser, publish, assign, first, second };
}

test("focused goal scopes expose real peer ownership without creating obligations", async t => {
  const h = await continuityHarness(t);
  const tasks = taskMap([
    work("experience"), work("runtime", { assignee: "c", reviewer: "d" }),
    work("outside", { goalId: "other-goal", assignee: "c" }),
  ]);
  const before = JSON.stringify([...tasks]);
  const helper = h.runtime.workContextView(tasks, "d", new Set(["experience"]));
  assert.deepEqual(helper.sharedGoalScopes.map(row => row.id), ["experience", "runtime"]);
  assert.ok(helper.sharedGoalScopes.every(row => row.contextOnly === true));
  assert.equal(helper.sharedGoalScopes.find(row => row.id === "runtime").assignee, "c",
    "being the reviewer must not transfer the owner's execution scope");
  assert.equal(helper.coverage.relevant, 1, "existing review obligations remain separate");
  assert.deepEqual(helper.sharedGoalCoverage, { goals: 1, total: 2, shown: 2, omitted: 0 });
  const owner = h.runtime.workContextView(tasks, "b", new Set(["shared-goal"]));
  assert.equal(owner.sharedGoalScopes.find(row => row.id === "experience").contextOnly, false);
  assert.equal(owner.sharedGoalScopes.find(row => row.id === "runtime").contextOnly, true);
  const coordinator = h.runtime.workContextView(tasks, "a", new Set(["shared-goal"]));
  assert.ok(coordinator.sharedGoalScopes.every(row => row.contextOnly === true));
  assert.equal(h.runtime.workContextView(tasks, "d", new Set(["foreign-id"])).sharedGoalScopes.length, 0);
  assert.equal(JSON.stringify([...tasks]), before);
});

test("shared scope previews are independently bounded and explicitly report omissions", async t => {
  const h = await continuityHarness(t);
  const tasks = taskMap(Array.from({ length: 256 }, (_, index) => work(`${index}-${"i".repeat(240)}`, {
    goalId: "g".repeat(255), title: "t".repeat(240), criteria: Array(12).fill("x".repeat(600)),
    assignee: index === 0 ? "reader" : "peer", creator: "peer", reviewer: "self",
  })));
  const before = JSON.stringify([...tasks]);
  const unfocused = h.runtime.workContextView(tasks, "reader");
  const view = h.runtime.workContextView(tasks, "reader", new Set(["g".repeat(255)]));
  assert.deepEqual(view.details, unfocused.details, "peer scope previews cannot displace the owned detail budget");
  assert.ok(view.sharedGoalScopes.length > 0 && view.sharedGoalScopes.length <= 32);
  assert.ok(view.sharedGoalScopes.reduce((sum, row) => sum + JSON.stringify(row).length + 1, 0) <= 8000);
  assert.equal(view.sharedGoalCoverage.total, 256);
  assert.equal(view.sharedGoalCoverage.shown + view.sharedGoalCoverage.omitted, 256);
  assert.ok(view.sharedGoalCoverage.omitted > 0);
  for (const row of view.sharedGoalScopes) {
    assert.equal(row.criteriaCount, 12); assert.equal(row.criteriaTruncated, true);
    assert.equal(row.criteriaPreview.length, 3); assert.ok(row.criteriaPreview.every(text => text.length <= 180));
    assert.ok(row.requirementsSourceId); assert.ok(row.updatedMessageId);
  }
  assert.equal(JSON.stringify([...tasks]), before);
});

test("actual group execution sees siblings through a quote even before the helper owns work", async t => {
  const h = await continuityHarness(t, { members: ["a", "b", "c", "d"], runMember: async () => [] });
  const { appendUser, publish, assign, first, second } = setupWork(h);
  appendUser("other-goal", "Unrelated task");
  assign("unrelated", "c", "Unrelated private scope within this room", "other-goal");
  const request = publish({ type: "text", content: "@{d} Give bounded advice on the proposed division; do not take over.",
    purpose: "request", reply_to: first });
  const before = JSON.stringify([...h.runtime.projectCollaboration(h.entries("room"))]);
  await h.send("@{d} Please answer that question only", "room", { replyToId: request });
  await h.drain();
  assert.deepEqual(h.calls.map(call => call.id), ["d"]);
  const rows = scopeRows(h.calls[0].prompt);
  assert.deepEqual(new Set(rows.map(row => row.id)), new Set([first, second]));
  assert.deepEqual(new Set(rows.map(row => row.assignee)), new Set(["b", "c"]));
  assert.ok(rows.every(row => row.contextOnly));
  assert.equal(JSON.stringify([...h.runtime.projectCollaboration(h.entries("room"))]), before,
    "receiving the division must not claim, revise, complete or reassign it");
  assert.match(h.calls[0].prompt, /omitted rows are not unowned or finished work/);
  assert.match(h.calls[0].systemPrompt, /original user goal.*context, not an assignment to repeat the whole task/);
});

test("division follows current revisions and stays scoped to the supplied conversation", async t => {
  const h = await continuityHarness(t, { members: ["a", "b", "c", "d"], extraGroups: ["other-room"] });
  const { session, appendUser, publish, first } = setupWork(h);
  appendUser("correction", "Only inspect keyboard accessibility now", first);
  const revision = publish({ type: "text", content: "@{b} Narrowed to keyboard accessibility", purpose: "update", collaboration: {
    action: "revise", request_id: "revised-experience", task_id: first, expected_version: 1,
    source_message_id: "correction", title: "Keyboard accessibility only", criteria: ["Report keyboard access; do not edit"],
  } });
  const before = JSON.stringify(session.db.getTranscriptEntries());
  const row = scopeRows(h.runtime.collaborationContext(h.entries("room"), "d", ["correction"]))
    .find(item => item.id === first);
  assert.equal(row.title, "Keyboard accessibility only");
  assert.equal(row.version, 2); assert.equal(row.scopeVersion, 2);
  assert.equal(row.requirementsSourceId, "correction"); assert.equal(row.updatedMessageId, revision);
  assert.equal(row.contextOnly, true);
  const elsewhere = h.runtime.collaborationContext(h.entries("other-room"), "d", ["shared-goal", first]);
  assert.ok(!elsewhere.includes("Keyboard accessibility") && !elsewhere.includes("Existing division"));
  assert.equal(JSON.stringify(session.db.getTranscriptEntries()), before);
});

test("ordinary direct chat remains task-free and instructions preserve independent opinions", async t => {
  const h = await continuityHarness(t);
  const entries = [{ id: "question", kind: "message", role: "user", content: "Explain the tradeoff" }];
  assert.ok(!h.runtime.collaborationContext(entries, "a", ["question"]).includes("Recorded work commitments"));
  assert.equal(h.runtime.projectCollaboration(entries).size, 0);
  assert.match(h.runtime.NATURAL_WORK_GUIDANCE, /targeted request for advice can remain ordinary discussion without a formal task/);
  assert.match(h.runtime.NATURAL_WORK_GUIDANCE, /Preserve explicitly requested independent opinions or parallel checks/);
  assert.match(h.runtime.NATURAL_WORK_GUIDANCE, /does not transfer your original responsibility/);
  assert.match(h.runtime.NATURAL_WORK_GUIDANCE, /never bypass criteria already established/);
});
