import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {Window} from "happy-dom";
const code=await readFile(new URL("../scripts/lib/beebot-work-review.snippet.js",import.meta.url),"utf8");
const tick=()=>new Promise(r=>setTimeout(r,8));
const store=value=>{const listeners=new Set();return{get:()=>value,set:next=>{value=next;listeners.forEach(f=>f());},subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);}};};
const entry={id:"submitted",kind:"send-message",author:{id:"a",name:"A"},message:{type:"text",content:"Result ready"},workEvent:{schema:1,taskId:"assignment",title:"Composer fixes",action:"submit",state:"submitted",actorId:"a",ownerId:"a",reviewerId:null,version:3}};
const data={task:{id:"assignment",title:"Composer fixes",requirements:["Keep draft","Keep quote"],state:"submitted",reviewerId:null,version:3,submission:{id:"submitted",results:[{id:"proof",digest:"a".repeat(64)}]}},results:[{id:"proof",available:true,text:"Real evidence preview",fileName:""}],contextId:"11111111-1111-4111-8111-111111111111",controlEpoch:0};
async function setup(t){
 const window=new Window({url:"https://beebot.local"});window.document.body.innerHTML='<main><div data-row-key="submitted">Original result</div><div class="sand-chat-input-dock"><textarea>Keep my chat draft</textarea></div></main>';
 const selection=store({currentAgentId:"room"}),entries=store({entries:[structuredClone(entry)]}),other=store({entries:[]}),connection=store({transport:"up"}),calls=[];
 let inspect=async()=>structuredClone(data),submit=async args=>({recorded:true,task:{...data.task,state:args.command.decision==="accept"?"accepted":"changes_requested",version:4}});
 const runtime={selection:{snapshots:selection},transcript:{snapshotsFor:id=>id==="room"?entries:other},connection:{snapshots:connection},roster:{getWorkReview:a=>{calls.push(["inspect",a]);return inspect(a);},submitWorkReview:a=>{calls.push(["submit",a]);return submit(a);}}};
 window.runtime=runtime;window.eval(code+';window.binding=RBindWorkReview(window.runtime);');await tick();
 t.after(async()=>{window.binding.dispose();await window.happyDOM.close();});
 const root=()=>window.document.querySelector("[data-bb-work-review]");
 return{window,selection,entries,other,connection,calls,root,inspect:f=>inspect=f,submit:f=>submit=f,async open(){root().querySelector(":scope>button").click();await tick();},get checks(){return root().querySelectorAll("fieldset:nth-of-type(2) input");},checkAll(){for(const n of this.checks){n.checked=true;n.dispatchEvent(new window.Event("change"));}},action:()=>root().querySelector(".bb-review-actions button")};
}
test("review opens at the result, never in a dialog, and keeps draft/focus intact",async t=>{
 const ui=await setup(t),draft=ui.window.document.querySelector("textarea");draft.focus();await ui.open();
 assert.equal(ui.window.document.querySelectorAll("[role=dialog]").length,0);assert.equal(ui.root().parentElement.dataset.rowKey,"submitted");assert.equal(draft.value,"Keep my chat draft");assert.equal(ui.window.document.activeElement,draft);assert.match(ui.root().textContent,/Real evidence preview/);
});
test("acceptance requires every criterion; payload carries exact work version and evidence",async t=>{
 const ui=await setup(t);await ui.open();assert.equal(ui.action().disabled,true);ui.checkAll();assert.equal(ui.action().disabled,false);ui.action().click();await tick();
 const [,args]=ui.calls.find(c=>c[0]==="submit");assert.equal(args.agentId,"room");assert.equal(args.command.expected_version,3);assert.equal(args.command.submission_id,"submitted");assert.deepEqual(Array.from(args.command.checks,c=>c.evidence_ids[0]),["proof","proof"]);assert.match(ui.root().textContent,/Review recorded/);
});
test("requesting changes needs a note, records negative checks, and never sends twice",async t=>{
 const ui=await setup(t),gate=Promise.withResolvers();ui.submit(()=>gate.promise);await ui.open();
 const button=ui.root().querySelector(".bb-review-actions button:last-child"),note=ui.root().querySelector("textarea");assert.equal(button.disabled,true);note.value="Second criterion still fails";note.dispatchEvent(new ui.window.Event("input"));button.click();button.click();
 assert.equal(ui.calls.filter(c=>c[0]==="submit").length,1);assert.equal(note.disabled,true);assert.equal(ui.calls.at(-1)[1].command.checks[0].passed,false);gate.resolve({recorded:true,task:{...data.task,state:"changes_requested",version:4}});await tick();
});
test("switching chats before a render prevents old review actions and drops late reads",async t=>{
 const ui=await setup(t),gate=Promise.withResolvers();ui.inspect(()=>gate.promise);ui.root().querySelector(":scope>button").click();ui.selection.set({currentAgentId:"other"});gate.resolve(data);await tick();assert.equal(ui.root(),null);assert.equal(ui.calls.filter(c=>c[0]==="submit").length,0);
});
test("lost acknowledgement requires inspection before retry and preserves the stable operation",async t=>{
 const ui=await setup(t);ui.submit(()=>Promise.reject(new Error("Lost acknowledgement")));await ui.open();ui.checkAll();ui.action().click();await tick();const first=ui.calls.find(c=>c[0]==="submit")[1];assert.equal(ui.action().disabled,true);assert.match(ui.root().textContent,/Check the latest status/);
 ui.root().querySelector(".bb-review-notice+button").click();await tick();assert.equal(ui.action().disabled,false);ui.action().click();await tick();assert.equal(ui.calls.filter(c=>c[0]==="submit")[1][1].command.operation_id,first.command.operation_id);
});
test("language and virtualized row remount preserve checklist and review note",async t=>{
 const ui=await setup(t);await ui.open();ui.checkAll();const note=ui.root().querySelector("textarea");note.value="Keep this review draft";note.dispatchEvent(new ui.window.Event("input"));ui.window.__sandUiLanguage="zh";ui.window.dispatchEvent(new ui.window.Event("sand-ui-language-changed"));await tick();
 assert.match(ui.root().textContent,/已核对通过的要求/);assert.equal(ui.root().querySelector("textarea"),note);ui.root().parentElement.remove();const row=ui.window.document.createElement("div");row.dataset.rowKey="submitted";ui.window.document.querySelector("main").prepend(row);await tick();assert.equal(ui.root().querySelector("textarea"),note);assert.equal(note.value,"Keep this review draft");assert.equal(ui.checks[0].checked,true);
});
test("remote selection removes local review and delayed submit cannot repaint another chat",async t=>{
 const ui=await setup(t),gate=Promise.withResolvers();ui.submit(()=>gate.promise);await ui.open();ui.checkAll();ui.action().click();ui.window.document.body.dataset.beebotRemoteActive="true";ui.window.dispatchEvent(new ui.window.Event("beebot-node-selection"));await tick();gate.resolve({recorded:true,task:{...data.task,state:"accepted"}});await tick();assert.equal(ui.root(),null);
});
test("agent prose, peer-reviewed work and malformed states cannot expose user acceptance",async t=>{
 const ui=await setup(t);for(const e of [{...entry,workEvent:undefined},{...entry,workEvent:{...entry.workEvent,reviewerId:"b"}},{...entry,workEvent:{...entry.workEvent,version:NaN}},{...entry,workEvent:{...entry.workEvent,actorId:"outside"}}]){ui.entries.set({entries:[e]});await tick();assert.equal(ui.root(),null);}
});
test("late inspection cannot enable an older submission after a newer work event arrives",async t=>{
 const ui=await setup(t),gate=Promise.withResolvers();ui.inspect(()=>gate.promise);ui.root().querySelector(":scope>button").click();ui.entries.set({entries:[entry,{...entry,id:"new",workEvent:{...entry.workEvent,version:4,action:"revise",state:"changes_requested"}}]});await tick();gate.resolve(data);await tick();assert.match(ui.root().textContent,/Newer work/);assert.equal(ui.action().disabled,true);
});
test("evidence is rendered as text, unavailable output cannot be selected or accepted",async t=>{
 const ui=await setup(t);ui.inspect(async()=>({...structuredClone(data),results:[{id:"proof",available:false,text:'<img onerror="alert(1)">',fileName:"<script>bad</script>"}]}));await ui.open();ui.checkAll();assert.equal(ui.root().querySelector("img"),null);const evidence=ui.root().querySelector("fieldset input");assert.equal(evidence.disabled,true);assert.equal(ui.action().disabled,true);
});


test("saved review reports uncertain follow-up delivery without pretending work resumed",async t=>{
 const ui=await setup(t);ui.submit(async()=>({recorded:true,notification:"needs-review",task:{...data.task,state:"accepted",version:4}}));await ui.open();ui.checkAll();ui.action().click();await tick();assert.match(ui.root().textContent,/Review recorded/);assert.match(ui.root().textContent,/delivery needs inspection/);assert.match(ui.root().textContent,/not replayed automatically/);assert.equal(ui.calls.filter(c=>c[0]==="submit").length,1);
});

test("the actual shipped renderer includes review UI and both authenticated RPC bridges",async()=>{
 const {patchOriginalLanding}=await import("../scripts/lib/router-renderer-patch.mjs");
 const raw=await readFile(new URL("../src/app/dist/renderer/assets/index-UbX-y3il.js",import.meta.url),"utf8");
 const patched=patchOriginalLanding(raw);
 assert.ok(patched.includes(code),"packaged code must include the actual reviewed adapter");
 for(const method of ["getWorkReview","submitWorkReview"]){
   assert.ok(patched.includes(`${method}:{args:"object",reply:"record"}`));
   assert.ok(patched.includes(`${method}:we=>e.${method}(we)`));
 }
 assert.ok(patched.includes('typeof RBindWorkReview === "function" ? RBindWorkReview(runtime)'));
 const {transform}=await import("esbuild");await transform(patched,{loader:"js",format:"esm",target:"es2022"});
});
