import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { api, taskFixture } from "./helpers/node-task-security-fixture.mjs";
import WebSocket from "ws";
import { testDevice } from "./helpers/node-device.mjs";

const source = () => ({ nodeId: randomUUID(), deviceJkt: testDevice().jkt, sessionId: randomUUID() });
const waitFor = async predicate => { for (let i=0;i<300;i++) { if (await predicate()) return; await delay(5); } assert.fail("Timed out waiting for task safety state."); };
async function ledger(t) {
  const data = await mkdtemp(path.join(os.tmpdir(), "bb-task-ledger-")); let store = new api.ControlStore(data);
  t.after(async () => { store.close(); await rm(data, { recursive: true, force: true }); });
  return { data, get store() { return store; }, restart() { store.close(); store = new api.ControlStore(data); store.recoverInterrupted(); } };
}
function deferredRuntime() {
  const jobs=[];
  return { jobs, execute(input, signal) { return new Promise((resolve,reject)=>{ jobs.push({input,signal,resolve,reject}); }); }, async reconcile() {}, async close() { for (const job of jobs) job.reject(new Error("fixture shutdown")); } };
}
const makeBot = (s,owner="owner") => s.createBot(owner,randomUUID(),{name:"Persistent colleague",description:""}).bot;
const submit = (s,b,src,prompt="Do this work") => s.submitGoal(b.ownerId,randomUUID(),{botId:b.id,prompt},src).goalId;
const freeze = (s,b,scope,target,key=randomUUID()) => s.freezeTasks(b.ownerId,randomUUID(),key,scope,target).freeze;

// These are real SQLite/controller tests; runtime promises below are explicit fixtures.
test("task provenance commits with acceptance, persists and cannot be rebound by another device's retry",async t=>{
  const f=await ledger(t),b=makeBot(f.store),first=source(),second=source(),key=randomUUID(),body={botId:b.id,prompt:"private prompt"};
  const accepted=f.store.submitGoal(b.ownerId,key,body,first);
  assert.deepEqual(f.store.submitGoal(b.ownerId,key,body,second),accepted);
  assert.deepEqual(f.store.taskSecurity.authorization(accepted.goalId).source,first);
  f.restart();assert.deepEqual(f.store.taskSecurity.authorization(accepted.goalId).source,first);
  assert.ok(!JSON.stringify(f.store.goal(accepted.goalId)).includes(first.deviceJkt),"ordinary transcript does not expose device metadata");
});
test("failure to persist task provenance rolls back the goal, receipt and events before dispatch",async t=>{
  const f=await ledger(t),b=makeBot(f.store),cursor=f.store.cursor,original=f.store.taskSecurity.record;
  f.store.taskSecurity.record=()=>{throw new Error("provenance disk failure");};
  assert.throws(()=>submit(f.store,b,source()),/disk failure/);assert.equal(f.store.goals().length,0);assert.equal(f.store.cursor,cursor);
  f.store.taskSecurity.record=original;assert.ok(submit(f.store,b,source()));
});
test("device freeze targets immutable provenance, not other keys, owners or unattributed legacy tasks",async t=>{
  const f=await ledger(t),s=f.store,b=makeBot(s),other=makeBot(s,"another-owner"),a=source(),z=source();
  const one=submit(s,b,a),two=submit(s,b,z),old=submit(s,b),foreign=submit(s,other,a),key=randomUUID();
  const frozen=freeze(s,b,"device",a.deviceJkt,key);const cursor=s.cursor;
  assert.equal(s.goal(one).status,"cancelled");assert.equal(s.goal(two).status,"queued");assert.equal(s.goal(old).status,"queued");assert.equal(s.goal(foreign).status,"queued");
  assert.equal(freeze(s,b,"device",a.deviceJkt,key).id,frozen.id);assert.equal(s.cursor,cursor);
  assert.throws(()=>submit(s,b,a),{status:423});assert.equal(s.taskSafetySnapshot(b.ownerId).unattributedActiveTasks,1);
});
test("Bot freeze covers unattributed work, survives restart and release admits only new work",async t=>{
  const f=await ledger(t),b=makeBot(f.store),one=submit(f.store,b),two=submit(f.store,b,source());
  // Simulate a genuine pre-migration task with no provenance row.
  const db=new DatabaseSync(path.join(f.data,"control.sqlite"));db.prepare("DELETE FROM task_authorizations WHERE goal_id=?").run(one);db.close();
  const frozen=freeze(f.store,b,"bot",b.id);f.restart();
  assert.equal(f.store.goal(one).status,"cancelled");assert.equal(f.store.start(two),undefined);assert.throws(()=>submit(f.store,b),{status:423});
  const key=randomUUID(),released=f.store.releaseBotFreeze(b.ownerId,randomUUID(),key,frozen.id,1);
  assert.equal(released.freeze.version,2);assert.ok(released.freeze.releasedAt);assert.equal(f.store.taskSecurity.authorization(two).revokedAt!==null,true);
  assert.deepEqual(f.store.releaseBotFreeze(b.ownerId,"other-session",key,frozen.id,1),released);assert.equal(f.store.start(two),undefined);
  assert.ok(f.store.start(submit(f.store,b,source())));assert.equal(f.store.goal(one).status,"cancelled");
});
test("late completion after safety revocation preserves evidence but cannot clear the uncertain fence",async t=>{
  const f=await ledger(t),s=f.store,b=makeBot(s),src=source(),g=submit(s,b,src),{run}=s.start(g),fr=freeze(s,b,"bot",b.id);
  s.finish(g,run.id,"review",{result:"Result returned after freeze",transcript:[{text:"keep evidence"}]});
  assert.equal(s.goal(g).status,"uncertain");assert.equal(s.goal(g).result,"Result returned after freeze");assert.equal(s.transcript(g)[0].text,"keep evidence");
  assert.throws(()=>s.releaseBotFreeze(b.ownerId,randomUUID(),randomUUID(),fr.id,1),{code:"inspection_required"});
  s.reconcile(b.ownerId,randomUUID(),g,s.goal(g).version,"Inspected the stopped runtime and external effects");
  s.releaseBotFreeze(b.ownerId,randomUUID(),randomUUID(),fr.id,1);assert.equal(s.goal(g).status,"failed");assert.equal(s.start(g),undefined);
});
test("synchronous freeze during durable-start notification cannot invoke the runtime",async t=>{
  const f=await ledger(t),s=f.store,b=makeBot(s),g=submit(s,b,source());
  let done=false;const unwatch=s.subscribe(()=>{if(!done&&s.goal(g).status==="running"){done=true;freeze(s,b,"bot",b.id);}});
  const service=new api.ControlService(s,{execute(){assert.fail("frozen work must not reach runtime");},async close(){}});
  await waitFor(()=>s.goal(g).status==="uncertain");await service.close();unwatch();
});
test("active task revocation sends immediate abort but leaves unrelated Bots running",async t=>{
  const f=await ledger(t),s=f.store,a=makeBot(s),b=makeBot(s),src=source(),runtime=deferredRuntime();
  const a1=submit(s,a,src),a2=submit(s,a,src),b1=submit(s,b,source());const service=new api.ControlService(s,runtime,2);
  try {
    await waitFor(()=>runtime.jobs.length===2);freeze(s,a,"device",src.deviceJkt);
    const first=runtime.jobs.find(j=>j.input.bot.id===a.id),second=runtime.jobs.find(j=>j.input.bot.id===b.id);
    assert.equal(first.signal.aborted,true);assert.equal(second.signal.aborted,false);assert.equal(s.goal(a2).status,"cancelled");assert.equal(s.goal(a1).status,"cancelling");
    first.resolve({text:"late",transcript:[]});second.resolve({text:"unrelated result",transcript:[]});
    await waitFor(()=>s.goal(a1).status==="uncertain"&&s.goal(b1).status==="review");
  }finally{await service.close();}
});
test("Bot-release and task-inspection recheck scope and version; device quarantine has no release endpoint",async t=>{
  const f=await ledger(t),s=f.store,b=makeBot(s),src=source(),g=submit(s,b,src),{run}=s.start(g),fr=freeze(s,b,"device",src.deviceJkt);
  s.finish(g,run.id,"failed",{error:"late failure"});assert.equal(s.goal(g).status,"uncertain");
  assert.throws(()=>s.releaseBotFreeze(b.ownerId,randomUUID(),randomUUID(),fr.id,1),{status:404});
  let allow=true,finish;const service=new api.ControlService(s,{execute(){assert.fail();},reconcile(){return new Promise(r=>finish=r);},async close(){}});
  const work=service.reconcile(b.ownerId,randomUUID(),g,s.goal(g).version,"Inspected workspace and external effects",()=>{if(!allow)throw new Error("permission revoked");});
  await waitFor(()=>finish);allow=false;finish();await assert.rejects(work,/permission revoked/);assert.equal(s.goal(g).status,"uncertain");await service.close();
});
test("failed safety persistence cannot partially cancel tasks or leave an active freeze",async t=>{
  const f=await ledger(t),s=f.store,b=makeBot(s),src=source(),g=submit(s,b,src),cursor=s.cursor;
  const original=s.taskSecurity.revoke;s.taskSecurity.revoke=()=>{throw new Error("disk unavailable");};
  assert.throws(()=>freeze(s,b,"device",src.deviceJkt),/disk unavailable/);
  assert.equal(s.taskSecurity.active(b.ownerId,"device",src.deviceJkt),undefined);assert.equal(s.goal(g).status,"queued");assert.equal(s.cursor,cursor);s.taskSecurity.revoke=original;
});

async function httpSetup(t) {
  const runtime=deferredRuntime(),f=await taskFixture(t,{runtime:()=>runtime}),admin=await f.first();
  const b=(await (await admin.request("/v1/bots",{name:"Work"})).json()).bot;
  const operator=await f.second(admin,{role:"operator",botIds:[b.id]});
  const getDevice=async jkt=>(await (await admin.request("/v1/security/sessions")).json()).devices.find(d=>d.jkt===jkt);
  const device=await getDevice(operator.device.jkt);
  return {...f,server:f.server,runtime,admin,operator,b,device,getDevice};
}
test("HTTP captures authenticated device, rejects forged provenance and exposes no raw source in Bot snapshots",async t=>{
  const f=await httpSetup(t),body={botId:f.b.id,prompt:"not in audit"};
  assert.equal((await f.operator.request("/v1/goals",{...body,source:{deviceJkt:f.admin.device.jkt}})).status,400);
  const result=await (await f.operator.request("/v1/goals",body)).json();const grant=f.server.store.taskSecurity.authorization(result.goalId);
  assert.equal(grant.source.deviceJkt,f.operator.device.jkt);assert.equal(grant.source.nodeId,f.server.node.id);
  const snapshot=await (await f.operator.request("/v1/snapshot")).json();assert.ok(!JSON.stringify(snapshot).includes(f.operator.device.jkt));
  assert.equal((await f.operator.request("/v1/security/sessions")).status,403);
});
test("ordinary logout and device-session block do not silently cancel accepted work",async t=>{
  const f=await httpSetup(t),response=await f.operator.request("/v1/goals",{botId:f.b.id,prompt:"Continue after logout"});const {goalId}=await response.json();
  await waitFor(()=>f.runtime.jobs.length===1);const state=await (await f.admin.request("/v1/security/sessions")).json(),session=state.sessions.find(s=>s.dpop_jkt===f.operator.device.jkt);
  assert.equal((await f.admin.request(`/v1/security/sessions/${session.id}/revoke`,{})).status,200);assert.equal(f.runtime.jobs[0].signal.aborted,false);
  assert.equal((await f.admin.request(`/v1/security/devices/${f.device.jkt}/block`,{expectedVersion:f.device.version})).status,200);assert.equal(f.runtime.jobs[0].signal.aborted,false);
  f.runtime.jobs[0].resolve({text:"Legitimate remote result",transcript:[]});await waitFor(()=>f.server.store.goal(goalId).status==="review");
});
test("block-and-freeze stops running work, cancels queued work and denies subsequent calls from every same-key session",async t=>{
  const f=await httpSetup(t),a=await (await f.operator.request("/v1/goals",{botId:f.b.id,prompt:"First"})).json(),b=await (await f.operator.request("/v1/goals",{botId:f.b.id,prompt:"Second"})).json();
  const another=await f.exchange(await f.begin(f.operator.device));await waitFor(()=>f.runtime.jobs.length===1);
  const result=await f.admin.request(`/v1/security/devices/${f.device.jkt}/block-and-freeze`,{expectedVersion:f.device.version});assert.equal(result.status,200,await result.clone().text());
  assert.equal(f.runtime.jobs[0].signal.aborted,true);assert.equal(f.server.store.goal(b.goalId).status,"cancelled");assert.equal(f.server.store.goal(a.goalId).status,"cancelling");
  assert.equal((await another.request("/v1/snapshot")).status,401);
  const snapshot=(await result.json()).taskSafety;assert.equal(snapshot.freezes[0].stopping,1);assert.equal(snapshot.freezes[0].cancelledBeforeDispatch,1);
  f.runtime.jobs[0].resolve({text:"late result",transcript:[]});await waitFor(()=>f.server.store.goal(a.goalId).status==="uncertain");
});
test("stale device confirmation, insufficient scope and old administrator login cannot freeze work",async t=>{
  const f=await httpSetup(t),uri=`/v1/security/devices/${f.device.jkt}/block-and-freeze`;
  assert.equal((await f.operator.request(uri,{expectedVersion:f.device.version})).status,403);
  assert.equal((await f.admin.request(uri,{expectedVersion:f.device.version+3})).status,409);
  f.alter(db=>db.prepare("UPDATE auth_sessions SET created_at=0 WHERE dpop_jkt=?").run(f.admin.device.jkt));
  assert.equal((await f.admin.request(uri,{expectedVersion:f.device.version})).status,428);assert.equal(f.server.store.taskSecurity.list(f.b.ownerId).length,0);
});
test("last usable administrator cannot be quarantined, including when another approved key is already quarantined",async t=>{
  const f=await httpSetup(t),target=await f.getDevice(f.admin.device.jkt);
  assert.equal((await f.admin.request(`/v1/security/devices/${target.jkt}/block-and-freeze`,{expectedVersion:target.version})).status,409);assert.equal(f.server.store.taskSecurity.list(f.b.ownerId).length,0);
  const other=await f.second(f.admin);const bad=await f.getDevice(other.device.jkt);
  f.server.store.freezeTasks(f.b.ownerId,randomUUID(),randomUUID(),"device",bad.jkt);
  assert.equal((await f.admin.request(`/v1/security/devices/${target.jkt}/block-and-freeze`,{expectedVersion:target.version})).status,409);
  assert.equal((await f.admin.request("/v1/snapshot")).status,200);
});
test("a previously blocked key can still have its earlier accepted work explicitly frozen",async t=>{
  const f=await httpSetup(t);await f.operator.request("/v1/goals",{botId:f.b.id,prompt:"Earlier work"});await waitFor(()=>f.runtime.jobs.length===1);
  await f.admin.request(`/v1/security/devices/${f.device.jkt}/block`,{expectedVersion:f.device.version});
  assert.equal((await f.admin.request(`/v1/security/devices/${f.device.jkt}/block-and-freeze`,{expectedVersion:f.device.version+1})).status,200);assert.equal(f.runtime.jobs[0].signal.aborted,true);
});
test("failure between task quarantine and auth commit stays fail-closed through restart and can be reconciled",async t=>{
  const f=await httpSetup(t),uri=`/v1/security/devices/${f.device.jkt}/block-and-freeze`,command=randomUUID();
  await f.operator.request("/v1/goals",{botId:f.b.id,prompt:"Sensitive task"});await waitFor(()=>f.runtime.jobs.length===1);
  f.alter(db=>db.exec("CREATE TRIGGER simulate_device_disk_failure BEFORE UPDATE OF status ON auth_trusted_devices BEGIN SELECT RAISE(ABORT, 'fixture auth write failure'); END"));
  const result=await f.admin.request(uri,{expectedVersion:f.device.version},command);assert.equal(result.status,503);assert.equal((await result.json()).error,"device_block_incomplete");
  assert.equal((await f.getDevice(f.device.jkt)).status,"approved","auth transaction actually rolled back");assert.equal(f.runtime.jobs[0].signal.aborted,true);
  assert.equal((await f.operator.request("/v1/snapshot")).status,401,"persistent quarantine denies access despite auth record rollback");
  await f.restart();assert.equal((await f.operator.request("/v1/snapshot")).status,401);
  f.alter(db=>db.exec("DROP TRIGGER simulate_device_disk_failure"));
  assert.equal((await f.admin.request(uri,{expectedVersion:f.device.version},command)).status,200);assert.equal((await f.getDevice(f.device.jkt)).status,"blocked");
});
test("request whose body finishes after a security freeze cannot use the pre-freeze identity",async t=>{
  const f=await httpSetup(t),uri=f.origin+"/v1/goals",payload=JSON.stringify({botId:f.b.id,prompt:"Must not be accepted"});
  const pending=new Promise((resolve,reject)=>{
    const req=httpRequest(uri,{method:"POST",headers:{Authorization:`DPoP ${f.operator.tokens.access_token}`,DPoP:f.operator.device.proof(uri,"POST",f.operator.tokens.access_token),"content-type":"application/json","content-length":Buffer.byteLength(payload),"idempotency-key":randomUUID()}},res=>{let b="";res.on("data",x=>b+=x);res.on("end",()=>resolve(res.statusCode));});
    req.on("error",reject);req.write(payload.slice(0,10));
    void (async()=>{await delay(30);assert.equal((await f.admin.request(`/v1/security/devices/${f.device.jkt}/block-and-freeze`,{expectedVersion:f.device.version})).status,200);req.end(payload.slice(10));})().catch(reject);
  });
  assert.equal(await pending,401);assert.equal(f.server.store.goals().length,0);
});
test("task safety records are administrator-only, contain no prompt or token, and do not cross owners",async t=>{
  const f=await httpSetup(t),secret="unique-user-prompt-not-in-security-log";
  await f.operator.request("/v1/goals",{botId:f.b.id,prompt:secret});await f.admin.request(`/v1/security/bots/${f.b.id}/freeze`,{});
  const log=await (await f.admin.request("/v1/security/events")).json();assert.ok(log.events.some(e=>e.kind==="security.tasks_frozen"));
  for(const value of [secret,f.operator.tokens.access_token,f.admin.tokens.refresh_token])assert.ok(!JSON.stringify(log).includes(value));
  const foreign=f.server.store.createBot("foreign",randomUUID(),{name:"Foreign",description:""}).bot;
  assert.equal((await f.admin.request(`/v1/security/bots/${foreign.id}/freeze`,{})).status,404);
});
test("security-stopped result inspection cannot be performed by an ordinary operator",async t=>{
  const f=await httpSetup(t),cmd=await (await f.operator.request("/v1/goals",{botId:f.b.id,prompt:"External work"})).json();await waitFor(()=>f.runtime.jobs.length===1);
  const hold=await (await f.admin.request(`/v1/security/bots/${f.b.id}/freeze`,{})).json();f.runtime.jobs[0].resolve({text:"late",transcript:[]});await waitFor(()=>f.server.store.goal(cmd.goalId).status==="uncertain");
  const goal=f.server.store.goal(cmd.goalId),body={expectedVersion:goal.version,note:"Inspected stopped process and external effects"};
  assert.equal((await f.operator.request(`/v1/goals/${goal.id}/reconcile`,body)).status,403);
  assert.equal((await f.admin.request(`/v1/security/task-freezes/${hold.freeze.id}/release`,{expectedVersion:1})).status,409);
  assert.equal((await f.admin.request(`/v1/goals/${goal.id}/reconcile`,body)).status,200);
  assert.equal((await f.admin.request(`/v1/security/task-freezes/${hold.freeze.id}/release`,{expectedVersion:1})).status,200);
  assert.equal(f.server.store.goal(goal.id).status,"failed");
});

test("freezing an idle Bot invalidates authorized event clients without exposing security records to unrelated readers",async t=>{
  const f=await httpSetup(t),unrelated=await f.second(f.admin,{role:"viewer",botIds:[]});
  async function listen(client){const ticket=await(await client.request("/v1/events/ticket",{})).json();const socket=new WebSocket(f.origin.replace("http:","ws:")+"/v1/events");t.after(()=>socket.terminate());socket.on("error",()=>{});const messages=[];socket.on("message",data=>messages.push(JSON.parse(data.toString())));await new Promise((resolve,reject)=>{socket.once("open",resolve);socket.once("error",reject);});socket.send(JSON.stringify({ticket:ticket.ticket,proof:client.device.proof(f.origin+"/v1/events","GET",ticket.ticket,ticket.nonce),after:f.server.store.cursor}));await waitFor(()=>messages.some(m=>m.type==="ready"));return messages;}
  const allowed=await listen(f.operator),denied=await listen(unrelated);
  const response=await f.admin.request(`/v1/security/bots/${f.b.id}/freeze`,{});assert.equal(response.status,200);
  await waitFor(()=>allowed.some(m=>m.type==="resync"));await delay(30);assert.ok(!denied.some(m=>m.type==="resync"));
  assert.ok(allowed.filter(m=>m.type==="resync").every(m=>Object.keys(m).sort().join(",")==="cursor,type"));
  const state=await(await f.operator.request("/v1/snapshot")).json();assert.equal(state.bots[0].securityFrozen,true);
  assert.equal((await f.operator.request("/v1/goals",{botId:f.b.id,prompt:"do not submit"})).status,423);
});

test("an authorized retry after Bot freeze returns the original receipt without accepting or re-dispatching work",async t=>{
  const f=await ledger(t),b=makeBot(f.store),src=source(),key=randomUUID(),body={botId:b.id,prompt:"original"};
  const first=f.store.submitGoal(b.ownerId,key,body,src);freeze(f.store,b,"bot",b.id);const cursor=f.store.cursor;
  assert.deepEqual(f.store.submitGoal(b.ownerId,key,body,source()),first);assert.equal(f.store.goals().length,1);assert.equal(f.store.goal(first.goalId).status,"cancelled");assert.equal(f.store.start(first.goalId),undefined);assert.equal(f.store.cursor,cursor);
  assert.throws(()=>f.store.submitGoal(b.ownerId,key,{...body,prompt:"changed"},src),{status:409});
  assert.throws(()=>f.store.submitGoal(b.ownerId,randomUUID(),body,src),{status:423});
});
