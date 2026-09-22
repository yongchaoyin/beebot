import assert from "node:assert/strict";
import test from "node:test";
import {continuityHarness} from "./helpers/continuity-harness.mjs";

function setup(h,room="room"){
 const session=h.sessions.get(room);session.db.appendTranscriptEntry({id:"goal",kind:"message",role:"user",content:"Improve this release"});let seq=0;
 const publish=(actor,message)=>h.tm.groupChat.postGroupMemberMessage(session,{id:actor,name:actor},message.content,undefined,h.runtime.prepareGroupPublication(session.dbPath,message,false));
 const tasks=()=>h.runtime.projectCollaboration(h.entries(room));
 const post=(actor,collaboration,content="Work event")=>publish(actor,{type:"text",purpose:"update",content,collaboration});
 const assign=(extra={})=>post("a",{action:"assign",request_id:`assign-${++seq}`,goal_message_id:"goal",title:"Chat behavior",assignee:"b",reviewer:"a",criteria:["Correct","Tested"],...extra});
 const cmd=(actor,id,action,rest={})=>post(actor,{action,request_id:`op-${++seq}`,task_id:id,expected_version:tasks().get(id).version,...rest});
 const result=(actor,id)=>publish(actor,{type:"text",purpose:"update",content:"Actual result and recorded test evidence",reply_to:id,work_on:id});
 const submit=id=>{cmd("b",id,"claim");const evidence=result("b",id);cmd("b",id,"submit",{result_ids:[evidence],evidence_ids:[evidence]});return evidence;};
 const review=(id,evidence)=>cmd("a",id,"review",{submission_id:tasks().get(id).submission.id,verdict:"accept",checks:tasks().get(id).criteria.map((_,criterion)=>({criterion,passed:true,note:"Inspected recorded outcome",evidence_ids:[evidence]}))});
 const finish=(extra={})=>post("a",{action:"finish",request_id:`finish-${++seq}`,goal_message_id:"goal",expected_tasks:[...tasks().values()].map(t=>({id:t.id,version:t.version})),result_ids:[...tasks().values()][0]?.submission?.resultIds??[],...extra},"Here is the checked delivery");
 return{session,publish,post,tasks,assign,cmd,result,submit,review,finish};
}
const request=task=>({agentId:"room",reviewToken:task.reviewToken,review:{action:"review",task_id:task.id,request_id:"user-review",expected_version:task.version,submission_id:task.submission.id,verdict:"accept",checks:task.criteria.map((_,criterion)=>({criterion,passed:true,note:"User inspected this criterion",evidence_ids:[task.submission.id]}))}});

test("finish pins every accepted task, original goal, and final published results",async t=>{
 const h=await continuityHarness(t),w=setup(h),a=w.assign(),b=w.assign();const ar=w.submit(a);w.review(a,ar);const br=w.submit(b);w.review(b,br);
 const id=w.finish();const receipt=h.runtime.projectCompletions(h.entries("room")).get("goal");
 assert.equal(receipt.id,id);assert.equal(receipt.tasks.length,2);assert.equal(h.entries("room").at(-1).replyTo,"goal");
 assert.equal(h.runtime.completionIsCurrent(receipt,w.tasks()),true);
 assert.deepEqual(h.tm.groupChat.readGroupHistory(w.session).at(-1).recipientIds,[],"finish is visible without waking the entire room again");
});
test("missing, repeated, stale or unaccepted tasks cannot be hidden by a finish message",async t=>{
 const h=await continuityHarness(t),w=setup(h),a=w.assign(),b=w.assign();const e=w.submit(a);w.review(a,e);
 assert.throws(()=>w.finish({expected_tasks:[{id:a,version:w.tasks().get(a).version}]}),/work_finish_incomplete/);
 const br=w.submit(b);w.review(b,br);
 const pin={id:a,version:w.tasks().get(a).version};assert.throws(()=>w.finish({expected_tasks:[pin,pin]}),/work_finish_incomplete/);
 assert.throws(()=>w.finish({expected_tasks:[{...pin,version:1},{id:b,version:w.tasks().get(b).version}]}),/work_finish_incomplete/);
 assert.equal(h.runtime.projectCompletions(h.entries("room")).size,0);
});
test("later work reopens the historical finish; another Bot cannot impersonate the closer",async t=>{
 const h=await continuityHarness(t),w=setup(h),a=w.assign();const e=w.submit(a);w.review(a,e);w.finish();
 const receipt=h.runtime.projectCompletions(h.entries("room")).get("goal");w.assign({title:"Newly discovered required work"});
 assert.equal(h.runtime.completionIsCurrent(receipt,w.tasks()),false);
 assert.throws(()=>w.post("b",{action:"finish",request_id:"fake",goal_message_id:"goal",expected_tasks:receipt.tasks,result_ids:[e]}),/work_closer_required/);
 assert.equal(h.runtime.projectCompletions(h.entries("room")).get("goal").id,receipt.id);
});
test("finish rechecks published evidence, not just earlier pass labels",async t=>{
 const h=await continuityHarness(t),w=setup(h),id=w.assign(),e=w.submit(id);w.review(id,e);
 w.session.db.updateTranscriptEntry(e,row=>({...row,message:{...row.message,content:"Edited after review"}}));
 assert.throws(()=>w.finish(),/work_evidence_changed/);
});
test("human review is a durable inline receipt and wakes only intended colleagues once",async t=>{
 const h=await continuityHarness(t,{members:["a","b","c"]}),w=setup(h),id=w.assign({reviewer:"user"});w.submit(id);
 const controls=new h.runtime.CollaborationControls(h.tm),snap=await controls.snapshot({agentId:"room"}),args=request(snap.tasks[0]);
 assert.equal(snap.tasks[0].canReview,true);
 const response=await controls.review(args);assert.equal(response.saved,true);await h.drain();
 assert.equal(w.tasks().get(id).review.reviewer,"user");assert.equal(w.tasks().get(id).state,"accepted");
 assert.deepEqual([...new Set(h.calls.map(c=>c.id))].sort(),["a","b"]);
 const before=h.calls.length,again=await controls.review(args);assert.equal(again.replayed,true);assert.equal(h.calls.length,before);
 const entry=h.entries("room").find(e=>e.id===response.messageId);assert.equal(entry.kind,"notice");assert.equal(entry.controlActor,"user");assert.equal(entry.replyTo,id);
 assert.equal(h.runtime.projectCollaboration(structuredClone(h.entries("room"))).get(id).state,"accepted");
});
test("review accepts every criterion explicitly and never lets a Bot become the user",async t=>{
 const h=await continuityHarness(t),w=setup(h),id=w.assign({reviewer:"user"});w.submit(id);const controls=new h.runtime.CollaborationControls(h.tm);
 const args=request((await controls.snapshot({agentId:"room"})).tasks[0]);
 await assert.rejects(controls.review({...args,actor:"user"}));
 await assert.rejects(controls.review({...args,review:{...args.review,checks:args.review.checks.slice(0,1)}}),/work_checks_incomplete/);
 assert.throws(()=>w.post("b",args.review),/work_not_reviewer/);
 assert.equal(w.tasks().get(id).state,"review");
});
test("stale review tokens, explicit Stop and changed membership cannot resume old work",async t=>{
 const h=await continuityHarness(t),w=setup(h),id=w.assign({reviewer:"user"});w.submit(id);
 const controls=new h.runtime.CollaborationControls(h.tm),args=request((await controls.snapshot({agentId:"room"})).tasks[0]);
 await assert.rejects(new h.runtime.CollaborationControls(h.tm).review(args),/work_review_stale/);
 h.runtime.writeSandGroupConfig(w.session.dbPath.replace(/\/agent.db$/,""),{version:1,memberIds:["a"]});
 await assert.rejects(controls.review(args),/work_review_stale/);
 h.runtime.writeSandGroupConfig(w.session.dbPath.replace(/\/agent.db$/,""),{version:1,memberIds:["a","b"]});
 await h.tm.sendPipeline.stopConversation("room");await assert.rejects(controls.review(args),/work_review_stale/);
 assert.equal((await controls.snapshot({agentId:"room"})).tasks[0].canReview,false);assert.equal(h.calls.length,0);
});
test("failed review persistence leaves work unaccepted and safe for the same retry",async t=>{
 const h=await continuityHarness(t),w=setup(h),id=w.assign({reviewer:"user"});w.submit(id);
 const controls=new h.runtime.CollaborationControls(h.tm),args=request((await controls.snapshot({agentId:"room"})).tasks[0]);
 w.session.db.durable=false;await assert.rejects(controls.review(args),/work_review_not_saved/);assert.equal(w.tasks().get(id).state,"review");assert.equal(h.calls.length,0);
 w.session.db.durable=true;assert.equal((await controls.review(args)).saved,true);await h.drain();
});
test("an unrelated user message does not invalidate a work review; scope correction does",async t=>{
 const h=await continuityHarness(t),w=setup(h),id=w.assign({reviewer:"user"});w.submit(id);
 const controls=new h.runtime.CollaborationControls(h.tm),args=request((await controls.snapshot({agentId:"room"})).tasks[0]);
 w.session.db.appendTranscriptEntry({id:"other-question",kind:"message",role:"user",content:"Separate topic"});
 assert.equal((await controls.review(args)).saved,true);await h.drain();
 const another=w.assign({reviewer:"user"}),e=w.submit(another);const next=request((await controls.snapshot({agentId:"room"})).tasks.find(t=>t.id===another));next.review.request_id="next";
 w.session.db.appendTranscriptEntry({id:"correction",kind:"message",role:"user",content:"New criteria",replyTo:another});
 w.cmd("a",another,"revise",{source_message_id:"correction",title:"New",criteria:["Updated"]});
 await assert.rejects(controls.review(next),/work_version_conflict/);
});
test("single Bot can submit, receive real user review and finish without inventing a manager",async t=>{
 const h=await continuityHarness(t),session=h.sessions.get("a");
 // Model publishing reuses the exact single-Bot update method already tested in C1.
 const runtime=new h.runtime.TurnRuntime(h.tm);h.tm.ackObligations.fulfillAckObligation=()=>{};
 h.tm.roster.applyAgentUpdateToOutline=()=>{};
 const post=message=>{const prior=h.tm.turnRuntime;h.tm.turnRuntime=runtime;try{return runtime.handleAgentUpdate({type:"send-message",message,timestampMs:Date.now()},session);}finally{h.tm.turnRuntime=prior;}};
 session.db.appendTranscriptEntry({id:"goal",kind:"message",role:"user",content:"Independent work"});
 const id=post({type:"text",content:"I will do this",collaboration:{action:"assign",request_id:"one",goal_message_id:"goal",assignee:"a",reviewer:"user",title:"Independent",criteria:["Accurate"]}});
 post({type:"text",content:"Claim",collaboration:{action:"claim",request_id:"two",task_id:id,expected_version:1}});
 const result=post({type:"text",content:"Real result",reply_to:id});
 post({type:"text",content:"Check my result",collaboration:{action:"submit",request_id:"three",task_id:id,expected_version:2,result_ids:[result],evidence_ids:[result]}});
 const controls=new h.runtime.CollaborationControls(h.tm),args=request((await controls.snapshot({agentId:"a"})).tasks[0]);args.agentId="a";
 assert.equal((await controls.review(args)).saved,true);await h.drain();assert.equal(h.directCalls.length,1);assert.equal(h.directCalls[0].id,"a");
 const task=h.runtime.projectCollaboration(h.entries("a")).get(id);
 post({type:"text",content:"Delivered",collaboration:{action:"finish",request_id:"finish",goal_message_id:"goal",expected_tasks:[{id,version:task.version}],result_ids:[result]}});
 assert.equal(h.runtime.projectCompletions(h.entries("a")).size,1);
});


test("actual group user review resumes colleagues and closes the original goal, not the control notice",async t=>{
 let h,id,started=false,finished=false,ack=false;
 h=await continuityHarness(t,{runMember:async call=>{
  const tasks=()=>h.runtime.projectCollaboration(h.entries("room"));
  const post=(action,content)=>call.publish({type:"text",purpose:"update",content,collaboration:action});
  if(call.id==="a"&&!started){started=true;const goal=h.entries("room").find(e=>e.role==="user").id;
   id=post({action:"assign",request_id:"assign-live",goal_message_id:goal,title:"Deliver a version",assignee:"b",reviewer:"user",criteria:["Readable"]},"B owns this work");
  }else if(call.id==="b"&&tasks().get(id)?.state==="offered"){
   post({action:"claim",request_id:"claim-live",task_id:id,expected_version:1},"Claimed");
   const result=call.publish({type:"text",purpose:"update",content:"Published output",reply_to:id});
   post({action:"submit",request_id:"submit-live",task_id:id,expected_version:2,result_ids:[result],evidence_ids:[result]},"Please inspect this version");
  }else if(call.id==="a"&&tasks().get(id)?.state==="accepted"&&!finished){
   const task=tasks().get(id);
   const summary=call.publish({type:"text",purpose:"update",content:"Final results",reply_to:task.goalId});
   post({action:"finish",request_id:"finish-live",goal_message_id:task.goalId,expected_tasks:[{id,version:task.version}],result_ids:[summary]},"Checked delivery");finished=true;
  }else if(call.id==="b"&&tasks().get(id)?.state==="accepted"&&!ack){
   call.publish({type:"text",purpose:"update",content:"Noted the review"});ack=true;
  }
  return [];
 }});
 await h.send("@{a} Coordinate this delivery");await h.drain();
 const controls=new h.runtime.CollaborationControls(h.tm),snapshot=await controls.snapshot({agentId:"room"});
 await controls.review(request(snapshot.tasks[0]));await h.drain();
 assert.equal(finished,true);assert.equal(ack,true);assert.deepEqual(h.errors,[]);
 const entries=h.entries("room"),receipt=[...h.runtime.projectCompletions(entries).values()][0];
 assert.equal(receipt.goalId,entries.find(e=>e.role==="user").id);
 assert.equal(entries.find(e=>e.message?.content==="Checked delivery").replyTo,receipt.goalId);
 assert.equal(entries.find(e=>e.message?.content==="Noted the review").replyTo,id);
 assert.equal(h.runtime.completionIsCurrent(receipt,h.runtime.projectCollaboration(entries)),true);
});

test("review in the active chat publishes the same durable receipt and updates live state",async t=>{
 const h=await continuityHarness(t),w=setup(h),id=w.assign({reviewer:"user"});w.submit(id);
 await h.tm.sessions.ensureActionTarget("room");
 const controls=new h.runtime.CollaborationControls(h.tm),args=request((await controls.snapshot({agentId:"room"})).tasks[0]);
 const result=await controls.review(args);await h.drain();
 assert.equal(h.tm.groupChat.readGroupHistory(w.session).find(e=>e.id===result.messageId).responseTargetId,id);
 assert.ok(h.events.some(e=>e.type==="appended"&&e.entry.id===result.messageId));
 assert.equal((await controls.snapshot({agentId:"room"})).tasks[0].state,"accepted");
});


test("review preview never presents edited evidence as its submitted version",async t=>{
 const h=await continuityHarness(t),w=setup(h),id=w.assign({reviewer:"user"}),result=w.submit(id);
 w.session.db.updateTranscriptEntry(result,row=>({...row,message:{...row.message,content:"Edited after submission"}}));
 const controls=new h.runtime.CollaborationControls(h.tm),snapshot=await controls.snapshot({agentId:"room"});
 const evidence=snapshot.tasks.find(task=>task.id===id).evidence.find(item=>item.id===result);
 assert.equal(evidence.available,false);assert.equal(evidence.text,"");
});

test("saved human feedback keeps its specific notes and never wakes uncertain work",async t=>{
 const h=await continuityHarness(t),w=setup(h),id=w.assign({reviewer:"user"});w.submit(id);
 const controls=new h.runtime.CollaborationControls(h.tm),snapshot=await controls.snapshot({agentId:"room"});
 const pending=h.tm.sendPipeline.deliveries.queue(w.session.dbPath,"uncertain-request");
 h.tm.sendPipeline.deliveries.route(w.session.dbPath,pending.id,["b"]);
 h.tm.sendPipeline.deliveries.settle(w.session.dbPath,pending.id,"b","needs-review");
 const args=request(snapshot.tasks[0]);args.review.verdict="changes";args.review.checks[0].passed=false;args.review.checks[0].note="Fix the second-send case before delivery";
 const result=await controls.review(args);assert.equal(result.saved,true);assert.equal(result.notified,false);
 assert.match(h.entries("room").find(entry=>entry.id===result.messageId).text,/Fix the second-send case/);
 assert.equal(h.calls.length,0,"acceptance/feedback is not permission to replay uncertain work");
});
