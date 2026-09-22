import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { parse } from "acorn";
import { patchOriginalLanding } from "../scripts/lib/router-renderer-patch.mjs";
const source=readFileSync(new URL("../scripts/lib/beebot-bot-role.snippet.js",import.meta.url),"utf8");
const overlay=readFileSync(new URL("../scripts/lib/sand-create-overlay.snippet.js",import.meta.url),"utf8");
const paths=readFileSync(new URL("../scripts/lib/persona-shape-paths.json",import.meta.url),"utf8");
const plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await tick();}assert.fail("expected role UI state");}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
const job={primaryJob:"聊天交互",responsibilities:["输入与引用"],outOfScope:["生产部署"],deliverables:["代码与自检"],workingStyle:"跨职责先请教"};
const record=(id="a",revision=1,role=job)=>({botId:id,format:1,revision,role,updatedAt:100,confirmedBy:"user"});
async function boot(t,options={}){
 const window=new Window({url:"https://beebot.local/role"});window.__sandUiLanguage=options.language||"zh";
 if(options.shortTimeout){const original=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>original(fn,ms===15000?20:ms,...args);}
 window.document.body.innerHTML='<main><textarea aria-label="Chat">聊天草稿</textarea><section id="settings"></section></main>';
 const state={current:options.initial===undefined?record():options.initial,calls:[]};
 const roster={getBotRole:options.get||(async({agentId})=>({agentId,role:state.current,configured:!!state.current,legacyDescription:"万能助手"})),updateBotRole:async request=>{state.calls.push(plain(request));if(options.save)return options.save(request,state);state.current=record(request.agentId,request.expectedRevision+1,plain(request.role));return{saved:true,record:state.current};}};
 window.eval(source);const host=window.document.getElementById("settings");let dispose=window.__beebotMountBotRole(host,{agentId:"a",roster});
 t.after(async()=>{dispose?.();await window.happyDOM.close();});
 const action=key=>host.querySelector(`[data-role-action="${key}"]`),field=key=>host.querySelector(`[data-role-field="${key}"]`);
 const input=(key,value)=>{const node=field(key);node.value=value;node.dispatchEvent(new window.Event("input",{bubbles:true}));};
 return{window,document:window.document,host,state,roster,action,field,input,dispose:()=>{dispose?.();dispose=null;},mount:id=>{dispose=window.__beebotMountBotRole(host,{agentId:id,roster});}};
}
test("settings show confirmed job and exclusions without creating a chat dialog",async t=>{
 const h=await boot(t);await until(()=>!h.action("edit").disabled);assert.match(h.host.textContent,/聊天交互/);assert.match(h.host.textContent,/生产部署/);
 assert.equal(h.host.querySelector('[role="dialog"]'),null);assert.equal(h.document.querySelector("textarea").value,"聊天草稿");
 assert.equal(h.state.calls.length,0);
});
test("unconfigured legacy profile is not automatically confirmed or copied into the role",async t=>{
 const h=await boot(t,{initial:null});await until(()=>!h.action("edit").disabled);assert.match(h.host.textContent,/尚未确认/);
 h.action("edit").click();assert.equal(h.field("primaryJob").value,"");h.action("save").click();
 assert.equal(h.state.calls.length,0);assert.equal(h.field("primaryJob").getAttribute("aria-invalid"),"true");
 h.input("primaryJob","前端工程");h.action("save").click();await until(()=>h.state.calls.length===1&&!h.action("edit").hidden);
 assert.equal(h.state.calls[0].expectedRevision,0);assert.equal(h.state.current.revision,1);
});
test("explicit save preserves exact boundaries and prevents duplicate clicks",async t=>{
 const gate=deferred(),h=await boot(t,{save:async(request,state)=>{await gate.promise;state.current=record("a",2,plain(request.role));return{saved:true,record:state.current};}});
 t.after(gate.resolve);await until(()=>!h.action("edit").disabled);h.action("edit").click();h.input("primaryJob","前端实现");h.input("outOfScope","后端修改\n生产发布");
 h.action("save").click();h.action("save").click();await until(()=>h.state.calls.length===1);assert.equal(h.state.calls.length,1);assert.equal(h.field("primaryJob").disabled,true);
 gate.resolve();await until(()=>!h.action("edit").hidden);assert.deepEqual(h.state.calls[0].role.outOfScope,["后端修改","生产发布"]);assert.match(h.host.textContent,/v2/);
});
test("stale edit preserves draft, never auto-merges, and requires loading the current role",async t=>{
 const h=await boot(t,{save:async()=>{throw new Error("bot_role_stale");}});await until(()=>!h.action("edit").disabled);
 h.action("edit").click();h.input("primaryJob","我的修改");h.action("save").click();await until(()=>h.host.textContent.includes("草稿保留"));
 assert.equal(h.field("primaryJob").value,"我的修改");assert.equal(h.action("save").disabled,true);assert.equal(h.state.calls.length,1);
 h.state.current=record("a",3,{...job,primaryJob:"别处已更新"});h.action("reload").click();await until(()=>h.field("primaryJob").value==="别处已更新");
 assert.equal(h.action("save").disabled,false);
});
test("lost acknowledgement retries the same request rather than inventing a new edit",async t=>{
 let attempt=0;const h=await boot(t,{save:async(request,state)=>{if(++attempt===1){state.current=record("a",2,plain(request.role));throw new Error("Network failed");}return{saved:true,record:state.current,replayed:true};}});
 await until(()=>!h.action("edit").disabled);h.action("edit").click();h.input("primaryJob","输入交互");h.action("save").click();await until(()=>h.host.textContent.includes("尚未确认"));
 assert.equal(h.field("primaryJob").disabled,true);h.action("save").click();await until(()=>!h.action("edit").hidden);
 assert.deepEqual(h.state.calls[0],h.state.calls[1]);assert.equal(h.state.current.revision,2);
});
test("a replayed earlier save cannot roll back a newer role in the editor",async t=>{
 const h=await boot(t,{save:async(request,state)=>{const earlier=record("a",2,plain(request.role));state.current=record("a",3,{...job,primaryJob:"新岗位"});return{saved:true,record:earlier,replayed:true};}});
 await until(()=>!h.action("edit").disabled);h.action("edit").click();h.input("primaryJob","旧修改");h.action("save").click();await until(()=>!h.action("edit").hidden);
 assert.match(h.host.textContent,/v3/);assert.match(h.host.textContent,/新岗位/);h.action("edit").click();assert.equal(h.field("primaryJob").value,"新岗位");
});
test("late role reads cannot populate another Bot's settings or move chat focus",async t=>{
 const gate=deferred();const h=await boot(t,{get:async({agentId})=>agentId==="a"?gate.promise:{agentId,role:record("b",1,{...job,primaryJob:"B的岗位"})}});
 h.dispose();h.mount("b");await until(()=>h.host.textContent.includes("B的岗位"));const chat=h.document.querySelector("textarea");chat.focus();
 gate.resolve({agentId:"a",role:record()});await tick();assert.doesNotMatch(h.host.textContent,/聊天交互/);assert.equal(h.document.activeElement,chat);
});
test("late save acknowledgement after closing cannot replace another Bot's role",async t=>{
 const gate=deferred(),h=await boot(t,{save:()=>gate.promise});t.after(gate.resolve);await until(()=>!h.action("edit").disabled);h.action("edit").click();h.action("save").click();h.dispose();
 h.state.current=record("b",1,{...job,primaryJob:"B角色"});h.mount("b");await until(()=>h.host.textContent.includes("B角色"));gate.resolve({saved:true,record:record("a",2)});await tick();
 assert.equal(h.host.querySelector('[data-role-owner]').dataset.roleOwner,"b");assert.doesNotMatch(h.host.textContent,/v2/);
});
test("language changes preserve editing nodes, IME input, keyboard focus and cancellation",async t=>{
 const h=await boot(t);await until(()=>!h.action("edit").disabled);h.action("edit").click();const field=h.field("primaryJob");h.input("primaryJob","正在选词");field.focus();field.setSelectionRange(1,3);
 h.window.__sandUiLanguage="en";h.window.dispatchEvent(new h.window.Event("sand-ui-language-changed"));assert.equal(h.field("primaryJob"),field);assert.equal(h.document.activeElement,field);assert.equal(field.value,"正在选词");
 h.action("cancel").click();assert.equal(h.state.calls.length,0);assert.equal(h.document.querySelector("textarea").value,"聊天草稿");
});
test("role text and transport errors cannot become HTML or reveal private error strings",async t=>{
 const h=await boot(t,{initial:record("a",1,{...job,primaryJob:'<img src=x onerror="window.bad=1">'}),save:async()=>{throw new Error("Bearer secret-test");}});
 await until(()=>!h.action("edit").disabled);assert.equal(h.host.querySelector("img"),null);h.action("edit").click();h.action("save").click();await until(()=>h.host.textContent.includes("尚未确认"));
 assert.equal(h.window.bad,undefined);assert.equal(h.host.textContent.includes("secret-test"),false);
});
test("invalid identity or unavailable role protocol fails closed in settings",async t=>{
 const h=await boot(t,{get:async()=>({agentId:"b",role:record("b")})});await until(()=>h.host.textContent.includes("无法读取"));assert.equal(h.action("edit").disabled,true);assert.equal(h.state.calls.length,0);
});
test("role fields validate complete limits without silently truncating lines",async t=>{
 const h=await boot(t);const f=h.window.__beebotRoleFields();t.after(f.dispose);h.host.append(f.root);
 f.write({...job,outOfScope:Array.from({length:13},(_,i)=>"Limit "+i)});assert.ok(f.validate());assert.equal(f.details.open,true);assert.equal(f.read().outOfScope.length,13);
});
test("creation requires a job, preserves detailed scope across appearance changes, and submits one structured role",async t=>{
 const w=new Window({url:"https://beebot.local"});t.after(()=>w.happyDOM.close());w.__sandVendorPaneBound=true;
 w.desktop={agent:{getUiLanguage:async()=>({language:"zh"}),getInferenceVendors:async()=>({vendors:[],defaultVendorId:""})}};
 w.eval(`const R_PATHS=${paths};\n${source}\n${overlay.slice(0,overlay.indexOf("function MOn("))}`);
 let draft;w.__sandPickCreateBot(undefined,{onCreate:value=>{draft=plain(value);}});await until(()=>w.document.getElementById("sand-create-bot-sheet"));
 const sheet=w.document.getElementById("sand-create-bot-sheet");sheet.querySelector(".bb-create-submit").click();assert.equal(draft,undefined);
 const set=(key,value)=>{const node=sheet.querySelector(`[data-role-field="${key}"]`);node.value=value;node.dispatchEvent(new w.Event("input",{bubbles:true}));};
 set("primaryJob",job.primaryJob);set("outOfScope","后端修改\n生产部署");sheet.querySelector('[aria-label="blue"]').click();assert.equal(sheet.querySelector('[data-role-field="primaryJob"]').value,job.primaryJob);
 sheet.querySelector(".bb-create-submit").click();await until(()=>draft);assert.equal(draft.avatarColor,"blue");assert.deepEqual(draft.role.outOfScope,["后端修改","生产部署"]);
 assert.equal(Object.hasOwn(draft,"permissions"),false);
});
test("the exact shipped renderer binds role methods and settings ownership, with drift rejection",()=>{
 const original=readFileSync(new URL("../src/app/dist/renderer/assets/index-UbX-y3il.js",import.meta.url),"utf8");
 const patched=patchOriginalLanding(original);parse(patched,{ecmaVersion:"latest",sourceType:"module"});
 assert.match(patched,/getBotRole:\{args:"object",reply:"record"\}/);assert.match(patched,/updateBotRole:we=>e.updateBotRole\(we\)/);
 assert.match(patched,/__beebotMountBotRole\?\.\(r.current,\{agentId:n.agent.id,roster:e\}\)/);
 assert.throws(()=>patchOriginalLanding(original.replace("function h3n(n){const e=he.c(31),","function movedSettings(n){")),/anchor/);
});


test("a stalled save becomes an explicit uncertain retry, not a permanently locked form",async t=>{
 const gate=deferred(),h=await boot(t,{shortTimeout:true,save:()=>gate.promise});t.after(gate.resolve);
 await until(()=>!h.action("edit").disabled);h.action("edit").click();h.input("primaryJob","Scope preserved");h.action("save").click();
 await until(()=>h.host.textContent.includes("尚未确认"));assert.equal(h.action("save").disabled,false);assert.equal(h.field("primaryJob").value,"Scope preserved");
 assert.equal(h.document.querySelector("textarea").disabled,false);h.dispose();gate.resolve({saved:true,record:record("a",2)});await tick();assert.equal(h.host.childElementCount,0);
});

test("creation defers repaint during primary-job IME composition and keeps its final value",async t=>{
 const w=new Window({url:"https://beebot.local"});t.after(()=>w.happyDOM.close());w.__sandVendorPaneBound=true;
 w.desktop={agent:{getUiLanguage:async()=>({language:"zh"}),getInferenceVendors:async()=>({vendors:[]})}};
 w.eval(`const R_PATHS=${paths};\n${source}\n${overlay.slice(0,overlay.indexOf("function MOn("))}`);
 w.__sandPickCreateBot();await until(()=>w.document.getElementById("sand-create-bot-sheet"));const sheet=w.document.getElementById("sand-create-bot-sheet"),field=sheet.querySelector('[data-role-field="primaryJob"]');
 field.focus();field.dispatchEvent(new w.CompositionEvent("compositionstart",{bubbles:true}));field.value="正在输入职责";field.dispatchEvent(new w.Event("input",{bubbles:true}));
 w.__sandUiLanguage="en";w.dispatchEvent(new w.Event("sand-ui-language-changed"));assert.equal(sheet.querySelector('[data-role-field="primaryJob"]'),field);
 field.dispatchEvent(new w.CompositionEvent("compositionend",{bubbles:true}));const next=sheet.querySelector('[data-role-field="primaryJob"]');assert.equal(next.value,"正在输入职责");assert.equal(w.document.activeElement,next);
 sheet.__sandDismiss();
});
