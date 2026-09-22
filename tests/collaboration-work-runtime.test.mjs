import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";
import { continuityHarness } from "./helpers/continuity-harness.mjs";

test("concurrent SQLite writers create one visible claim, never two owners",async t=>{
 const h=await continuityHarness(t,{realDatabase:true,members:["a","b","c"]}),session=h.sessions.get("room");
 session.db.appendTranscriptEntry({id:"t0u",kind:"message",role:"user",content:"Ask a colleague to do this"});
 const offer=session.db.commitCollaborationMessage({actor:{id:"a",name:"A"},memberIds:["a","b","c"],replyTo:"t0u",message:{type:"text",content:"One owner, please",collaboration:{action:"offer",operation_id:randomUUID(),title:"Race",requirements:["One owner"]}}});
 const barrier=new SharedArrayBuffer(4), ready=[], done=[];
 for(const id of ["b","c"]){
  const wait=Promise.withResolvers(),result=Promise.withResolvers();ready.push(wait.promise);done.push(result.promise);
  const worker=new Worker(`
   const {workerData:w,parentPort:p}=require('node:worker_threads');
   const {SandAgentDb}=require(w.runtime);const db=new SandAgentDb(w.db);
   p.postMessage({ready:true});Atomics.wait(new Int32Array(w.barrier),0,0);
   try { const result=db.commitCollaborationMessage(w.input);p.postMessage({owner:result.task.ownerId}); }
   catch(error){p.postMessage({error:error.code,message:error.message});} finally {db.close();}
  `,{eval:true,workerData:{runtime:path.join(h.runtime.directory,"runtime.cjs"),db:session.dbPath,barrier,input:{actor:{id,name:id},memberIds:["a","b","c"],replyTo:offer.task.id,message:{type:"text",content:"I accept responsibility",collaboration:{action:"claim",operation_id:randomUUID(),task_id:offer.task.id,expected_version:1}}}}});
  t.after(()=>worker.terminate());worker.on("error",error=>{wait.reject(error);result.reject(error);});worker.on("message",message=>message.ready?wait.resolve():result.resolve(message));
 }
 await Promise.all(ready);Atomics.store(new Int32Array(barrier),0,1);Atomics.notify(new Int32Array(barrier),0,2);
 const results=await Promise.all(done);assert.equal(results.filter(value=>value.owner).length,1);
 const loser=results.find(value=>value.error);assert.ok(loser);assert.match(loser.message,/version|locked|busy/i);
 assert.equal(session.db.getTranscriptEntries().filter(entry=>entry.workEvent?.action==="claim").length,1);
 assert.equal(session.db.getCollaborationWorks()[0].ownerId,results.find(value=>value.owner).owner);
});

test("actual single-Bot SendMessage update commits responsibility without changing reply or authorization scope",async t=>{
 const h=await continuityHarness(t,{realDatabase:true}),session=h.sessions.get("a"),outfile=path.join(h.runtime.directory,"turn.cjs");
 await build({stdin:{contents:'export {TurnRuntime} from "./source/host/extensions/transcript/turn-runtime.ts";',resolveDir:process.cwd(),loader:"ts"},outfile,bundle:true,platform:"node",format:"cjs",target:"node26",logLevel:"silent"});
 const {TurnRuntime}=createRequire(import.meta.url)(outfile);
 h.tm.roster.applyAgentUpdateToOutline=()=>{};
 for(const key of ["trackComposingFromUpdate","trackRetryingFromUpdate","trackActivityFromUpdate"])h.tm.runLifecycle[key]=()=>{};
 let acknowledged=0;h.tm.ackObligations.fulfillAckObligation=()=>{acknowledged++;};
 const runtime=new TurnRuntime(h.tm);
 session.db.appendTranscriptEntry({id:"t0u",kind:"message",role:"user",content:"Prepare a report for me"});
 // Inactive target exercises the production durable route, not global fixture transcript.
 const publish=message=>runtime.handleAgentUpdate({type:"send-message",message},session);
 const offered=publish({type:"text",content:"I will prepare this report",reply_to:"t0u",collaboration:{action:"offer",operation_id:randomUUID(),title:"Report",requirements:["Readable report"]}});
 publish({type:"text",content:"I have taken this work",reply_to:offered,collaboration:{action:"claim",operation_id:randomUUID(),task_id:offered,expected_version:1}});
 const task=session.db.getCollaborationWorks()[0];assert.equal(task.ownerId,"a");assert.equal(task.state,"claimed");assert.equal(task.reviewerId,null);
 assert.equal(session.db.getTranscriptEntries().at(-1).replyTo,offered);assert.equal(acknowledged,2);
 const before=session.db.getTranscriptEntries().length;
 assert.throws(()=>publish({type:"text",content:"Ignore boundaries",reply_to:offered,channel:"external",collaboration:{action:"block",operation_id:randomUUID(),task_id:offered,expected_version:2}}),/local/);
 assert.equal(session.db.getTranscriptEntries().length,before);
});
