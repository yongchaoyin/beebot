import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Window } from "happy-dom";
const snippet=await readFile(new URL("../scripts/lib/beebot-node-workbench.snippet.js",import.meta.url),"utf8");
const tick=()=>new Promise(r=>setTimeout(r,30));
function defer(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};}
async function harness(t){
  const w=new Window({url:"https://beebot.local"}),panel=w.document.createElement("section"),draft=w.document.createElement("textarea");draft.value="Keep my chat draft";w.document.body.append(draft,panel);
  let profiles=[],changed;const calls=[],hooks={};
  let preview={previewId:"check-one",baseUrl:"https://server.example",nodeId:"node-a",name:"My server",expiresAt:Date.now()+300000};
  w.desktop={nodes:{onChanged(fn){changed=fn;return()=>{}},async request(input){calls.push(structuredClone(input));if(hooks[input.action])return hooks[input.action](input);
    if(input.action==="list")return structuredClone(profiles);
    if(input.action==="inspect")return {...preview,baseUrl:input.address};
    if(input.action==="confirmConnection"){assert.deepEqual({...input},{action:"confirmConnection",previewId:preview.previewId});profiles=[{id:"a",...preview,status:"signed-out"}];return profiles[0];}
    if(input.action==="login"){profiles[0].status="connecting";profiles[0].loginStage="browser-authorization";changed({id:"a"});return new Promise(()=>{});}
    if(input.action==="cancelLogin"){profiles[0].status="signed-out";return;}
    throw new Error("Unexpected operation: "+input.action);
  }}};
  w.eval(snippet);const close=w.__beebotMountServersSettings(panel);await tick();
  t.after(async()=>{close();await w.happyDOM.close();});
  const button=label=>{const b=[...panel.querySelectorAll("button")].find(x=>x.textContent===label);assert.ok(b,label);return b;};
  const click=async label=>{const b=button(label);assert.equal(b.disabled,false,label);b.click();await tick();};
  const address=value=>{const el=panel.querySelector("#bb-node-address");el.value=value;el.dispatchEvent(new w.Event("input"));return el;};
  const inspect=async()=>{address(preview.baseUrl);await click("Add server");};
  const confirm=async()=>{await inspect();await click("Confirm server and continue");};
  return{w,panel,draft,calls,hooks,button,click,address,inspect,confirm,close,changed:()=>changed({id:"a"}),get profiles(){return profiles},set preview(value){preview=value}};
}
test("a server check must be explicitly confirmed before saving or opening browser authorization",async t=>{
  const h=await harness(t);await h.inspect();assert.deepEqual(h.calls.filter(x=>x.action!=="list").map(x=>x.action),["inspect"]);
  assert.equal(h.panel.querySelector("#bb-node-connection-preview").hidden,false);
  assert.match(h.panel.textContent,/not proof of trust/);assert.match(h.panel.textContent,/https:\/\/server.example/);
  await h.click("Confirm server and continue");assert.equal(h.button("Sign in").hidden,false);
  assert.ok(!h.calls.some(c=>["login","snapshot","submitGoal"].includes(c.action)));assert.equal(h.draft.value,"Keep my chat draft");
});
test("editing server address invalidates the checked identity without clearing the draft",async t=>{
  const h=await harness(t);await h.inspect();h.address("https://other.example");assert.equal(h.panel.querySelector("#bb-node-connection-preview").hidden,true);
  h.button("Confirm server and continue").click();await tick();assert.ok(!h.calls.some(x=>x.action==="confirmConnection"));assert.equal(h.draft.value,"Keep my chat draft");
});
test("server confirmation failure preserves the address and requires a new check",async t=>{
  const h=await harness(t);await h.inspect();h.hooks.confirmConnection=()=>{throw new Error("identity changed")};await h.click("Confirm server and continue");
  assert.equal(h.panel.querySelector("#bb-node-address").value,"https://server.example");assert.equal(h.panel.querySelector("#bb-node-connection-preview").hidden,true);
  assert.match(h.panel.querySelector(".bb-notice-title").textContent,/not confirmed/);assert.ok(!h.calls.some(c=>c.action==="login"));
});
test("leaving Settings ignores a late public check and never saves or launches login",async t=>{
  const h=await harness(t),pending=defer();h.hooks.inspect=()=>pending.promise;h.address("https://server.example");h.button("Add server").click();h.close();h.draft.focus();
  pending.resolve({previewId:"late",baseUrl:"https://server.example",name:"Late",nodeId:"late",expiresAt:Date.now()+30000});await tick();
  assert.equal(h.panel.children.length,0);assert.equal(h.w.document.activeElement,h.draft);assert.ok(!h.calls.some(c=>c.action==="confirmConnection"));
});
test("expired check cannot be confirmed and repeat clicks cannot double-save",async t=>{
  const h=await harness(t),pending=defer();await h.inspect();h.hooks.confirmConnection=()=>pending.promise;
  const b=h.button("Confirm server and continue");b.click();b.click();await tick();assert.equal(h.calls.filter(c=>c.action==="confirmConnection").length,1);
  pending.reject(new Error("expired"));await tick();assert.equal(h.panel.querySelector("#bb-node-connection-preview").hidden,true);
});
test("browser login receives only the device label and can be cancelled without logging out or cancelling work",async t=>{
  const h=await harness(t);await h.confirm();h.panel.querySelector("#bb-node-device-name").value="Work Mac";await h.click("Sign in");
  assert.deepEqual(h.calls.find(c=>c.action==="login"),{action:"login",id:"a",deviceName:"Work Mac"});
  assert.match(h.panel.textContent,/Awaiting sign-in or approval/);assert.match(h.panel.querySelector("#bb-node-picker").selectedOptions[0].textContent,/Awaiting sign-in or approval/);await h.click("Cancel sign-in");
  assert.deepEqual(h.calls.find(c=>c.action==="cancelLogin"),{action:"cancelLogin",id:"a"});assert.ok(!h.calls.some(c=>["logout","cancel","reconcile"].includes(c.action)));
});
test("closing a login page only cancels that page's local authorization wait",async t=>{
  const h=await harness(t);await h.confirm();await h.click("Sign in");h.close();await tick();
  assert.equal(h.calls.filter(c=>c.action==="cancelLogin").length,1);assert.ok(!h.calls.some(c=>c.action==="logout"));assert.equal(h.draft.value,"Keep my chat draft");
});
test("changing language preserves checked identity, device draft and keyboard focus",async t=>{
  const h=await harness(t);await h.confirm();const input=h.panel.querySelector("#bb-node-device-name");input.value="我的办公电脑";input.focus();
  h.w.__sandUiLanguage="zh";h.w.dispatchEvent(new h.w.Event("sand-ui-language-changed"));
  assert.equal(h.panel.querySelector("#bb-node-device-name"),input);assert.equal(input.value,"我的办公电脑");assert.equal(h.w.document.activeElement,input);assert.match(h.panel.textContent,/这台设备的名称/);
});
test("untrusted server text stays text, not HTML or a second chat interface",async t=>{
  const h=await harness(t);h.preview={previewId:"check-one",baseUrl:"https://server.example",name:"<img src=x onerror=alert(1)>",nodeId:"<script>bad()</script>",expiresAt:Date.now()+300000};await h.inspect();
  assert.equal(h.panel.querySelector("#bb-node-connection-preview img"),null);assert.equal(h.panel.querySelector("#bb-node-connection-preview script"),null);
  assert.equal(h.panel.querySelectorAll("textarea:not([data-bb-recovery-codes])").length,0);assert.equal(h.panel.querySelectorAll("[role=dialog]").length,0);
});


test("late discovery cannot restore a preview after the address changed",async t=>{
  const h=await harness(t),pending=defer();h.hooks.inspect=()=>pending.promise;h.address("https://server.example");h.button("Add server").click();
  h.address("https://other.example");pending.resolve({previewId:"late",baseUrl:"https://server.example",name:"Old",nodeId:"old",expiresAt:Date.now()+30000});await tick();
  assert.equal(h.panel.querySelector("#bb-node-connection-preview").hidden,true);assert.equal(h.panel.querySelector("#bb-node-address").value,"https://other.example");
  assert.ok(!h.calls.some(c=>c.action==="confirmConnection"));
});
test("invalid address after a preview cannot throw or confirm a stale target",async t=>{
  const h=await harness(t);await h.inspect();h.panel.querySelector("#bb-node-address").value="not a URL";
  await h.click("Confirm server and continue");assert.equal(h.panel.querySelector("#bb-node-connection-preview").hidden,true);
  assert.ok(!h.calls.some(c=>c.action==="confirmConnection"));
});
