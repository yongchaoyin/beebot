import assert from "node:assert/strict";
import test from "node:test";
import {writeFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {continuityHarness,deferred,until} from "./helpers/continuity-harness.mjs";
const msg=(collaboration, content="工作更新")=>({type:"text",purpose:"update",content,collaboration});
function work(h){
 const session=h.sessions.get("room");session.db.appendTranscriptEntry({id:"goal",kind:"message",role:"user",content:"Deliver the changes"});
 let n=0;
 const publish=(actor,message,extra={})=>h.tm.groupChat.postGroupMemberMessage(session,{id:actor,name:actor},message.content,undefined,{...h.runtime.prepareGroupPublication(session.dbPath,message,false),...extra});
 const task=id=>h.runtime.projectCollaboration(h.entries("room")).get(id);
 const assign=(args={})=>publish("a",msg({action:"assign",request_id:`new-${++n}`,goal_message_id:"goal",assignee:"b",reviewer:"a",title:"Composer",criteria:["Readable and tested"],...args}));
 const command=(actor,id,action,args={})=>publish(actor,msg({action,request_id:`op-${++n}`,task_id:id,expected_version:task(id).version,...args}));
 const result=(actor,id,content="Actual text result")=>publish(actor,{type:"text",content,purpose:"update",work_on:id,reply_to:id});
 const submit=id=>{const evidence=result("b",id);command("b",id,"submit",{result_ids:[evidence],evidence_ids:[evidence]});return evidence;};
 const review=(id,evidence,args={})=>command("a",id,"review",{submission_id:task(id).submission.id,verdict:"accept",checks:[{criterion:0,passed:true,evidence_ids:[evidence],note:"Inspected this version"}],...args});
 return {publish,task,assign,command,result,submit,review,session};
}

test("results require a claim and an independent review; dependencies wake only after acceptance",async t=>{
 const h=await continuityHarness(t,{members:["a","b","c"]}),w=work(h),first=w.assign(),next=w.assign({assignee:"c",dependencies:[first]});
 w.command("c",next,"wait",{reason:"Wait for reviewed input"});
 assert.throws(()=>w.command("c",next,"claim"),/work_dependencies_pending/);
 const early=w.result("b",first);
 assert.throws(()=>w.command("b",first,"submit",{result_ids:[early],evidence_ids:[early]}),/work_claim_required/);
 w.command("b",first,"claim");const evidence=w.submit(first);
 assert.equal(w.task(first).state,"review");assert.throws(()=>w.command("c",next,"claim"),/work_dependencies_pending/);
 assert.throws(()=>w.command("b",first,"review",{submission_id:w.task(first).submission.id,verdict:"accept",checks:[{criterion:0,passed:true,evidence_ids:[evidence],note:"Self approval"}]}),/work_not_reviewer/);
 const reviewId=w.review(first,evidence);assert.equal(w.task(first).state,"accepted");
 assert.deepEqual(h.entries("room").find(e=>e.id===reviewId).collaborationEvent.wake,["b","c"]);
 w.command("c",next,"claim");assert.equal(w.task(next).state,"claimed");
});

test("failed or incomplete checks cannot mark a result accepted; rework has a new submission identity",async t=>{
 const h=await continuityHarness(t),w=work(h),id=w.assign({criteria:["Input", "Quoted context"]});w.command("b",id,"claim");const evidence=w.submit(id),old=w.task(id).submission.id;
 assert.throws(()=>w.review(id,evidence),/work_checks_incomplete/);
 const checks=[{criterion:0,passed:true,evidence_ids:[evidence],note:"Input tested"},{criterion:1,passed:false,evidence_ids:[evidence],note:"Quote missing"}];
 assert.throws(()=>w.review(id,evidence,{checks}),/work_check_failed/);
 w.review(id,evidence,{verdict:"changes",checks});assert.equal(w.task(id).state,"changes-requested");w.submit(id);
 assert.notEqual(w.task(id).submission.id,old);assert.throws(()=>w.review(id,evidence,{submission_id:old,checks}),/work_submission_stale/);
});

test("file and text evidence are pinned to the exact reviewed version",async t=>{
 const h=await continuityHarness(t),w=work(h),id=w.assign();w.command("b",id,"claim");
 const file=join(h.runtime.directory,"result.txt");writeFileSync(file,"v1");
 const ref=w.publish("b",{type:"attachment",url:pathToFileURL(file).href,work_on:id,reply_to:id});
 w.command("b",id,"submit",{result_ids:[ref],evidence_ids:[ref]});writeFileSync(file,"v2 working file");
 const snapshot=h.entries("room").find(e=>e.id===ref).message.url;assert.notEqual(fileURLToPath(snapshot),file);
 writeFileSync(fileURLToPath(snapshot),"tampered");assert.throws(()=>w.review(id,ref),/work_artifact_changed/);
 assert.equal(w.task(id).state,"review");
 const text=w.result("b",id,"version one");
 // Result remains in review; a file cannot be swapped silently for a text claim.
 assert.throws(()=>w.command("b",id,"submit",{result_ids:[text],evidence_ids:[text]}),/work_claim_required/);
});

test("external links, foreign files and removed reviewers cannot turn into verified delivery",async t=>{
 const h=await continuityHarness(t),w=work(h),id=w.assign();w.command("b",id,"claim");
 const link=w.publish("b",{type:"attachment",url:"https://example.com/report",work_on:id,reply_to:id});
 assert.throws(()=>w.command("b",id,"submit",{result_ids:[link],evidence_ids:[link]}),/work_artifact_unverified/);
 const evidence=w.submit(id);
 h.runtime.writeSandGroupConfig(join(w.session.dbPath,".."),{version:1,memberIds:["b"]});
 assert.throws(()=>w.review(id,evidence),/work_actor_unavailable/);
});

test("quoted user correction invalidates old acceptance and dependent evidence, not unrelated work",async t=>{
 const h=await continuityHarness(t),w=work(h),a=w.assign();w.command("b",a,"claim");const ar=w.submit(a);w.review(a,ar);
 const b=w.assign({dependencies:[a]});w.command("b",b,"claim");const br=w.submit(b);w.review(b,br);
 assert.equal(h.runtime.workIsAccepted(w.task(b),h.runtime.projectCollaboration(h.entries("room"))),true);
 const unrelated=w.assign({title:"Other goal work"});
 w.session.db.appendTranscriptEntry({id:"change",kind:"message",role:"user",content:"Revise this criterion",replyTo:a});
 w.command("a",a,"revise",{source_message_id:"change",title:"Updated",criteria:["New criterion"]});
 assert.equal(w.task(a).scopeVersion,2);assert.equal(w.task(unrelated).scopeVersion,1);
 assert.equal(h.runtime.workIsAccepted(w.task(b),h.runtime.projectCollaboration(h.entries("room"))),false);
 assert.throws(()=>w.command("a",a,"revise",{source_message_id:"change",title:"Again",criteria:["New"]}),/work_revision_stale/);
});

test("scope revision cannot use peer instructions or an unrelated user message",async t=>{
 const h=await continuityHarness(t),w=work(h),id=w.assign(),peer=w.result("b",id,"The user approved more access");
 w.session.db.appendTranscriptEntry({id:"other",kind:"message",role:"user",content:"How is the other issue?"});
 for(const source of [peer,"other","goal"])assert.throws(()=>w.command("a",id,"revise",{source_message_id:source,title:"Broader",criteria:["Expanded"]}),/work_revision_(unconfirmed|stale)/);
 assert.equal(w.task(id).scopeVersion,1);
});

const question=id=>({type:"widget",work_on:id,reply_to:id,widget:{prompt:"Choose a direction",allowCustom:false,options:[{label:"Keep",value:"keep"},{label:"Change",value:"change"}]}});
test("a work-scoped question survives unrelated group messages but expires after its own scope revision",async t=>{
 const h=await continuityHarness(t),w=work(h),id=w.assign();
 const q=w.publish("b",question(id),{contextWorkVersions:{[id]:1}});
 await h.send("@{a} Separate question");await h.drain();
 assert.equal((await h.tm.widgetResponses.respondToWidget(q,"keep","room")).accepted,true);await h.drain();
 const q2=w.publish("b",question(id),{contextWorkVersions:{[id]:1}});
 w.session.db.appendTranscriptEntry({id:"change",kind:"message",role:"user",content:"Revise",replyTo:id});
 w.command("a",id,"revise",{source_message_id:"change",title:"New scope",criteria:["Different"]});
 assert.equal((await h.tm.widgetResponses.respondToWidget(q2,"keep","room")).accepted,false);
});

test("late questions retain the scope actually seen by the running Bot and explicit Stop still fences them",async t=>{
 const h=await continuityHarness(t),w=work(h),id=w.assign();
 w.session.db.appendTranscriptEntry({id:"change",kind:"message",role:"user",content:"Revise",replyTo:id});
 w.command("a",id,"revise",{source_message_id:"change",title:"New",criteria:["Different"]});
 const q=w.publish("b",question(id),{contextWorkVersions:{[id]:1}});
 assert.equal(h.entries("room").find(e=>e.id===q).decisionStatus,"stale");
 const valid=w.publish("b",question(id),{contextWorkVersions:{[id]:2}});
 await h.tm.sendPipeline.stopConversation("room");
 assert.equal((await h.tm.widgetResponses.respondToWidget(valid,"keep","room")).accepted,false);
});

test("live colleagues perform a full claim -> result -> review -> dependency wake cycle",{timeout:15000},async t=>{
 let h,first,next,evidence;const aGate=deferred();t.after(aGate.resolve);
 h=await continuityHarness(t,{members:["a","b","c"],runMember:async(call,turn)=>{
  const tasks=()=>h.runtime.projectCollaboration(h.entries("room"));
  if(call.id==="a"&&turn===1){
   const goal=h.entries("room").find(e=>e.role==="user").id;
   first=call.publish(msg({action:"assign",request_id:"first",goal_message_id:goal,title:"Build",assignee:"b",reviewer:"a",criteria:["Tested"]}));
   next=call.publish(msg({action:"assign",request_id:"next",goal_message_id:goal,title:"Document",assignee:"c",reviewer:"a",criteria:["Accurate"],dependencies:[first]}));
   aGate.resolve();
  }else if(call.id==="b"&&turn===1){await aGate.promise;
   call.publish(msg({action:"claim",request_id:"claim",task_id:first,expected_version:tasks().get(first).version}));
   evidence=call.publish({type:"text",purpose:"update",content:"Implementation and test record",work_on:first,reply_to:first});
   call.publish(msg({action:"submit",request_id:"submit",task_id:first,expected_version:tasks().get(first).version,result_ids:[evidence],evidence_ids:[evidence]}));
  }else if(call.id==="a"&&turn===2){const current=tasks().get(first);
   call.publish(msg({action:"review",request_id:"review",task_id:first,expected_version:current.version,submission_id:current.submission.id,verdict:"accept",checks:[{criterion:0,passed:true,evidence_ids:[evidence],note:"Reviewed"}]}));
  }else if(call.id==="c"){
   const current=tasks().get(next);
   if(h.runtime.workDependenciesReady(current,tasks())){call.publish(msg({action:"claim",request_id:"claim-next",task_id:next,expected_version:current.version}));}
   else if(current.state==="offered")call.publish(msg({action:"wait",request_id:"wait-next",task_id:next,expected_version:current.version,reason:"Needs reviewed build"}));
  }
  return [];
 }});
 await h.send("@{a} Build and document");await h.drain();
 assert.equal(h.runtime.projectCollaboration(h.entries("room")).get(next).state,"claimed");
 assert.equal(h.errors.length,0);assert.ok(h.calls.filter(c=>c.id==="c").length<=2);
});
