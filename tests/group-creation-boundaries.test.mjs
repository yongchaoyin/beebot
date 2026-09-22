import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadContinuityRuntime } from "./helpers/load-continuity-runtime.mjs";

async function setup(t) {
  const runtime=await loadContinuityRuntime(t), calls=[], agents=[{id:"a"},{id:"b"},{id:"old",isGroup:true,memberIds:["a","b"]}];
  const tm={sessionStore:{listAgents:async()=>agents,getAgentDir:id=>path.join(runtime.directory,id)},
    createAgent:async profile=>{calls.push(profile);const agent={...profile,id:"new-"+calls.length};agents.push(agent);mkdirSync(path.join(runtime.directory,agent.id),{recursive:true});return {agent,transcript:[]};},
    productAnalytics:{trackEvent(){}},roster:{emitAgents:async()=>{},reserveSnapshotStamp:()=>1,finalizeSummaryForRpc:agent=>agent}};
  return {glue:new runtime.GroupChatGlue(tm),calls,agents};
}
test("same colleagues can create distinct named project groups",async t=>{
  const {glue,calls}=await setup(t);
  const first=await glue.createGroup({name:"Project One",memberIds:["a","b"]});
  const second=await glue.createGroup({name:"Project Two",memberIds:["a","b"]});
  assert.notEqual(first.agent.id,second.agent.id);assert.equal(calls.length,2);
});
test("invalid or too many group members fail before any group is created",async t=>{
  const {glue,calls,agents}=await setup(t);
  for(let i=0;i<7;i++)agents.push({id:"extra"+i});
  for(const memberIds of [[],["a","gone"],Array.from({length:7},(_,i)=>"extra"+i),["old"]])await assert.rejects(glue.createGroup({name:"Team",memberIds}));
  assert.equal(calls.length,0);
});
test("empty and overlong group names are rejected without mutation",async t=>{
  const {glue,calls}=await setup(t);
  await assert.rejects(glue.createGroup({name:"   ",memberIds:["a"]}));
  await assert.rejects(glue.createGroup({name:"x".repeat(101),memberIds:["a"]}));
  assert.equal(calls.length,0);
});
