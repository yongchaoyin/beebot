import assert from "node:assert/strict";
import test from "node:test";
import { continuityHarness } from "./helpers/continuity-harness.mjs";

// Adapted from ddd0d0f to the primary event protocol. Real dispatch, publication,
// SQLite and SessionRuntime; only model/OS boundaries are deterministic fixtures.
async function fixture(t, solo=false) {
 const h=await continuityHarness(t), room=solo?"a":"room", session=h.sessions.get(room);
 session.db.appendTranscriptEntry({id:"goal",kind:"message",role:"user",content:"Deliver both assigned outcomes"});
 let seq=0; const turn=new h.runtime.TurnRuntime(h.tm); h.tm.turnRuntime=turn; h.tm.ackObligations.fulfillAckObligation=()=>{};
 const post=(actor,raw)=>solo?turn.handleAgentUpdate({type:"send-message",message:raw,timestampMs:Date.now()},session):
   h.tm.groupChat.postGroupMemberMessage(session,{id:actor,name:actor},raw.content,undefined,h.runtime.prepareGroupPublication(session.dbPath,raw,false));
 const entries=()=>h.entries(room), tasks=()=>h.runtime.projectCollaboration(entries());
 const owner=solo?"a":"b";
 const action=(actor,op)=>post(actor,{type:"text",content:"Work update",purpose:"update",collaboration:{request_id:`op-${++seq}`,...op}});
 const assign=()=>action("a",{action:"assign",goal_message_id:"goal",title:"Scoped result",assignee:owner,reviewer:solo?"self":"a",criteria:["Correct result"]});
 const command=(actor,id,type,extra={})=>action(actor,{action:type,task_id:id,expected_version:tasks().get(id).version,...extra});
 const evidence=(actor,id,content="Actual result")=>post(actor,{type:"text",purpose:"update",content,reply_to:id});
 const submit=(id,ref=evidence(owner,id))=>command(owner,id,"submit",{result_ids:[ref],evidence_ids:[ref]});
 const review=(id,ref=evidence("a",id,"Checked current result"),verdict="accept")=>command("a",id,"review",{submission_id:tasks().get(id).submission.id,verdict,checks:[{criterion:0,passed:verdict==="accept",note:"Check of this version",evidence_ids:[ref]}]});
 const rejects=(fn,re)=>{const before=JSON.stringify(entries());assert.throws(fn,re);assert.equal(JSON.stringify(entries()),before);};
 return {...h,room,session,owner,post,entries,tasks,assign,command,evidence,submit,review,rejects};
}
for(const solo of [false,true])test(`${solo?"single Bot":"Group"}: unrelated results cannot satisfy another assignment`,async t=>{
 const f=await fixture(t,solo),first=f.assign(),second=f.assign();
 f.command(f.owner,first,"claim");f.command(f.owner,second,"claim");const ref=f.evidence(f.owner,first);
 f.rejects(()=>f.submit(second,ref),/work_evidence_scope/);assert.equal(f.tasks().get(second).state,"claimed");
});
test("a result published before claim cannot be laundered into a fresh attempt",async t=>{
 const f=await fixture(t),id=f.assign(),old=f.evidence(f.owner,id);f.command(f.owner,id,"claim");
 f.rejects(()=>f.submit(id,old),/work_evidence_stale/);
});
test("quoted user revision invalidates old evidence even after reclaim",async t=>{
 const f=await fixture(t),id=f.assign();f.command(f.owner,id,"claim");const old=f.evidence(f.owner,id);
 f.session.db.appendTranscriptEntry({kind:"message",id:"correction",role:"user",content:"Changed requirement",replyTo:id});
 f.command("a",id,"revise",{source_message_id:"correction",title:"Revised",criteria:["New behavior"]});f.command(f.owner,id,"claim");
 f.rejects(()=>f.submit(id,old),/work_evidence_stale/);
});
test("requested rework requires new results and cannot reuse a rejected check report",async t=>{
 const f=await fixture(t),id=f.assign();f.command(f.owner,id,"claim");const old=f.evidence(f.owner,id);f.submit(id,old);
 const check=f.evidence("a",id,"Fails this check");f.review(id,check,"changes");
 f.rejects(()=>f.submit(id,old),/work_evidence_stale/);f.submit(id);
 f.rejects(()=>f.review(id,check),/work_evidence_stale/);
});
test("review reports must follow the exact submission and concern this task",async t=>{
 const f=await fixture(t),id=f.assign(),other=f.assign();f.command(f.owner,id,"claim");
 const premature=f.evidence("a",id,"A plan is not an executed check");f.submit(id);
 f.rejects(()=>f.review(id,premature),/work_evidence_stale/);
 const foreign=f.evidence("a",other);f.rejects(()=>f.review(id,foreign),/work_evidence_scope/);
});
test("result quoting a same-task clarification preserves the original work",async t=>{
 const f=await fixture(t),id=f.assign();f.command(f.owner,id,"claim");
 const question=f.evidence("a",id,"Use the existing interface"),answer=f.evidence(f.owner,question);
 f.submit(id,answer);f.review(id);assert.equal(f.tasks().get(id).state,"accepted");
});
test("single Bot: failed off-screen result persistence cannot return a success message ID", async t => {
  const f = await fixture(t, true);
  assert.notEqual(f.tm.sessions.activeSession?.id, "a");
  const before = JSON.stringify(f.entries());
  f.session.db.durable = false;
  assert.throws(() => f.evidence("a", "goal", "Unsaved result"), /persist|sav/i);
  assert.equal(JSON.stringify(f.entries()), before);
});

test("a failed group stream save cannot promote an unsaved preview to a completed reply", async t => {
  const f = await fixture(t), session = f.sessions.get("room");
  f.tm.sessions.activeSession = session; f.tm.sessions.inMemoryTranscriptAgentId = "room";
  const preview = {kind: "send-message", id: "t999s1", message: {type: "text", content: "Preview"}, streaming: true};
  f.runtime.setTranscript([...f.entries(), preview]);
  session.db.durable = false;
  const live = {sealed: [preview.id], currentText: ""};
  const raw = {type:"text",content:"Final result that failed persistence",reply_to:"goal"};
  assert.throws(() => f.tm.groupChat.postGroupMemberMessage(session, {id:"b",name:"B",description:""}, raw.content,
    live, f.runtime.prepareGroupPublication(session.dbPath, raw, false)), /sav/i);
  assert.equal(f.runtime.getTranscript().find(e => e.id === preview.id).streaming, true);
  assert.deepEqual(live.sealed, [preview.id], "failed publication must remain eligible for preview cleanup");
  assert.equal(f.entries().some(e => e.id === preview.id), false);
});


test("single Bot: actual active-session persistence failure cannot publish, acknowledge or report success", async t => {
  const f = await fixture(t, true), session = f.session;
  const actual = new f.runtime.SessionRuntime(f.tm); actual.activeSession = session;
  f.tm.roster.applyAgentUpdateToOutline = () => {};
  f.tm.sessions.activeSession = session; f.tm.sessions.inMemoryTranscriptAgentId = "a";
  f.runtime.setTranscript(f.entries()); f.tm.appendEntry = actual.appendEntry.bind(actual);
  let acknowledgements = 0;
  f.tm.ackObligations.fulfillAckObligation = () => { acknowledgements++; };
  session.db.durable = false;
  const before = JSON.stringify(f.runtime.getTranscript()), eventCount = f.events.length;
  assert.throws(() => f.evidence("a", "goal", "Unsaved active result"), /persist|sav/i);
  assert.equal(JSON.stringify(f.runtime.getTranscript()), before);
  assert.equal(f.events.length, eventCount);
  assert.equal(acknowledgements, 0);
});

test("single Bot: real active publication persists exactly once before its UI event and acknowledgement", async t => {
  const f = await fixture(t, true), session = f.session;
  const actual = new f.runtime.SessionRuntime(f.tm); actual.activeSession = session;
  f.tm.roster.applyAgentUpdateToOutline = () => {};
  f.tm.sessions.activeSession = session; f.tm.sessions.inMemoryTranscriptAgentId = "a";
  f.runtime.setTranscript(f.entries()); f.tm.appendEntry = actual.appendEntry.bind(actual);
  const order = [], append = session.db.appendTranscriptEntry;
  session.db.appendTranscriptEntry = entry => { order.push("persist"); return append(entry); };
  f.tm.roster.emit = () => { order.push("publish"); };
  f.tm.ackObligations.fulfillAckObligation = () => { order.push("acknowledge"); };
  const id = f.evidence("a", "goal", "Durable active result");
  assert.deepEqual(order, ["persist", "publish", "acknowledge"]);
  assert.equal(f.entries().filter(e => e.id === id).length, 1);
  assert.equal(f.runtime.getTranscript().filter(e => e.id === id).length, 1);
});
