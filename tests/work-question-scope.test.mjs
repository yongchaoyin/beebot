import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { continuityHarness, deferred, until } from "./helpers/continuity-harness.mjs";

async function setup(t, {hold} = {}) {
  let target;
  const h = await continuityHarness(t, {realDatabase:true, members:["a","b","c"], runMember:async(call,turn)=>{
    if (call.id === "b" && turn === 1) {
      const task = h.sessions.get("room").db.getCollaborationWorks().find(item=>item.id===target.id);
      call.publish({type:"text", content:"I have taken responsibility", reply_to:task.id, collaboration:{action:"claim",operation_id:randomUUID(),task_id:task.id,expected_version:task.version}});
      if (hold) await hold.promise;
      call.publish({type:"widget",reply_to:task.id,work_on:task.id,widget:{prompt:"For this task, use compact labels?",options:[{label:"Compact",value:"compact"}]}});
    }
    return [];
  }});
  const db=h.sessions.get("room").db;
  db.appendTranscriptEntry({id:"t0u",kind:"message",role:"user",content:"Prepare two separate pieces of work"});
  const publish=(body)=>h.runtime.commitWorkInConversation(h.tm,h.sessions.get("room"),body,{id:"a",name:"A"},body.reply_to,body.work_on);
  const offer=(title,assignee)=>publish({type:"text",content:`${title}: please take this work`,reply_to:"t0u",collaboration:{action:"offer",operation_id:randomUUID(),title,assignee_id:assignee,requirements:["Keep the agreed scope"]}}).task;
  target=offer("Input labels","b");const other=offer("Readme","c");
  await h.send("@{b} Please ask your question", "room", {replyToId:target.id});
  if (hold) await until(()=>h.calls.some(c=>c.id==="b")); else await h.drain();
  return {...h,db,target,other,publish,question:()=>h.entries("room").find(e=>e.message?.type==="widget")};
}

test("a question bound to work survives conversation about a different quoted task",async t=>{
 const h=await setup(t);const question=h.question();assert.equal(question.decisionContext.kind,"work");
 await h.send("@{c} How is this separate task?","room",{replyToId:h.other.id});await h.drain();
 assert.equal((await h.tm.widgetResponses.respondToWidget(question.id,"compact","room")).accepted,true);await h.drain();
 assert.equal(h.calls.at(-1).id,"b");assert.equal(h.db.getTranscriptEntries().find(e=>e.id===question.id).respondedValue,"compact");
 assert.equal((await h.tm.widgetResponses.respondToWidget(question.id,"compact","room")).accepted,false);
});
for (const [label,quoted] of [["its own task",true],["an unscoped group constraint",false]]) test(`a question expires after user changes ${label}`,async t=>{
 const h=await setup(t),question=h.question();
 await h.send("@{c} New requirement: do not change labels","room",quoted?{replyToId:h.target.id}:{});await h.drain();
 const before=h.calls.length;assert.equal((await h.tm.widgetResponses.respondToWidget(question.id,"compact","room")).accepted,false);
 assert.equal(h.calls.length,before);assert.equal(h.db.getTranscriptEntries().find(e=>e.id===question.id).decisionStatus,"stale");
});
test("a scope revision invalidates an old question even without a new user message",async t=>{
 const h=await setup(t),question=h.question(),task=h.db.getCollaborationWorks().find(item=>item.id===h.target.id);
 h.publish({type:"text",content:"Revise only this work",reply_to:task.id,collaboration:{action:"revise",operation_id:randomUUID(),task_id:task.id,expected_version:task.version,requirements:["Use full labels"]}});
 assert.equal((await h.tm.widgetResponses.respondToWidget(question.id,"compact","room")).accepted,false);
});
test("a delayed question never absorbs a later correction it has not read",async t=>{
 const hold=deferred();t.after(hold.resolve);const h=await setup(t,{hold});
 await h.send("@{c} The requirement changed","room",{replyToId:h.target.id});hold.resolve();await h.drain();
 assert.equal(h.question().decisionStatus,"stale");assert.equal(h.question().widgetDismissed,true);
});
test("a delayed question remains current when only unrelated quoted work changed",async t=>{
 const hold=deferred();t.after(hold.resolve);const h=await setup(t,{hold});
 await h.send("@{c} Discuss the separate readme","room",{replyToId:h.other.id});hold.resolve();await h.drain();
 assert.equal(h.question().decisionStatus,undefined);
 assert.equal((await h.tm.widgetResponses.respondToWidget(h.question().id,"compact","room")).accepted,true);await h.drain();
});
test("explicit Stop keeps scoped questions inactive and malformed scope tokens fail closed",async t=>{
 const h=await setup(t),question=h.question();await h.tm.sendPipeline.stopConversation("room");
 assert.equal((await h.tm.widgetResponses.respondToWidget(question.id,"compact","room")).accepted,false);
 h.db.updateTranscriptEntry(question.id,e=>({...e,widgetDismissed:false,decisionStatus:undefined,decisionContext:{kind:"work",taskId:h.target.id,token:"made-up"}}));
 assert.equal((await h.tm.widgetResponses.respondToWidget(question.id,"compact","room")).accepted,false);
});
test("a task offered during a run can scope that same run's question without reading future user context",async t=>{
 const h=await continuityHarness(t,{realDatabase:true,runMember:async(call,turn)=>{
   if(call.id!=="a"||turn!==1)return [];
   const root=h.entries("room").find(e=>e.role==="user").id;
   const id=call.publish({type:"text",content:"I will prepare a proposal for your review",reply_to:root,collaboration:{action:"offer",operation_id:randomUUID(),title:"Proposal",assignee_id:"a",requirements:["Clear options"]}});
   call.publish({type:"widget",reply_to:id,work_on:id,widget:{prompt:"Audience?",options:[{label:"Internal",value:"internal"}]}});return [];
 }});
 await h.send("@{a} Prepare a proposal");await h.drain();
 const question=h.entries("room").find(e=>e.message?.type==="widget");assert.equal(question.decisionContext.kind,"work");assert.equal(question.decisionStatus,undefined);
});
