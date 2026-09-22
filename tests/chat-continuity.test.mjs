import assert from "node:assert/strict";
import test from "node:test";
import { continuityHarness, deferred, until } from "./helpers/continuity-harness.mjs";

test("actual send ingress keeps second and third targeted group requests while A is busy", { timeout: 10000 }, async t => {
  const gate = deferred(); t.after(gate.resolve);
  const h = await continuityHarness(t, { runMember: async (call, turn) => {
    if (call.id === "a" && turn === 1) await gate.promise;
    return ["(pass)"];
  } });
  await h.send("@{a} first question"); await until(() => h.calls.length === 1);
  const epoch = h.tm.sendPipeline.currentTurnEpoch(h.sessions.get("room"));
  await h.send("@{b} second question"); await until(() => h.calls.some(call => call.id === "b"));
  await h.send("@{a} third question");
  assert.equal(h.tm.sendPipeline.currentTurnEpoch(h.sessions.get("room")), epoch, "normal messages do not invalidate the group epoch");
  assert.equal(h.calls.filter(c => c.id === "a").length, 1, "one Bot retains exclusive execution");
  gate.resolve(); await h.drain();
  assert.equal(h.calls.filter(c => c.id === "a").length, 2);
  assert.match(h.calls.filter(c => c.id === "a")[1].prompt, /third question/);
  assert.equal(h.entries("room").filter(e => e.role === "user").length, 3);
  assert.equal(h.records("room").filter(r => r.state === "processed").length, 3);
  assert.equal(h.interrupts.length, 0);
});

test("messages arriving while members are being resolved are all routed", { timeout: 10000 }, async t => {
  const gate = deferred(); t.after(gate.resolve);
  const h = await continuityHarness(t);
  const original = h.tm.groupChat.resolveGroupMembers.bind(h.tm.groupChat);
  h.tm.groupChat.resolveGroupMembers = async (...args) => { await gate.promise; return original(...args); };
  await h.send("@{a} first"); await h.send("@{b} second"); await h.send("@{a} third");
  gate.resolve(); await h.drain();
  assert.equal(h.calls.length, 2);
  assert.match(h.calls.find(c => c.id === "a").prompt, /first/);
  assert.match(h.calls.find(c => c.id === "a").prompt, /third/);
  assert.match(h.calls.find(c => c.id === "b").prompt, /second/);
  assert.ok(h.records("room").every(r => r.state === "processed"));
});

test("an earlier completed reply remains published after a follow-up arrives", { timeout: 10000 }, async t => {
  const gate = deferred(); t.after(gate.resolve);
  const h = await continuityHarness(t, { runMember: async (call, turn) => {
    if (call.id === "a" && turn === 1) { await gate.promise; return ["@{a} First result remains visible."]; }
    return ["(pass)"];
  } });
  await h.send("@{a} first"); await until(() => h.calls.length === 1);
  await h.send("@{b} second"); gate.resolve(); await h.drain();
  assert.ok(h.entries("room").some(e => e.message?.content?.includes("First result remains visible")));
});

test("a member failure is visible inline and does not silence other colleagues", { timeout: 10000 }, async t => {
  const h = await continuityHarness(t, { runMember: async call => {
    if (call.id === "a") throw new Error("fixture model failure");
    return ["(pass)"];
  } });
  await h.send("@all check"); await h.drain();
  assert.equal(h.calls.length, 2);
  assert.ok(h.entries("room").some(e => e.kind === "notice" && e.replyTo));
  assert.equal(h.records("room")[0].recipients.a, "failed");
  assert.equal(h.records("room")[0].recipients.b, "processed");
  await h.send("@{b} keep working"); await h.drain();
  assert.equal(h.calls.filter(c => c.id === "b").length, 2);
});

test("single Bot sends queue all three messages and never interrupt the active reply", { timeout: 10000 }, async t => {
  const gate = deferred(); t.after(gate.resolve);
  const h = await continuityHarness(t, { runDirect: async ({ prompt }) => { if (prompt === "first") await gate.promise; } });
  await h.send("first", "a"); await until(() => h.directCalls.length === 1);
  await h.send("second", "a"); await h.send("third", "a");
  assert.equal(h.directCalls.length, 1); assert.equal(h.interrupts.length, 0);
  gate.resolve(); await h.drain();
  assert.deepEqual(h.directCalls.map(c => c.prompt), ["first", "second", "third"]);
  assert.deepEqual(h.directCalls.map(c => c.epoch), [1, 2, 3]);
  assert.equal(h.records("a").length, 3);
});

test("a private message does not cancel the same Bot's group commitment", { timeout: 10000 }, async t => {
  const gate = deferred(); t.after(gate.resolve);
  const h = await continuityHarness(t, { runMember: async () => { await gate.promise; return ["(pass)"]; } });
  await h.send("@{a} group task"); await until(() => h.calls.length === 1);
  await h.send("private question", "a"); assert.equal(h.directCalls.length, 0); assert.equal(h.interrupts.length, 0);
  gate.resolve(); await h.drain();
  assert.equal(h.directCalls.length, 1);
  assert.equal(h.entries("a").filter(e => e.role === "user").length, 1);
  assert.equal(h.entries("room").filter(e => e.role === "user").length, 1);
});

test("an explicit control epoch fences queued private messages but later messages still run", { timeout: 10000 }, async t => {
  const gate = deferred(); t.after(gate.resolve);
  const h = await continuityHarness(t, { runDirect: async ({ prompt }) => { if (prompt === "first") await gate.promise; } });
  await h.send("first", "a"); await until(() => h.directCalls.length === 1); await h.send("queued", "a");
  h.tm.sendPipeline.nextTurnEpoch(h.sessions.get("a"));
  await h.send("after explicit stop", "a"); gate.resolve(); await h.drain();
  assert.deepEqual(h.directCalls.map(c => c.prompt), ["first", "after explicit stop"]);
  assert.equal(h.records("a").find(r => r.state === "cancelled")?.recipients.a, "cancelled");
});

test("an unpersisted message never starts model work and remains safe to retry", { timeout: 10000 }, async t => {
  const h = await continuityHarness(t);
  h.sessions.get("room").db.durable = false;
  await assert.rejects(h.send("@{a} not durable", "room", { clientNonce: "stable-retry" }), /persist/i);
  assert.equal(h.calls.length, 0); assert.equal(h.entries("room").length, 0);
  h.sessions.get("room").db.durable = true;
  await h.send("@{a} not durable", "room", { clientNonce: "stable-retry" }); await h.drain();
  assert.equal(h.calls.length, 1);
});

test("accepted nonce replay is idempotent but intentionally repeated text is a new message", { timeout: 10000 }, async t => {
  const h = await continuityHarness(t);
  await h.send("@{a} continue", "room", { clientNonce: "same" }); await h.drain();
  await h.send("@{a} continue", "room", { clientNonce: "same" }); await h.drain();
  assert.equal(h.calls.length, 1);
  await h.send("@{a} continue"); await h.drain(); assert.equal(h.calls.length, 2);
});

test("one Bot serving two groups never overlaps its execution or reroutes their messages", { timeout: 10000 }, async t => {
  const gate = deferred(); t.after(gate.resolve);
  const h = await continuityHarness(t, { extraGroups: ["other-room"], runMember: async (_c, turn) => { if (turn === 1) await gate.promise; return ["(pass)"]; } });
  await h.send("@{a} first room"); await until(() => h.calls.length === 1);
  await h.send("@{a} second room", "other-room"); assert.equal(h.calls.length, 1);
  gate.resolve(); await h.drain();
  assert.equal(h.calls.length, 2);
  assert.match(h.calls[0].prompt, /first room/); assert.doesNotMatch(h.calls[0].prompt, /second room/);
  assert.match(h.calls[1].prompt, /second room/); assert.doesNotMatch(h.calls[1].prompt, /first room/);
});

test("explicit stop requests cancel only the selected group's active and queued work", { timeout: 10000 }, async t => {
  const gate = deferred(); t.after(gate.resolve);
  const h = await continuityHarness(t, { extraGroups: ["other-room"], runMember: async () => { await gate.promise; return ["(pass)"]; } });
  await h.send("@{a} original"); await until(() => h.calls.length === 1);
  await h.send("@{a} queued");
  const result = await h.tm.sendPipeline.stopConversation("room");
  assert.equal(result.accepted, true); assert.equal(result.externalEffectsUndone, false);
  assert.equal(h.interrupts.length, 1); assert.equal(h.interrupts[0].id, "a");
  gate.resolve(); await h.drain();
  assert.equal(h.calls.length, 1);
  assert.ok(h.entries("room").some(entry => entry.code === "conversation_stop_requested"));
  await h.send("@{b} new request"); await h.drain(); assert.equal(h.calls.length, 2);
});

test("stopping a private chat never interrupts that Bot's active group runner", { timeout: 10000 }, async t => {
  const gate = deferred(); t.after(gate.resolve);
  const h = await continuityHarness(t, { runMember: async () => { await gate.promise; return ["(pass)"]; } });
  await h.send("@{a} group commitment"); await until(() => h.calls.length === 1);
  await h.tm.sendPipeline.stopConversation("a"); assert.equal(h.interrupts.length, 0);
  gate.resolve(); await h.drain(); assert.equal(h.records("room")[0].state, "processed");
});

test("different inputs cannot coalesce onto an in-flight nonce", { timeout: 10000 }, async t => {
  const gate = deferred(); t.after(gate.resolve);
  const h = await continuityHarness(t, { runDirect: async () => { await gate.promise; } });
  const first = h.send("original", "a", { clientNonce: "colliding", awaitTurn: true });
  await until(() => h.directCalls.length === 1);
  await assert.rejects(h.send("different", "a", { clientNonce: "colliding", awaitTurn: true }), { code: "NONCE_DIGEST_MISMATCH" });
  gate.resolve(); await first; await h.drain(); assert.equal(h.directCalls.length, 1);
});
