import assert from "node:assert/strict";
import test from "node:test";
import { dirname } from "node:path";
import { continuityHarness } from "./helpers/continuity-harness.mjs";

function setup(h) {
  const session = h.sessions.get("room"); let n = 0;
  session.db.appendTranscriptEntry({id:"goal",kind:"message",role:"user",content:"Deliver within the existing scope"});
  const tasks = () => h.runtime.projectCollaboration(h.entries("room"));
  const post = (actor, action, key = `request-${++n}`) => h.tm.groupChat.postGroupMemberMessage(session,
    {id:actor,name:actor}, "Quoted colleague work update", undefined,
    h.runtime.prepareGroupPublication(session.dbPath, {type:"text",content:"Quoted colleague work update",purpose:"update",
      collaboration:{request_id:key,...action}}, false));
  const assign = () => post("a",{action:"assign",goal_message_id:"goal",assignee:"b",reviewer:"d",title:"Verified result",criteria:["Correct behavior"]});
  const cmd = (actor,id,action,fields={},key) => post(actor,{action,task_id:id,expected_version:tasks().get(id).version,...fields},key);
  const transfer = (id,fields={}) => cmd("a",id,"reassign",{assignee:"c",reviewer:"d",reason:"C has the required tool",...fields});
  return {session,tasks,post,assign,cmd,transfer};
}

test("declining before claim preserves the assignment quote and transfers responsibility without new scope",async t=>{
 const h=await continuityHarness(t,{members:["a","b","c","d"]}),w=setup(h),id=w.assign();
 const decline=w.cmd("b",id,"decline",{reason:"This Bot lacks the required tool"});
 assert.equal(w.tasks().get(id).state,"declined");
 assert.equal(w.tasks().get(id).claimedBy,undefined);
 const event=h.entries("room").find(e=>e.id===decline);
 assert.equal(event.replyTo,id);assert.deepEqual(event.collaborationEvent.wake,["a"]);
 const before=w.tasks().get(id),transfer=w.transfer(id),after=w.tasks().get(id);
 assert.equal(after.id,id);assert.equal(after.goalId,before.goalId);assert.equal(after.creator,"a");
 assert.deepEqual(after.criteria,before.criteria);assert.deepEqual(after.dependencies,before.dependencies);
 assert.equal(after.assignee,"c");assert.equal(after.scopeVersion,before.scopeVersion+1);
 assert.equal(after.state,"offered");assert.equal(after.claimedBy,undefined);
 assert.deepEqual(h.entries("room").find(e=>e.id===transfer).collaborationEvent.wake,["c"]);
 assert.equal(h.runtime.workDecisionCurrent(h.entries("room"),{taskId:id,scopeVersion:before.scopeVersion}),false);
 assert.throws(()=>w.cmd("b",id,"claim"),/work_not_owner/);
 w.cmd("c",id,"claim");assert.equal(w.tasks().get(id).claimedBy,"c");
 assert.equal(h.calls.length,0,"recording an offer must not secretly execute the recipient");
});

test("only the designated recipient can decline and only its coordinator can reassign",async t=>{
 const h=await continuityHarness(t,{members:["a","b","c","d"]}),w=setup(h),id=w.assign();
 assert.throws(()=>w.cmd("c",id,"decline",{reason:"Not my assignment"}),/work_not_owner/);
 assert.throws(()=>w.cmd("b",id,"reassign",{assignee:"c",reviewer:"d",reason:"Delegate myself"}),/work_not_coordinator/);
 assert.throws(()=>w.transfer(id,{assignee:"missing"}),/work_assignee_unavailable/);
 assert.throws(()=>w.transfer(id,{reviewer:"c"}),/work_reviewer_invalid/);
 assert.throws(()=>w.transfer(id,{assignee:"b"}),/work_same_assignee/);
 assert.equal(w.tasks().get(id).version,1);
});

test("same request retry is idempotent and stale ownership versions never claim or reassign",async t=>{
 const h=await continuityHarness(t,{members:["a","b","c","d"]}),w=setup(h),id=w.assign();
 const action={action:"reassign",task_id:id,expected_version:1,assignee:"c",reviewer:"d",reason:"C is available"};
 const first=w.post("a",action,"stable"),count=h.entries("room").length;
 assert.equal(w.post("a",action,"stable"),first);assert.equal(h.entries("room").length,count);
 assert.throws(()=>w.post("a",{...action,reason:"Different request"},"stable"),/work_request_conflict/);
 assert.throws(()=>w.post("b",{action:"claim",task_id:id,expected_version:1}),/work_version_conflict/);
 assert.throws(()=>w.post("a",action),/work_version_conflict/);
});

test("waiting or revision cannot erase execution history to permit unsafe reassignment",async t=>{
 const h=await continuityHarness(t,{members:["a","b","c","d"]}),w=setup(h),id=w.assign();
 w.cmd("b",id,"claim");w.cmd("b",id,"wait",{reason:"Waiting for a result"});
 assert.equal(w.tasks().get(id).claimedBy,undefined);
 assert.throws(()=>w.transfer(id),/work_reassignment_unsafe/);
 assert.throws(()=>w.cmd("b",id,"decline",{reason:"No longer available"}),/work_reassignment_unsafe/);
 w.session.db.appendTranscriptEntry({id:"correction",kind:"message",role:"user",content:"Change the requirement",replyTo:id});
 w.cmd("a",id,"revise",{source_message_id:"correction",title:"Updated",criteria:["New behavior"]});
 assert.equal(w.tasks().get(id).state,"offered");
 assert.throws(()=>w.transfer(id),/work_reassignment_unsafe/);
 assert.equal(w.tasks().get(id).assignee,"b");assert.equal(h.interrupts.length,0);
});

test("a departed unclaimed recipient can be replaced but a missing new reviewer cannot",async t=>{
 const h=await continuityHarness(t,{members:["a","b","c","d"]}),w=setup(h),id=w.assign();
 h.runtime.writeSandGroupConfig(dirname(w.session.dbPath),{version:1,memberIds:["a","c","d"]});
 assert.throws(()=>w.transfer(id,{reviewer:"b"}),/work_reviewer_invalid/);
 w.transfer(id);assert.equal(w.tasks().get(id).assignee,"c");
 assert.equal(w.tasks().get(id).reviewer,"d");
});

test("failed reassignment persistence leaves the original owner and version intact",async t=>{
 const h=await continuityHarness(t,{members:["a","b","c","d"]}),w=setup(h),id=w.assign();
 w.session.db.durable=false;assert.throws(()=>w.transfer(id));
 assert.equal(w.tasks().get(id).assignee,"b");assert.equal(w.tasks().get(id).version,1);
 w.session.db.durable=true;w.transfer(id);assert.equal(w.tasks().get(id).assignee,"c");
});

test("single Bot records inability in the same chat without inventing another member",async t=>{
 const h=await continuityHarness(t),session=h.sessions.get("a"),runtime=new h.runtime.TurnRuntime(h.tm);
 h.tm.ackObligations.fulfillAckObligation=()=>{};h.tm.roster.applyAgentUpdateToOutline=()=>{};
 const post=collaboration=>{const prior=h.tm.turnRuntime;h.tm.turnRuntime=runtime;try{return runtime.handleAgentUpdate({type:"send-message",message:{type:"text",content:"Cannot take this work yet",purpose:"update",collaboration},timestampMs:Date.now()},session);}finally{h.tm.turnRuntime=prior;}};
 session.db.appendTranscriptEntry({id:"goal",kind:"message",role:"user",content:"Prepare a native test"});
 const id=post({action:"assign",request_id:"assign",goal_message_id:"goal",title:"Native test",assignee:"a",reviewer:"user",criteria:["Runs on macOS"]});
 post({action:"decline",request_id:"decline",task_id:id,expected_version:1,reason:"Native macOS environment not available"});
 assert.equal(h.runtime.projectCollaboration(h.entries("a")).get(id).state,"declined");
 assert.throws(()=>post({action:"reassign",request_id:"reassign",task_id:id,expected_version:2,assignee:"b",reviewer:"user",reason:"Try another"}),/work_assignee_unavailable/);
 assert.equal(h.directCalls.length,0);
});

test("actual A-B-C-D dialogue declines, reassigns, checks and finishes against the original assignment",async t=>{
 let h,id,finished=false;const claimed=[];
 h=await continuityHarness(t,{members:["a","b","c","d"],runMember:async call=>{
  const tasks=()=>h.runtime.projectCollaboration(h.entries("room"));const task=()=>tasks().get(id);
  const post=(action,extra,content)=>call.publish({type:"text",purpose:"update",content,collaboration:{request_id:`${call.id}-${action}`,action,...extra}});
  const update=(action,extra,content)=>post(action,{task_id:id,expected_version:task().version,...extra},content);
  if(call.id==="a"&&!id){const goal=h.entries("room").find(e=>e.role==="user").id;
   id=post("assign",{goal_message_id:goal,assignee:"b",reviewer:"d",title:"Tested output",criteria:["Readable verified output"]},"B, please take this work");
  }else if(call.id==="b"&&task()?.state==="offered"){
   update("decline",{reason:"Required tool unavailable"},"I cannot take this with my current tools");
  }else if(call.id==="a"&&task()?.state==="declined"){
   update("reassign",{assignee:"c",reviewer:"d",reason:"C has the required tool"},"C, please take the same scope; D will check");
  }else if(call.id==="c"&&task()?.state==="offered"){
   update("claim",{},"I will do it");claimed.push("c");
   const result=call.publish({type:"text",purpose:"update",reply_to:id,work_on:id,content:"Actual published output"});
   update("submit",{result_ids:[result],evidence_ids:[result]},"D, please check this version");
  }else if(call.id==="d"&&task()?.state==="review"){
   const submission=task().submission;
   update("review",{submission_id:submission.id,verdict:"accept",checks:[{criterion:0,passed:true,evidence_ids:submission.resultIds,note:"Inspected the published version"}]},"This version passes");
  }else if(call.id==="a"&&task()?.state==="accepted"&&!finished){finished=true;
   post("finish",{goal_message_id:task().goalId,expected_tasks:[{id,version:task().version}],result_ids:task().submission.resultIds},"All recorded work checked");
  }
  return [];
 }});
 await h.send("@{a} Coordinate this delivery");await h.drain();
 assert.equal(finished,true);assert.deepEqual(claimed,["c"]);assert.deepEqual(h.errors,[]);
 const entries=h.entries("room"),tasks=h.runtime.projectCollaboration(entries),receipt=[...h.runtime.projectCompletions(entries).values()][0];
 assert.equal(tasks.size,1);assert.equal(tasks.get(id).assignee,"c");
 assert.equal(entries.find(e=>e.message?.content==="I cannot take this with my current tools").replyTo,id);
 assert.equal(entries.find(e=>e.message?.content==="Actual published output").replyTo,id);
 assert.equal(h.runtime.completionIsCurrent(receipt,tasks),true);
});

test("a recovered colleague can be explicitly re-offered declined work, but not claim it silently",async t=>{
 const h=await continuityHarness(t,{members:["a","b","c","d"]}),w=setup(h),id=w.assign();
 w.cmd("b",id,"decline",{reason:"Tool not configured yet"});
 assert.throws(()=>w.cmd("b",id,"claim"),/work_not_claimable/);
 w.transfer(id,{assignee:"b",reason:"Tool is now available; same scope"});
 w.cmd("b",id,"claim");assert.equal(w.tasks().get(id).claimedBy,"b");
});

test("an offer waiting for a dependency may be declined and reassigned without bypassing that dependency",async t=>{
 const h=await continuityHarness(t,{members:["a","b","c","d"]}),w=setup(h),prerequisite=w.assign();
 const id=w.post("a",{action:"assign",goal_message_id:"goal",assignee:"b",reviewer:"d",title:"Dependent work",criteria:["Uses checked input"],dependencies:[prerequisite]});
 w.cmd("b",id,"wait",{reason:"Await reviewed prerequisite"});w.cmd("b",id,"decline",{reason:"Missing required tool"});
 w.transfer(id);assert.deepEqual(w.tasks().get(id).dependencies,[prerequisite]);
 assert.throws(()=>w.cmd("c",id,"claim"),/work_dependencies_pending/);
 assert.throws(()=>w.transfer(id,{criteria:["Broadened scope"]}),/unrecognized|Unrecognized/);
});

test("real SendMessage schema exposes transfer actions without allowing external-channel delegation",async t=>{
 const h=await continuityHarness(t),deps={getIngestAttachment:()=>undefined,onSendMessage:()=>undefined};
 for(const collaboration of [
  {action:"decline",request_id:"decline",task_id:"task",expected_version:1,reason:"Tool unavailable"},
  {action:"reassign",request_id:"reassign",task_id:"task",expected_version:2,assignee:"c",reviewer:"d",reason:"C has the tool"},
 ]){
  const message={type:"text",content:"Quoted work update",reply_to:"task",work_on:"task",purpose:"update",collaboration};
  const output=await h.runtime.buildSandSendMessage({},message,deps);
  assert.deepEqual(output.collaboration,collaboration);assert.equal(output.reply_to,"task");
  await assert.rejects(h.runtime.buildSandSendMessage({},{...message,channel:"slack:external"},deps));
 }
});
