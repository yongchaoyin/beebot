import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {Window} from "happy-dom";
const code=await readFile(new URL("../scripts/lib/beebot-conversation-status.snippet.js",import.meta.url),"utf8");
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
function store(value){const listeners=new Set();return{get:()=>value,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},set:next=>{value=next;for(const fn of listeners)fn();}};}
async function setup(t){
 const window=new Window({url:"https://beebot.local"});t.after(async()=>{window.__beebotConversationStatus?.dispose();await window.happyDOM.close();});
 window.document.body.innerHTML='<main><div data-row-key="nonce:one">User message</div><div data-row-key="handoff">Bot handoff</div><div class="sand-chat-input-dock"><textarea>Keep my draft</textarea></div></main>';
 const selected=store({currentAgentId:"room"}),entries=store({entries:[{id:"m1",kind:"message",clientNonce:"one",delivery:{state:"processing",recipients:{a:"processing",b:"queued"}}},{id:"handoff",kind:"send-message",delivery:{state:"queued",recipients:{b:"queued"}}}]}),other=store({entries:[]}),connection=store({transport:"up"});
 const calls=[];let stop=async args=>{calls.push(args);return{accepted:true};};
 const runtime={selection:{snapshots:selected},transcript:{snapshotsFor:id=>id==="room"?entries:other},connection:{snapshots:connection},roster:{snapshots:store({agents:{rows:[{id:"a",name:"A"},{id:"b",name:"B"}]}}),stopConversation:args=>stop(args)}};
 window.fixtureRuntime=runtime;window.eval(code+';RBindConversationStatus(window.fixtureRuntime);');await tick();
 return{window,document:window.document,selected,entries,other,connection,calls,stop:fn=>{stop=fn;},root:()=>window.document.getElementById("beebot-conversation-status")};
}
test("single and group transcript status is sourced from actual delivery records",async t=>{
 const ui=await setup(t);assert.match(ui.document.querySelector('[data-row-key="nonce:one"]').textContent,/A · Being handled；B · Waiting/);
 assert.equal(ui.document.querySelectorAll("[role=dialog]").length,0);
 assert.equal(ui.root().parentElement.className,"sand-chat-input-dock");
 assert.equal(ui.document.querySelector('textarea').value,"Keep my draft");
 ui.entries.set({entries:[{id:"m1",kind:"message",clientNonce:"one",delivery:{state:"failed",recipients:{a:"failed"}}}]});await tick();
 assert.match(ui.document.querySelector('[data-bb-delivery="m1"]').textContent,/failed; message retained/);
 assert.equal(ui.document.querySelector('[data-row-key="handoff"] [data-bb-delivery]'),null);
});
test("stop is confirmed inline and affects only the selected conversation",async t=>{
 const ui=await setup(t);ui.root().querySelector(":scope > button").click();
 assert.equal(ui.calls.length,0);assert.equal(ui.root().querySelector(".bb-conversation-confirm").hidden,false);
 assert.match(ui.root().textContent,/will not be undone/);
 ui.root().querySelector(".bb-conversation-confirm button").click();await tick();
 assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].agentId,"room");assert.match(ui.root().textContent,/Stop request accepted/);
});
test("changing chats invalidates a confirmation even before the next render microtask",async t=>{
 const ui=await setup(t);ui.root().querySelector(":scope > button").click();const confirm=ui.root().querySelector(".bb-conversation-confirm button");
 ui.selected.set({currentAgentId:"other"});confirm.click();assert.equal(ui.calls.length,0);await tick();
 assert.equal(ui.root().hidden,true);assert.equal(ui.document.querySelectorAll("[data-bb-delivery]").length,0);
});
test("late stop failure cannot overwrite another chat or steal its draft",async t=>{
 const ui=await setup(t),gate=Promise.withResolvers();ui.stop(()=>gate.promise);
 ui.root().querySelector(":scope > button").click();ui.root().querySelector(".bb-conversation-confirm button").click();
 ui.selected.set({currentAgentId:"other"});await tick();gate.reject(new Error("private failure"));await tick();
 assert.equal(ui.root().hidden,true);assert.equal(ui.document.body.textContent.includes("private failure"),false);
 assert.equal(ui.document.querySelector("textarea").value,"Keep my draft");
});
test("connection loss preserves last status but never claims stop succeeded",async t=>{
 const ui=await setup(t);ui.connection.set({transport:"down"});await tick();
 assert.match(ui.root().textContent,/Disconnected/);assert.equal(ui.root().querySelector(":scope > button").disabled,true);
 assert.ok(ui.document.querySelector("[data-bb-delivery]"));assert.equal(ui.calls.length,0);
});
test("virtualized rows remount their status without duplicating badges or mutating text",async t=>{
 const ui=await setup(t);ui.document.querySelector('[data-row-key="nonce:one"]').remove();
 const row=ui.document.createElement("div");row.dataset.rowKey="nonce:one";row.textContent="Original";ui.document.querySelector("main").prepend(row);await tick();
 assert.equal(row.querySelectorAll("[data-bb-delivery]").length,1);assert.equal(row.firstChild.textContent,"Original");
 ui.entries.set(ui.entries.get());await tick();assert.equal(row.querySelectorAll("[data-bb-delivery]").length,1);
});
test("remote Bot selection hides local conversation metadata",async t=>{
 const ui=await setup(t);ui.document.body.dataset.beebotRemoteActive="true";ui.window.dispatchEvent(new ui.window.Event("beebot-node-selection"));await tick();
 assert.equal(ui.root().hidden,true);assert.equal(ui.document.querySelectorAll("[data-bb-delivery]").length,0);
});
test("failed stop stays retryable and never repeats automatically",async t=>{
 const ui=await setup(t);let calls=0;ui.stop(async()=>{calls++;throw new Error("No reply");});
 ui.root().querySelector(":scope > button").click();ui.root().querySelector(".bb-conversation-confirm button").click();await tick();
 assert.match(ui.root().textContent,/Stopping was not confirmed/);assert.equal(calls,1);assert.equal(ui.root().querySelector(".bb-conversation-confirm button").disabled,false);
});

test("artifact and stale-question hints are inline, truthful, and scoped to the current chat",async t=>{
 const ui=await setup(t);const hash="a".repeat(64);
 ui.entries.set({entries:[{id:"handoff",kind:"send-message",message:{type:"attachment",artifact:{availability:"snapshot",bytes:100,sha256:hash}}}]});await tick();
 const badge=ui.document.querySelector("[data-bb-publication]");assert.match(badge.textContent,/Artifact snapshot/);assert.match(badge.textContent,/not an acceptance result/);assert.equal(badge.title,hash);
 ui.entries.set({entries:[{id:"handoff",kind:"send-message",message:{type:"attachment",artifact:{availability:"external-link"}}}]});await tick();assert.match(badge.textContent,/not locally verified/);
 ui.entries.set({entries:[{id:"handoff",kind:"send-message",message:{type:"widget"},decisionStatus:"stale"}]});await tick();assert.match(badge.textContent,/old question is inactive/);assert.equal(ui.document.querySelectorAll("[role=dialog]").length,0);
 ui.selected.set({currentAgentId:"other"});await tick();assert.equal(ui.document.querySelectorAll("[data-bb-publication]").length,0);
});

test("a disposed status binding can mount again on the same live runtime",async t=>{
 const ui=await setup(t);ui.window.__beebotConversationStatus.dispose();
 ui.window.eval("RBindConversationStatus(window.fixtureRuntime)");await tick();
 assert.equal(ui.document.querySelectorAll("#beebot-conversation-status").length,1);
 assert.ok(ui.document.querySelector("[data-bb-delivery]"));
});

const workEntry=(action="claim",state="claimed")=>({id:"handoff",kind:"send-message",author:{id:"b",name:"B"},message:{type:"text",content:"I will handle this"},workEvent:{schema:1,taskId:"assignment",version:2,title:"Quoted input",state,action,actorId:"b",ownerId:"b",requesterId:"a",reviewerId:"a",recipients:[]}});
test("recorded work actions stay inline and never turn a submission into approval",async t=>{
 const ui=await setup(t);ui.entries.set({entries:[workEntry()]});await tick();const badge=ui.document.querySelector("[data-bb-work]");
 assert.match(badge.textContent,/Responsibility claimed/);assert.match(badge.title,/Historical events/);
 ui.entries.set({entries:[workEntry("submit","submitted")]});await tick();assert.match(badge.textContent,/not acceptance/);
 ui.entries.set({entries:[workEntry("review","accepted")]});await tick();assert.match(badge.textContent,/not user approval/);
 ui.entries.set({entries:[workEntry("review","changes_requested")]});await tick();assert.match(badge.textContent,/changes requested/);
 assert.equal(ui.document.querySelectorAll("[role=dialog]").length,0);assert.equal(ui.document.querySelector("textarea").value,"Keep my draft");
});
test("agent text and malformed work event data cannot paint accepted work",async t=>{
 const ui=await setup(t);
 for(const entry of [
   {id:"handoff",kind:"send-message",message:{type:"text",content:"✅ all accepted"}},
   {...workEntry(),workEvent:{...workEntry().workEvent,schema:2}},
   {...workEntry(),workEvent:{...workEntry().workEvent,actorId:"c"}},
   workEntry("submit","accepted"),
   {...workEntry(),workEvent:{...workEntry().workEvent,version:NaN}},
 ]){ui.entries.set({entries:[entry]});await tick();assert.equal(ui.document.querySelector("[data-bb-work]"),null);}
});
test("work events survive virtualization and language changes without touching input or focus",async t=>{
 const ui=await setup(t);ui.entries.set({entries:[workEntry()]});await tick();const input=ui.document.querySelector("textarea");input.focus();
 ui.document.querySelector('[data-row-key="handoff"]').remove();const row=ui.document.createElement("div");row.dataset.rowKey="handoff";row.textContent="Bot: quote the real assignment";ui.document.querySelector("main").prepend(row);await tick();
 assert.equal(row.querySelectorAll("[data-bb-work]").length,1);assert.equal(row.firstChild.textContent,"Bot: quote the real assignment");
 ui.window.__sandUiLanguage="zh";ui.window.dispatchEvent(new ui.window.Event("sand-ui-language-changed"));await tick();
 assert.match(row.textContent,/已接下工作/);assert.equal(ui.document.activeElement,input);assert.equal(input.value,"Keep my draft");
 ui.entries.set(ui.entries.get());await tick();assert.equal(row.querySelectorAll("[data-bb-work]").length,1);
});
test("work metadata is text only and clears on another or remote conversation",async t=>{
 const ui=await setup(t);const entry=workEntry();entry.workEvent.title='<img src=x onerror="window.xss=1">';ui.entries.set({entries:[entry]});await tick();
 assert.equal(ui.document.querySelector("img"),null);assert.equal(ui.window.xss,undefined);
 ui.document.body.dataset.beebotRemoteActive="true";ui.window.dispatchEvent(new ui.window.Event("beebot-node-selection"));await tick();assert.equal(ui.document.querySelector("[data-bb-work]"),null);
 delete ui.document.body.dataset.beebotRemoteActive;ui.window.dispatchEvent(new ui.window.Event("beebot-node-selection"));await tick();assert.ok(ui.document.querySelector("[data-bb-work]"));
 ui.selected.set({currentAgentId:"other"});await tick();assert.equal(ui.document.querySelector("[data-bb-work]"),null);
 ui.window.__beebotConversationStatus.dispose();assert.equal(ui.document.querySelector("[data-bb-work]"),null);
});
