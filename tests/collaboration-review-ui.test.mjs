import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {Window} from "happy-dom";
const source=await readFile(new URL("../scripts/lib/beebot-collaboration-review.snippet.js",import.meta.url),"utf8");
const tick=()=>new Promise(resolve=>setTimeout(resolve,70));
function store(value){const subs=new Set();return{get:()=>value,set:next=>{value=next;subs.forEach(fn=>fn());},subscribe:fn=>{subs.add(fn);return()=>subs.delete(fn);}};}
function task(overrides={}){return{id:"t0s0",title:"引用回复与连续发送",criteria:["引用不串会话","第二、第三条消息能处理"],state:"review",version:3,reviewer:"user",assignee:"b",canReview:true,reviewToken:"a".repeat(64),submission:{id:"t0s3",resultIds:["t0s2"],manifest:[]},evidence:[{id:"t0s2",text:"Reviewed source and test outputs",available:true,files:[]}],...overrides};}
async function boot(t){
 const window=new Window({url:"https://beebot.local"});window.__sandUiLanguage="zh";
 window.document.body.innerHTML='<main><div class="messages">Original discussion</div><div class="sand-chat-input-dock"><textarea id="chat">Keep my draft</textarea></div></main>';
 const selected=store({currentAgentId:"room"}),entries=store({entries:[]}),connection=store({transport:"up"}),calls=[];
 let tasks=[task()],get=async({agentId})=>({agentId,tasks,completions:[]}),review=async input=>{calls.push(structuredClone(input));return{saved:true};};
 const runtime={selection:{snapshots:selected},transcript:{snapshotsFor:()=>entries},connection:{snapshots:connection},roster:{snapshots:store({agents:{rows:[]}}),getCollaboration:args=>get(args),reviewCollaboration:args=>review(args)}};
 window.runtime=runtime;window.eval(source+';RBindCollaborationReview(window.runtime);');t.after(async()=>{window.__beebotCollaborationReview?.dispose();await window.happyDOM.close();});await tick();
 const root=()=>window.document.querySelector("#beebot-collaboration-review");
 const expand=()=>root().querySelector(":scope>button").click();
 const choose=(value="pass")=>{for(const select of root().querySelectorAll("select")){select.value=value;select.dispatchEvent(new window.Event("change"));}};
 return{window,root,selected,entries,connection,calls,expand,choose,get:fn=>get=fn,review:fn=>review=fn,tasks:next=>tasks=next,refresh:()=>[...root().children].at(-1).click()};
}
test("review appears inline in both conversations and never replaces the draft",async t=>{
 const ui=await boot(t);assert.equal(ui.root().parentElement.className,"sand-chat-input-dock");assert.match(ui.root().textContent,/1 项待你验收/);ui.expand();
 assert.equal(ui.window.document.querySelectorAll('[role="dialog"]').length,0);assert.equal(ui.window.document.querySelector("#chat").value,"Keep my draft");
 assert.match(ui.root().textContent,/第二、第三条消息/);assert.equal(ui.calls.length,0);
});
test("acceptance requires every criterion and uses one exact submission/version",async t=>{
 const ui=await boot(t);ui.expand();ui.root().querySelector(".bb-work-actions button").click();await tick();assert.equal(ui.calls.length,0);
 ui.choose();ui.root().querySelector(".bb-work-actions button").click();await tick();assert.equal(ui.calls.length,1);
 assert.equal(ui.calls[0].agentId,"room");assert.equal(ui.calls[0].review.submission_id,"t0s3");assert.equal(ui.calls[0].review.expected_version,3);assert.equal(ui.calls[0].review.checks.length,2);
 assert.equal(ui.calls[0].review.checks.every(c=>c.passed),true);assert.equal("actor" in ui.calls[0],false);
});
test("changes need an explicit failed criterion and explanatory note",async t=>{
 const ui=await boot(t);ui.expand();ui.choose();ui.root().querySelectorAll(".bb-work-actions button")[1].click();await tick();assert.equal(ui.calls.length,0);
 const select=ui.root().querySelector("select");select.value="fail";select.dispatchEvent(new ui.window.Event("change"));
 ui.root().querySelectorAll(".bb-work-actions button")[1].click();await tick();assert.equal(ui.calls.length,0);
 const note=ui.root().querySelector(".bb-work-check textarea");note.value="Switching rooms still changes the quote";note.dispatchEvent(new ui.window.Event("input"));
 ui.root().querySelectorAll(".bb-work-actions button")[1].click();await tick();assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].review.verdict,"changes");
});
test("repeated clicks and failed receipt retries reuse the original intent",async t=>{
 const ui=await boot(t),gate=Promise.withResolvers(),requests=[];ui.review(args=>{requests.push(args);return gate.promise;});ui.expand();ui.choose();
 const button=ui.root().querySelector(".bb-work-actions button");button.click();button.click();assert.equal(requests.length,1);
 gate.reject(new Error("Acknowledgement lost"));await tick();assert.match(ui.root().textContent,/尚未确认保存/);assert.equal(requests.length,1);
 ui.review(async args=>{requests.push(args);return{saved:true,replayed:true};});button.click();await tick();assert.equal(requests.length,2);assert.equal(requests[0].review.request_id,requests[1].review.request_id);
});
test("a chat switch blocks old clicks immediately and ignores late failure",async t=>{
 const ui=await boot(t),gate=Promise.withResolvers();ui.expand();ui.choose();const button=ui.root().querySelector(".bb-work-actions button");
 ui.selected.set({currentAgentId:"other"});button.click();assert.equal(ui.calls.length,0);await tick();
 ui.expand();ui.choose();ui.review(()=>gate.promise);ui.root().querySelector(".bb-work-actions button").click();ui.selected.set({currentAgentId:"third"});gate.reject(new Error("Private details"));await tick();
 assert.equal(ui.root().textContent.includes("Private details"),false);assert.equal(ui.window.document.querySelector("#chat").value,"Keep my draft");
});
test("remote chat hides local work; returning restores verified state without automatic action",async t=>{
 const ui=await boot(t);ui.window.document.body.dataset.beebotRemoteActive="true";ui.window.dispatchEvent(new ui.window.Event("beebot-node-selection"));assert.equal(ui.root().hidden,true);
 delete ui.window.document.body.dataset.beebotRemoteActive;ui.window.dispatchEvent(new ui.window.Event("beebot-node-selection"));await tick();assert.equal(ui.root().hidden,false);assert.equal(ui.calls.length,0);
});
test("disconnect and malformed status disable acceptance without discarding input",async t=>{
 const ui=await boot(t);ui.expand();ui.choose();ui.connection.set({transport:"down"});await tick();assert.equal(ui.root().querySelector(".bb-work-actions button").disabled,true);
 ui.connection.set({transport:"up"});ui.get(async()=>({agentId:"room",tasks:[{}],completions:[]}));await tick();assert.match(ui.root().textContent,/无法核对工作状态/);
 assert.equal(ui.root().querySelector(".bb-work-actions button").disabled,true);assert.equal(ui.root().querySelector("select").value,"pass");
});
test("status refresh and language switching preserve focused criterion input",async t=>{
 const ui=await boot(t);ui.expand();const note=ui.root().querySelector(".bb-work-check textarea");note.value="draft review";note.focus();
 ui.window.__sandUiLanguage="en";ui.window.dispatchEvent(new ui.window.Event("sand-ui-language-changed"));ui.refresh();await tick();
 assert.equal(ui.window.document.activeElement,note);assert.equal(note.value,"draft review");assert.match(ui.root().textContent,/Accept this version/);
});
test("a late status cannot overwrite a newer selection or version",async t=>{
 const ui=await boot(t),gate=Promise.withResolvers();ui.get(()=>gate.promise);ui.refresh();
 ui.tasks([task({version:4,title:"New version"})]);ui.get(async({agentId})=>({agentId,tasks:[task({version:4,title:"New version"})],completions:[]}));
 ui.entries.set({entries:[{id:"new",collaborationEvent:{task:{version:4}}}]});await tick();
 gate.resolve({agentId:"room",tasks:[task({title:"Old version"})],completions:[]});await tick();ui.expand();assert.match(ui.root().textContent,/New version/);assert.equal(ui.root().textContent.includes("Old version"),false);
});
test("work descriptions and evidence are text, never executable markup",async t=>{
 const ui=await boot(t);ui.tasks([task({title:'<img src=x onerror="alert(1)">',evidence:[{id:"e",text:"<script>window.bad=1</script>",available:true,files:[]}]})]);ui.refresh();await tick();ui.expand();
 assert.equal(ui.root().querySelector("img,script"),null);assert.equal(ui.window.bad,undefined);
});


test("isolated renderer without randomUUID still creates a secure unique review identity",async t=>{
 const ui=await boot(t);Object.defineProperty(ui.window.crypto,"randomUUID",{value:undefined,configurable:true});ui.expand();ui.choose();
 ui.root().querySelector(".bb-work-actions button").click();await tick();
 assert.equal(ui.calls.length,1);assert.match(ui.calls[0].review.request_id,/^[a-f0-9]{32}$/);
});
test("finish receipts distinguish current recorded work from an obsolete finish",async t=>{
 const ui=await boot(t);ui.get(async()=>({agentId:"room",tasks:[task()],completions:[{current:true}]}));ui.refresh();await tick();
 assert.match(ui.root().textContent,/1 项交付已核对当前已记录工作/);
 ui.get(async()=>({agentId:"room",tasks:[task()],completions:[{current:false}]}));ui.refresh();await tick();
 assert.match(ui.root().textContent,/此前交付的工作范围或版本已变化/);
});

test("legacy evidence review is shown as re-verification, not falsely blamed on dependencies",async t=>{
 const ui=await boot(t);ui.tasks([task({state:"accepted",acceptedForCurrentInputs:false,reviewNeedsRefresh:true})]);
 ui.refresh();await tick();ui.expand();
 assert.match(ui.root().textContent,/历史验收缺少版本依据，请重新核对/);
 assert.doesNotMatch(ui.root().textContent,/依赖已变化/);
 assert.equal(ui.window.document.querySelectorAll('[role="dialog"]').length,0);
 assert.equal(ui.calls.length,0,"opening historical evidence never triggers acceptance");
 ui.choose();ui.root().querySelector('.bb-work-actions button').click();await tick();
 assert.equal(ui.calls.length,1);
});
