import assert from "node:assert/strict";
import test from "node:test";
import { continuityHarness, deferred, until } from "./helpers/continuity-harness.mjs";

const action = (collaboration, content = "Work update", reply_to) => ({type:"text", content, purpose:"update", collaboration, ...(reply_to ? {reply_to} : {})});
function setup(h, room = "room") {
  const goal = {id:"user-goal", kind:"message", role:"user", content:"Ship the chat improvement", timestampMs:1};
  h.sessions.get(room).db.appendTranscriptEntry(goal);
  const publish = (actor, message) => {
    const prepared = h.runtime.prepareGroupPublication(h.sessions.get(room).dbPath, message, false);
    return h.tm.groupChat.postGroupMemberMessage(h.sessions.get(room), {id:actor,name:actor.toUpperCase()}, message.content, undefined, prepared);
  };
  const tasks = () => [...h.runtime.projectCollaboration(h.entries(room)).values()];
  const assign = (extra = {}) => publish("a", action({action:"assign", request_id:"assign-one", goal_message_id:goal.id, title:"Composer", assignee:"b", reviewer:"a", criteria:["IME Enter does not send"], ...extra}));
  return {publish,tasks,assign,goal};
}

test("assignment, claim and progress are durable quoted messages, not inferred from prose", async t => {
  const h = await continuityHarness(t), w = setup(h), id = w.assign();
  assert.equal(w.tasks()[0].id,id); assert.equal(h.entries("room").at(-1).replyTo,w.goal.id);
  w.publish("b", action({action:"claim",request_id:"claim",task_id:id,expected_version:1},"I have this",id));
  w.publish("b", action({action:"progress",request_id:"progress",task_id:id,expected_version:2,evidence_ids:[]},"Still checking",id));
  assert.equal(w.tasks()[0].state,"claimed");assert.equal(w.tasks()[0].version,3);
  assert.equal(h.runtime.projectCollaboration(structuredClone(h.entries("room"))).get(id).state,"claimed");
  assert.match(h.runtime.collaborationContext(h.entries("room"),"b"),/IME Enter/);
  assert.deepEqual(h.tm.groupChat.readGroupHistory(h.sessions.get("room")).find(m=>m.id===id).recipientIds,["b"]);
});

test("same action retries return the same message identity without a second task or wake", async t=>{
  const h=await continuityHarness(t),w=setup(h),id=w.assign();
  assert.equal(w.assign(),id);assert.equal(w.tasks().length,1);
  assert.equal(h.entries("room").filter(e=>e.collaborationEvent).length,1);
  assert.throws(()=>w.assign({title:"Different scope"}),/work_request_conflict/);
});

test("claim and version checks reject races, wrong Bot and self approval",async t=>{
  const h=await continuityHarness(t),w=setup(h),id=w.assign();
  assert.throws(()=>w.publish("a",action({action:"claim",request_id:"wrong",task_id:id,expected_version:1})),/work_not_owner/);
  w.publish("b",action({action:"claim",request_id:"one",task_id:id,expected_version:1}));
  assert.throws(()=>w.publish("b",action({action:"claim",request_id:"two",task_id:id,expected_version:1})),/work_version_conflict/);
  assert.throws(()=>w.publish("b",action({action:"claim",request_id:"three",task_id:id,expected_version:2})),/work_not_claimable/);
  assert.throws(()=>w.assign({request_id:"self-review",reviewer:"b"}),/work_reviewer_invalid/);
});

test("missing or peer-supplied goals, foreign dependencies and removed members fail closed",async t=>{
  const h=await continuityHarness(t),w=setup(h),id=w.assign();
  assert.throws(()=>w.assign({request_id:"peer",goal_message_id:id}),/work_goal_invalid/);
  assert.throws(()=>w.assign({request_id:"gone",assignee:"removed"}),/work_assignee_unavailable/);
  assert.throws(()=>w.assign({request_id:"dep",dependencies:["foreign-room"]}),/work_dependency_missing/);
  const pending=w.assign({request_id:"later",dependencies:[id]});
  assert.throws(()=>w.publish("b",action({action:"claim",request_id:"early",task_id:pending,expected_version:1})),/work_dependencies_pending/);
});

test("failed persistence changes neither task nor visible commitment",async t=>{
  const h=await continuityHarness(t),w=setup(h),id=w.assign();
  h.sessions.get("room").db.durable=false;
  assert.throws(()=>w.publish("b",action({action:"claim",request_id:"claim",task_id:id,expected_version:1})),/not saved/);
  h.sessions.get("room").db.durable=true;
  assert.equal(w.tasks()[0].state,"offered");assert.equal(w.tasks()[0].version,1);
  w.publish("b",action({action:"claim",request_id:"claim",task_id:id,expected_version:1}));
  assert.equal(w.tasks()[0].state,"claimed");
});

test("claim route is real: B receives A's work while A continues, progress does not call the whole room",{timeout:10000},async t=>{
  let h,taskId;const gate=deferred();t.after(gate.resolve);
  h=await continuityHarness(t,{members:["a","b","c"],runMember:async(call,turn)=>{
    if(call.id==="a"&&turn===1){
      const goal=h.entries("room").find(e=>e.role==="user").id;
      taskId=call.publish(action({action:"assign",request_id:"assign",goal_message_id:goal,title:"Check input",assignee:"b",reviewer:"a",criteria:["Keep draft"]},"@{b} Check input"));
      await gate.promise;
    }else if(call.id==="b"){
      assert.match(call.prompt,/Recorded work commitments/);assert.match(call.systemPrompt,/collaboration/);
      call.publish(action({action:"claim",request_id:"claim",task_id:taskId,expected_version:1},"I will check",taskId));
      call.publish({type:"text",purpose:"update",content:"Working on the input",reply_to:taskId});
    }
    return [];
  }});
  await h.send("@{a} Coordinate input");await until(()=>h.calls.some(c=>c.id==="b"));gate.resolve();await h.drain();
  assert.deepEqual(h.calls.map(c=>c.id),["a","b"]);
  assert.equal(h.runtime.projectCollaboration(h.entries("room")).get(taskId).state,"claimed");
});

test("tool schema retains work sidecar and rejects external channel commands",async t=>{
  const h=await continuityHarness(t);
  const message=action({action:"assign",request_id:"one",goal_message_id:"g",title:"Test",assignee:"a",criteria:["Read file"]});
  const output=await h.runtime.buildSandSendMessage({},message,{getIngestAttachment:()=>undefined,onSendMessage:()=>undefined});
  assert.equal(output.collaboration.reviewer,"user");assert.equal(output.purpose,"update");
  await assert.rejects(h.runtime.buildSandSendMessage({},{...message,channel:"slack:somewhere"},{getIngestAttachment:()=>undefined,onSendMessage:()=>undefined}));
  assert.throws(()=>h.runtime.prepareCollaboration({messageId:"s",actor:"a",members:["a"],entries:[],message,sharedRoom:true}),/work_scope_unsupported/);
});

test("single Bot uses the actual update handler and cannot approve itself",async t=>{
  const h=await continuityHarness(t),s=h.sessions.get("a");
  s.db.appendTranscriptEntry({id:"user-1",kind:"message",role:"user",content:"Check the file"});
  h.tm.ackObligations.fulfillAckObligation=()=>{};
  const turn=new h.runtime.TurnRuntime(h.tm);h.tm.turnRuntime=turn;
  const msg=action({action:"assign",request_id:"private",goal_message_id:"user-1",title:"File",assignee:"a",criteria:["Readable"]});
  const id=turn.handleAgentUpdate({type:"send-message",message:msg,timestampMs:2},s);
  assert.equal(h.runtime.projectCollaboration(h.entries("a")).get(id).reviewer,"user");
  assert.equal(h.entries("room").length,0);
  turn.handleAgentUpdate({type:"send-message",message:action({action:"claim",request_id:"private-claim",task_id:id,expected_version:1}),timestampMs:3},s);
  assert.equal(h.runtime.projectCollaboration(h.entries("a")).get(id).state,"claimed");
});
