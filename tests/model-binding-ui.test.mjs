import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Window } from "happy-dom";

const source=await readFile(new URL("../scripts/lib/sand-create-overlay.snippet.js",import.meta.url),"utf8");
const start=source.indexOf("function RSyncVendorChoices("),end=source.indexOf("},1200)}",start)+9;
assert.ok(start>0&&end>start,"Actual packaged selector must exist");
const script=source.slice(start,end);
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function rig(t){
 const w=new Window({url:"https://beebot.test",settings:{enableJavaScriptEvaluation:true}});t.after(()=>w.happyDOM.close());
 w.document.body.innerHTML='<main data-beebot-settings-owner="bot-a"><section class="sand-agent-settings"><input value="Alice"><textarea>Keep the original description</textarea></section></main><input id="draft" value="unsent chat">';
 w.__sandAgentVendors={"bot-a":"removed-api"};w.RAgentVendorId=id=>w.__sandAgentVendors[id];w.RCreateText=(zh,en)=>en;
 let catalog={vendors:[{id:"api-a",label:"Local API A",modelId:"model-a"},{id:"api-b",label:"Local API B",modelId:"model-b"}],defaultVendorId:"api-a"},read=async()=>catalog;
 const calls=[];w.desktop={agent:{getInferenceVendors:()=>read()}};w.__sandUpdateAgent=async(id,profile)=>{calls.push([id,profile]);return {id,...profile};};
 let poll;w.setInterval=callback=>(poll=callback,1);w.eval(script);
 return{w,calls,setRead:fn=>read=fn,setCatalog:next=>catalog=next,poll:()=>poll(),select:()=>w.document.querySelector("#sand-agent-vendor select"),hint:()=>w.document.querySelector('[role="status"]').textContent,change(value){const s=this.select();s.value=value;s.dispatchEvent(new w.Event("change"));}};
}
test("missing bound API stays visibly missing, never masquerades as the first configured API",async t=>{
 const x=rig(t);await x.poll();const s=x.select();assert.equal(s.value,"removed-api");assert.ok(s.selectedOptions[0].disabled);assert.match(s.selectedOptions[0].textContent,/unavailable/);assert.equal(x.calls.length,0);
 const draft=x.w.document.getElementById("draft");draft.focus();await x.poll();assert.equal(x.select(),s);assert.equal(x.w.document.activeElement,draft);assert.equal(draft.value,"unsent chat");
});
test("failed save retains old binding, does not change cached model or drop Bot description",async t=>{
 const x=rig(t);await x.poll();x.w.__sandUpdateAgent=async()=>{throw new Error("offline")};x.change("api-b");assert.equal(x.select().disabled,true);await tick();
 assert.equal(x.select().value,"removed-api");assert.equal(x.w.__sandAgentVendors["bot-a"],"removed-api");assert.match(x.hint(),/Save not confirmed/);assert.equal(x.w.document.querySelector("textarea").value,"Keep the original description");
});
test("save uses the pane owner, captures exact selection and preserves unedited fields",async t=>{
 const x=rig(t);await x.poll();x.change("api-b");x.select().value="api-a";await tick();
 assert.deepEqual(JSON.parse(JSON.stringify(x.calls)),[["bot-a",{name:"Alice",inferenceVendorId:"api-b"}]]);
 assert.equal(x.w.__sandAgentVendors["bot-a"],"api-b");await x.poll();assert.equal(x.select().value,"api-b");assert.match(x.hint(),/Saved/);
});
test("late catalog reads cannot attach the previous Bot's selector to a different pane",async t=>{
 const x=rig(t);let finish;x.setRead(()=>new Promise(r=>finish=r));const pending=x.poll();x.w.document.querySelector("main").setAttribute("data-beebot-settings-owner","bot-b");finish({vendors:[{id:"b",label:"B"}]});await pending;assert.equal(x.select(),null);
});
test("closing or replacing Bot settings before dispatch does not update the old Bot",async t=>{
 const x=rig(t);await x.poll();x.change("api-b");x.w.document.querySelector("main").remove();await tick();assert.equal(x.calls.length,0);assert.equal(x.w.__sandAgentVendors["bot-a"],"removed-api");
});
test("empty catalog shows missing state and later edits refresh without rebuilding the control",async t=>{
 const x=rig(t);x.setCatalog({vendors:[],defaultVendorId:null});await x.poll();const s=x.select();assert.equal(s.disabled,true);assert.equal(s.value,"removed-api");
 x.setCatalog({vendors:[{id:"new",label:"Added later"}],defaultVendorId:"new"});await x.poll();assert.equal(x.select(),s);assert.equal(s.disabled,false);assert.equal(s.value,"removed-api");assert.equal(s.options.length,2);
});

for(const response of [null, {id:"other-bot",inferenceVendorId:"api-b"}, {id:"bot-a",inferenceVendorId:"api-a"}]) {
 test(`unconfirmed/mismatched host summary cannot masquerade as a saved binding: ${JSON.stringify(response)}`,async t=>{
  const x=rig(t);await x.poll();x.w.__sandUpdateAgent=async()=>response;x.change("api-b");await tick();
  assert.equal(x.w.__sandAgentVendors["bot-a"],"removed-api");assert.match(x.hint(),/not confirmed/);assert.equal(x.select().disabled,false);
 });
}
test("late successful save from a previous runtime cannot contaminate a new roster's cache",async t=>{
 const x=rig(t);await x.poll();let finish;x.w.__sandUpdateAgent=()=>new Promise(r=>finish=r);x.change("api-b");await tick();
 x.w.__sandRoster={};x.w.__sandAgentVendors={"bot-a":"new-runtime-api"};finish({id:"bot-a",inferenceVendorId:"api-b"});await tick();
 assert.equal(x.w.__sandAgentVendors["bot-a"],"new-runtime-api");assert.doesNotMatch(x.hint(),/Saved/);
});
test("a reused settings pane rebinds its selector to the new actual Bot owner",async t=>{
 const x=rig(t);await x.poll();const before=x.select();
 x.w.document.querySelector("main").setAttribute("data-beebot-settings-owner","bot-b");x.w.__sandAgentVendors["bot-b"]="api-a";
 await x.poll();assert.notEqual(x.select(),before);assert.equal(x.select().value,"api-a");x.change("api-b");await tick();
 assert.deepEqual(JSON.parse(JSON.stringify(x.calls)),[["bot-b",{name:"Alice",inferenceVendorId:"api-b"}]]);
 assert.equal(x.w.__sandAgentVendors["bot-a"],"removed-api");
});
