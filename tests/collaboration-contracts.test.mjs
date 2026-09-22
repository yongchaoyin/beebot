import assert from "node:assert/strict";
import test from "node:test";
import { continuityHarness, until } from "./helpers/continuity-harness.mjs";

function user(h, room = "room") { return h.entries(room).find(entry => entry.role === "user").id; }
const text = (reply_to, collaboration, content = "Actual colleague message") => ({type: "text", content, reply_to, collaboration});
const assignment = assignee => ({action: "assign", title: "Input behavior", deliverable: "Source and tests", criteria: ["No repeated send", "IME stays correct"], ...(assignee ? {assignee_id: assignee} : {})});

// Uses the real group ingress, publication, DB and member scheduler, not a
// standalone invented ledger. The model is a deterministic controlled runner.
test("assignment and claim are real quoted messages in one durable journal, not message completion", async t => {
  let h, taskId;
  h = await continuityHarness(t, {runMember: async call => {
    if (call.id === "a" && !taskId) taskId = call.publish(text(user(h), assignment("b"), "@{b} Please handle input"));
    else if (call.id === "b") call.publish(text(taskId, {action: "claim", task_id: taskId, expected_version: 1}, "I will handle it"));
    return [];
  }});
  await h.send("@{a} Coordinate input improvements"); await h.drain();
  const tasks = h.runtime.collaborationTasks(h.entries("room")), task = tasks.get(taskId);
  assert.equal(task.ownerId, "b"); assert.equal(task.state, "claimed"); assert.equal(task.version, 2);
  assert.equal(h.calls.length, 2, "a claim is visible but does not wake everybody to say thanks");
  assert.equal(h.entries("room").filter(e => e.collaborationEvent).length, 2);
  assert.match(h.calls.find(c => c.id === "b").systemPrompt, /Input behavior/);
  assert.notEqual(task.state, "completed");
});

test("informational updates remain visible and do not fan out even when quoting a colleague", async t => {
  let h;
  h = await continuityHarness(t, {runMember: async call => {
    call.publish({type: "text", content: "Investigation underway, nothing needed from you", intent: "update", reply_to: user(h)});
    return [];
  }});
  await h.send("@{a} Investigate"); await h.drain();
  assert.equal(h.calls.length, 1); assert.ok(h.entries("room").some(e => e.message?.intent === "update"));
});

test("reserved assignment rejects the wrong claimant and stale versions without publishing success", async t => {
  const h = await continuityHarness(t); await h.send("@{a} Scope"); await h.drain();
  const room = h.sessions.get("room"), post = (actor, message) => h.tm.groupChat.postGroupMemberMessage(room, {id:actor,name:actor,description:""}, message.content, undefined, h.runtime.prepareGroupPublication(room.dbPath, message, false));
  const id = post("a", text(user(h), assignment("b")));
  assert.throws(() => post("a", text(id, {action:"claim",task_id:id,expected_version:1})), /reserved/);
  assert.throws(() => post("b", text(id, {action:"claim",task_id:id,expected_version:2})), /Stale work version/);
  post("b", text(id, {action:"claim",task_id:id,expected_version:1}));
  assert.throws(() => post("b", text(id, {action:"claim",task_id:id,expected_version:1})), /Stale work version/);
  assert.equal(h.entries("room").filter(e=>e.collaborationEvent).length, 2);
});

test("failed transcript persistence cannot leave an invisible work claim", async t => {
  const h = await continuityHarness(t); await h.send("@{a} Scope"); await h.drain();
  const room = h.sessions.get("room"), msg = text(user(h), assignment("b"));
  room.db.durable = false;
  assert.throws(()=>h.tm.groupChat.postGroupMemberMessage(room,{id:"a",name:"A",description:""},msg.content,undefined,h.runtime.prepareGroupPublication(room.dbPath,msg,false)),/not saved/);
  assert.equal(h.runtime.collaborationTasks(h.entries("room")).size,0);
});

test("work is scoped to its conversation and rejects forged identities and association", async t => {
  const h = await continuityHarness(t,{extraGroups:["other"]}); await h.send("@{a} Scope"); await h.drain();
  const entries=h.entries("room");
  const entry={kind:"send-message",id:"t2s1",replyTo:user(h),message:text(user(h),assignment("b"))};
  assert.throws(()=>h.runtime.stampCollaborationEntry(entry,entries,"outside",["a","b"]),/no longer a member/);
  assert.throws(()=>h.runtime.stampCollaborationEntry(entry,entries,"a",["a","b"],true),/owned local/);
  assert.throws(()=>h.runtime.stampCollaborationEntry(entry,h.entries("other"),"a",["a","b"]),/not available/);
});

test("single Bot uses the actual outgoing update handler to save its own responsibility", async t => {
  const h=await continuityHarness(t); await h.send("Give me source and tests","a"); await h.drain();
  const session=h.sessions.get("a"),runtime=new h.runtime.TurnRuntime(h.tm);
  // This exercise enters the production event handler, with an off-screen chat.
  const incoming=text(user(h,"a"),assignment("a"));
  h.tm.ackObligations.fulfillAckObligation=()=>{};
  const id=runtime.handleAgentUpdate({type:"send-message",message:incoming,timestampMs:Date.now()},session);
  assert.equal(h.runtime.collaborationTasks(h.entries("a")).get(id).assigneeId,"a");
  assert.equal(h.runtime.collaborationTasks(h.entries("room")).size,0);
});

test("outgoing SendMessage builder preserves the action and cannot smuggle it into an external channel", async t => {
  const h=await continuityHarness(t);
  const input=text("t1u",assignment("b"));
  const result=await h.runtime.buildSandSendMessage({},input,{getIngestAttachment:()=>undefined});
  assert.deepEqual(result.collaboration,input.collaboration);
  await assert.rejects(h.runtime.buildSandSendMessage({},{...input,channel:"slack:other"},{getIngestAttachment:()=>undefined}), /Work actions require/);
});
