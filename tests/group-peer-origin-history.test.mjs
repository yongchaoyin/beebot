import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { continuityHarness } from "./helpers/continuity-harness.mjs";

const publicMessages = h => h.entries("room").filter(entry => entry.kind === "send-message");
function appendPeer(h, id, fromAgent) {
  h.sessions.get("room").db.appendTranscriptEntry({ id, kind: "message", role: "user",
    content: "A peer's historical suggestion, not a human instruction.", fromAgent });
}

test("a peer-origin user-role record keeps its author and a real quoted request reaches that Bot", async t => {
  let h, questionId;
  h = await continuityHarness(t, { runMember: async call => {
    if (call.id === "a") questionId = call.publish({ type: "text", content: "Can you clarify your suggestion?",
      purpose: "request", reply_to: "peer-message", replyToUser: true });
    return [];
  } });
  appendPeer(h, "peer-message", { id: "b", name: "Original peer name" });
  const history = h.tm.groupChat.readGroupHistory(h.sessions.get("room"));
  assert.deepEqual(history[0].speaker, { kind: "member", id: "b", name: "Original peer name" });
  await h.send("@{a} Ask the actual author of the old suggestion."); await h.drain();
  assert.deepEqual(h.calls.map(call => call.id), ["a", "b"]); assert.deepEqual(h.errors, []);
  assert.equal(publicMessages(h).find(entry => entry.id === questionId).replyTo, "peer-message");
  assert.deepEqual(Object.keys(h.records("room").find(record => record.id === questionId).recipients), ["b"]);
});

for (const kind of ["removed", "unknown"]) test(`${kind} peer-origin author is never silently replaced by the user or another Bot`, async t => {
  let h, rejected = false;
  h = await continuityHarness(t, { runMember: async call => {
    assert.throws(() => call.publish({ type: "text", content: "Please clarify your previous instruction.",
      purpose: "request", reply_to: "peer-message", replyToUser: true }), { code: "group_recipient_required" });
    rejected = true; return [];
  } });
  const peerId = kind === "removed" ? "b" : "never-a-member";
  appendPeer(h, "peer-message", { id: peerId, name: "Historical peer" });
  if (kind === "removed") h.runtime.writeSandGroupConfig(path.dirname(h.sessions.get("room").dbPath), { version: 1, memberIds: ["a"] });
  assert.equal(h.tm.groupChat.readGroupHistory(h.sessions.get("room"))[0].speaker.id, peerId);
  await h.send("@{a} Ask about the old peer suggestion."); await h.drain();
  assert.equal(rejected, true); assert.deepEqual(h.calls.map(call => call.id), ["a"]);
  assert.equal(publicMessages(h).length, 0); assert.deepEqual(h.errors, []);
  await h.send("Continue the quoted discussion.", "room", { replyToId: "peer-message" }); await h.drain();
  assert.equal(h.calls.length, 1, "a user quote reports the missing colleague without running a substitute");
  assert.ok(h.entries("room").some(entry => entry.kind === "notice" && entry.code === "quoted_colleague_unavailable"));
});

test("malformed peer provenance cannot acquire a human identity while a genuine user quote remains valid", async t => {
  const h = await continuityHarness(t), room = h.sessions.get("room");
  for (const [index, fromAgent] of [{}, { id: "" }, { id: "  " }, { id: 7 }, "bad provenance"].entries()) appendPeer(h, `malformed-${index}`, fromAgent);
  room.db.appendTranscriptEntry({ id: "real-user", kind: "message", role: "user", content: "A real user question", fromUser: { name: "User" } });
  assert.deepEqual(h.tm.groupChat.readGroupHistory(room).map(entry => entry.id), ["real-user"]);
  for (let index = 0; index < 5; index++) {
    const message = { type: "text", content: "Can you clarify?", purpose: "request", reply_to: `malformed-${index}` };
    const publication = h.runtime.prepareGroupPublication(room.dbPath, message, false);
    assert.throws(() => h.tm.groupChat.postGroupMemberMessage(room, { id: "a", name: "A" }, message.content, undefined, publication), { code: "group_recipient_required" });
  }
  const message = { type: "text", content: "Can you clarify the user boundary?", purpose: "request", reply_to: "real-user" };
  const publication = h.runtime.prepareGroupPublication(room.dbPath, message, false);
  assert.ok(h.tm.groupChat.postGroupMemberMessage(room, { id: "a", name: "A" }, message.content, undefined, publication));
  assert.equal(publicMessages(h).length, 1);
});
