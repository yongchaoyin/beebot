import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { continuityHarness } from "./helpers/continuity-harness.mjs";

const message=(quote,action,content="Work update",extra={})=>({type:"text",content,reply_to:quote,...(action?{collaboration:action}:{intent:"update"}),...extra});
async function fixture(t,options={}) {
 const h=await continuityHarness(t,options);await h.send("@{a} Deliver this outcome");await h.drain();
 const root=h.entries("room").find(e=>e.role==="user").id,session=h.sessions.get("room");
 const post=(actor,raw)=>h.tm.groupChat.postGroupMemberMessage(session,{id:actor,name:actor.toUpperCase(),description:"Colleague"},raw.content??"File",undefined,h.runtime.prepareGroupPublication(session.dbPath,raw,false));
 const tasks=()=>h.runtime.collaborationTasks(h.entries("room"));
 const assign=(extra={})=>post("a",message(root,{action:"assign",title:"Source change",deliverable:"Reviewed source",criteria:["Correct behavior"],assignee_id:"b",...extra}));
 const change=(actor,id,action,extra={})=>post(actor,message(id,{action,task_id:id,expected_version:tasks().get(id).version,...extra}));
 const submit=(id,actor="b")=>{const evidence=post(actor,message(id,null,"Saved result and reproducible evidence"));change(actor,id,"submit",{evidence:[{criterion:0,message_id:evidence}]});return evidence;};
 const review=(id,verdict="approve",actor="a")=>{const check=post(actor,message(id,null,"I inspected this exact submitted result"));change(actor,id,"review",{submission_id:tasks().get(id).submission.id,verdict,checks:[{criterion:0,message_id:check,passed:verdict==="approve"}]});};
 return{...h,root,session,post,tasks,assign,change,submit,review};
}

test("A delegates B/C/D, dependency C wakes only after B's exact result is reviewed, and A closes every task",async t=>{
 let h,ids={},initialized=false,finalized;
 h=await continuityHarness(t,{members:["a","b","c","d"],runMember:async call=>{
  const root=h.entries("room").find(e=>e.role==="user").id;
  const tasks=()=>h.runtime.collaborationTasks(h.entries("room"));
  if(call.id==="a"&&!initialized){
   initialized=true;
   for(const bot of ["b","c","d"]){
    ids[bot]=call.publish(message(root,{action:"assign",title:bot,deliverable:"Result",criteria:["Evidence"],assignee_id:bot,...(bot==="c"?{depends_on:[ids.b]}:{})}));
   }
  }else if(call.id!=="a"){
   const id=ids[call.id],task=tasks().get(id);
   if(task?.state!=="offered") return [];
   if(call.id==="c")assert.equal(tasks().get(ids.b).state,"reviewed");
   call.publish(message(id,{action:"claim",task_id:id,expected_version:1}));
   const evidence=call.publish(message(id,null,`Result from ${call.id}`));
   call.publish(message(id,{action:"submit",task_id:id,expected_version:2,evidence:[{criterion:0,message_id:evidence}]}));
  }else{
   for(const task of tasks().values())if(task.state==="submitted"){
    const check=call.publish(message(task.id,null,`Checked ${task.title}`));
    call.publish(message(task.id,{action:"review",task_id:task.id,expected_version:task.version,submission_id:task.submission.id,verdict:"approve",checks:[{criterion:0,message_id:check,passed:true}]}));
   }
   const all=[...tasks().values()];
   if(!finalized&&all.length===3&&all.every(t=>t.state==="reviewed"))finalized=call.publish(message(root,{action:"finalize",root_id:root,task_versions:all.map(t=>({task_id:t.id,version:t.version}))},"Outcome assembled; user acceptance remains separate"));
  }
  return [];
 }});
 await h.send("@{a} Coordinate B, C and D");await h.drain();
 assert.ok(finalized);assert.equal(h.errors.length,0);
 assert.ok([...h.runtime.collaborationTasks(h.entries("room")).values()].every(t=>t.state==="reviewed"));
 assert.ok(h.entries("room").find(e=>e.id===finalized).collaborationEvent.finalization);
 assert.equal(h.entries("room").filter(e=>e.collaborationEvent?.action==="claim").length,3);
});

test("dependencies are existing acyclic work references; a blocked owner cannot start via resume",async t=>{
 const f=await fixture(t),up=f.assign(),down=f.assign({depends_on:[up]});
 f.change("b",down,"claim");assert.equal(f.tasks().get(down).state,"blocked");
 assert.throws(()=>f.change("b",down,"resume"),/dependencies are reviewed/);
 assert.throws(()=>f.assign({depends_on:["unknown"]}),/existing tasks/);
 f.change("b",up,"claim");f.submit(up);f.review(up);
 f.change("b",down,"resume");assert.equal(f.tasks().get(down).state,"claimed");
});

test("a question on task X survives chat on task Y but not revision of task X",async t=>{
 const f=await fixture(t),x=f.assign(),y=f.assign({title:"Other topic"});f.change("b",x,"claim");
 const question=()=>f.post("b",{type:"widget",reply_to:x,work_on:x,widget:{prompt:"Choose for X",options:[{label:"Option one",value:"one"}]}});
 const first=question();
 await f.send("@{a} Discuss Y", "room",{replyToId:y});await f.drain();
 assert.equal((await f.tm.widgetResponses.respondToWidget(first,"one","room")).accepted,true);await f.drain();
 const second=question();f.change("a",x,"revise",{deliverable:"Changed X",criteria:["New requirement"]});
 assert.equal((await f.tm.widgetResponses.respondToWidget(second,"one","room")).accepted,false);
 assert.equal(f.entries("room").find(e=>e.id===second).decisionStatus,"stale");
});

test("in-flight obsolete contract cannot publish a current-looking question",async t=>{
 const f=await fixture(t),id=f.assign();f.change("b",id,"claim");
 f.change("a",id,"revise",{deliverable:"New scope",criteria:["Changed"]});
 const raw={type:"widget",reply_to:id,work_on:id,widget:{prompt:"Old assumption?",options:[{label:"Yes"}]}};
 const pub=f.runtime.prepareGroupPublication(f.session.dbPath,raw,false);
 const q=f.tm.groupChat.postGroupMemberMessage(f.session,{id:"b",name:"B",description:""},pub.content,undefined,{...pub,contextWorkVersions:{[id]:1}});
 assert.equal(f.entries("room").find(e=>e.id===q).decisionStatus,"stale");
});

test("submission needs all criteria; review needs designated reviewer and a passing check",async t=>{
 const f=await fixture(t),id=f.assign();f.change("b",id,"claim");
 const evidence=f.post("b",message(id,null,"Result"));
 assert.throws(()=>f.change("b",id,"submit",{evidence:[{criterion:1,message_id:evidence}]}),/every acceptance criterion/);
 f.change("b",id,"submit",{evidence:[{criterion:0,message_id:evidence}]});
 const result=f.tasks().get(id).submission.id,check=f.post("a",message(id,null,"Check failed"));
 assert.throws(()=>f.change("b",id,"review",{submission_id:result,verdict:"approve",checks:[{criterion:0,message_id:evidence,passed:true}]}),/designated reviewer/);
 assert.throws(()=>f.change("a",id,"review",{submission_id:result,verdict:"approve",checks:[{criterion:0,message_id:check,passed:false}]}),/failing acceptance criterion/);
 assert.equal(f.tasks().get(id).state,"submitted");
});

test("rework preserves previous evidence but only the new submission can be approved",async t=>{
 const f=await fixture(t),id=f.assign();f.change("b",id,"claim");const first=f.submit(id),oldResult=f.tasks().get(id).submission.id;
 f.review(id,"changes_requested");assert.equal(f.tasks().get(id).state,"changes_requested");
 f.change("b",id,"resume");const second=f.submit(id),check=f.post("a",message(id,null,"Check version 2"));
 assert.throws(()=>f.change("a",id,"review",{submission_id:oldResult,verdict:"approve",checks:[{criterion:0,message_id:check,passed:true}]}),/exact current/);
 f.review(id);assert.equal(f.tasks().get(id).state,"reviewed");
 assert.ok(f.entries("room").find(e=>e.id===first));assert.ok(f.entries("room").find(e=>e.id===second));
});

test("changed upstream requirements prevent downstream result acceptance",async t=>{
 const f=await fixture(t),up=f.assign();f.change("b",up,"claim");f.submit(up);f.review(up);
 const down=f.assign({depends_on:[up]});f.change("b",down,"claim");
 f.change("a",up,"revise",{deliverable:"New upstream",criteria:["Changed"]});
 assert.throws(()=>f.submit(down),/Resolve changed dependencies/);
 assert.equal(f.tasks().get(down).state,"claimed");
 assert.equal(f.tasks().get(up).contractVersion,2);
});

test("file evidence is immutable-by-verification: changed snapshot blocks review and finalization",async t=>{
 const f=await fixture(t),id=f.assign();f.change("b",id,"claim");
 const file=join(f.runtime.directory,"result.txt");writeFileSync(file,"first");
 const pub=f.post("b",{type:"attachment",reply_to:id,url:pathToFileURL(file).href});
 f.change("b",id,"submit",{evidence:[{criterion:0,message_id:pub}]});
 const saved=f.entries("room").find(e=>e.id===pub);writeFileSync(fileURLToPath(saved.message.url),"other");
 assert.throws(()=>f.review(id),/Evidence file changed/);assert.equal(f.tasks().get(id).state,"submitted");
 writeFileSync(fileURLToPath(saved.message.url),"first");f.review(id);writeFileSync(fileURLToPath(saved.message.url),"third");
 assert.throws(()=>f.post("a",message(f.root,{action:"finalize",root_id:f.root,task_versions:[{task_id:id,version:f.tasks().get(id).version}]})),/Evidence file changed/);
});

test("finalization cannot omit pending work or use stale task versions",async t=>{
 const f=await fixture(t),a=f.assign();f.change("b",a,"claim");f.submit(a);f.review(a);
 const close=(versions)=>f.post("a",message(f.root,{action:"finalize",root_id:f.root,task_versions:versions}));
 const version=f.tasks().get(a).version;const b=f.assign({title:"Required extra item"});
 assert.throws(()=>close([{task_id:a,version}]),/incomplete or changed/);
 f.change("b",b,"claim");f.submit(b);f.review(b);
 assert.throws(()=>close([{task_id:a,version:version-1},{task_id:b,version:f.tasks().get(b).version}]),/incomplete or changed/);
 const id=close([...f.tasks().values()].map(t=>({task_id:t.id,version:t.version})));
 assert.ok(f.entries("room").find(e=>e.id===id).collaborationEvent.finalization);
});

test("replayed logical action returns original message without another task or wake",async t=>{
 const f=await fixture(t),raw=message(f.root,{action:"assign",title:"One action",deliverable:"Result",criteria:["Check"],assignee_id:"b"});
 const pub=f.runtime.prepareGroupPublication(f.session.dbPath,{...raw,collaborationKey:"stable-tool-call"},false);
 const a={id:"a",name:"A",description:""},first=f.tm.groupChat.postGroupMemberMessage(f.session,a,pub.content,undefined,pub);
 const replay=f.runtime.prepareGroupPublication(f.session.dbPath,{...raw,collaborationKey:"stable-tool-call"},false);
 assert.equal(f.tm.groupChat.postGroupMemberMessage(f.session,a,replay.content,undefined,replay),first);assert.equal(replay.replayed,true);
 assert.equal(f.tasks().size,1);
 const changed=f.runtime.prepareGroupPublication(f.session.dbPath,{...raw,content:"Different",collaborationKey:"stable-tool-call"},false);
 assert.throws(()=>f.tm.groupChat.postGroupMemberMessage(f.session,a,changed.content,undefined,changed),/already used with different input/);
});

test("single Bot submits a real file and self-checks through the actual publication handler",async t=>{
 const h=await continuityHarness(t);await h.send("Produce a file","a");await h.drain();
 const session=h.sessions.get("a"),runtime=new h.runtime.TurnRuntime(h.tm),root=h.entries("a").find(e=>e.role==="user").id;
 h.tm.ackObligations.fulfillAckObligation=()=>{};
 const post=raw=>runtime.handleAgentUpdate({type:"send-message",message:raw,timestampMs:Date.now()},session);
 const tasks=()=>h.runtime.collaborationTasks(h.entries("a"));
 const id=post(message(root,{action:"assign",title:"Solo result",deliverable:"Readable file",criteria:["Content"],assignee_id:"a"}));
 post(message(id,{action:"claim",task_id:id,expected_version:1}));
 const file=join(h.runtime.directory,"solo.txt");writeFileSync(file,"actual solo result");
 const artifact=post({type:"attachment",reply_to:id,url:pathToFileURL(file).href});
 assert.equal(h.entries("a").find(e=>e.id===artifact).message.artifact.availability,"snapshot");
 post(message(id,{action:"submit",task_id:id,expected_version:2,evidence:[{criterion:0,message_id:artifact}]}));
 const check=post(message(id,null,"Read the actual file; content is correct"));
 post(message(id,{action:"review",task_id:id,expected_version:3,submission_id:tasks().get(id).submission.id,verdict:"approve",checks:[{criterion:0,message_id:check,passed:true}]}));
 assert.equal(tasks().get(id).review.kind,"self");assert.equal(tasks().get(id).state,"reviewed");
 assert.equal(h.runtime.collaborationTasks(h.entries("room")).size,0);
});

test("rebuilding from saved transcript preserves ownership without starting or replaying work",async t=>{
 const f=await fixture(t),id=f.assign();f.change("b",id,"claim");
 const serialized=JSON.stringify(f.entries("room")),count=f.calls.length;
 const projected=f.runtime.collaborationTasks(JSON.parse(serialized));assert.equal(projected.get(id).ownerId,"b");
 projected.get(id).ownerId="forged";
 assert.equal(f.tasks().get(id).ownerId,"b");assert.equal(f.calls.length,count);
});

test("the persistent transition bound cannot be reset by unrelated chat",async t=>{
 const f=await fixture(t),id=f.assign();f.change("b",id,"claim");
 while(f.tasks().get(id).version<64){const task=f.tasks().get(id);f.change("b",id,task.state==="blocked"?"resume":"block",task.state==="blocked"?{}:{reason:"Not resolved"});}
 await f.send("@{a} another topic");await f.drain();
 assert.throws(()=>f.change("b",id,"block",{reason:"Still spinning"}),/persistent transition budget/);
 assert.equal(f.tasks().get(id).version,64);
});


test("file contracts reject prose-only delivery and actions cannot hide as progress updates",async t=>{
 const f=await fixture(t),id=f.assign({output_type:"file"});f.change("b",id,"claim");
 assert.throws(()=>f.submit(id),/real file snapshot/);
 assert.throws(()=>f.post("a",{...message(id,{action:"block",task_id:id,expected_version:2,reason:"No"}),intent:"update"}),/already defines routing/);
});


test("reviewed upstream file tampering blocks dependent claim even across outcome roots",async t=>{
 const f=await fixture(t),up=f.assign({output_type:"file"});f.change("b",up,"claim");
 const file=join(f.runtime.directory,"upstream.txt");writeFileSync(file,"actual dependency");
 const pub=f.post("b",{type:"attachment",reply_to:up,url:pathToFileURL(file).href});
 f.change("b",up,"submit",{evidence:[{criterion:0,message_id:pub}]});f.review(up);
 await f.send("@{a} Another outcome");await f.drain();
 const root=f.entries("room").filter(e=>e.role==="user").at(-1).id;
 const down=f.post("a",message(root,{action:"assign",title:"Dependent outcome",deliverable:"Output",criteria:["Check"],assignee_id:"b",depends_on:[up]}));
 const snapshot=f.entries("room").find(e=>e.id===pub).message.url;writeFileSync(fileURLToPath(snapshot),"corrupt");
 assert.throws(()=>f.change("b",down,"claim"),/Evidence file is missing or changed|Evidence file changed/);
 assert.equal(f.tasks().get(down).state,"offered");
});

test("a downstream question stays stale after upstream revision is reviewed again",async t=>{
 const f=await fixture(t),up=f.assign();f.change("b",up,"claim");f.submit(up);f.review(up);
 const down=f.assign({depends_on:[up]});f.change("b",down,"claim");
 const context=f.runtime.workDecisionContext(f.entries("room"),down);
 assert.equal(f.runtime.isWorkDecisionCurrent(f.entries("room"),context),true);
 f.change("a",up,"revise",{deliverable:"New basis",criteria:["Check new basis"]});
 f.change("b",up,"resume");f.submit(up);f.review(up);
 assert.equal(f.runtime.isWorkDecisionCurrent(f.entries("room"),context),false);
});

test("group work cannot be assigned to its own reviewer while a lone Bot may self-check",async t=>{
 const f=await fixture(t);
 assert.throws(()=>f.assign({assignee_id:"a"}),/different reviewer/);
 const open=f.assign({assignee_id:undefined});
 assert.throws(()=>f.change("a",open,"claim"),/reviewer cannot also claim/);
 assert.equal(f.tasks().get(open).ownerId,undefined);
});


test("live work questions survive legacy move-on collection and gate submission until answered",async t=>{
 const f=await fixture(t),x=f.assign(),y=f.assign({title:"Other topic"});f.change("b",x,"claim");
 const q=f.post("b",{type:"widget",reply_to:x,work_on:x,widget:{prompt:"Choose X",dismissOnMoveOn:true,options:[{label:"One",value:"one"}]}});
 await f.send("Another topic", "room", {replyToId:y});await f.drain();
 f.tm.widgetResponses.collectUnansweredQuestionPrompts(f.session);
 assert.notEqual(f.entries("room").find(e=>e.id===q).widgetSkipped,true);
 assert.throws(()=>f.submit(x),/unanswered user question/);
 assert.equal((await f.tm.widgetResponses.respondToWidget(q,"one","room")).accepted,true);await f.drain();
 f.submit(x);f.review(x);assert.equal(f.tasks().get(x).state,"reviewed");
});
