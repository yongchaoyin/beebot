import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { continuityHarness, deferred, until } from "./helpers/continuity-harness.mjs";

function offer(h, room = "room", title = "日报整理", assignee = "b") {
  const session=h.sessions.get(room),seq=h.entries(room).length;
  const goal=`goal-${seq}`;
  session.db.appendTranscriptEntry({id:goal,kind:"message",role:"user",content:"Prepare a report, do not send it externally"});
  const message={type:"text",content:`I will prepare ${title}`,purpose:"update",collaboration:{action:"assign",
    request_id:`assign-${seq}`,goal_message_id:goal,title,assignee,reviewer:"user",criteria:["Review content"]}};
  if(room==="a") {
    h.tm.ackObligations.fulfillAckObligation=()=>{};
    const prior=h.tm.turnRuntime,turn=new h.runtime.TurnRuntime(h.tm);h.tm.turnRuntime=turn;
    try { return turn.handleAgentUpdate({type:"send-message",message,timestampMs:Date.now()},session); }
    finally { h.tm.turnRuntime=prior; }
  }
  return h.tm.groupChat.postGroupMemberMessage(session,{id:"a",name:"A"},message.content,undefined,
    h.runtime.prepareGroupPublication(session.dbPath,message,false));
}
const notices=(h,room)=>h.entries(room).filter(e=>e.kind==="notice"&&e.code==="recorded_work_status");

test("Group status query is answered while the original colleague remains busy, without a model or interruption",async t=>{
  const gate=deferred();t.after(()=>gate.resolve());
  const h=await continuityHarness(t,{members:["a","b"],runMember:async()=>{await gate.promise;return ["Finished handling the original request"];}});
  const work=offer(h);
  await h.send("@{b} Please discuss the report before changes");await until(()=>h.calls.length===1);
  const previous=h.records("room")[0];const beforeTasks=JSON.stringify([...h.runtime.projectCollaboration(h.entries("room"))]);
  await h.send("进度怎么样？","room",{replyToId:work,awaitTurn:true});
  assert.equal(notices(h,"room").length,1);assert.equal(h.calls.length,1);assert.deepEqual(h.interrupts,[]);
  const notice=notices(h,"room")[0];assert.equal(notice.workOnId,work);assert.equal(notice.author,undefined);
  assert.match(notice.text,/工作记录快照/);assert.match(notice.text,/not claimed/);assert.match(notice.text,/no execution, file recheck, approval or scope change/);
  const status=h.records("room").find(r=>r.id===notice.replyTo);
  assert.equal(status.state,"replied");assert.deepEqual(status.recipients,{});assert.equal(status.systemResponse.id,notice.id);
  assert.equal(h.records("room").find(r=>r.id===previous.id).state,"processing");
  assert.equal(JSON.stringify([...h.runtime.projectCollaboration(h.entries("room"))]),beforeTasks);
  gate.resolve();await h.drain();assert.equal(h.calls.length,1);
});

test("single Bot status bypasses the busy run but preserves its outstanding acknowledgement and decision",async t=>{
  const gate=deferred();t.after(()=>gate.resolve());
  const h=await continuityHarness(t,{runDirect:async()=>{await gate.promise;}});
  const work=offer(h,"a","日报整理","a");
  let ackRecorded=0,ackFulfilled=0,errorCleared=0,decision="pending-decision";
  h.tm.trayErrors.clearForAgent=()=>errorCleared++;
  h.tm.ackObligations.recordAckObligationSend=()=>ackRecorded++;
  h.tm.ackObligations.fulfillAckObligation=()=>ackFulfilled++;
  await h.send("Work on the existing request","a");await until(()=>h.directCalls.length===1);
  h.sessions.get("a").db.getAwaitingUserResponse=()=>decision;
  h.sessions.get("a").db.setAwaitingUserResponse=value=>{decision=value;};
  await h.send("what is the current status?","a",{replyToId:work,awaitTurn:true});
  assert.equal(h.directCalls.length,1);assert.equal(notices(h,"a").length,1);
  assert.equal(decision,"pending-decision");assert.equal(ackRecorded,1);assert.equal(ackFulfilled,0);assert.equal(errorCleared,1);
  assert.equal(notices(h,"room").length,0);assert.deepEqual(h.interrupts,[]);
  gate.resolve();await h.drain();
});

test("duplicate status sends reuse a response and restart does not replay it",async t=>{
  const h=await continuityHarness(t);offer(h);
  const opts={clientNonce:"status-once",awaitTurn:true};
  await h.send("《日报整理》完成了吗？","room",opts);
  await h.send("《日报整理》完成了吗？","room",opts);
  assert.equal(notices(h,"room").length,1);assert.equal(h.calls.length,0);
  const reopened=new h.runtime.ConversationDeliveries();
  assert.deepEqual(reopened.recover(h.sessions.get("room").dbPath),[]);
  assert.equal(reopened.list(h.sessions.get("room").dbPath)[0].systemResponse.kind,"recorded-work-status");
  await assert.rejects(h.send("《日报整理》进度如何？","room",opts),{code:"NONCE_DIGEST_MISMATCH"});
});

test("ambiguous tasks, mixed work requests and explicit @ retain ordinary Bot handling",async t=>{
  const h=await continuityHarness(t,{members:["a","b","c"],runMember:async()=>["Clarification"]});
  const work=offer(h);
  await h.send("《日报整理》进度如何？然后帮我提交");await h.drain();
  assert.equal(h.calls.length,1);assert.equal(notices(h,"room").length,0);
  await h.send("@{c} what is the status?","room",{replyToId:work});await h.drain();
  assert.equal(h.calls.at(-1).id,"c");assert.equal(notices(h,"room").length,0);
  offer(h,"room","日报整理","c");
  await h.send("《日报整理》进度如何？");await h.drain();
  assert.equal(notices(h,"room").length,0);assert.match(h.calls.at(-1).prompt,/ambiguous-work/);
});

test("a status question with an attachment or a fork does not discard the user's extra input",async t=>{
  const h=await continuityHarness(t,{runMember:async()=>["Check input"]});const id=offer(h);
  const file=join(h.runtime.directory,"material.txt");writeFileSync(file,"Additional material");
  await h.send("进度怎么样？","room",{replyToId:id,attachmentPaths:[file]});await h.drain();
  assert.equal(notices(h,"room").length,0);assert.equal(h.calls.length,1);
  await h.send("进度如何？","room",{replyToId:id,isFork:true});await h.drain();
  assert.equal(notices(h,"room").length,0);assert.equal(h.calls.length,2);
});

test("only the addressed conversation can contribute status or receive the notice",async t=>{
  const h=await continuityHarness(t,{extraGroups:["other"],runMember:async()=>["Please identify the work"]});
  offer(h);await h.send("《日报整理》进度如何？","other");await h.drain();
  assert.equal(notices(h,"other").length,0);assert.equal(notices(h,"room").length,0);
  h.tm.sessions.activeSession=h.sessions.get("other");h.tm.sessions.inMemoryTranscriptAgentId="other";
  h.runtime.setTranscript(h.entries("other"));const other=JSON.stringify(h.runtime.getTranscript());
  await h.send("《日报整理》进度如何？","room",{awaitTurn:true});
  assert.equal(notices(h,"room").length,1);assert.equal(JSON.stringify(h.runtime.getTranscript()),other);
  assert.ok(h.events.some(e=>e.type==="appended"&&e.entry?.code==="recorded_work_status"&&e.conversationId==="room"));
});

test("shared or remote-member rooms retain their existing protocol",async t=>{
  const h=await continuityHarness(t);offer(h);
  h.sessions.get("room").db.appendTranscriptEntry({id:"query",kind:"message",role:"user",content:"《日报整理》进度如何？"});
  assert.ok(h.runtime.localRecordedWorkStatus(h.tm,h.sessions.get("room"),"query"));
  h.runtime.writeSandGroupConfig(h.runtime.directory+"/agents/room",{version:1,memberIds:["a","b"],sharedRoomId:"shared"});
  assert.equal(h.runtime.localRecordedWorkStatus(h.tm,h.sessions.get("room"),"query"),undefined);
});

test("status persistence failure never becomes a normal work execution",async t=>{
  const h=await continuityHarness(t,{runMember:async()=>["Must not run"]});offer(h);
  const db=h.sessions.get("room").db,append=db.appendTranscriptEntry;
  db.appendTranscriptEntry=entry=>entry.code==="recorded_work_status"?false:append(entry);
  await assert.rejects(h.send("《日报整理》进度如何？"),/Could not save/);
  assert.equal(h.calls.length,0);assert.equal(notices(h,"room").length,0);
  assert.ok(h.entries("room").some(e=>e.role==="user"&&e.content==="《日报整理》进度如何？"));
  assert.ok(h.records("room").every(r=>r.state!=="replied"));
});

test("system responses never clear another Bot's delivery and cannot be rerouted for execution",async t=>{
  const h=await continuityHarness(t),db=h.sessions.get("room").dbPath,ledger=h.tm.sendPipeline.deliveries;
  ledger.route(db,"owned",["b"]);
  assert.throws(()=>ledger.recordSystemResponse(db,"owned","response"),/different response or recipient/);
  assert.equal(ledger.list(db)[0].state,"queued");
  ledger.queue(db,"status");ledger.recordSystemResponse(db,"status","response-status");
  assert.throws(()=>ledger.recordSystemResponse(db,"status","other-response"),/different response/);
  assert.throws(()=>ledger.route(db,"status",["b"]),/cannot be routed/);
  assert.equal(ledger.route(db,"status",[]).state,"replied");
  assert.equal(new h.runtime.ConversationDeliveries().list(db).find(r=>r.id==="status").state,"replied");
});

test("malformed system-response journal fails closed without dropping old obligations",async t=>{
  const h=await continuityHarness(t),db=h.sessions.get("room").dbPath;
  h.tm.sendPipeline.deliveries.queue(db,"q");
  const filename=join(h.runtime.directory,"agents/room/conversation-deliveries.v1.json");
  const data=JSON.parse(readFileSync(filename));data.records[0].systemResponse={id:"x",kind:"recorded-work-status"};
  writeFileSync(filename,JSON.stringify(data));
  assert.throws(()=>new h.runtime.ConversationDeliveries().list(db),/Invalid system status/);
});

test("querying an unclaimed work or old accepted record does not manufacture fresh verification",async t=>{
  const h=await continuityHarness(t);offer(h);
  await h.send("《日报整理》完成了吗？","room",{awaitTurn:true});
  const text=notices(h,"room")[0].text;
  assert.match(text,/not claimed/);assert.match(text,/no execution, file recheck, approval or scope change/);
  assert.equal([...h.runtime.projectCollaboration(h.entries("room"))][0][1].state,"offered");
});


test("a quoted goal with multiple tasks requires a normal clarification instead of guessing progress",async t=>{
 const h=await continuityHarness(t,{runMember:async()=>["Which part of the goal?"]});
 const first=offer(h),initial=h.runtime.projectCollaboration(h.entries("room")).get(first),s=h.sessions.get("room");
 const message={type:"text",content:"Another part",purpose:"update",collaboration:{action:"assign",request_id:"second",goal_message_id:initial.goalId,title:"另一个部分",assignee:"a",reviewer:"user",criteria:["Check"]}};
 h.tm.groupChat.postGroupMemberMessage(s,{id:"a",name:"A"},message.content,undefined,h.runtime.prepareGroupPublication(s.dbPath,message,false));
 await h.send("进度如何？","room",{replyToId:initial.goalId});await h.drain();
 assert.equal(notices(h,"room").length,0);assert.equal(h.calls.length,1);
});

test("an old acceptance without evidence is reported as needing recheck, never refreshed by a status read",async t=>{
 const h=await continuityHarness(t);const id=offer(h),s=h.sessions.get("room");
 const source=h.entries("room").find(e=>e.id===id),event=structuredClone(source.collaborationEvent);
 event.requestId="historical";event.task={...event.task,version:2,state:"accepted",updatedMessageId:"old-acceptance"};
 s.db.appendTranscriptEntry({id:"old-acceptance",kind:"send-message",author:{id:"a",name:"A"},message:{type:"text",content:"Historical acceptance"},collaborationEvent:event});
 const before=JSON.stringify([...h.runtime.projectCollaboration(h.entries("room"))]);
 await h.send("《日报整理》完成了吗？","room",{awaitTurn:true});
 assert.match(notices(h,"room")[0].text,/Recorded acceptance needs rechecking/);
 assert.equal(JSON.stringify([...h.runtime.projectCollaboration(h.entries("room"))]),before);
 assert.equal(h.calls.length,0);
});


test("a supplement after a system status answer keeps its work owner while an explicit new topic stays separate",async t=>{
 const gate=deferred();t.after(()=>gate.resolve());
 const h=await continuityHarness(t,{members:["a","b"],runMember:async call=>{if(call.id==="b")await gate.promise;return ["Response"];}});
 offer(h);
 await h.send("《日报整理》进度如何？","room",{awaitTurn:true});assert.equal(h.calls.length,0);
 await h.send("那请解释现在的要求，不要修改");await until(()=>h.calls.length===1);
 assert.equal(h.calls[0].id,"b");assert.match(h.calls[0].prompt,/status-follow-up/);
 await h.send("另一个问题：帮我讨论一个名字");await until(()=>h.calls.length===2);
 assert.equal(h.calls[1].id,"a");assert.deepEqual(h.interrupts,[]);
 gate.resolve();await h.drain();
});
