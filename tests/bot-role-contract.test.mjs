import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { continuityHarness, deferred, until } from "./helpers/continuity-harness.mjs";

const job = {primaryJob:"聊天界面交互工程",responsibilities:["输入框、引用回复与前端回归"],outOfScope:["后端调度修改","生产部署"],deliverables:["前端改动及自检证据"],workingStyle:"跨职责先请教，关键决策留在原群。"};
async function setup(t,options) {
  const h=await continuityHarness(t,options);
  const root=path.join(h.runtime.directory,"agents");
  Object.assign(h.tm.sessionStore,{getRootDir:()=>root,agentExists:id=>h.sessions.has(id),getAgentProfileText:id=>({name:id,description:"legacy persona"})});
  h.tm.roster.emitProfileChanged=()=>{};
  h.tm.botRoles=new h.runtime.BotRoles(h.tm);
  const store=new h.runtime.BotRoleStore(root,()=>100);
  const save=(id="b",role=job,expectedRevision=0,requestId="set-role")=>store.update({agentId:id,role,expectedRevision,requestId});
  const room=h.sessions.get("room");
  room.db.appendTranscriptEntry({id:"goal",kind:"message",role:"user",content:"Improve chat",timestampMs:1});
  const publish=(actor,collaboration,content="Work update")=>{
    const msg={type:"text",purpose:"update",content,collaboration};
    return h.tm.groupChat.postGroupMemberMessage(room,{id:actor,name:actor},content,undefined,h.runtime.prepareGroupPublication(room.dbPath,msg,false));
  };
  const offer=()=>publish("a",{action:"assign",request_id:"offer",goal_message_id:"goal",assignee:"b",reviewer:"a",title:"Composer",criteria:["No IME accidental send"]});
  return {...h,store,save,publish,offer,root};
}

test("legacy profiles stay unconfigured without writes or invented permissions",async t=>{
  const h=await setup(t); const profile=path.join(h.root,"b","profile.json"),before=readFileSync(profile,"utf8");
  assert.equal(h.tm.botRoles.snapshot({agentId:"b"}).configured,false);
  assert.equal(existsSync(h.store.path),false); assert.equal(readFileSync(profile,"utf8"),before);
  assert.match(h.runtime.renderBotRole(null),/not been confirmed/);
});
test("confirmed job survives restart independently of profile, name and model edits",async t=>{
  const h=await setup(t),saved=h.save().record;
  h.runtime.writeSandProfileFile(path.join(h.root,"b","profile.json"),{name:"New name",description:"Do everything",title:"",avatarShape:"hex",avatarColor:"blue",inferenceVendorId:"other"});
  const reopened=new h.runtime.BotRoleStore(h.root);
  assert.deepEqual(reopened.read("b"),saved);assert.equal(reopened.read("a"),null);
  assert.equal(h.tm.botRoles.snapshot({agentId:"b"}).role.role.primaryJob,job.primaryJob);
});
test("role edits use compare-and-swap and preserve prior revisions",async t=>{
  const h=await setup(t);h.save();h.save("b",{...job,workingStyle:"Ask specific questions"},1,"v2");
  assert.throws(()=>h.save("b",job,1,"stale"),/bot_role_stale/);
  assert.equal(h.store.read("b").revision,2);
  const db=new DatabaseSync(h.store.path,{readOnly:true});t.after(()=>db.close());
  assert.equal(db.prepare("SELECT count(*) AS n FROM bot_role_revisions WHERE bot_id='b'").get().n,2);
});
test("lost role acknowledgement retries once and cannot reuse the request for changed input",async t=>{
  const h=await setup(t),first=h.save();assert.equal(h.save().replayed,true);
  assert.throws(()=>h.save("b",{...job,primaryJob:"Anything"}),/bot_role_request_conflict/);
  h.save("b",{...job,primaryJob:"UI review"},1,"v2");
  assert.deepEqual(h.save().record,first.record);assert.equal(h.store.read("b").revision,2,"replay does not restore obsolete revision");
});
test("malformed/overbroad fields and forged metadata never persist",async t=>{
  const h=await setup(t);
  for(const bad of [{...job,primaryJob:" "},{...job,primaryJob:"x".repeat(241)},{...job,responsibilities:[""]},{...job,permissions:["*"]},{...job,revision:99}]){
    assert.throws(()=>h.save("b",bad));
  }
  assert.equal(h.store.read("b"),null);
  assert.throws(()=>h.store.update({agentId:"../foreign",role:job,requestId:"x",expectedRevision:0}));
});
test("corrupt persisted role does not silently become an unrestricted legacy Bot",async t=>{
  const h=await setup(t);h.save();const db=new DatabaseSync(h.store.path);
  db.prepare("UPDATE bot_role_revisions SET payload=? WHERE bot_id='b'").run(JSON.stringify({format:1,botId:"a",revision:1}));db.close();
  assert.throws(()=>h.store.read("b"));
});
test("role management rejects group, remote-room and removed targets",async t=>{
  const h=await setup(t);
  assert.throws(()=>h.tm.botRoles.snapshot({agentId:"room"}),/bot_role_unsupported/);
  assert.throws(()=>h.tm.botRoles.snapshot({agentId:"missing"}),/bot_role_unavailable/);
  h.tm.groupChat.isRemoteRoomAgentId=id=>id==="b";
  await assert.rejects(h.tm.botRoles.update({agentId:"b",role:job,requestId:"x",expectedRevision:0}),/bot_role_unsupported/);
  assert.equal(h.store.read("b"),null);
});
test("a durable role update remains saved when roster notification fails",async t=>{
  const h=await setup(t);h.tm.roster.emitAgentUpdate=async()=>{throw new Error("lost connection")};
  const args={agentId:"b",role:job,requestId:"x",expectedRevision:0};
  const saved=await h.tm.botRoles.update(args);assert.equal(saved.saved,true);assert.equal(saved.notified,false);
  const retry=await h.tm.botRoles.update(args);assert.equal(retry.replayed,true);assert.equal(h.store.read("b").revision,1);
});
test("Agent profile tools reject role injection instead of claiming it was applied",async t=>{
  const h=await setup(t);h.save();
  assert.throws(()=>h.runtime.createAgentParameters.parse({name:"X",description:"Y",role:job}));
  assert.throws(()=>h.runtime.updateAgentParameters.parse({agent_id:"b",description:"Anything",role:job}));
  assert.equal(h.store.read("b").role.primaryJob,job.primaryJob);
});
test("new user Bot validates role before mint and installs it before exposure",async t=>{
  const h=await setup(t),order=[];
  h.tm.sessionStore.createSession=async()=>{order.push("mint");return h.sessions.get("b")};
  h.tm.botRoles.initialize=(id,role)=>{order.push("role");return h.save(id,role)};
  const lifecycle=new h.runtime.AgentLifecycle(h.tm);
  await assert.rejects(lifecycle.mintAgentSession({name:"B"},"user",{initialUserRole:{primaryJob:""}}));assert.deepEqual(order,[]);
  const result=await lifecycle.mintAgentSession({name:"B"},"user",{initialUserRole:job,isIntroductionSuppressed:true});
  assert.equal(result.id,"b");assert.deepEqual(order,["mint","role"]);assert.equal(h.store.read("b").revision,1);
});
test("role persistence failure does not expose or kickstart a half-created Bot",async t=>{
  const h=await setup(t),order=[],session={id:"fresh",db:{close:()=>order.push("close")},agentStore:{dispose:async()=>order.push("dispose")}};
  h.tm.sessionStore.createSession=async()=>session;h.tm.sessionStore.deleteSession=async id=>order.push(`delete:${id}`);
  h.tm.botRoles.initialize=()=>{throw new Error("disk failed")};
  await assert.rejects(new h.runtime.AgentLifecycle(h.tm).mintAgentSession({name:"Fresh"},"user",{initialUserRole:job}),/disk failed/);
  assert.deepEqual(order,["dispose","close","delete:fresh"]);
});
test("single-Bot identity updates carry role revision without replacing persona",async t=>{
  const h=await setup(t),role=h.save("a").record;
  const identity={name:"A",description:"Friendly",role};
  const encoded=h.runtime.renderAgentProfileUpdate(identity);
  assert.deepEqual(h.runtime.parseLatestAgentProfileUpdate(encoded),identity);
  assert.match(encoded,/One Bot has one primary job/);assert.match(encoded,/后端调度修改/);
  assert.equal(h.runtime.agentProfileIdentitiesEqual(identity,{...identity,role:{...role,revision:2}}),false);
});
test("group context includes own exclusions and real peers' distinct primary jobs",async t=>{
  const h=await setup(t);h.save();h.save("a",{...job,primaryJob:"交付协调"});
  const members=await h.tm.groupChat.resolveGroupMembers(["a","b"]);
  const b=members.find(m=>m.id==="b"),a=members.find(m=>m.id==="a");
  const prompt=h.runtime.buildGroupMemberSystemPrompt(b,{name:"Team",description:"Work together"},[a]);
  assert.match(prompt,/交付协调/);assert.match(prompt,/后端调度修改/);assert.match(prompt,/not a role expansion/);
});
test("configured claim requires current-role assessment and records its source",async t=>{
  const h=await setup(t);h.save();const task=h.offer();
  const claim={action:"claim",request_id:"claim",task_id:task,expected_version:1};
  assert.throws(()=>h.publish("b",claim),/work_role_check_required/);
  assert.throws(()=>h.publish("b",{...claim,role_check:{revision:2,fit:"primary",reason:"UI"}}),/work_role_stale/);
  h.publish("b",{...claim,role_check:{revision:1,fit:"primary",reason:"This is the configured composer/IME work"}});
  const row=h.runtime.projectCollaboration(h.entries("room")).get(task);
  assert.equal(row.roleAcceptance.revision,1);assert.equal(row.roleAcceptance.primaryJob,job.primaryJob);assert.equal(row.state,"claimed");
});
test("claim retry after role edit replays original receipt, not a new assessment",async t=>{
  const h=await setup(t);h.save();const task=h.offer(),claim={action:"claim",request_id:"claim",task_id:task,expected_version:1,role_check:{revision:1,fit:"primary",reason:"Composer"}};
  const id=h.publish("b",claim);h.save("b",{...job,primaryJob:"文档整理"},1,"v2");
  assert.equal(h.publish("b",claim),id);assert.equal(h.runtime.projectCollaboration(h.entries("room")).get(task).roleAcceptance.revision,1);
});
test("out-of-role colleague can decline with quoted reason without claiming",async t=>{
  const h=await setup(t);h.save();const task=h.offer();
  h.publish("b",{action:"decline",request_id:"decline",task_id:task,expected_version:1,reason:"This requires backend work outside my primary job"});
  assert.equal(h.runtime.projectCollaboration(h.entries("room")).get(task).state,"declined");
  assert.equal(h.entries("room").at(-1).replyTo,task);
});
test("legacy Bot can continue existing work but cannot invent a confirmed role version",async t=>{
  const h=await setup(t),task=h.offer(),claim={action:"claim",request_id:"claim",task_id:task,expected_version:1};
  assert.throws(()=>h.publish("b",{...claim,role_check:{revision:1,fit:"primary",reason:"Fake"}}),/work_role_unconfirmed/);
  h.publish("b",claim);assert.equal(h.runtime.projectCollaboration(h.entries("room")).get(task).state,"claimed");
});
test("single-Bot formal claim uses same role guard without needing a group",async t=>{
  const h=await setup(t);h.save("a");const s=h.sessions.get("a");
  s.db.appendTranscriptEntry({id:"u",kind:"message",role:"user",content:"Review UI"});h.tm.ackObligations.fulfillAckObligation=()=>{};
  const runtime=new h.runtime.TurnRuntime(h.tm);h.tm.turnRuntime=runtime;
  const publish=c=>runtime.handleAgentUpdate({type:"send-message",message:{type:"text",content:"Update",collaboration:c},timestampMs:2},s);
  const id=publish({action:"assign",request_id:"offer",goal_message_id:"u",title:"UI",assignee:"a",criteria:["Check UI"]});
  assert.throws(()=>publish({action:"claim",request_id:"claim",task_id:id,expected_version:1}),/work_role_check_required/);
  publish({action:"claim",request_id:"claim",task_id:id,expected_version:1,role_check:{revision:1,fit:"primary",reason:"UI self-check"}});
  assert.equal(h.runtime.projectCollaboration(h.entries("a")).get(id).roleAcceptance.revision,1);
});

test("teammate discovery exposes primary jobs without treating profile files as authority",async t=>{
  const h=await setup(t);const role=h.save().record;
  const text=h.runtime.renderAgentDirectorySystemPrompt([{id:"b",name:"B",description:"Friendly",role},{id:"a",name:"A",description:"Anything"}],[],h.root);
  assert.match(text,/User-confirmed primary job v1/);assert.match(text,/后端调度修改/);
  assert.match(text,/Primary job not confirmed/);assert.match(text,/Do not edit internal role storage/);
});
test("explicit Bot deletion can remove its role revisions without touching a colleague",async t=>{
  const h=await setup(t);h.save();h.save("a");h.store.forget("b");
  assert.equal(h.store.read("b"),null);assert.equal(h.store.read("a").revision,1);
  h.store.forget("b");assert.throws(()=>h.store.forget("../a"));
});
