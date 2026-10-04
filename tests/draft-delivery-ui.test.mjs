import assert from "node:assert/strict";
import test,{after} from "node:test";
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {createRequire} from "node:module";
import {build} from "esbuild";
import {Window} from "happy-dom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
const bootstrapWindow=new Window();
Object.assign(globalThis,{window:bootstrapWindow,document:bootstrapWindow.document,HTMLElement:bootstrapWindow.HTMLElement});
const {createRoot}=await import("react-dom/client");
after(()=>bootstrapWindow.happyDOM.close());
import {draftDeliverySnippet,patchDraftDeliveryChunks,patchDraftDeliveryRenderer} from "../scripts/lib/draft-delivery-renderer-patch.mjs";
const root=path.resolve(import.meta.dirname,".."),dir=mkdtempSync(path.join(tmpdir(),"bb-draft-ui-"));after(()=>rmSync(dir,{recursive:true,force:true}));
const entryFile=path.join(dir,"host.ts"),outfile=path.join(dir,"host.cjs");
writeFileSync(entryFile,["host/extensions/transcript/draft-delivery","host/extensions/session/agent-session","host/extensions/transcript/group-chat-glue","host/groups/group-store"].map(p=>`export * from ${JSON.stringify(path.join(root,"source",p+".ts"))}`).join("\n"));
await build({entryPoints:[entryFile],outfile,bundle:true,platform:"node",format:"cjs",target:"node26",logLevel:"silent",external:["tree-sitter","tree-sitter-bash"]});const host=createRequire(import.meta.url)(outfile);
function store(value){const listeners=new Set();return {get:()=>value,set:next=>{value=next;listeners.forEach(fn=>fn());},subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};}
function wrapper(kind,window){
 const name=kind==="email"?"Ms":"vs",file=kind==="email"?"view-ClhdNXKM.js":"view-DyaeCHiE.js",source=patchDraftDeliveryChunks(readFileSync(path.join(root,"src/app/dist/renderer/assets",file),"utf8"),kind),start=source.indexOf(`function ${name}(`),end=source.indexOf(`export{${name} as default};`,start),body=source.slice(start,end);
 const Frame=({children,className})=>jsx.jsx("section",{className,children}),Outer=({children})=>jsx.jsx(React.Fragment,{children});
 return new Function("window","e","as","rs","bs","ps","ks","js",body+`;return ${name};`)(window,jsx,React,React,Frame,Frame,Outer,Outer);
}
const slackTool={name:"slack:send",toolName:"slack_post_message",providerIdentifier:"slack",senderLabel:"Product team",inputSchema:{type:"object",properties:{channel_id:{type:"string"},text:{type:"string"}},required:["channel_id","text"]}};
const emailTool={name:"email:send",toolName:"declared-email",providerIdentifier:"email",senderLabel:"Fixture account",inputSchema:{type:"object","x-beebot-draft-delivery":{version:1,kind:"email"},properties:{from:{type:"string"},to:{type:"array",items:{type:"string"}},cc:{type:"array",items:{type:"string"}},subject:{type:"string"},body:{type:"string"}},required:["to","subject","body"]}};
const messages={email:{type:"email-draft",draft:{from:"a@example.test",to:["old@example.test"],subject:"Draft",body:"Original body"}},slack:{type:"slack-draft",draft:{workspace:"Product",target:"C123456789",body:"Original body"}}};
async function setup(t,{group=false,kind="slack",executor,tools=[slackTool,emailTool],snapshot}={}){
 const window=new Window({url:"https://beebot.test",settings:{enableJavaScriptEvaluation:true,suppressInsecureJavaScriptEnvironmentWarning:true}});const previous={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,HTMLElement:globalThis.HTMLElement};
 Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});Object.defineProperty(globalThis,"navigator",{value:window.navigator,configurable:true});
 const databaseDir=mkdtempSync(path.join(dir,"case-")),sessionStore=new host.SandAgentSessionStore(path.join(databaseDir,"agents")),a=await sessionStore.createSession({name:"A"}),b=await sessionStore.createSession({name:"B"}),room=group?await sessionStore.createSession({name:"Group"}):a;
 if(group)host.writeSandGroupConfig(path.dirname(room.dbPath),{version:1,memberIds:[a.id,b.id]});
 const sessions=new Map([a,b,room].map(s=>[s.id,s])),selection=store({currentAgentId:room.id}),connection=store({transport:"up",authenticationGeneration:1}),calls=[];
 const tm={sessionStore,sessions:{isAgentGone:()=>false,resolveBackgroundSession:async id=>sessions.get(id)},roster:{emit(){}}};tm.groupChat=new host.GroupChatGlue(tm);const service=new host.DraftDelivery(tm);
 service.configure({listTools:async()=>tools,executeTool:async request=>{calls.push(request);if(executor)return executor(request);return request.providerIdentifier==="email"?{result:{case:"success",value:{structuredContent:{sent:true,messageId:"fixture-id"}}}}:{result:{case:"success",value:{content:[{content:{case:"text",value:{text:JSON.stringify({ok:true,channel:request.args.channel_id,ts:"123.456",message:{text:request.args.text}})}}}]}}};}});
 const runtime={selection:{snapshots:selection},connection:{snapshots:connection},roster:{getDraftDelivery:snapshot||((args)=>service.snapshot(args)),resolveDraftDelivery:args=>service.action(args)}};
 window.eval(draftDeliverySnippet()+";window.__testBind=RBindDraftDelivery;");window.__testBind(runtime);window.document.body.innerHTML='<main id="app"></main><textarea id="conversation-draft">preserve conversation draft</textarea>';
 const renderRoot=createRoot(window.document.getElementById("app")),Card=wrapper(kind,window);
 const add=id=>{const entry={id,kind:"send-message",message:messages[kind],timestampMs:1,...(group?{author:{id:a.id,name:"A"}}:{})};room.db.appendTranscriptEntry(entry);return entry;};
 const render=async(entry,language="en")=>{window.__sandUiLanguage=language;await React.act(async()=>{renderRoot.render(jsx.jsx(Card,{entry,adjacency:{isGroupStart:true}}));window.dispatchEvent(new window.Event("sand-ui-language-changed"));});for(let i=0;i<100&&window.document.querySelector(".bb-draft")?.getAttribute("aria-busy")==="true";i++)await React.act(async()=>new Promise(r=>setTimeout(r,2)));};
 t.after(async()=>{await React.act(async()=>renderRoot.unmount());window.__beebotDraftDeliveryRuntime.dispose();await window.happyDOM.close();for(const s of sessions.values())s.db.close();Object.assign(globalThis,{window:previous.window,document:previous.document,HTMLElement:previous.HTMLElement});Object.defineProperty(globalThis,"navigator",{value:previous.navigator,configurable:true});});
 return {window,document:window.document,service,room,a,b,selection,connection,calls,runtime,add,render};
}
async function input(h,selector,value){await React.act(async()=>{const element=h.document.querySelector(selector);const setter=Object.getOwnPropertyDescriptor(element.tagName==="TEXTAREA"?h.window.HTMLTextAreaElement.prototype:h.window.HTMLInputElement.prototype,"value").set;setter.call(element,value);element.dispatchEvent(new h.window.Event("input",{bubbles:true}));element.dispatchEvent(new h.window.Event("change",{bubbles:true}));});}
async function click(h,selector){await React.act(async()=>h.document.querySelector(selector).click());for(let i=0;i<100&&h.document.querySelector(".bb-draft")?.getAttribute("aria-busy")==="true";i++)await React.act(async()=>new Promise(r=>setTimeout(r,2)));}
for(const group of [false,true])for(const kind of ["email","slack"]){
 test(`actual lazy ${kind} card, ${group?"Group":"Bot"}: edited first/second/third sends persist and retain the chat draft`,async t=>{
  const h=await setup(t,{group,kind});
  for(const id of ["first","second","third"]){await h.render(h.add(id));assert.equal(h.document.querySelector('button[type=submit]').disabled,false);await input(h,"textarea[aria-label=Message]",`Edited ${id}`);if(kind==="email"){await input(h,"input[aria-label=To]","new@example.test");await input(h,"input[aria-label=Subject]",`Subject ${id}`);}await click(h,'button[type=submit]');assert.match(h.document.getElementById("app").textContent,/Sent/);assert.equal(h.room.db.getEntryById(id).message.draft.body,`Edited ${id}`);assert.equal(h.calls.at(-1).agentId,h.a.id);}
  assert.equal(h.calls.length,3);assert.equal(h.document.getElementById("conversation-draft").value,"preserve conversation draft");
 });
}
test("actual cards require verified snapshot and receipt, and rejected actions retain edits for read-only recovery",async t=>{
 const h=await setup(t,{kind:"email",executor:()=>({result:{case:"success",value:{}}})});await h.render(h.add("unknown"),"zh");await input(h,"textarea[aria-label='消息内容']","编辑后保留的正文");await click(h,'button[type=submit]');assert.match(h.document.getElementById("app").textContent,/需要核查/);assert.doesNotMatch(h.document.getElementById("app").textContent,/已发送/);assert.equal(h.document.querySelector("textarea[aria-label='消息内容']").value,"编辑后保留的正文");assert.equal(h.document.querySelector('button[type=submit]').disabled,true);assert.equal(h.calls.length,1);
});
test("actual cards persist discard without calling executor, and unavailable connector still permits discard",async t=>{
 const h=await setup(t,{tools:[],kind:"slack"});await h.render(h.add("d"));assert.match(h.document.getElementById("app").textContent,/No connected sender/);assert.equal(h.document.querySelector('button[type=submit]').disabled,true);const discard=[...h.document.querySelectorAll("button")].find(b=>b.textContent==="Discard");assert.equal(discard.disabled,false);await React.act(async()=>discard.click());assert.match(h.document.getElementById("app").textContent,/Discarded/);assert.equal(h.room.db.getEntryById("d").draftDelivery.state,"discarded");assert.equal(h.calls.length,0);
});
test("late snapshots and in-flight send acknowledgements cannot cross selection/authentication generations",async t=>{
 let release,hold=false;const waiting=new Promise(r=>release=r),h=await setup(t,{executor:async request=>{hold=true;await waiting;return {result:{case:"success",value:{content:[{content:{case:"text",value:{text:JSON.stringify({ok:true,channel:request.args.channel_id,ts:"123.456",message:{text:request.args.text}})}}}]}}};}});
 const first=h.add("d");await h.render(first);await React.act(async()=>{h.document.querySelector('button[type=submit]').click();await new Promise(r=>setImmediate(r));});assert.equal(hold,true);
 await React.act(async()=>{h.selection.set({currentAgentId:h.b.id});h.connection.set({transport:"up",authenticationGeneration:2});});await React.act(async()=>{release();await new Promise(r=>setImmediate(r));});assert.doesNotMatch(h.document.getElementById("app").textContent,/Sent/);assert.equal(h.room.db.getEntryById("d").draftDelivery.state,"sent","server work continues, stale UI result is invalidated");assert.equal(h.calls.length,1);
});
test("pinned RPC and lazy-card adapters fail on changed anchors and remove all empty send/discard callbacks",()=>{
 const main=readFileSync(path.join(root,"src/app/dist/renderer/assets/index-UbX-y3il.js"),"utf8"),patched=patchDraftDeliveryRenderer(main);assert.match(patched,/getDraftDelivery:we=>e.getDraftDelivery\(we\)/);assert.match(patched,/resolveDraftDelivery:\{args:"object",reply:"record"\}/);assert.throws(()=>patchDraftDeliveryRenderer(patched),/anchor changed/);
 for(const [kind,file]of[["email","view-ClhdNXKM.js"],["slack","view-DyaeCHiE.js"]]){const chunk=patchDraftDeliveryChunks(readFileSync(path.join(root,"src/app/dist/renderer/assets",file),"utf8"),kind);assert.match(chunk,/window.__beebotDraftCard/);assert.doesNotMatch(chunk,/function (qs|Cs|Ss|zs)\(\)\{\}/);assert.throws(()=>patchDraftDeliveryChunks(chunk,kind),/anchor changed/);}
});

test("disconnect while a snapshot is pending clears UI busy and enables read-only recovery",async t=>{
 let release;const waiting=new Promise(r=>release=r),h=await setup(t,{snapshot:()=>waiting});const item=h.add("pending");await h.render(item);await React.act(async()=>h.connection.set({transport:"down",authenticationGeneration:2}));assert.equal(h.document.querySelector(".bb-draft").getAttribute("aria-busy"),"false");assert.equal([...h.document.querySelectorAll("button")].find(b=>b.textContent==="Reload state").disabled,false);await React.act(async()=>release({agentId:h.room.id,entryId:item.id,version:0,hash:"a".repeat(64),state:"editable",message:messages.slack,senders:[]}));assert.equal(h.document.querySelector(".bb-draft").getAttribute("aria-busy"),"false");assert.equal(h.document.querySelector('button[type=submit]').disabled,true);
});
test("disconnect while sending unlocks read-only status reload and never cancels or repeats server delivery",async t=>{
 let release;const waiting=new Promise(r=>release=r),h=await setup(t,{executor:async request=>{await waiting;return {result:{case:"success",value:{content:[{content:{case:"text",value:{text:JSON.stringify({ok:true,channel:request.args.channel_id,ts:"123.456",message:{text:request.args.text}})}}}]}}};}});await h.render(h.add("pending"));await React.act(async()=>{h.document.querySelector('button[type=submit]').click();await new Promise(r=>setImmediate(r));});await React.act(async()=>h.connection.set({transport:"down",authenticationGeneration:2}));assert.equal(h.document.querySelector(".bb-draft").getAttribute("aria-busy"),"false");assert.equal([...h.document.querySelectorAll("button")].find(b=>b.textContent==="Reload state").disabled,false);await React.act(async()=>{release();await new Promise(r=>setImmediate(r));});assert.equal(h.room.db.getEntryById("pending").draftDelivery.state,"sent");assert.doesNotMatch(h.document.querySelector(".bb-draft").textContent,/Sent/);assert.equal(h.calls.length,1);
});
test("remote body attribute changes invalidate an outstanding draft snapshot without store events",async t=>{
 let release;const waiting=new Promise(r=>release=r),h=await setup(t,{snapshot:()=>waiting});const item=h.add("pending");await h.render(item);const generation=h.window.__beebotDraftDeliveryRuntime.adapter.getScope().generation;await React.act(async()=>{h.document.body.dataset.beebotRemoteActive="true";await new Promise(r=>setImmediate(r));});assert.ok(h.window.__beebotDraftDeliveryRuntime.adapter.getScope().generation>generation);assert.equal(h.document.querySelector(".bb-draft").getAttribute("aria-busy"),"false");await React.act(async()=>release({agentId:h.room.id,entryId:item.id,version:0,hash:"a".repeat(64),state:"sent",message:messages.slack,receipt:{messageId:"late"}}));assert.doesNotMatch(h.document.querySelector(".bb-draft").textContent,/Sent/);assert.equal(h.calls.length,0);
});
