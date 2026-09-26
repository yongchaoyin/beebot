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
test("single and group chats keep routine bookkeeping quiet but show handling failures",async t=>{
 const ui=await setup(t);assert.equal(ui.document.querySelector('[data-row-key="nonce:one"]').textContent,"User message");
 assert.equal(ui.document.querySelectorAll('[data-bb-delivery]').length,0);
 assert.equal(ui.root().querySelector('.bb-conversation-summary').textContent,"Colleagues are working");
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
 assert.equal(ui.document.querySelector("[data-bb-delivery]"),null);assert.equal(ui.calls.length,0);
});
test("virtualized rows remount their status without duplicating badges or mutating text",async t=>{
 const ui=await setup(t);ui.entries.set({entries:[{id:"m1",kind:"message",clientNonce:"one",delivery:{state:"failed",recipients:{a:"failed"}}}]});await tick();
 ui.document.querySelector('[data-row-key="nonce:one"]').remove();
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

test("artifacts keep their original cards without technical banners and stale questions remain visible",async t=>{
 const ui=await setup(t);const hash="a".repeat(64);
 ui.entries.set({entries:[{id:"handoff",kind:"send-message",message:{type:"attachment",artifact:{availability:"snapshot",bytes:100,sha256:hash}}}]});await tick();
 assert.equal(ui.document.querySelector("[data-bb-publication]"),null);
 assert.equal(ui.entries.get().entries[0].message.artifact.sha256,hash);
 assert.equal(ui.document.querySelector('[data-row-key="handoff"]').textContent,"Bot handoff");
 ui.entries.set({entries:[{id:"handoff",kind:"send-message",message:{type:"attachment",artifact:{availability:"external-link"}}}]});await tick();assert.equal(ui.document.querySelector("[data-bb-publication]"),null);
 ui.entries.set({entries:[{id:"handoff",kind:"send-message",message:{type:"widget"},decisionStatus:"stale"}]});await tick();const badge=ui.document.querySelector("[data-bb-publication]");assert.match(badge.textContent,/old question is inactive/);assert.equal(ui.document.querySelectorAll("[role=dialog]").length,0);
 ui.selected.set({currentAgentId:"other"});await tick();assert.equal(ui.document.querySelectorAll("[data-bb-publication]").length,0);
});

test("a disposed status binding can mount again on the same live runtime",async t=>{
 const ui=await setup(t);ui.window.__beebotConversationStatus.dispose();
 ui.window.eval("RBindConversationStatus(window.fixtureRuntime)");await tick();
 assert.equal(ui.document.querySelectorAll("#beebot-conversation-status").length,1);
 assert.equal(ui.document.querySelector("[data-bb-delivery]"),null);
 assert.equal(ui.root().querySelector(":scope > button").hidden,false);
});


test("system response receipts stay quiet while other pending work remains stoppable",async t=>{
 const ui=await setup(t);
 ui.entries.set({entries:[
  {id:"m1",kind:"message",clientNonce:"one",delivery:{state:"replied",recipients:{},systemResponse:{id:"notice-work-status-m1",kind:"recorded-work-status"}}},
  {id:"handoff",kind:"send-message",delivery:{state:"processing",recipients:{b:"processing"}}}
 ]});await tick();
 assert.equal(ui.document.querySelector('[data-bb-delivery="m1"]'),null);
 assert.equal(ui.root().querySelector(":scope > button").hidden,false);
 assert.equal(ui.root().querySelector('.bb-conversation-summary').textContent,"Colleagues are working");
 assert.equal(ui.document.querySelector('textarea').value,"Keep my draft");
 assert.equal(ui.document.querySelectorAll('[role="dialog"]').length,0);
 ui.window.__sandUiLanguage="zh";ui.window.dispatchEvent(new ui.window.Event("sand-ui-language-changed"));await tick();
 assert.equal(ui.document.querySelector('[data-bb-delivery="m1"]'),null);
 assert.equal(ui.root().querySelector(":scope > button").textContent,"停止此会话的工作");
 ui.selected.set({currentAgentId:"other"});await tick();
 assert.equal(ui.document.querySelectorAll('[data-bb-delivery]').length,0);
});

test("a group member failure remains visible while a colleague is still processing",async t=>{
 const ui=await setup(t);
 ui.entries.set({entries:[{id:"m1",kind:"message",clientNonce:"one",delivery:{state:"processing",recipients:{a:"processing",b:"failed"}}}]});await tick();
 const badge=ui.document.querySelector('[data-bb-delivery="m1"]');
 assert.equal(badge.textContent,"B · Handling failed; message retained");assert.equal(badge.dataset.state,"failed");
 assert.equal(ui.root().querySelector(":scope > button").hidden,false);
 ui.entries.set({entries:[{id:"m1",kind:"message",clientNonce:"one",delivery:{state:"replied",recipients:{a:"replied",b:"replied"}}}]});await tick();
 assert.equal(ui.document.querySelector('[data-bb-delivery]'),null);assert.equal(ui.root().hidden,true);
});

test("second and third sends leave the single and group composer usable without receipt clutter",async t=>{
 for(const recipients of [{a:"processing"},{a:"processing",b:"queued"}]) {
  const ui=await setup(t),draft=ui.document.querySelector('textarea');draft.focus();
  const messages=[1,2,3].map(index=>({id:`m${index}`,kind:"message",clientNonce:`send-${index}`,delivery:{state:"processing",recipients}}));
  for(let count=1;count<=3;count++){
   ui.entries.set({entries:messages.slice(0,count)});await tick();
   assert.equal(ui.document.querySelectorAll('[data-bb-delivery]').length,0);
   assert.equal(ui.document.activeElement,draft);assert.equal(draft.value,"Keep my draft");
   assert.equal(ui.root().querySelector(":scope > button").hidden,false);
  }
  assert.equal(ui.calls.length,0);
 }
});

test("switching to a remote Bot fences a stale local stop confirmation before rendering",async t=>{
 const ui=await setup(t);ui.root().querySelector(":scope > button").click();
 const confirm=ui.root().querySelector(".bb-conversation-confirm button");
 ui.document.body.dataset.beebotRemoteActive="true";
 ui.window.dispatchEvent(new ui.window.Event("beebot-node-selection"));
 confirm.click();
 assert.equal(ui.calls.length,0,"remote selection must never invoke the hidden local conversation's stop");
 await tick();
 ui.document.body.dataset.beebotRemoteActive="false";ui.window.dispatchEvent(new ui.window.Event("beebot-node-selection"));await tick();
 assert.equal(ui.root().querySelector(".bb-conversation-confirm").hidden,true);
});

test("late local stop results cannot restore an obsolete confirmation after a remote detour",async t=>{
 const ui=await setup(t),gate=Promise.withResolvers();ui.stop(()=>gate.promise);
 ui.root().querySelector(":scope > button").click();ui.root().querySelector(".bb-conversation-confirm button").click();
 ui.document.body.dataset.beebotRemoteActive="true";ui.window.dispatchEvent(new ui.window.Event("beebot-node-selection"));await tick();
 ui.document.body.dataset.beebotRemoteActive="false";ui.window.dispatchEvent(new ui.window.Event("beebot-node-selection"));await tick();
 gate.reject(new Error("Old stop outcome"));await tick();
 assert.equal(ui.root().querySelector(".bb-conversation-confirm").hidden,true);
 assert.equal(ui.root().querySelector(".bb-conversation-feedback").textContent,"");
});

test("rapidly leaving and returning before render still invalidates the old stop intent",async t=>{
 const ui=await setup(t);ui.root().querySelector(":scope > button").click();
 const confirm=ui.root().querySelector(".bb-conversation-confirm button");
 ui.selected.set({currentAgentId:"other"});ui.selected.set({currentAgentId:"room"});confirm.click();
 assert.equal(ui.calls.length,0);await tick();
 assert.equal(ui.root().querySelector(".bb-conversation-confirm").hidden,true);
});
