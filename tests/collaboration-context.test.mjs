import assert from "node:assert/strict";
import test from "node:test";
import {continuityHarness} from "./helpers/continuity-harness.mjs";

const task = (id, extra={}) => ({id,goalId:`goal-${id}`,creator:"a",assignee:"b",reviewer:"c",title:`Work ${id}`,
  criteria:["Evidence matches requirements"],dependencies:[],version:1,scopeVersion:1,state:"offered",
  evidenceIds:[],updatedBy:"a",updatedMessageId:id,...extra});
const acceptedTask = id => task(id,{state:"accepted",version:4,
  submission:{id:`submit-${id}`,scopeVersion:1,resultIds:[`result-${id}`],evidenceIds:[`result-${id}`],manifest:[],dependencyVersions:[]},
  review:{id:`review-${id}`,reviewer:"c",submissionId:`submit-${id}`,verdict:"accept",checks:[{criterion:0,passed:true,note:"Checked",evidence_ids:[`result-${id}`]}],manifest:[{id:`result-${id}`,digest:"a".repeat(64),files:[]}]},
});
const map = items => new Map(items.map(t=>[t.id,t]));

test("bounded work context preserves obligations instead of the newest 32 task dumps", async t => {
  const h=await continuityHarness(t);const view=h.runtime.workContextView;
  await t.test("old unfinished obligation survives newer accepted work",()=>{
    const tasks=map([task("old-unfinished"),...Array.from({length:45},(_,i)=>acceptedTask(`done-${i}`))]);
    const result=view(tasks,"b");
    assert.equal(result.details[0].id,"old-unfinished");assert.equal(result.coverage.pending,1);
    assert.ok(result.details.length<=32);assert.equal(result.coverage.omittedDetails,14);
  });
  await t.test("explicitly referenced work gets detail without hiding older unfinished work",()=>{
    const tasks=map([task("old"),...Array.from({length:45},(_,i)=>acceptedTask(`done-${i}`))]);
    const result=view(tasks,"b",new Set(["done-35"]));
    assert.equal(result.details[0].id,"done-35");assert.equal(result.details[1].id,"old");
  });
  await t.test("pending review and coordinator blockers outrank passive responsibilities",()=>{
    const tasks=map([task("passive",{reviewer:"a",creator:"c"}),task("needs-review",{reviewer:"a",creator:"c",state:"review"}),task("blocked",{state:"blocked",reason:"Missing environment"})]);
    const result=view(tasks,"a");
    assert.deepEqual(result.details.map(t=>t.id),["needs-review","blocked","passive"]);
  });
  await t.test("dependencies are context only; unrelated work is not assigned to the reader",()=>{
    const tasks=map([task("own",{dependencies:["dep"]}),task("dep",{assignee:"d",creator:"c",reviewer:"d"}),task("unrelated",{assignee:"d",creator:"c",reviewer:"d"})]);
    const result=view(tasks,"b");assert.equal(result.coverage.contextDependencies,1);
    assert.equal(result.details.find(t=>t.id==="dep").contextOnlyDependency,true);
    assert.ok(!result.details.some(t=>t.id==="unrelated"));
  });
  await t.test("evidence manifests are not copied into prompt or treated as semantic proof",()=>{
    const item=acceptedTask("result");item.review.manifest[0].files=[{url:"sensitive-local-path",sha256:"b".repeat(64),bytes:12}];
    const serialized=JSON.stringify(view(map([item]),"b"));
    assert.ok(!serialized.includes("sensitive-local-path"));assert.ok(!serialized.includes("b".repeat(64)));
    assert.ok(serialized.includes('"evidenceVersionPinned":true'));
  });
  await t.test("worst-case IDs/criteria stay bounded and omissions are explicit",()=>{
    const tasks=map(Array.from({length:256},(_,i)=>task(`${i}-${"i".repeat(245)}`,{goalId:"g".repeat(255),criteria:Array(12).fill("x".repeat(600)),evidenceIds:Array(24).fill("e".repeat(255))})));
    const snapshot=JSON.stringify([...tasks]);const result=view(tasks,"b");
    assert.ok(JSON.stringify(result).length<42000);assert.equal(result.coverage.pending,256);
    assert.ok(result.coverage.omittedPending>0);
    assert.equal(result.coverage.detailed+result.coverage.indexedPending+result.coverage.omittedPending,256);
    assert.equal(JSON.stringify([...tasks]),snapshot,"prompt construction must not mutate work");
  });
  await t.test("focus follows explicit quote chains, not text or foreign IDs",()=>{
    const entries=[{id:"goal",kind:"message",role:"user",content:"Work"},{id:"assignment",kind:"send-message",replyTo:"goal"},{id:"question",kind:"send-message",replyTo:"assignment",workOnId:"assignment"},{id:"followup",kind:"message",role:"user",replyTo:"question",content:"Also see private-work"}];
    assert.deepEqual([...h.runtime.workFocus(entries,["followup","foreign"])].sort(),["assignment","followup","goal","question"]);
    const cyclic=[{id:"a",replyTo:"b"},{id:"b",replyTo:"a"}];assert.equal(h.runtime.workFocus(cyclic,["a"]).size,2);
  });
  await t.test("Agent instructions distinguish discussion, help and execution",()=>{
    assert.match(h.runtime.NATURAL_WORK_GUIDANCE,/request for advice is not permission/);
    assert.match(h.runtime.NATURAL_WORK_GUIDANCE,/does not transfer your original responsibility/);
    assert.match(h.runtime.NATURAL_WORK_GUIDANCE,/never bypass criteria already established/);
  });
});

test("actual group prompt hydrates focused responsibility and does not manufacture a scope revision", async t=>{
  const h=await continuityHarness(t,{runMember:async()=>[]});const session=h.sessions.get("room");
  session.db.appendTranscriptEntry({id:"goal",kind:"message",role:"user",content:"Discuss before making changes"});
  const publish=message=>h.tm.groupChat.postGroupMemberMessage(session,{id:"a",name:"A"},message.content,undefined,h.runtime.prepareGroupPublication(session.dbPath,message,false));
  let last;
  for(let i=0;i<38;i++) last=publish({type:"text",content:`Assignment ${i}`,purpose:"update",collaboration:{action:"assign",request_id:`a-${i}`,goal_message_id:"goal",assignee:"b",reviewer:"a",title:`Scoped work ${i}`,criteria:[`Criterion ${i}`]}});
  await h.send("@{b} Please explain this requirement, do not execute yet","room",{replyToId:last});await h.drain();
  assert.equal(h.calls.length,1);
  assert.match(h.calls[0].prompt,/Scoped work 37/);
  assert.match(h.calls[0].prompt,/Criterion 37/);
  assert.match(h.calls[0].prompt,/Context coverage:/);
  assert.match(h.calls[0].systemPrompt,/request for advice is not permission/);
  assert.ok([...h.runtime.projectCollaboration(h.entries("room")).values()].every(t=>t.version===1&&t.state==="offered"));
});

test("single Bot context uses the same priority view with unchanged authoritative versions",async t=>{
  const h=await continuityHarness(t),s=h.sessions.get("a");
  s.db.appendTranscriptEntry({id:"direct-goal",kind:"message",role:"user",content:"Independently check the file"});
  h.tm.ackObligations.fulfillAckObligation=()=>{};const turn=new h.runtime.TurnRuntime(h.tm);h.tm.turnRuntime=turn;
  const id=turn.handleAgentUpdate({type:"send-message",timestampMs:1,message:{type:"text",content:"I will check the file",collaboration:{action:"assign",request_id:"direct",goal_message_id:"direct-goal",assignee:"a",reviewer:"user",title:"File check",criteria:["Readable"]}}},s);
  const before=JSON.stringify(h.entries("a"));const context=h.runtime.collaborationContext(h.entries("a"),"a",[id]);
  assert.match(context,/File check/);assert.match(context,/"reviewer":"user"/);assert.match(context,/"requirementsSourceId"/);
  assert.equal(JSON.stringify(h.entries("a")),before);assert.equal(h.entries("room").length,0);
});
