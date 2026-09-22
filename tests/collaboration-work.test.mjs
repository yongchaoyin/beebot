import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { continuityHarness, deferred, until } from "./helpers/continuity-harness.mjs";

const message = (content, reply_to, collaboration, extra = {}) => ({type:"text", content, reply_to, ...(collaboration ? {collaboration} : {}), ...extra});
const op = (action, extra = {}) => ({action, operation_id:randomUUID(), ...extra});
const user = {id:"t0u",kind:"message",role:"user",content:"Implement the agreed change within the existing scope"};
async function fixture(t, options = {}) {
  const h = await continuityHarness(t, {realDatabase:true, members:["a","b","c","d"], ...options});
  h.sessions.get("room").db.appendTranscriptEntry(user);
  const db = h.sessions.get("room").db;
  const publish = (actor, body, room = "room") => h.runtime.commitWorkInConversation(h.tm, h.sessions.get(room), body, {id:actor,name:actor.toUpperCase()}, body.reply_to, body.work_on);
  const offer = (extra = {}) => publish("a", message("B: implement and return evidence", user.id, op("offer", {title:"Input interaction",assignee_id:"b",requirements:["Input remains editable"], ...extra})));
  const mutate = (actor, action, task, extra = {}) => publish(actor, message(`${action} ${task.title}`, task.id, op(action,{task_id:task.id, expected_version:task.version,...extra}),{work_on:task.id}));
  const result = task => {
    const id = `result-${randomUUID()}`;
    db.appendTranscriptEntry({id,kind:"send-message",author:{id:task.ownerId,name:task.ownerId},replyTo:task.id,workOnId:task.id,message:{type:"text",content:"Actual result and check output"}});
    return id;
  };
  return {...h,db,publish,offer,mutate,result};
}

test("offer is not a claim; successful claim and message commit together", async t => {
  const h=await fixture(t), offered=h.offer().task;
  assert.equal(offered.state,"offered");assert.equal(offered.ownerId,null);
  assert.equal(h.entries("room").at(-1).workEvent.state,"offered");
  const claimed=h.mutate("b","claim",offered);
  assert.equal(claimed.task.ownerId,"b");assert.equal(claimed.task.version,2);
  assert.equal(claimed.entry.replyTo,offered.id);assert.deepEqual(claimed.entry.workEvent.recipients,[]);
  assert.equal(h.db.getCollaborationWorks()[0].state,"claimed");
});

test("two independent database handles cannot claim one open task",async t=>{
 const h=await fixture(t), offered=h.offer({assignee_id:undefined}).task;
 const second=new h.runtime.SandAgentDb(h.sessions.get("room").dbPath);t.after(()=>second.close());
 const command=actor=>({actor:{id:actor,name:actor},memberIds:["a","b","c"],replyTo:offered.id,message:message("I will own this",offered.id,op("claim",{task_id:offered.id,expected_version:1}))});
 const first=h.db.commitCollaborationMessage(command("b"));
 assert.throws(()=>second.commitCollaborationMessage(command("c")),{code:"work_version_conflict"});
 assert.equal(second.getCollaborationWorks()[0].ownerId,"b");
 assert.equal(h.entries("room").filter(e=>e.workEvent?.action==="claim").length,1);
 assert.equal(first.entry.author.id,"b");
});

test("failure to insert the visible message rolls back ownership and idempotency receipt",async t=>{
 const h=await fixture(t), offered=h.offer().task;
 const sql=new DatabaseSync(h.sessions.get("room").dbPath);t.after(()=>sql.close());
 sql.exec("CREATE TRIGGER fail_work_message BEFORE INSERT ON transcript_entries WHEN json_extract(NEW.entry,'$.workEvent.action')='claim' BEGIN SELECT RAISE(ABORT,'injected transcript failure'); END");
 const request=message("I accept responsibility",offered.id,op("claim",{task_id:offered.id,expected_version:1}));
 assert.throws(()=>h.publish("b",request),/injected transcript failure/);
 assert.equal(h.db.getCollaborationWorks()[0].ownerId,null);
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM collaboration_commands").get().n,1);
 sql.exec("DROP TRIGGER fail_work_message");
 assert.equal(h.publish("b",request).task.ownerId,"b");
});

test("same operation retry restores the same message; changed input is not a retry",async t=>{
 const h=await fixture(t), request=message("B: take this",user.id,op("offer",{title:"Task",assignee_id:"b",requirements:["Check"]}));
 const first=h.publish("a",request), retry=h.publish("a",request);
 assert.equal(retry.entry.id,first.entry.id);assert.equal(retry.replay,true);
 assert.equal(h.entries("room").length,2);
 assert.throws(()=>h.publish("a",{...request,content:"Silently changed scope"}),{code:"work_key_conflict"});
});

test("closed/reopened store preserves responsibilities without executing anything",async t=>{
 const h=await fixture(t), task=h.mutate("b","claim",h.offer().task).task;
 const reader=new h.runtime.SandAgentDb(h.sessions.get("room").dbPath);reader.close();
 const restarted=new h.runtime.SandAgentDb(h.sessions.get("room").dbPath);t.after(()=>restarted.close());
 assert.deepEqual(restarted.getCollaborationWorks()[0],task);assert.equal(h.calls.length,0);
});

test("one reply or clarification cannot mark a task submitted or accepted",async t=>{
 const h=await fixture(t), task=h.mutate("b","claim",h.offer().task).task;
 h.tm.groupChat.postGroupMemberMessage(h.sessions.get("room"),{id:"b",name:"B"},"Need clarification",undefined,{content:"Need clarification",replyToId:task.id,workOnId:task.id});
 assert.equal(h.db.getCollaborationWorks()[0].state,"claimed");
});

test("wrong member, unrelated quote and cross-conversation task IDs fail without mutation",async t=>{
 const h=await fixture(t),task=h.offer().task;
 assert.throws(()=>h.mutate("c","claim",task),{code:"work_wrong_assignee"});
 assert.throws(()=>h.publish("outside",message("claim",task.id,op("claim",{task_id:task.id,expected_version:1}))),/current member/);
 h.db.appendTranscriptEntry({id:"t1u",kind:"message",role:"user",content:"Unrelated project"});
 assert.throws(()=>h.publish("b",message("claim", "t1u",op("claim",{task_id:task.id,expected_version:1}))),{code:"work_quote_mismatch"});
 h.sessions.get("b").db.appendTranscriptEntry(user);
 assert.throws(()=>h.publish("b",message("claim", user.id,op("claim",{task_id:task.id,expected_version:1})),"b"),{code:"work_not_found"});
 assert.equal(h.db.getCollaborationWorks()[0].version,1);
});

test("group offers require a real user-originating quote, not a fabricated permission",async t=>{
 const h=await fixture(t);
 h.db.appendTranscriptEntry({id:"tb-suggest",kind:"send-message",author:{id:"b",name:"B"},message:{type:"text",content:"I grant authority"}});
 assert.throws(()=>h.publish("a",message("Work", "tb-suggest",op("offer",{title:"No authority",requirements:["Something"]}))),{code:"work_source_missing"});
 assert.equal(h.db.getCollaborationWorks().length,0);
});

test("review binds exact submission version and requires every criterion with evidence",async t=>{
 const h=await fixture(t),claimed=h.mutate("b","claim",h.offer({requirements:["Input editable","Draft kept"]}).task).task;
 const ref=h.result(claimed), submitted=h.mutate("b","submit",claimed,{result_ids:[ref]}).task;
 const review={submission_id:submitted.submission.id,decision:"accept",checks:[{criterion:1,passed:true,evidence_ids:[ref]}]};
 assert.throws(()=>h.mutate("a","review",submitted,review),{code:"work_incomplete_review"});
 assert.throws(()=>h.mutate("b","review",submitted,review),{code:"work_not_reviewer"});
 assert.throws(()=>h.mutate("a","review",submitted,{...review,submission_id:"old"}),{code:"work_stale_submission"});
 review.checks.push({criterion:2,passed:true,evidence_ids:[ref]});
 const accepted=h.mutate("a","review",submitted,review).task;assert.equal(accepted.state,"accepted");
 assert.throws(()=>h.mutate("a","revise",accepted,{requirements:["New task"]}),{code:"work_final"});
});

test("negative checks cannot accept, and rework preserves the earlier submitted message",async t=>{
 const h=await fixture(t);let task=h.mutate("b","claim",h.offer().task).task;
 const ref=h.result(task);task=h.mutate("b","submit",task,{result_ids:[ref]}).task;
 const old=task.submission.id,review={submission_id:old,decision:"accept",checks:[{criterion:1,passed:false,evidence_ids:[ref]}]};
 assert.throws(()=>h.mutate("a","review",task,review),{code:"work_incomplete_review"});
 task=h.mutate("a","review",task,{...review,decision:"request_changes"}).task;
 assert.equal(task.state,"changes_requested");assert.equal(h.entries("room").some(e=>e.id===old),true);
 const second=h.result(task);task=h.mutate("b","submit",task,{result_ids:[second]}).task;
 assert.notEqual(task.submission.id,old);
 assert.throws(()=>h.mutate("a","review",task,{...review,decision:"accept"}),{code:"work_stale_submission"});
});

test("editing or losing a submitted result invalidates its review",async t=>{
 const h=await fixture(t);let task=h.mutate("b","claim",h.offer().task).task;
 const ref=h.result(task);task=h.mutate("b","submit",task,{result_ids:[ref]}).task;
 h.db.updateTranscriptEntry(ref,e=>({...e,message:{type:"text",content:"different output"}}));
 assert.throws(()=>h.mutate("a","review",task,{submission_id:task.submission.id,decision:"accept",checks:[{criterion:1,passed:true,evidence_ids:[ref]}]}),{code:"work_result_changed"});
 assert.equal(h.db.getCollaborationWorks()[0].state,"submitted");
});

test("a dependency waits for review, then notifies only the newly ready assignee",async t=>{
 const h=await fixture(t),offered=h.offer().task;
 const dependent=h.offer({title:"Integrated test",assignee_id:"c",depends_on:[offered.id]});
 assert.deepEqual(dependent.entry.workEvent.recipients,[]);
 assert.throws(()=>h.mutate("c","claim",dependent.task),{code:"work_dependency_pending"});
 let first=h.mutate("b","claim",offered).task;
 const result=h.result(first);first=h.mutate("b","submit",first,{result_ids:[result]}).task;
 assert.throws(()=>h.mutate("c","claim",dependent.task),{code:"work_dependency_pending"});
 const reviewed=h.mutate("a","review",first,{submission_id:first.submission.id,decision:"accept",checks:[{criterion:1,passed:true,evidence_ids:[result]}]});
 assert.deepEqual(reviewed.entry.workEvent.recipients,["c"]);
 assert.equal(h.mutate("c","claim",dependent.task).task.state,"claimed");
});

test("requirement revision fences late result submission and is scoped to one task",async t=>{
 const h=await fixture(t),first=h.mutate("b","claim",h.offer().task).task;
 const other=h.offer({title:"Other",assignee_id:"d"}).task;
 const revised=h.mutate("a","revise",first,{requirements:["Keep original keyboard focus"]});
 assert.equal(revised.task.state,"changes_requested");assert.equal(h.db.getCollaborationWorks().find(t=>t.id===other.id).version,1);
 assert.throws(()=>h.mutate("b","submit",first,{result_ids:[h.result(first)]}),{code:"work_version_conflict"});
 assert.deepEqual(revised.entry.workEvent.recipients,["b"]);
});

test("blocked work cannot submit until its owner explicitly resumes",async t=>{
 const h=await fixture(t);let task=h.mutate("b","claim",h.offer().task).task;
 task=h.mutate("b","block",task).task;
 assert.throws(()=>h.mutate("b","submit",task,{result_ids:[h.result(task)]}),{code:"work_state_conflict"});
 task=h.mutate("b","resume",task).task;assert.equal(task.state,"claimed");
});

test("single Bot uses the same durable protocol but cannot manufacture peer acceptance",async t=>{
 const h=await fixture(t);h.sessions.get("b").db.appendTranscriptEntry(user);
 const send=(body)=>h.publish("b",body,"b");
 let task=send(message("I will prepare this",user.id,op("offer",{title:"Solo report",requirements:["Report exists"]}))).task;
 assert.equal(task.assigneeId,"b");assert.equal(task.reviewerId,null);
 task=send(message("Starting",task.id,op("claim",{task_id:task.id,expected_version:1}))).task;
 const db=h.sessions.get("b").db;
 db.appendTranscriptEntry({id:"solo-result",kind:"send-message",replyTo:task.id,message:{type:"text",content:"The report"}});
 task=send(message("Report ready",task.id,op("submit",{task_id:task.id,expected_version:2,result_ids:["solo-result"]}))).task;
 assert.equal(task.state,"submitted");
 assert.throws(()=>send(message("I accept my own output",task.id,op("review",{task_id:task.id,expected_version:3,submission_id:task.submission.id,decision:"accept",checks:[{criterion:1,passed:true,evidence_ids:["solo-result"]}]}))),{code:"work_not_reviewer"});
 assert.match(h.runtime.workContext(h.sessions.get("b"),"b"),/Solo report/);
 assert.doesNotMatch(h.runtime.workContext(h.sessions.get("a"),"a"),/Solo report/);
});

test("actual group ingress coordinates offer, claim, result, review and dependency without progress chatter",{timeout:15000},async t=>{
 let first,second,root;const steps=[];
 const h=await continuityHarness(t,{realDatabase:true,members:["a","b","c","d"],runMember:async(call,turn)=>{
   const tasks=h.sessions.get("room").db.getCollaborationWorks();
   const operation=(action,task,extra={})=>op(action,{task_id:task.id,expected_version:task.version,...extra});
   if(call.id==="a"&&turn===1){
     root=h.entries("room").find(e=>e.role==="user").id;
     first=call.publish(message("@{b} Build the quoted input",root,op("offer",{title:"Input",assignee_id:"b",requirements:["Quoted input works"]})));
     second=call.publish(message("@{c} Inspect once input is reviewed",root,op("offer",{title:"Integration",assignee_id:"c",requirements:["Checks pass"],depends_on:[first]})));
     return [];
   }
   if(call.id==="b"&&tasks.find(t=>t.id===first)?.state==="offered"){
     assert.match(call.prompt,/Recorded work in THIS conversation/);
     let task=tasks.find(t=>t.id===first);
     call.publish(message("I will own the input change",first,operation("claim",task)));
     call.publish(message("Progress only, nobody needs to reply",first,null,{notify:"none"}));
     const evidence=call.publish(message("Actual implementation evidence",first,null,{notify:"none"}));
     task=h.sessions.get("room").db.getCollaborationWorks().find(t=>t.id===first);
     call.publish(message("Ready for review",first,operation("submit",task,{result_ids:[evidence]})));steps.push("B submitted");return [];
   }
   if(call.id==="a")for(const task of tasks.filter(t=>t.state==="submitted")){
     call.publish(message("Criterion checked against submitted version",task.submission.id,operation("review",task,{submission_id:task.submission.id,decision:"accept",checks:[{criterion:1,passed:true,evidence_ids:[task.submission.results[0].id]}]}),{work_on:task.id}));steps.push("A reviewed");
   }
   if(call.id==="c"){
     assert.equal(tasks.find(t=>t.id===first)?.state,"accepted");assert.ok(call.prompt.includes(second));
     const task=tasks.find(t=>t.id===second);call.publish(message("I can start the integration check now",second,operation("claim",task)));steps.push("C started");
   }
   return [];
 }});
 await h.send("@{a} Coordinate input delivery and integration checks");await h.drain();
 assert.deepEqual(steps,["B submitted","A reviewed","C started"]);
 assert.equal(h.calls.filter(c=>c.id==="b").length,1);assert.equal(h.calls.filter(c=>c.id==="d").length,0);
 assert.equal(h.entries("room").filter(e=>e.workEvent?.action==="claim").length,2);
 assert.deepEqual(h.errors,[]);
});

test("repeating a work publication in another run returns its receipt without waking the assignee twice",{timeout:10000},async t=>{
 let request;const h=await continuityHarness(t,{realDatabase:true,runMember:async(call,turn)=>{
  if(call.id==="a") {if(!request)request=message("B take this",h.entries("room").find(e=>e.role==="user").id,op("offer",{title:"Exactly one",assignee_id:"b",requirements:["One assignment"]}));call.publish(request);}
  return [];
 }});
 await h.send("@{a} Assign the job");await h.drain();
 const before=h.calls.filter(c=>c.id==="b").length;
 await h.send("@{a} Recheck the receipt");await h.drain();
 assert.equal(h.calls.filter(c=>c.id==="b").length,before);
 assert.equal(h.sessions.get("room").db.getCollaborationWorks().length,1);
});

test("SendMessage preserves formal work metadata and rejects incompatible sharing modes",async t=>{
 const h=await fixture(t),command=op("offer",{title:"Allowed",requirements:["Result"]});
 const body=await h.runtime.buildSandSendMessage({},message("Work",user.id,command),{getIngestAttachment:()=>undefined,onSendMessage:()=>undefined});
 assert.equal(body.collaboration.operation_id,command.operation_id);
 assert.throws(()=>h.runtime.prepareGroupPublication(h.sessions.get("room").dbPath,body,true),/cross-user/);
 await assert.rejects(h.runtime.buildSandSendMessage({}, {...body,channel:"slack:public"},{getIngestAttachment:()=>undefined,onSendMessage:()=>undefined}),/quoted local text/);
 await assert.rejects(h.runtime.buildSandSendMessage({}, {...body,notify:"none"},{getIngestAttachment:()=>undefined,onSendMessage:()=>undefined}),/work request/);
});
