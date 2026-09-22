import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { continuityHarness, deferred, until } from "./helpers/continuity-harness.mjs";
const question = {type:"widget",widget:{prompt:"先修哪个？",options:[{label:"先修输入框",value:"composer"},{label:"先修群成员",value:"members"}]}};
const publicEntries = h => h.entries("room").filter(e=>e.kind==="send-message");

test("real SendMessage wakes the addressed colleague before its sender's run finishes", {timeout:10000}, async t=>{
 const gate=deferred();t.after(gate.resolve);let handoff;
 const h=await continuityHarness(t,{runMember:async(call,turn)=>{
   if(call.id==="a"&&turn===1){handoff=call.publish("@{b} Please review the input change");await gate.promise;return ["@{a} My remaining check is finished"];} return ["(pass)"];
 }});
 await h.send("@{a} Improve chat");await until(()=>h.calls.some(c=>c.id==="b"));
 assert.ok(handoff);assert.ok(h.entries("room").some(e=>e.id===handoff));
 assert.match(h.calls.find(c=>c.id==="b").prompt,/Please review the input change/);
 assert.equal(h.calls.filter(c=>c.id==="a").length,1);
 gate.resolve();await h.drain();assert.equal(publicEntries(h).filter(e=>e.id===handoff).length,1);
 assert.equal(h.records("room").find(r=>r.id===handoff).recipients.b,"processed");
});

test("explicit public progress is published; private text deltas are never leaked",async t=>{
 const h=await continuityHarness(t,{runMember:async call=>{call.update({type:"text-delta",text:"PRIVATE SCRATCHPAD"});call.publish("@{a} Public progress");return [];}});
 await h.send("@{a} Check");await h.drain();
 assert.equal(publicEntries(h).length,1);assert.match(publicEntries(h)[0].message.content,/Public progress/);
 assert.equal(JSON.stringify(h.entries("room")).includes("PRIVATE SCRATCHPAD"),false);
});

test("published files are room-scoped immutable snapshots readable by the existing attachment service",async t=>{
 const h=await continuityHarness(t,{runMember:async(call,turn)=>turn===1&&call.id==="a"?[{type:"attachment",url:pathToFileURL(file).href}]:["(pass)"]});
 const file=path.join(h.runtime.directory,"结果.md");writeFileSync(file,"first verified bytes");
 await h.send("@{a} Share result");await h.drain();
 const entry=publicEntries(h)[0],message=entry.message,stored=fileURLToPath(message.url);
 assert.match(stored,/agents\/room\/attachments\/group-artifacts\//);
 assert.equal(message.artifact.sha256,createHash("sha256").update("first verified bytes").digest("hex"));
 assert.equal(statSync(stored).mode&0o777,0o600);
 writeFileSync(file,"changed working copy");assert.equal(readFileSync(stored,"utf8"),"first verified bytes");
 const preview=await h.runtime.readAttachmentText(path.dirname(h.sessions.get("room").dbPath),stored);
 assert.equal(preview.kind,"text");assert.equal(preview.text,"first verified bytes");
 assert.equal(entry.replyTo,h.entries("room").find(e=>e.role==="user").id);
 assert.match(h.tm.groupChat.readGroupHistory(h.sessions.get("room")).find(m=>m.id===entry.id).content,/SHA-256/);
});

test("rework replies target the result's author and preserve both file versions",async t=>{
 let file;
 const h=await continuityHarness(t,{runMember:async(call,turn)=>{
   if(call.id!=="a")return ["(pass)"];writeFileSync(file,turn===1?"version one":"version two");return [{type:"attachment",url:pathToFileURL(file).href}];
 }});file=path.join(h.runtime.directory,"result.txt");
 await h.send("@{a} Deliver");await h.drain();const first=publicEntries(h)[0];
 const bCount=h.calls.filter(c=>c.id==="b").length;
 await h.send("Make this shorter","room",{replyToId:first.id});await h.drain();
 const second=publicEntries(h).at(-1);
 const rework = h.entries("room").find(e=>e.role==="user"&&e.content==="Make this shorter");
 assert.deepEqual(Object.keys(h.records("room").find(r=>r.id===rework.id).recipients),["a"],"the revision request targets its author; peers can still see the published result");
 assert.notEqual(first.message.artifact.sha256,second.message.artifact.sha256);
 assert.equal(readFileSync(fileURLToPath(first.message.url),"utf8"),"version one");
 assert.equal(readFileSync(fileURLToPath(second.message.url),"utf8"),"version two");
 assert.equal(h.entries("room").find(e=>e.role==="user"&&e.content==="Make this shorter").replyTo,first.id);
});

test("missing files fail visibly and do not publish a pretend artifact",async t=>{
 const h=await continuityHarness(t,{runMember:async()=>[{type:"attachment",url:"file:///does-not-exist/beebot-result.txt"}]});
 await h.send("@{a} Share");await h.drain();
 assert.equal(publicEntries(h).length,0);assert.ok(h.entries("room").some(e=>e.kind==="notice"));
 assert.equal(h.records("room")[0].recipients.a,"failed");
});

test("publication validates reply identity and does not grant cross-user sharing",async t=>{
 const h=await continuityHarness(t),db=h.sessions.get("room").dbPath;
 const link=h.runtime.prepareGroupPublication(db,{type:"attachment",url:"https://example.com/result.txt"},false);
 assert.equal(link.message.artifact.availability,"external-link");assert.equal(link.message.artifact.sha256,undefined);
 assert.throws(()=>h.runtime.prepareGroupPublication(db,question,true),/plain text/);
 assert.throws(()=>h.runtime.prepareGroupPublication(db,{type:"text",content:"secret",channel:"slack:elsewhere"},false),/current group/);
 assert.throws(()=>h.runtime.prepareGroupPublication(db,{type:"secret-request",secret:{label:"Password",connector:"x",field:"password"}},false),/private Bot/);
 assert.throws(()=>h.runtime.prepareGroupPublication(db,{type:"widget"},false),/prompt and answer/);
 assert.throws(()=>h.tm.groupChat.postGroupMemberMessage(h.sessions.get("room"),{id:"a",name:"A"},"reply",undefined,{content:"reply",replyToId:"other-room-message"}),/not available/);
 assert.equal(publicEntries(h).length,0);
});

test("questions wait for the user instead of waking every colleague",async t=>{
 const h=await continuityHarness(t,{runMember:async(call,turn)=>turn===1?[question]:["(pass)"]});
 await h.send("@{a} Discuss the UI");await h.drain();
 assert.deepEqual(h.calls.map(c=>c.id),["a"]);
 const entry=publicEntries(h)[0];assert.equal(entry.message.type,"widget");assert.ok(entry.decisionContext.userMessageId);
 assert.equal(h.tm.groupChat.readGroupHistory(h.sessions.get("room")).find(m=>m.id===entry.id).awaitingUser,true);
});

test("an inline answer goes only to its question author and duplicate clicks do not run twice",async t=>{
 const h=await continuityHarness(t,{runMember:async(call,turn)=>call.id==="a"&&turn===1?[question]:["(pass)"]});
 await h.send("@{a} Discuss");await h.drain();const entry=publicEntries(h)[0];
 const accepted=await h.tm.widgetResponses.respondToWidget(entry.id,"composer","room");assert.equal(accepted.accepted,true);await h.drain();
 assert.deepEqual(h.calls.map(c=>c.id),["a","a"]);assert.match(h.calls.at(-1).prompt,/composer/);
 const duplicate=await h.tm.widgetResponses.respondToWidget(entry.id,"composer","room");assert.equal(duplicate.accepted,false);
 assert.equal(h.calls.length,2);assert.equal(h.entries("room").find(e=>e.id===entry.id).respondedValue,"composer");
});

test("stale or invented question answers never authorize a new run",async t=>{
 const h=await continuityHarness(t,{runMember:async(call,turn)=>call.id==="a"&&turn===1?[question]:["(pass)"]});
 await h.send("@{a} Discuss");await h.drain();const entry=publicEntries(h)[0];
 assert.equal((await h.tm.widgetResponses.respondToWidget(entry.id,"deploy-everything","room")).accepted,false);
 await h.send("@{b} Scope changed: discussion only");await h.drain();const count=h.calls.length;
 assert.equal((await h.tm.widgetResponses.respondToWidget(entry.id,"composer","room")).accepted,false);
 assert.equal(h.calls.length,count);assert.equal(h.entries("room").find(e=>e.id===entry.id).decisionStatus,"stale");
});

test("a question produced from an obsolete user context is already visibly stale",async t=>{
 const gate=deferred();t.after(gate.resolve);
 const h=await continuityHarness(t,{runMember:async(call,turn)=>{if(call.id==="a"&&turn===1){await gate.promise;return [question];}return ["(pass)"];}});
 await h.send("@{a} First scope");await until(()=>h.calls.length===1);
 await h.send("@{b} New scope");gate.resolve();await h.drain();
 assert.equal(publicEntries(h)[0].decisionStatus,"stale");assert.equal(publicEntries(h)[0].widgetDismissed,true);
});

test("queued work rechecks membership before starting a colleague",async t=>{
 const gate=deferred();t.after(gate.resolve);const h=await continuityHarness(t,{runDirect:async()=>gate.promise});
 await h.send("private work","a");await until(()=>h.directCalls.length===1);
 await h.send("@{a} Group work");
 h.runtime.writeSandGroupConfig(path.dirname(h.sessions.get("room").dbPath),{version:1,memberIds:["b"]});
 gate.resolve();await h.drain();assert.equal(h.calls.length,0);
 assert.equal(h.records("room")[0].recipients.a,"failed");
});

test("a removed colleague's unanswered question cannot dispatch to other members",async t=>{
 const h=await continuityHarness(t,{runMember:async()=>[question]});await h.send("@{a} Discuss");await h.drain();const entry=publicEntries(h)[0];
 h.runtime.writeSandGroupConfig(path.dirname(h.sessions.get("room").dbPath),{version:1,memberIds:["b"]});
 assert.equal((await h.tm.widgetResponses.respondToWidget(entry.id,"composer","room")).accepted,false);assert.equal(h.calls.length,1);
});

test("attachment-only user messages keep a delivery identity and readable group context",async t=>{
 const h=await continuityHarness(t),file=path.join(h.runtime.directory,"requirements.txt");writeFileSync(file,"Read only, do not execute");
 await h.send("","room",{attachmentPaths:[file],attachmentNames:["requirements.txt"]});await h.drain();
 assert.ok(h.calls.length);assert.match(h.calls[0].prompt,/requirements.txt/);assert.ok(h.calls[0].prompt.includes(file));
 const attachment=h.entries("room").find(e=>e.kind==="user-attachment");assert.ok(h.records("room").find(r=>r.id===attachment.id));
});

test("explicit Stop also invalidates outstanding inline decisions",async t=>{
 const h=await continuityHarness(t,{runMember:async()=>[question]});await h.send("@{a} Discuss");await h.drain();
 const entry=publicEntries(h)[0];await h.tm.sendPipeline.stopConversation("room");
 assert.equal((await h.tm.widgetResponses.respondToWidget(entry.id,"composer","room")).accepted,false);assert.equal(h.calls.length,1);
});

test("long-running work never force-releases into an overlapping zombie execution",async t=>{
 const h=await continuityHarness(t);let now=0,items=[],interrupts=0,started=0;const events=[],gate=deferred();t.after(gate.resolve);
 const clock={now:()=>now,schedule:(delay,callback)=>{const job={at:now+delay,callback,live:true};items.push(job);return {dispose(){job.live=false;}};}};
 const scheduler=new h.runtime.SandRunScheduler({watchdogMs:10,watchdogGraceMs:5,interruptWedgedRun:()=>{interrupts++;return true;},telemetry:{onAccepted(){},onDequeued(){},onWatchdog:e=>events.push(e)}},clock);t.after(()=>scheduler.dispose());
 const first=scheduler.enqueue("a",async()=>{started++;await gate.promise;},{lane:"user",source:"turn"});await Promise.resolve();
 const second=scheduler.enqueue("a",async()=>{started++;},{lane:"user",source:"turn"});await Promise.resolve();
 now=100;for(const job of [...items])if(job.live&&job.at<=now){job.live=false;job.callback();}
 await Promise.resolve();now=1000;for(const job of [...items])if(job.live&&job.at<=now){job.live=false;job.callback();}
 assert.equal(started,1);assert.equal(interrupts,0);assert.equal(events.length,1);assert.equal(scheduler.getDiagnostics()[0].active.phase,"waiting");
 gate.resolve();await Promise.all([first,second]);assert.equal(started,2);
});
