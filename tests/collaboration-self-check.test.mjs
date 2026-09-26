import {publishHistoricalUserAssignment} from "./helpers/legacy-collaboration.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import {continuityHarness, deferred, until} from "./helpers/continuity-harness.mjs";

function setup(h, room="room") {
  const session=h.sessions.get(room); let seq=0;
  session.db.appendTranscriptEntry({id:"goal",kind:"message",role:"user",content:"Deliver a checked result"});
  const publish=(actor,message)=>h.tm.groupChat.postGroupMemberMessage(session,{id:actor,name:actor},message.content,undefined,h.runtime.prepareGroupPublication(session.dbPath,message,false));
  const tasks=()=>h.runtime.projectCollaboration(h.entries(room));
  const post=(actor,collaboration)=>publish(actor,{type:"text",purpose:"update",content:"Colleague work update",collaboration});
  const assign=(extra={})=>post("a",{action:"assign",request_id:`assign-${++seq}`,goal_message_id:"goal",title:"Checked work",assignee:"b",criteria:["Readable","Verified"],...extra});
  const cmd=(actor,id,action,extra={})=>post(actor,{action,request_id:`cmd-${++seq}`,task_id:id,expected_version:tasks().get(id).version,...extra});
  const result=(id,text="Actual output and test results")=>publish("b",{type:"text",purpose:"update",content:text,reply_to:id});
  const submit=id=>{cmd("b",id,"claim");const evidence=result(id);cmd("b",id,"submit",{result_ids:[evidence],evidence_ids:[evidence]});return evidence;};
  const checks=(id,evidence=tasks().get(id).submission.resultIds[0])=>tasks().get(id).criteria.map((_,criterion)=>({criterion,passed:true,note:"Inspected the actual output",evidence_ids:[evidence]}));
  const selfCheck=(id,extra={})=>cmd("b",id,"self-check",{submission_id:tasks().get(id).submission.id,checks:checks(id),...extra});
  const finish=()=>post("a",{action:"finish",request_id:`finish-${++seq}`,goal_message_id:"goal",expected_tasks:[...tasks().values()].map(t=>({id:t.id,version:t.version})),result_ids:[...tasks().values()].find(t=>t.submission)?.submission.resultIds??["missing-result"]});
  return {session,publish,tasks,post,assign,cmd,result,submit,checks,selfCheck,finish};
}

test("ordinary work completes with an attributed Bot self-check and no fabricated user acceptance",async t=>{
  const h=await continuityHarness(t),w=setup(h),id=w.assign(),result=w.submit(id);
  assert.equal(w.tasks().get(id).reviewer,"self");assert.equal(w.tasks().get(id).reviewPolicy,"owner");
  assert.throws(w.finish,/work_finish_incomplete/);
  const checked=w.selfCheck(id),task=w.tasks().get(id);w.finish();
  assert.equal(task.state,"completed");assert.equal(task.selfCheck.actor,"b");assert.equal(task.review,undefined);
  assert.equal(h.runtime.workIsAccepted(task,w.tasks()),false);assert.equal(h.runtime.workIsCompleted(task,w.tasks()),true);
  assert.deepEqual(h.entries("room").find(e=>e.id===checked).collaborationEvent.wake,["a"]);
  assert.equal(h.runtime.completionIsCurrent(h.runtime.projectCompletions(h.entries("room")).get("goal"),w.tasks()),true);
  const snap=await new h.runtime.CollaborationControls(h.tm).snapshot({agentId:"room"});
  assert.equal(snap.tasks[0].completedForCurrentInputs,true);assert.equal(snap.tasks[0].acceptedForCurrentInputs,false);
  assert.equal(snap.tasks[0].canReview,false);assert.equal(snap.tasks[0].evidence[0].id,result);
});

test("every self-check criterion and exact submission is required; only the owner may check",async t=>{
  const h=await continuityHarness(t),w=setup(h),id=w.assign();w.submit(id);
  assert.throws(()=>w.cmd("a",id,"self-check",{submission_id:w.tasks().get(id).submission.id,checks:w.checks(id)}),/work_not_owner/);
  assert.throws(()=>w.selfCheck(id,{submission_id:"previous-submission"}),/work_submission_stale/);
  assert.throws(()=>w.selfCheck(id,{checks:w.checks(id).slice(0,1)}),/work_checks_incomplete/);
  const duplicated=w.checks(id);duplicated[1].criterion=0;
  assert.throws(()=>w.selfCheck(id,{checks:duplicated}),/work_checks_incomplete/);
  assert.equal(w.tasks().get(id).state,"review");
});

test("failed self-check keeps the owner responsible for fresh repair and resubmission",async t=>{
  const h=await continuityHarness(t),w=setup(h),id=w.assign(),old=w.submit(id),checks=w.checks(id);checks[1].passed=false;checks[1].note="Found incorrect output";
  w.selfCheck(id,{checks});assert.equal(w.tasks().get(id).state,"changes-requested");assert.throws(w.finish,/work_finish_incomplete/);
  assert.throws(()=>w.cmd("b",id,"submit",{result_ids:[old],evidence_ids:[old]}),/work_evidence_stale/);
  const fresh=w.result(id,"Fixed output and rerun checks");w.cmd("b",id,"submit",{result_ids:[fresh],evidence_ids:[fresh]});w.selfCheck(id);w.finish();
  assert.equal(w.tasks().get(id).state,"completed");
});

test("self-check preserves designated independent peer review",async t=>{
  const h=await continuityHarness(t),w=setup(h);
  for (const reviewer of ["a"]) {
    const id=w.assign({reviewer});w.submit(id);
    assert.throws(()=>w.selfCheck(id),/work_review_required/);
    assert.equal(w.tasks().get(id).state,"review");
  }
});

test("legacy human-default review advances only with a new quoted user continuation and keeps its history",async t=>{
  const h=await continuityHarness(t),w=setup(h);
  const id=publishHistoricalUserAssignment(w.session,message=>w.publish("a",message),{type:"text",content:"Historical work",collaboration:{action:"assign",request_id:"legacy",goal_message_id:"goal",assignee:"b",reviewer:"user",title:"Historical",criteria:["Readable","Verified"]}});w.submit(id);
  const before=structuredClone(h.entries("room"));
  await new h.runtime.CollaborationControls(h.tm).snapshot({agentId:"room"});
  assert.deepEqual(h.entries("room"),before,"reading is not an approval migration");
  assert.throws(()=>w.selfCheck(id),/work_continuation_required/);
  for (const source of [{id:"unrelated",kind:"message",role:"user",content:"Hello"},{id:"peer",kind:"message",role:"user",fromAgent:"a",replyTo:id,content:"Continue"}]) {
    w.session.db.appendTranscriptEntry(source);assert.throws(()=>w.selfCheck(id,{source_message_id:source.id}),/work_continuation_required/);
  }
  assert.throws(()=>w.selfCheck(id,{source_message_id:"goal"}),/work_continuation_required/);
  w.session.db.appendTranscriptEntry({id:"continue",kind:"message",role:"user",content:"Check the existing result yourself and finish this",replyTo:id});
  w.selfCheck(id,{source_message_id:"continue"});w.finish();
  const task=w.tasks().get(id);assert.equal(task.state,"completed");assert.equal(task.reviewer,"user");assert.equal(task.review,undefined);
  assert.equal(task.selfCheck.sourceMessageId,"continue");assert.equal(task.reviewPolicy,undefined);
  assert.deepEqual(h.entries("room").slice(0,before.length),before);
});

test("self-check and finish reject changed evidence including a separate owner check report",async t=>{
  const h=await continuityHarness(t),w=setup(h),id=w.assign(),result=w.submit(id);
  const report=w.result(id,"I inspected output and ran the criterion checks");w.selfCheck(id,{checks:w.checks(id,report)});
  w.session.db.updateTranscriptEntry(report,row=>({...row,message:{...row.message,content:"Edited check report"}}));
  assert.throws(w.finish,/work_evidence_changed/);
  const other=w.assign(),otherResult=w.submit(other);
  w.session.db.updateTranscriptEntry(otherResult,row=>({...row,message:{...row.message,content:"Edited result"}}));
  assert.throws(()=>w.selfCheck(other),/work_evidence_changed/);
  assert.ok(result);
});

test("self-check rejects other work's evidence and missing colleagues",async t=>{
  const h=await continuityHarness(t),w=setup(h),id=w.assign();w.submit(id);
  const other=w.assign(),foreign=w.submit(other);
  assert.throws(()=>w.selfCheck(id,{checks:w.checks(id,foreign)}),/work_evidence_scope/);
  h.runtime.writeSandGroupConfig(w.session.dbPath.replace(/\/agent.db$/,""),{version:1,memberIds:["b"]});
  assert.throws(()=>w.selfCheck(id),/work_not_owner/);
});

test("self-check retry is idempotent, conflicts are rejected and failed publication stays uncompleted",async t=>{
  const h=await continuityHarness(t),w=setup(h),id=w.assign();w.submit(id);
  const command={action:"self-check",request_id:"stable-check",task_id:id,expected_version:w.tasks().get(id).version,submission_id:w.tasks().get(id).submission.id,checks:w.checks(id)};
  w.session.db.durable=false;assert.throws(()=>w.post("b",command),/not saved/);w.session.db.durable=true;
  assert.equal(w.tasks().get(id).state,"review");const sent=w.post("b",command);assert.equal(w.post("b",command),sent);
  assert.throws(()=>w.post("b",{...command,checks:[...command.checks].reverse()}),/work_request_conflict/);
  assert.equal(h.entries("room").filter(e=>e.collaborationEvent?.requestId==="stable-check").length,1);
});

test("completed dependencies are usable but subsequent revisions invalidate dependent completion",async t=>{
  const h=await continuityHarness(t,{members:["a","b","c"]}),w=setup(h),up=w.assign(),down=w.assign({assignee:"c",dependencies:[up]});w.submit(up);
  assert.throws(()=>w.cmd("c",down,"claim"),/work_dependencies_pending/);const checked=w.selfCheck(up);
  assert.deepEqual(h.entries("room").find(e=>e.id===checked).collaborationEvent.wake,["a","c"]);
  w.cmd("c",down,"claim");const result=w.publish("c",{type:"text",purpose:"update",content:"Dependent result",reply_to:down});
  w.cmd("c",down,"submit",{result_ids:[result],evidence_ids:[result]});w.cmd("c",down,"self-check",{submission_id:w.tasks().get(down).submission.id,checks:w.checks(down,result)});w.finish();
  w.session.db.appendTranscriptEntry({id:"revision",kind:"message",role:"user",content:"Updated requirement",replyTo:up});
  w.cmd("a",up,"revise",{source_message_id:"revision",title:"Changed upstream",criteria:["New criterion"]});
  assert.equal(h.runtime.workIsCompleted(w.tasks().get(down),w.tasks()),false);assert.throws(w.finish,/work_finish_incomplete/);
  w.submit(up);const rechecked=w.selfCheck(up);
  assert.deepEqual(h.entries("room").find(e=>e.id===rechecked).collaborationEvent.wake,["a","c"]);
});

test("Stop and unresolved interrupted execution cannot be hidden by self-check or finish",async t=>{
  const h=await continuityHarness(t),w=setup(h),id=w.assign();w.submit(id);
  await h.tm.sendPipeline.stopConversation("room");assert.throws(()=>w.selfCheck(id),/work_stopped/);
  const second=w.assign();w.submit(second);
  const pending=h.tm.sendPipeline.deliveries.queue(w.session.dbPath,"goal");h.tm.sendPipeline.deliveries.route(w.session.dbPath,pending.id,["b"]);h.tm.sendPipeline.deliveries.settle(w.session.dbPath,pending.id,"b","needs-review");
  assert.throws(()=>w.selfCheck(second),/work_execution_uncertain/);assert.throws(w.finish,/work_execution_uncertain/);
  assert.equal(h.calls.length,0);
});

function directPublisher(h,session) {
  const runtime=new h.runtime.TurnRuntime(h.tm);h.tm.ackObligations.fulfillAckObligation=()=>{};h.tm.roster.applyAgentUpdateToOutline=()=>{};
  return message=>{const prior=h.tm.turnRuntime;h.tm.turnRuntime=runtime;try{return runtime.handleAgentUpdate({type:"send-message",message,timestampMs:Date.now()},session);}finally{h.tm.turnRuntime=prior;}};
}

test("single Bot completes through the real update handler while second and third user sends remain continuous",{timeout:10000},async t=>{
  const gate=deferred();t.after(gate.resolve);let h,publish,id,started=false;
  h=await continuityHarness(t,{runDirect:async call=>{
    if (started) return;started=true;publish=directPublisher(h,call.session);
    const post=collaboration=>publish({type:"text",content:"Checking the requested work",collaboration});
    id=post({action:"assign",request_id:"assign",goal_message_id:call.options.messageId,assignee:"a",title:"Independent task",criteria:["Accurate"]});
    post({action:"claim",request_id:"claim",task_id:id,expected_version:1});await gate.promise;
    const result=publish({type:"text",content:"Actual checked result",reply_to:id});
    post({action:"submit",request_id:"submit",task_id:id,expected_version:2,result_ids:[result],evidence_ids:[result]});
    const submission=h.runtime.projectCollaboration(h.entries("a")).get(id).submission.id;
    post({action:"self-check",request_id:"checked",task_id:id,expected_version:3,submission_id:submission,checks:[{criterion:0,passed:true,evidence_ids:[result],note:"Verified output"}]});
    post({action:"finish",request_id:"finish",goal_message_id:call.options.messageId,expected_tasks:[{id,version:4}],result_ids:[result]});
  }});
  await h.send("Handle this task","a");await until(()=>!!id);await h.send("Keep the language clear","a");await h.send("And keep going","a");gate.resolve();await h.drain();
  assert.equal(h.entries("a").filter(e=>e.kind==="message"&&e.role==="user").length,3);
  assert.equal(h.runtime.projectCollaboration(h.entries("a")).get(id).state,"completed");
  assert.equal(h.runtime.projectCompletions(h.entries("a")).size,1);assert.deepEqual(h.errors,[]);
});

test("group owner self-check wakes the closer and still handles second and third sends during work",{timeout:10000},async t=>{
  const gate=deferred();t.after(gate.resolve);let h,id,goal,started=false,finished=false;
  h=await continuityHarness(t,{runMember:async call=>{
    const post=collaboration=>call.publish({type:"text",purpose:"update",content:"Colleague update",collaboration});
    if(call.id==="a"&&!started){started=true;goal=h.entries("room").find(e=>e.role==="user").id;id=post({action:"assign",request_id:"assign",goal_message_id:goal,assignee:"b",title:"Delivery",criteria:["Checked"]});}
    else if(call.id==="b"&&h.runtime.projectCollaboration(h.entries("room")).get(id)?.state==="offered"){
      post({action:"claim",request_id:"claim",task_id:id,expected_version:1});await gate.promise;
      const result=call.publish({type:"text",purpose:"update",content:"Published work result",reply_to:id});
      const submitted=post({action:"submit",request_id:"submit",task_id:id,expected_version:2,result_ids:[result],evidence_ids:[result]});
      post({action:"self-check",request_id:"check",task_id:id,expected_version:3,submission_id:submitted,checks:[{criterion:0,passed:true,evidence_ids:[result],note:"Checked the delivered result"}]});
    }else if(call.id==="a"&&!finished&&h.runtime.projectCollaboration(h.entries("room")).get(id)?.state==="completed"){
      finished=true;const task=h.runtime.projectCollaboration(h.entries("room")).get(id);
      post({action:"finish",request_id:"finish",goal_message_id:goal,expected_tasks:[{id,version:task.version}],result_ids:task.submission.resultIds});
    }
    return [];
  }});
  await h.send("@{a} Coordinate this work");await until(()=>h.runtime.projectCollaboration(h.entries("room")).get(id)?.state==="claimed");
  await h.send("@{a} Keep the wording clear");await h.send("@{a} Keep going");gate.resolve();await h.drain();
  assert.equal(h.entries("room").filter(e=>e.kind==="message"&&e.role==="user").length,3);assert.equal(finished,true);assert.deepEqual(h.errors,[]);
  assert.equal(h.runtime.projectCompletions(h.entries("room")).size,1);
});

test("new user-review gates are rejected instead of creating an inaccessible completion workflow",async t=>{
  const h=await continuityHarness(t),w=setup(h);
  assert.throws(()=>w.assign({reviewer:"user"}),/work_human_gate_unsupported/);
  const id=w.assign();w.cmd("b",id,"decline",{reason:"Cannot inspect this environment"});
  assert.throws(()=>w.cmd("a",id,"reassign",{assignee:"a",reviewer:"user",reason:"Try this owner"}),/work_human_gate_unsupported/);
  assert.equal(w.tasks().get(id).state,"declined");
});

test("an existing explicitly required human gate is not converted into owner checking",async t=>{
  const h=await continuityHarness(t),w=setup(h);
  const id=publishHistoricalUserAssignment(w.session,message=>w.publish("a",message),{type:"text",content:"Historical explicit gate",collaboration:{action:"assign",request_id:"human-gate",goal_message_id:"goal",assignee:"b",reviewer:"user",title:"Explicit gate",criteria:["Accurate"]}});
  w.session.db.updateTranscriptEntry(id,row=>{row.collaborationEvent.task.reviewPolicy="user";return row;});w.submit(id);
  w.session.db.appendTranscriptEntry({id:"continue",kind:"message",role:"user",content:"Continue inspecting this",replyTo:id});
  assert.throws(()=>w.selfCheck(id,{source_message_id:"continue"}),/work_review_required/);
  assert.equal(w.tasks().get(id).state,"review");
});

test("unchanged historical omitted-reviewer retry survives the real SendMessage schema with its old identity",async t=>{
  const h=await continuityHarness(t),w=setup(h);
  const message={type:"text",content:"Historical assignment",purpose:"update",collaboration:{action:"assign",request_id:"old-command",goal_message_id:"goal",assignee:"b",reviewer:"user",title:"Old work",criteria:["Accurate"]}};
  const id=publishHistoricalUserAssignment(w.session,prepared=>w.publish("a",prepared),message);
  const omitted=structuredClone(message);delete omitted.collaboration.reviewer;
  const built=await h.runtime.buildSandSendMessage({},omitted,{getIngestAttachment:()=>undefined,onSendMessage:()=>undefined});
  assert.equal(built.collaboration.reviewer,undefined);assert.equal(w.publish("a",built),id);
  assert.equal(w.tasks().get(id).reviewer,"user");assert.equal(w.tasks().get(id).reviewPolicy,undefined);
  assert.throws(()=>w.publish("a",{...built,collaboration:{...built.collaboration,reviewer:"self"}}),/work_request_conflict/);
  assert.throws(()=>w.publish("a",{...built,content:"Different request"}),/work_request_conflict/);
});

test("a failed fresh inspection can recover changed submission evidence without certifying the old result",async t=>{
  const h=await continuityHarness(t),w=setup(h),id=w.assign(),result=w.submit(id);
  w.session.db.updateTranscriptEntry(result,row=>({...row,message:{...row.message,content:"Unexpected changed output"}}));
  assert.throws(()=>w.selfCheck(id),/work_evidence_changed/);
  const report=w.result(id,"Inspection found the original output changed; comparison failed"),checks=w.checks(id,report);checks[0].passed=false;
  w.selfCheck(id,{checks});assert.equal(w.tasks().get(id).state,"changes-requested");
  assert.throws(w.finish,/work_finish_incomplete/);
  const fixed=w.result(id,"Restored output and verified result");w.cmd("b",id,"submit",{result_ids:[fixed],evidence_ids:[fixed]});w.selfCheck(id);w.finish();
  assert.equal(w.tasks().get(id).state,"completed");
});

test("owner can report dependency drift then reconcile against its current checked version",async t=>{
  const h=await continuityHarness(t),w=setup(h),up=w.assign();w.submit(up);w.selfCheck(up);
  const down=w.assign({dependencies:[up]});w.submit(down);
  w.session.db.appendTranscriptEntry({id:"revision",kind:"message",role:"user",content:"Update the prerequisite",replyTo:up});
  w.cmd("a",up,"revise",{source_message_id:"revision",title:"New inputs",criteria:["Current"]});
  assert.throws(()=>w.selfCheck(down),/work_dependencies_changed/);
  const report=w.result(down,"Input version changed; old result needs inspection"),checks=w.checks(down,report);checks[0].passed=false;
  w.selfCheck(down,{checks});assert.equal(w.tasks().get(down).state,"changes-requested");
  w.submit(up);w.selfCheck(up);const fresh=w.result(down,"Reconciled output against current input");w.cmd("b",down,"submit",{result_ids:[fresh],evidence_ids:[fresh]});w.selfCheck(down);w.finish();
});

test("Stop recovery checks existing results only after a new scoped user continuation and fresh inspection",async t=>{
  const h=await continuityHarness(t),w=setup(h),id=w.assign();w.submit(id);
  await h.tm.sendPipeline.stopConversation("room");assert.throws(()=>w.selfCheck(id),/work_stopped/);
  w.session.db.appendTranscriptEntry({id:"resume",kind:"message",role:"user",content:"Inspect the saved result and finish; do not repeat the operation",replyTo:id});
  assert.throws(()=>w.selfCheck(id,{source_message_id:"resume"}),/work_inspection_required/);
  const report=w.result(id,"Inspected the already-published result; no operation replayed");
  w.selfCheck(id,{source_message_id:"resume",checks:w.checks(id,report)});w.finish();
  assert.equal(w.tasks().get(id).state,"completed");assert.equal(w.tasks().get(id).selfCheck.sourceMessageId,"resume");
  assert.equal(h.calls.length,0);
});

test("unrelated interrupted deliveries do not block new work, while a scoped interrupted follow-up does",async t=>{
  const h=await continuityHarness(t),w=setup(h),id=w.assign();w.submit(id);
  const interrupt=messageId=>{h.tm.sendPipeline.deliveries.queue(w.session.dbPath,messageId);h.tm.sendPipeline.deliveries.route(w.session.dbPath,messageId,["b"]);h.tm.sendPipeline.deliveries.settle(w.session.dbPath,messageId,"b","needs-review");};
  w.session.db.appendTranscriptEntry({id:"unrelated",kind:"message",role:"user",content:"Separate previous task"});interrupt("unrelated");w.selfCheck(id);w.finish();
  const other=w.assign();w.submit(other);
  w.session.db.appendTranscriptEntry({id:"scoped",kind:"message",role:"user",content:"Follow-up on that result",replyTo:other});interrupt("scoped");
  assert.throws(()=>w.selfCheck(other),/work_execution_uncertain/);
  assert.equal(w.tasks().get(other).state,"review");
});

test("uncertainty follows long quote chains exactly and terminates unrelated cycles",async t=>{
  const h=await continuityHarness(t),w=setup(h),id=w.assign();w.submit(id);
  w.session.db.appendTranscriptEntry({id:"cycle-a",kind:"message",role:"user",replyTo:"cycle-b",content:"Unrelated"});
  w.session.db.appendTranscriptEntry({id:"cycle-b",kind:"message",role:"user",replyTo:"cycle-a",content:"Unrelated"});
  const uncertain=messageId=>{h.tm.sendPipeline.deliveries.queue(w.session.dbPath,messageId);h.tm.sendPipeline.deliveries.route(w.session.dbPath,messageId,["b"]);h.tm.sendPipeline.deliveries.settle(w.session.dbPath,messageId,"b","needs-review");};
  uncertain("cycle-a");w.selfCheck(id);w.finish();
  const other=w.assign();w.submit(other);let previous=other;
  for(let n=0;n<110;n++){const next=`quote-${n}`;w.session.db.appendTranscriptEntry({id:next,kind:"message",role:"user",replyTo:previous,content:"Scoped follow-up"});previous=next;}
  uncertain(previous);assert.throws(()=>w.selfCheck(other),/work_execution_uncertain/);assert.throws(w.finish,/work_execution_uncertain/);
  assert.equal(w.tasks().get(other).state,"review");
});
