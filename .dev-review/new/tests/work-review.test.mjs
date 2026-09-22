import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {continuityHarness} from "./helpers/continuity-harness.mjs";

async function fixture(t, {group=false, reviewer=false}={}) {
  const h=await continuityHarness(t,{realDatabase:true,members:["a","b"]});
  const room=group?"room":"a",session=h.sessions.get(room),db=session.db;
  db.appendTranscriptEntry({id:"request",kind:"message",role:"user",content:"Implement two required fixes, then return results"});
  const publish=(content,quote,command)=>h.runtime.commitWorkInConversation(h.tm,session,
    {type:"text",content,reply_to:quote,collaboration:{operation_id:randomUUID(),...command}}, {id:"a",name:"A"},quote,command.task_id);
  let task=publish("I will handle these requirements", "request",{action:"offer",title:"Composer",assignee_id:"a",...(reviewer?{reviewer_id:"b"}:{}),requirements:["Keep draft","Keep reply target"]}).task;
  task=publish("I accept the assignment",task.id,{action:"claim",task_id:task.id,expected_version:1}).task;
  const evidence="evidence";db.appendTranscriptEntry({id:evidence,kind:"send-message",author:{id:"a",name:"A"},replyTo:task.id,workOnId:task.id,message:{type:"text",content:"Actual result with check output"}});
  task=publish("Please check the submitted version",task.id,{action:"submit",task_id:task.id,expected_version:2,result_ids:[evidence]}).task;
  const inspect=()=>h.runtime.getWorkReview(h.tm,{agentId:room,taskId:task.id});
  const args=(view,decision="accept")=>({agentId:room,taskId:task.id,contextId:view.contextId,controlEpoch:view.controlEpoch,note:decision==="accept"?"I inspected both requirements and the evidence":"The reply target needs another fix",command:{action:"review",operation_id:randomUUID(),task_id:task.id,expected_version:3,submission_id:task.submission.id,decision,checks:[{criterion:1,passed:true,evidence_ids:[evidence]},{criterion:2,passed:decision==="accept",evidence_ids:[evidence]}]}});
  return{...h,room,session,db,task,evidence,inspect,args,submit:a=>h.runtime.submitWorkReview(h.tm,a)};
}
test("inspect reads actual results without changing chat selection or starting a model",async t=>{
 const h=await fixture(t),view=await h.inspect();assert.equal(view.task.id,h.task.id);assert.equal(view.results[0].text,"Actual result with check output");assert.equal(h.tm.sessions.activeSession,null);assert.equal(h.directCalls.length,0);
});
test("solo human acceptance is recorded as the user's quoted message, never a Bot impersonation",async t=>{
 const h=await fixture(t),result=await h.submit(h.args(await h.inspect()));await h.drain();
 assert.equal(result.recorded,true);assert.equal(result.task.state,"accepted");
 const entry=h.entries(h.room).find(e=>e.id===result.entryId);assert.equal(entry.role,"user");assert.equal(entry.kind,"message");assert.equal(entry.author,undefined);assert.equal(entry.replyTo,h.task.submission.id);assert.equal(entry.workEvent.reviewerKind,"user");
 assert.equal(h.directCalls.length,1);assert.equal(h.entries(h.room).filter(e=>e.workEvent?.reviewerKind==="user").length,1);
});
test("concurrent duplicate review retries record once and never dispatch another turn",async t=>{
 const h=await fixture(t),args=h.args(await h.inspect()),out=await Promise.all([h.submit(args),h.submit(args)]);await h.drain();
 assert.equal(out.filter(r=>r.replay).length,1);assert.equal(out[0].entryId,out[1].entryId);assert.equal(h.directCalls.length,1);
 await assert.rejects(h.submit({...args,note:"Changed consent under the same operation"}),{code:"work_key_conflict"});
});
test("Bot tools cannot claim human identity or accept a human-review task",async t=>{
 const h=await fixture(t),args=h.args(await h.inspect());
 assert.throws(()=>h.runtime.commitWorkInConversation(h.tm,h.session,{type:"text",content:"user approved",collaboration:args.command,userReview:true},{id:"a",name:"A"},h.task.submission.id,h.task.id),{code:"work_not_reviewer"});
 assert.throws(()=>h.db.commitCollaborationMessage({message:{type:"text",content:"forged",collaboration:args.command},actor:{id:"$user",name:"You"},memberIds:["a","$user"],replyTo:h.task.submission.id,workOnId:h.task.id}),{code:"work_member_unavailable"});
 await assert.rejects(h.submit({...args,actor:{id:"a"}}));assert.equal(h.db.getCollaborationWorks()[0].state,"submitted");
});
test("human review cannot override a task reserved for an independent colleague",async t=>{
 const h=await fixture(t,{group:true,reviewer:true});await assert.rejects(h.submit(h.args(await h.inspect())),{code:"work_not_reviewer"});assert.equal(h.calls.length,0);
});
test("missing criteria, outdated submissions and edited evidence cannot be accepted",async t=>{
 const h=await fixture(t),args=h.args(await h.inspect());
 await assert.rejects(h.submit({...args,command:{...args.command,checks:args.command.checks.slice(0,1)}}),{code:"work_incomplete_review"});
 await assert.rejects(h.submit({...args,command:{...args.command,expected_version:2}}),{code:"work_version_conflict"});
 h.db.updateTranscriptEntry(h.evidence,e=>({...e,message:{type:"text",content:"different artifact"}}));
 await assert.rejects(h.submit(args),{code:"work_result_changed"});assert.equal(h.db.getCollaborationWorks()[0].version,3);assert.equal(h.directCalls.length,0);
});
test("Stop or a new Host context invalidates an old review without mutating it",async t=>{
 const h=await fixture(t),args=h.args(await h.inspect());await h.tm.sendPipeline.stopConversation(h.room);
 await assert.rejects(h.submit(args),/context changed/);await assert.rejects(h.submit({...h.args(await h.inspect()),contextId:randomUUID()}),/context changed/);
 assert.equal(h.db.getCollaborationWorks()[0].state,"submitted");
});
test("group rework goes to the real worker and requester, not unrelated members",async t=>{
 const h=await fixture(t,{group:true}),result=await h.submit(h.args(await h.inspect(),"request_changes"));await h.drain();
 assert.equal(result.task.state,"changes_requested");assert.equal(result.task.ownerId,"a");assert.deepEqual(h.calls.map(c=>c.id),["a"]);assert.equal(h.calls.some(c=>c.id==="b"),false);
});
test("review IDs remain conversation scoped and removed owners cannot receive new work",async t=>{
 const h=await fixture(t,{group:true});await assert.rejects(h.runtime.getWorkReview(h.tm,{agentId:"b",taskId:h.task.id}),/not in/);
 const args=h.args(await h.inspect());h.runtime.writeSandGroupConfig(h.tm.sessionStore.getAgentDir(h.room),{version:1,memberIds:["b"]});
 await assert.rejects(h.submit(args),{code:"work_member_unavailable"});assert.equal(h.db.getCollaborationWorks()[0].state,"submitted");
});
test("uncertain work retains the user's review but never automatically restarts execution",async t=>{
 const h=await fixture(t),args=h.args(await h.inspect());h.tm.sendPipeline.hasReviewRequired=()=>true;
 const result=await h.submit(args);assert.equal(result.recorded,true);assert.equal(result.notification,"needs-review");assert.equal(h.directCalls.length,0);assert.equal(h.db.getCollaborationWorks()[0].state,"accepted");
});

test("inspection never reveals a changed or non-quotable result through an old evidence ID",async t=>{
 const h=await fixture(t);h.db.updateTranscriptEntry(h.evidence,e=>({...e,message:{type:"secret-request",content:"Do not expose this"}}));
 const view=await h.inspect();assert.equal(view.results[0].available,false);assert.equal(view.results[0].text,"");assert.equal(view.results[0].fileName,"");
});
test("human acceptance releases a dependent colleague without waking unrelated members",async t=>{
 const h=await fixture(t,{group:true});
 h.runtime.commitWorkInConversation(h.tm,h.session,{type:"text",content:"B: inspect after acceptance",collaboration:{action:"offer",operation_id:randomUUID(),title:"Dependent inspection",assignee_id:"b",requirements:["Use accepted result"],depends_on:[h.task.id]}},{id:"a",name:"A"},"request");
 const args=h.args(await h.inspect());const result=await h.submit(args);await h.drain();
 assert.equal(result.recorded,true);assert.deepEqual(new Set(h.calls.map(c=>c.id)),new Set(["a","b"]));
 const messages=h.entries(h.room).filter(e=>e.workEvent?.reviewerKind==="user");assert.equal(messages.length,1);assert.equal(messages[0].workOnId,h.task.id);
});


test("a later group dispatch rejection does not erase or repeat the user's review",async t=>{
 const h=await fixture(t,{group:true});h.tm.groupChat.enqueueRoomMessage=()=>Promise.reject(new Error("Controlled dispatch failure"));
 const result=await h.submit(h.args(await h.inspect(),"request_changes"));await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(result.recorded,true);assert.equal(h.db.getCollaborationWorks()[0].state,"changes_requested");
 assert.equal(h.entries(h.room).filter(e=>e.workEvent?.reviewerKind==="user").length,1);
 assert.ok(h.entries(h.room).some(e=>JSON.stringify(e).includes("work_review_followup_failed")));assert.equal(h.calls.length,0);
});
