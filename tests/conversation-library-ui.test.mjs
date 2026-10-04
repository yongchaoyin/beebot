import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {Window} from "happy-dom";
import {conversationLibrarySnippet as source,patchConversationLibraryHost} from "../scripts/lib/conversation-library-renderer-patch.mjs";
const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
function store(value){const subs=new Set();return{get:()=>value,set:next=>{value=next;subs.forEach(fn=>fn());},subscribe:fn=>{subs.add(fn);return()=>subs.delete(fn);},subscriptions:()=>subs.size};}
const send=(id,message,extra={})=>({kind:"send-message",id,message,timestampMs:Date.UTC(2026,9,4,3),...extra});
const attachment=(id,url="file:///workspace/attachments/report.md",extra={})=>send(id,{type:"attachment",url,file_name:"Report",...extra});
const text=(id,content,extra={})=>send(id,{type:"text",content},extra);
async function boot(t,options={}){
 const window=new Window({url:"https://beebot.local"});window.__sandUiLanguage="zh";
 window.document.body.innerHTML='<main><div class="messages">Original conversation</div><textarea id="draft">Keep my draft</textarea><aside class="sand-info-pane" aria-hidden="false"><div class="sand-info-pane__section-content" data-beebot-library-host="bot"></div></aside></main>';
 const selected=store({currentAgentId:"bot"}),entries=new Map(),roster=store({agents:{rows:[{id:"bot",name:"Writer"},{id:"peer",name:"Research"},{id:"group",name:"Team",isGroup:true}]}}),connection=store({transport:"up"}),calls=[];
 const getEntries=id=>{if(!entries.has(id))entries.set(id,store({entries:[],hasOlder:false,installGeneration:1}));return entries.get(id);};
 let read=options.read??(async()=>({kind:"text",text:"Shared report content",truncated:false})),open=async()=>{},older=async()=>{},media=async()=>null;
 const runtime={selection:{snapshots:selected},transcript:{snapshotsFor:getEntries,loadOlder:id=>{calls.push(["older",id]);return older(id);}},roster:{snapshots:roster},connection:{snapshots:connection},desktop:{readAttachmentText:args=>{calls.push(["text",JSON.parse(JSON.stringify(args))]);return read(args);},resolveAttachmentMedia:args=>{calls.push(["media",JSON.parse(JSON.stringify(args))]);return media(args);},openExternal:args=>{calls.push(["open",JSON.parse(JSON.stringify(args))]);return open(args);}}};
 getEntries("bot").set({entries:options.entries??[attachment("result")],hasOlder:!!options.hasOlder,installGeneration:1});
 window.runtime=runtime;window.eval(source+";RBindConversationLibrary(window.runtime);");await tick();
 t.after(async()=>{window.__beebotConversationLibrary?.dispose();await window.happyDOM.close();});
 return {window,runtime,selected,roster,connection,entries:getEntries,calls,root:()=>window.document.getElementById("beebot-conversation-library"),read:fn=>read=fn,open:fn=>open=fn,older:fn=>older=fn,media:fn=>media=fn,update:async(id,values,extra={})=>{getEntries(id).set({entries:values,hasOlder:false,installGeneration:1,...extra});await tick();},select:async id=>{window.document.querySelector("[data-beebot-library-host]").setAttribute("data-beebot-library-host",id);selected.set({currentAgentId:id});await tick();},click:async index=>{window.document.querySelectorAll(".bb-library-open")[index??0]?.click();await tick();}};
}
const project=(window,snapshot)=>{window.snapshot=snapshot;return JSON.parse(window.eval('JSON.stringify(RProjectConversationLibrary(window.snapshot,"bot"))'));};

test("only real public sent entries enter the library; private text, previews, failed sends and receipts stay out",async t=>{
 const ui=await boot(t);const entries=[
  {kind:"message",id:"private",role:"assistant",content:"[Secret](https://private.example)"},
  {kind:"notice",id:"receipt",text:"Created [planned file](file:///private/file.md)"},
  {kind:"tool-call",id:"tool",result:"https://tool.example"},
  text("live","https://stream.example",{streaming:true}),text("failed","https://failed.example",{delivery:"failed"}),text("uncertain","https://uncertain.example",{delivery:{state:"needs-review"}}),text("branch","https://branch.example",{branched:true}),text("pending","https://pending.example"),text("rejected","https://rejected.example"),send("external",{type:"text",content:"https://external.example",channel:"slack"}),
  text("sent","[Useful](https://example.com/report)"),attachment("file"),
 ];
 const result=project(ui.window,{entries,pendingEntryIds:new Set(["pending"]),failedEntryIds:new Set(["rejected"])});
 assert.deepEqual(result.map(item=>item.sourceEntryId),["file","sent"]);assert.equal(result[0].kind,"page");assert.equal(result[1].kind,"link");
 assert.equal(ui.calls.length,0,"collecting never reads files or fetches links");
});

test("single Bot and Group share the real public message collection and retain author/source/version provenance",async t=>{
 const ui=await boot(t);
 for(const id of ["bot","group"]){await ui.select(id);await ui.update(id,[attachment("v1"),attachment("v2",undefined),text("link","[Reference](https://example.com)",{author:{id:"peer",name:"Old name"}})]);assert.equal(ui.root().hidden,false);assert.equal(ui.root().querySelectorAll("article").length,3);assert.match(ui.root().textContent,/Research/);await ui.click(0);assert.match(ui.root().textContent,/来源消息/);assert.match(ui.root().textContent,/Reference/);assert.equal(ui.window.document.querySelector("#draft").value,"Keep my draft");assert.equal(ui.selected.get().currentAgentId,id);}
});

test("library opens page/file previews through existing attachment reads, safely as text, and retains ordinary transcript cards",async t=>{
 const ui=await boot(t,{entries:[attachment("page","file:///workspace/attachments/report.html")]});ui.read(async()=>({kind:"text",text:'<script>window.leaked=true</script><h1>Report</h1>',truncated:true}));
 await ui.click();assert.deepEqual(ui.calls,[["text",{path:"file:///workspace/attachments/report.html"}]]);assert.match(ui.root().querySelector("pre").textContent,/<script>/);assert.equal(ui.root().querySelector("script,iframe"),null);assert.equal(ui.window.leaked,undefined);assert.match(ui.root().textContent,/部分预览/);assert.match(ui.window.document.querySelector(".messages").textContent,/Original conversation/);
});

test("published safe http links open only on explicit click; file targets never go to external shell",async t=>{
 const ui=await boot(t,{entries:[text("link","[Useful](https://example.com/report)")]});await ui.click();assert.equal(ui.calls.length,0);ui.root().querySelector(".bb-library-link").click();await tick();assert.deepEqual(ui.calls,[["open",{url:"https://example.com/report"}]]);
 await ui.update("bot",[attachment("file")]);await ui.click();assert.equal(ui.root().querySelector(".bb-library-link"),null);assert.equal(ui.calls.filter(([kind])=>kind==="open").length,1);
});

test("unsafe URL schemes, file hosts, credentials, control characters and code examples are rejected",async t=>{
 const ui=await boot(t);ui.window.values=["javascript:alert(1)","data:text/html,hello","file://remote-host/share/a.md","https://user:pass@example.com","//remote/share","file:///a.md?run=1","file:///a.md#run","https://example.com/\nprivate","sand://box"];
 assert.equal(ui.window.eval("window.values.some(value=>RLibraryTarget(value)!==null)"),false);
 const result=project(ui.window,{entries:[text("body",'```\nhttps://code.example\n```\n`https://inline.example`\n[Safe](https://example.com/safe)\nhttps://example.com/safe.'),attachment("bad","javascript:alert(1)")]});
 assert.equal(result.length,1);assert.equal(result[0].title,"Safe");
});

test("failed file/link preview preserves selected conversation and draft, with no auto-retry",async t=>{
 const ui=await boot(t);ui.read(async()=>{throw Error("private server path and credential");});await ui.click();assert.match(ui.root().textContent,/预览暂不可用/);assert.doesNotMatch(ui.root().textContent,/credential|private server path/);assert.equal(ui.selected.get().currentAgentId,"bot");assert.equal(ui.window.document.querySelector("#draft").value,"Keep my draft");await tick();assert.equal(ui.calls.length,1);
 await ui.update("bot",[text("link","https://example.com")]);ui.open(async()=>{throw Error("private auth");});await ui.click();ui.root().querySelector(".bb-library-link").click();await tick();assert.match(ui.root().textContent,/链接未能打开/);assert.doesNotMatch(ui.root().textContent,/private auth/);
});

test("a late preview cannot cross conversation, connection generation, pane close, or transcript install generation",async t=>{
 for(const boundary of ["conversation","connection","pane","install"]){const ui=await boot(t);const gate=Promise.withResolvers();ui.read(()=>gate.promise);await ui.click();
  if(boundary==="conversation"){await ui.select("group");await ui.update("group",[text("group-link","https://new.example")]);}
  if(boundary==="connection")ui.connection.set({transport:"down"});
  if(boundary==="pane")ui.window.document.querySelector(".sand-info-pane").setAttribute("aria-hidden","true");
  if(boundary==="install")await ui.update("bot",[attachment("result")],{installGeneration:2});
  await tick();gate.resolve({kind:"text",text:"Old private preview"});await tick();assert.doesNotMatch(ui.root().textContent,/Old private preview/);assert.equal(ui.window.document.querySelector("#draft").value,"Keep my draft");}
});

test("remote selection never displays the local catalog or performs a local file read",async t=>{
 const ui=await boot(t);ui.window.document.body.dataset.beebotRemoteActive="true";ui.window.dispatchEvent(new ui.window.Event("beebot-node-selection"));await tick();assert.equal(ui.root().hidden,true);assert.equal(ui.root().querySelectorAll("article").length,0);assert.equal(ui.entries("bot").subscriptions(),0);await ui.click();assert.equal(ui.calls.length,0);
 delete ui.window.document.body.dataset.beebotRemoteActive;ui.window.dispatchEvent(new ui.window.Event("beebot-node-selection"));await tick();assert.equal(ui.root().querySelectorAll("article").length,1);
});

test("loading earlier results uses read-only conversation paging, ignores late results and recovers after failure",async t=>{
 const ui=await boot(t,{hasOlder:true});const gate=Promise.withResolvers();ui.older(()=>gate.promise);ui.root().querySelector(".bb-library-older").click();await tick();assert.equal(ui.root().querySelector(".bb-library-older").disabled,true);await ui.select("group");gate.reject(Error("private path"));await tick();assert.doesNotMatch(ui.root().textContent,/private path|较早的记录暂不可用/);assert.deepEqual(ui.calls,[["older","bot"]]);
 await ui.select("bot");await ui.update("bot",[attachment("result")],{hasOlder:true});ui.older(async()=>{throw Error("private path");});ui.root().querySelector(".bb-library-older").click();await tick();assert.match(ui.root().textContent,/较早的记录暂不可用/);assert.equal(ui.root().querySelector(".bb-library-older").disabled,false);
 ui.older(async()=>{await ui.update("bot",[attachment("old"),attachment("result")]);});ui.root().querySelector(".bb-library-older").click();await tick();assert.equal(ui.root().querySelectorAll("article").length,2);assert.doesNotMatch(ui.root().textContent,/较早的记录暂不可用/);
});

test("language/type filters retain focused controls and draft across single-Bot and Group second and third sends",async t=>{
 const ui=await boot(t);for(const id of ["bot","group"]){await ui.select(id);await ui.update(id,[text("working","https://uncommitted.example",{streaming:true}),attachment("first")]);const button=ui.root().querySelector('[data-filter="file"]');button.click();button.focus();
  for(const n of [2,3])await ui.update(id,[text("working","https://uncommitted.example",{streaming:true}),attachment("first"),...Array.from({length:n-1},(_,i)=>attachment("follow-up-"+i,"file:///workspace/attachments/report-"+i+".txt"))]);
  assert.equal(ui.root().querySelectorAll("article").length,3);assert.equal(ui.window.document.activeElement,button);assert.equal(ui.window.document.querySelector("#draft").value,"Keep my draft");assert.doesNotMatch(ui.root().textContent,/uncommitted/);}
 ui.window.__sandUiLanguage="en";ui.window.dispatchEvent(new ui.window.Event("sand-ui-language-changed"));assert.match(ui.root().textContent,/Library/);assert.equal(ui.root().querySelector('[data-filter="file"]').textContent,"Files");
});

test("the bounded collection retains newest deliveries and does not invent a missing timestamp",async t=>{
 const ui=await boot(t);const records=Array.from({length:2001},(_,index)=>attachment("result-"+index));delete records.at(-1).timestampMs;
 const result=project(ui.window,{entries:records});assert.equal(result.length,2000);assert.equal(result[0].sourceEntryId,"result-2000");assert.equal(result[0].timestampMs,null);assert.equal(result.some(item=>item.sourceEntryId==="result-0"),false);
});

test("dispose releases subscriptions and replacement runtime cannot retain private catalog items",async t=>{
 const ui=await boot(t);ui.window.__beebotConversationLibrary.dispose();assert.equal(ui.root(),null);assert.equal(ui.entries("bot").subscriptions(),0);await ui.update("bot",[text("new","https://private.example")]);assert.equal(ui.root(),null);
});

test("the actual pinned renderer receives a conversation-owned overview host and rejects drift",async()=>{
 const pinned=await readFile(new URL("../src/app/dist/renderer/assets/index-UbX-y3il.js",import.meta.url),"utf8");const patched=patchConversationLibraryHost(pinned);assert.equal(patched.split('"data-beebot-library-host":t.id').length,2);assert.equal(patchConversationLibraryHost(patched),patched);assert.throws(()=>patchConversationLibraryHost("missing baseline"),/drifted/);
});
