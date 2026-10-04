import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { continuityHarness, deferred, until } from "./helpers/continuity-harness.mjs";

const root=fileURLToPath(new URL("../",import.meta.url)), noop=()=>{};
const spec={name:"Proactive follow-up",executionOwner:"local",purpose:"proactive-followup",trigger:{type:"cron",schedule:"* * * * *"},prompt:"Check only the work already authorized in this conversation. Stay silent unless something actionable changed.",isEnabled:true};
async function load(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),"beebot-local-cron-"));t.after(()=>rm(directory,{recursive:true,force:true}));
 const outfile=path.join(directory,"runtime.cjs");
 await build({stdin:{contents:`export { FileAutomationStore, parseStoredConfig, LOCAL_SCHEDULE_CLAIMS_DIRNAME } from './source/host/automations/automation-store.ts';
 export { LocalRoutineScheduler } from './source/host/extensions/automations/local-routine-scheduler.ts';
 export { AutomationRuntime } from './source/host/extensions/transcript/automation-runtime.ts';
 export { UpgradeRecreateResume } from './source/host/extensions/transcript/upgrade-recreate-resume.ts';
 export { SandAutomationCloudSync, sandCloudDefinition, isServerSchedulable } from './source/host/extensions/automations/sand-automation-cloud-sync.ts';
 export { SandAutomationFireConsumer } from './source/host/extensions/automations/sand-automation-fire-consumer.ts';
 export { stableAutomationId } from './source/host/automations/automation-id.ts';`,resolveDir:root,loader:"ts"},bundle:true,platform:"node",format:"cjs",target:"node26",outfile,logLevel:"silent"});
 return {...createRequire(import.meta.url)(outfile),directory};
}
function clockAt(now=Date.UTC(2026,9,5,8,0,1)) {return {value:now,now(){return this.value},monotonicNow(){return this.value},schedule(_ms,callback){this.callback=callback;return{dispose:noop}}};}
async function scheduler(t,r,{store=new r.FileAutomationStore(path.join(r.directory,"a","automations")),clock=clockAt(),fire=async()=>"ok",isReady=()=>true,listAutomations,getTimeZone=()=>"UTC"}={}){
 const calls=[],diagnostics=[];const s=new r.LocalRoutineScheduler({clock,isReady,getTimeZone,listAutomations:listAutomations??(async()=>store.listDefinitions().map(automation=>({agentId:"a",automation}))),fire:async args=>{calls.push(args);return fire(args)},reportDiagnostic:v=>diagnostics.push(v)});
 t.after(()=>s.stop());s.start();await s.reconcileNow();await s.reconcileNow();
 return {s,store,clock,calls,diagnostics,async minute(minutes=1){clock.value=Math.floor(clock.value/60000)*60000+minutes*60000;await s.reconcileNow();}};
}

test("local ownership survives disk restart and legacy updates preserve it; invalid owner never falls back to cloud",async t=>{
 const r=await load(t),store=new r.FileAutomationStore(path.join(r.directory,"a","automations"));
 const a=store.upsert(spec);assert.equal(a.executionOwner,"local");assert.equal(a.purpose,"proactive-followup");
 const saved=JSON.parse(readFileSync(a.filePath,"utf8"));assert.equal(saved.executionOwner,"local");assert.equal(saved.purpose,"proactive-followup");
 const reopened=new r.FileAutomationStore(store.automationsDir);const changed=reopened.update(a.id,{name:"Custom",prompt:"My own boundaries",trigger:{type:"cron",schedule:"0 10 * * 1"},isEnabled:false});
 assert.equal(changed.executionOwner,"local");assert.equal(changed.purpose,"proactive-followup");assert.equal(changed.isEnabled,false);
 const replay=reopened.upsert(spec);assert.equal(replay.id,a.id);assert.equal(replay.prompt,changed.prompt);assert.equal(replay.trigger.schedule,changed.trigger.schedule);assert.equal(replay.isEnabled,false);assert.equal(reopened.count(),1);
 assert.equal(r.parseStoredConfig(JSON.stringify({...saved,executionOwner:"cloud-ish"}),Date.now()),null);
 const legacy=store.upsert({name:"Legacy",prompt:"Legacy task",trigger:spec.trigger});assert.equal(legacy.executionOwner,undefined);assert.equal(r.isServerSchedulable(legacy),true);
});

test("runtime template creation is serialized and idempotent for active Bot and inactive Group",async t=>{
 const r=await load(t);
 for(const active of [true,false]){
  const store=new r.FileAutomationStore(path.join(r.directory,active?"a":"room","automations")),id=active?"a":"room";
  const tm={sessions:{activeSession:active?{id,automations:store}:null},sessionStore:{listAgentAutomations:()=>store.list(),createAgentAutomation:(_id,value)=>{store.upsert(value);return store.list()}},shouldEmitAutomations:()=>false,automationConfigChanged:noop};
  const runtime=new r.AutomationRuntime(tm);runtime.recordAutomationChangeEvents=noop;runtime.recordInactiveAutomationChanges=noop;
  const results=await Promise.all(Array.from({length:12},()=>runtime.createAgentAutomation(id,spec)));
  assert.equal(store.count(),1);assert.equal(new Set(results.map(value=>value[0].id)).size,1);
  store.update(results[0][0].id,{...spec,prompt:"Customized prompt",trigger:{type:"cron",schedule:"0 12 * * *"}});
  assert.equal((await runtime.createAgentAutomation(id,spec))[0].prompt,"Customized prompt");
 }
});

test("actual Node cron loop dispatches Bot and Group independently without cloud credentials",async t=>{
 const r=await load(t),a=new r.FileAutomationStore(path.join(r.directory,"a","automations")),room=new r.FileAutomationStore(path.join(r.directory,"room","automations"));
 a.upsert(spec);room.upsert(spec);
 const gate=deferred();const h=await scheduler(t,r,{store:a,listAutomations:async()=>[{agentId:"a",automation:a.listDefinitions()[0]},{agentId:"room",automation:room.listDefinitions()[0]}],fire:async args=>args.agentId==="a"?gate.promise:"ok"});
 await h.minute();assert.deepEqual(h.calls.map(v=>v.agentId),["a","room"]);assert.ok(h.calls.every(v=>v.scheduledForMs===h.clock.value&&/^[a-f\d-]{36}$/.test(v.runUuid)));
 for(const store of[a,room])assert.equal(readdirSync(path.join(store.automationsDir,store.listDefinitions()[0].id,r.LOCAL_SCHEDULE_CLAIMS_DIRNAME)).length,1);
 gate.resolve("ok");
});

test("durable slot claims survive restart, bounded run history, unknown dispatch failure and duplicate Node processes",async t=>{
 const r=await load(t),h=await scheduler(t,r,{fire:async()=>{throw new Error("unknown external result")}});const a=h.store.upsert(spec);await h.s.reconcileNow();await h.minute();
 assert.equal(h.calls.length,1);const first=h.calls[0],reopened=new r.FileAutomationStore(h.store.automationsDir);
 assert.equal(reopened.claimLocalScheduleSlot({...first,automation:reopened.get(a.id)}),null);
 for(let i=0;i<25;i++)reopened.beginRun({id:a.id,trigger:"manual",runId:`other-${i}`,at:i});assert.equal(reopened.readRuns(a.id).length,20);
 assert.equal(reopened.claimLocalScheduleSlot({...first,automation:reopened.get(a.id)}),null,"dedup is independent of display history");
 h.s.stop();const after=await scheduler(t,r,{store:reopened,clock:h.clock});await after.s.reconcileNow();assert.equal(after.calls.length,0,"restart never catches up");await after.minute();assert.equal(after.calls.length,1);assert.notEqual(after.calls[0].runUuid,first.runUuid);
 const same=new r.FileAutomationStore(h.store.automationsDir);assert.equal(same.claimLocalScheduleSlot({...after.calls[0],automation:same.get(a.id)}),null);
 const raw=readFileSync(path.join(h.store.automationsDir,a.id,r.LOCAL_SCHEDULE_CLAIMS_DIRNAME,`${first.runUuid}.json`),"utf8");assert.ok(!raw.includes(spec.prompt));
});

test("pause, deletion, unavailable Node and sleep discard missed slots without catchup",async t=>{
 const r=await load(t);let ready=true;const h=await scheduler(t,r,{isReady:()=>ready});const a=h.store.upsert(spec);await h.s.reconcileNow();
 h.store.setEnabled(a.id,false);await h.minute();h.store.setEnabled(a.id,true);await h.s.reconcileNow();assert.equal(h.calls.length,0);await h.minute();assert.equal(h.calls.length,1);
 ready=false;await h.minute();ready=true;await h.s.reconcileNow();assert.equal(h.calls.length,1);await h.minute();assert.equal(h.calls.length,2);
 await h.minute(15);assert.equal(h.calls.length,2,"sleep does not replay the fifteen missed minutes");await h.minute();assert.equal(h.calls.length,3);
 h.store.remove(a.id);await h.minute();assert.equal(h.calls.length,3);assert.equal(existsSync(path.dirname(a.filePath)),false);
});

test("legacy/cloud schedules, unmarked templates, event triggers and invalid time zones are never stolen locally",async t=>{
 const r=await load(t),store=new r.FileAutomationStore(path.join(r.directory,"a","automations"));
 store.upsert({name:"Legacy",prompt:"legacy",trigger:spec.trigger});store.upsert({...spec,name:"Purpose only",executionOwner:undefined});store.upsert({...spec,name:"Owner only",purpose:undefined});
 const h=await scheduler(t,r,{store});await h.minute();assert.equal(h.calls.length,0);
 store.remove(store.listDefinitions().find(a=>a.purpose===spec.purpose&&a.executionOwner==="local")?.id??"missing");
 const local=store.upsert(spec);assert.equal(new r.FileAutomationStore(store.automationsDir,()=>"Invalid/Timezone").get(local.id).nextRunAt,null);const bad=await scheduler(t,r,{store,getTimeZone:()=>"Invalid/Timezone"});await bad.minute();assert.equal(bad.calls.length,0);
 store.update(local.id,{...spec,trigger:{type:"slack",channel:"#fixture",match:{kind:"message"}}});await h.s.reconcileNow();await h.minute();assert.equal(h.calls.length,0,"event triggers are outside the local lane");
 store.update(local.id,{...spec,trigger:{type:"cron",schedule:"@every 2s"}});await h.s.reconcileNow();await h.minute();assert.equal(h.calls.length,0,"local lane only supports compiled cron");
});

test("late read-only reconciliation after stop/resume cannot dispatch or seed old view state",async t=>{
 const r=await load(t),store=new r.FileAutomationStore(path.join(r.directory,"a","automations"));store.upsert(spec);const gate=deferred(),clock=clockAt();let useGate=true,calls=[];
 const s=new r.LocalRoutineScheduler({clock,isReady:()=>true,getTimeZone:()=>"UTC",listAutomations:async()=>useGate?gate.promise:store.listDefinitions().map(automation=>({agentId:"a",automation})),fire:async v=>{calls.push(v)}});t.after(()=>s.stop());s.start();s.stop();clock.value+=300000;useGate=false;s.start();gate.resolve(store.listDefinitions().map(automation=>({agentId:"a",automation})));await s.reconcileNow();await s.reconcileNow();assert.equal(calls.length,0);clock.value=Math.floor(clock.value/60000)*60000+60000;await s.reconcileNow();assert.equal(calls.length,1);
});

test("cloud sync excludes local definitions and prunes their previous authenticated shadows; unknown cloud auth never runs legacy locally",async t=>{
 const r=await load(t),store=new r.FileAutomationStore(path.join(r.directory,"a","automations")),local=store.upsert(spec),legacy=store.upsert({name:"Legacy",prompt:"legacy",trigger:spec.trigger});
 assert.equal(r.sandCloudDefinition({agentId:"a",automation:local}),null);assert.equal(r.isServerSchedulable(local),false);assert.ok(r.sandCloudDefinition({agentId:"a",automation:legacy}));
 const localId=r.stableAutomationId({agentId:"a",localId:local.id});let remotes=[{automationId:localId,description:"sand-shadow:old",enabled:true}],created=[],deleted=[];
 const sync=new r.SandAutomationCloudSync({client:{listSandAutomations:async()=>({workflows:remotes.map(workflow=>({workflow}))}),deleteSandAutomation:async r=>{deleted.push(r.automationId);remotes=remotes.filter(v=>v.automationId!==r.automationId)},createSandAutomation:async r=>{created.push(r);remotes.push({automationId:r.sandAutomationId,description:r.description,enabled:r.enabled})},updateSandAutomation:async()=>assert.fail("unexpected update")},hasCredential:()=>true,listAgentIds:async()=>["a"],listAutomations:async()=>store.listDefinitions().map(automation=>({agentId:"a",automation})),onFailure:assert.fail,onRecovery:noop,onSchedulingAuthorityChanged:noop,getTimeZone:()=>"UTC"});
 assert.equal(sync.shouldScheduleLocally({agentId:"a",automation:legacy}),false);assert.equal(sync.shouldScheduleLocally({agentId:"a",automation:local}),false);await sync.reconcileNow();assert.deepEqual(deleted,[localId]);assert.equal(created.length,1);assert.equal(created[0].name,legacy.name);
});

test("actual remote fire consumer rejects local-owner wakes including forged existing completed ids",async t=>{
 const r=await load(t),store=new r.FileAutomationStore(path.join(r.directory,"a","automations")),a=store.upsert(spec);let calls=0,completions=[],dropped=[];
 const event={id:"wrong-remote",sandAgentId:"a",automationId:r.stableAutomationId({agentId:"a",localId:a.id}),timestampMs:Date.now(),scheduledForMs:Date.now()};a.runs=[{id:event.id,status:"ok"}];
 const consumer=new r.SandAutomationFireConsumer({getAccessToken:async()=>"fixture-only",getBackendUrl:()=>"https://fixture.invalid",getTimeZone:()=>"UTC",getBoxUptimeMs:()=>1,isReady:()=>true,listAutomations:async()=>[{agentId:"a",automation:a}],fire:async()=>{calls++;return"ok"},fireForEvent:async()=>{calls++;return"ok"},fetchImpl:async(url,options)=>({ok:true,json:async()=>{if(url.endsWith("/complete"))completions.push(JSON.parse(options.body));return{}}}),telemetry:{reportAutomationFireDropped:v=>dropped.push(v)}});
 await consumer.deliver(event);assert.equal(calls,0);assert.equal(completions[0].status,"failed");assert.equal(dropped[0].reason,"local_execution_owner");consumer.stop();
});

async function runHarness(t,{runMember=async()=>["(pass)"]}={}){
 const r=await load(t),h=await continuityHarness(t,{runMember});
 for(const session of h.sessions.values())session.automations=new r.FileAutomationStore(path.join(path.dirname(session.dbPath),"automations"));
 h.tm.sessions.resolveBackgroundSession=async id=>h.sessions.get(id);h.tm.sessionStore.getUserTimeZone=()=>"UTC";
 h.tm.automationRuntime=new r.AutomationRuntime(h.tm);h.tm.automationRuntime.emitAutomations=noop;h.tm.automationRuntime.recordAutomationChangeEvents=noop;h.tm.automationRuntime.recordInactiveAutomationChanges=noop;
 h.tm.automationRuntime.spendGuard.apply=async()=>({paused:false});h.tm.upgradeResume=new r.UpgradeRecreateResume(h.tm);let markers=[];h.tm.upgradeResumeStore={markPending:v=>markers.push(v)};
 return {...h,r,markers,runPath:h.tm.automationRuntime.runPath};
}

test("real automation runtime executes a single Bot turn with durable history and no local transient retry or upgrade replay",async t=>{
 const h=await runHarness(t),session=h.sessions.get("a"),automation=session.automations.upsert(spec),gate=deferred(),calls=[];
 h.tm.runnerRegistry.getRunner=()=>({run:async(prompt,options)=>{calls.push({prompt,options});await gate.promise;return{quiescedForUpgrade:true,sentMessageCount:0}}});
 const now=Date.now(),runUuid=session.automations.claimLocalScheduleSlot({agentId:"a",automation,scheduledForMs:now});
 const done=h.tm.automationRuntime.runServerScheduledAutomation({agentId:"a",automation,runUuid,scheduledForMs:now});await until(()=>calls.length===1);
 h.tm.upgradeResume.markAllRunningAgentsForUpgradeResume();assert.equal(h.markers.length,0);gate.resolve();assert.equal(await done,"interrupted");
 assert.equal(calls[0].options.transientStreamRetry.maxAttempts,1);assert.equal(calls[0].options.isSilenceAllowed,true);assert.ok(calls[0].prompt.includes(spec.prompt));
 const run=session.automations.get(automation.id).runs[0];assert.equal(run.id,runUuid);assert.equal(run.status,"error");assert.match(run.detail,/will not be replayed/);assert.equal(h.markers.length,0);assert.equal(h.tm.runLifecycle.inFlightRunCounts.size,0);
});

test("queued local single/Group wakes recheck pause, deletion, prompt/schedule edit, readiness and age before execution",async t=>{
 const h=await runHarness(t);let called=0;h.tm.runnerRegistry.getRunner=()=>({run:async()=>{called++;return{aborted:false}}});
 for(const id of["a","room"]){for(const mutation of["pause","reenable","delete","prompt","resetprompt","schedule","unready","expired"]){
  h.tm.execution.canExecute=true;const session=h.sessions.get(id),automation=session.automations.upsert(spec),gate=deferred();let queued;
  const original=h.tm.runLifecycle.enqueueExclusiveRun.bind(h.tm.runLifecycle);h.tm.runLifecycle.enqueueExclusiveRun=async(_id,work)=>{queued=work;await gate.promise;await work()};
  const scheduledForMs=mutation==="expired"?Date.now()-61000:Date.now();const done=h.tm.automationRuntime.runServerScheduledAutomation({agentId:id,automation,runUuid:`blocked-${id}-${mutation}`,scheduledForMs});await until(()=>!!queued);h.tm.upgradeResume.markAllRunningAgentsForUpgradeResume();assert.equal(h.markers.length,0,"queued local work is not persisted as an ordinary restart turn");
  if(mutation==="pause")session.automations.setEnabled(automation.id,false);if(mutation==="reenable"){session.automations.setEnabled(automation.id,false);session.automations.setEnabled(automation.id,true)}if(mutation==="resetprompt"){session.automations.update(automation.id,{...spec,prompt:"Changed"});session.automations.update(automation.id,spec)}if(mutation==="delete")session.automations.remove(automation.id);if(mutation==="prompt")session.automations.update(automation.id,{...spec,prompt:"New boundaries"});if(mutation==="schedule")session.automations.update(automation.id,{...spec,trigger:{type:"cron",schedule:"0 10 * * *"}});if(mutation==="unready")h.tm.execution.canExecute=false;
  gate.resolve();assert.equal(await done,undefined);assert.equal(called,0);assert.equal(h.calls.length,0);assert.equal(h.tm.runLifecycle.inFlightRunCounts.size,0);assert.equal(h.entries("room").length,0);h.tm.runLifecycle.enqueueExclusiveRun=original;
  session.automations.remove(automation.id);
 }}
});

test("real scheduled Group runs distinct Bot peers and refuses DM-preemption redrive and upgrade resume",async t=>{
 let h,attempts=new Map(),options=[];
 h=await runHarness(t,{runMember:async call=>{attempts.set(call.id,(attempts.get(call.id)??0)+1);h.tm.groupChat.dmPreemptedGroupMemberIds.add(call.id);h.tm.upgradeResume.markAllRunningAgentsForUpgradeResume();return["(pass)"]}});
 const create=h.tm.execution.createGroupMemberRunner;h.tm.execution.createGroupMemberRunner=(...args)=>{const runner=create(...args),run=runner.run;runner.run=(prompt,o)=>{options.push(o);return run(prompt,o)};return runner};
 const session=h.sessions.get("room"),automation=session.automations.upsert({...spec,prompt:"@A @B Each check only your own authorized work and stay silent when unchanged."}),scheduledForMs=Date.now(),runUuid=session.automations.claimLocalScheduleSlot({agentId:"room",automation,scheduledForMs});
 assert.equal(await h.tm.automationRuntime.runServerScheduledAutomation({agentId:"room",automation,runUuid,scheduledForMs}),"ok");
 assert.deepEqual([...attempts.keys()].sort(),["a","b"]);assert.ok([...attempts.values()].every(n=>n===1));assert.ok(options.every(o=>o.transientStreamRetry.maxAttempts===1));assert.equal(h.markers.length,0);
 assert.equal(session.automations.get(automation.id).runs[0].id,runUuid);assert.equal(h.tm.runLifecycle.inFlightRunCounts.size,0);assert.equal(h.entries("room").filter(e=>e.kind==="send-message").length,0,"private pass text is never a public result");
});


test("polling start alone fires a future slot; no UI reconciliation or backend wake is required",async t=>{
 const r=await load(t),store=new r.FileAutomationStore(path.join(r.directory,"a","automations"));store.upsert(spec);const h=await scheduler(t,r,{store});
 await until(()=>typeof h.clock.callback==="function");const callback=h.clock.callback;h.clock.value=Math.floor(h.clock.value/60000)*60000+60000;callback();await until(()=>h.calls.length===1);assert.equal(h.calls[0].scheduledForMs,h.clock.value);
});

test("ordinary Group preemption retains its existing bounded redrive behavior",async t=>{
 let h,attempts=0;h=await runHarness(t,{runMember:async call=>{attempts++;if(attempts===1)h.tm.groupChat.dmPreemptedGroupMemberIds.add(call.id);return[]}});
 const session=h.sessions.get("room"),automation=session.automations.upsert({name:"Legacy",prompt:"@A check your existing task",trigger:spec.trigger});
 assert.equal(await h.tm.automationRuntime.runServerScheduledAutomation({agentId:"room",automation,runUuid:"legacy",scheduledForMs:Date.now()}),"ok");assert.equal(attempts,2);assert.equal(h.tm.runLifecycle.inFlightRunCounts.size,0);
});
