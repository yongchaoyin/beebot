import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Window } from "happy-dom";

// Uses the same DOM dependency and real packaged adapter as node-workbench.test.mjs.
const snippet = await readFile(new URL("../scripts/lib/beebot-node-workbench.snippet.js", import.meta.url), "utf8");
const profile = (id, status = "online") => ({ id, nodeId: `node-${id}`, name: `Server ${id}`, baseUrl: `https://${id}.example`, status });
const snapshot = id => ({ node: { id: `node-${id}` }, bots: [{ id: `bot-${id}`, name: `Bot ${id}` }], goals: [], cursor: 0 });
async function until(check, message = "condition was not reached") {
  const end = Date.now() + 1500;
  while (!check()) {
    if (Date.now() > end) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(initial = [profile("a"), profile("b")]) {
  const window = new Window({ url: "https://beebot.local" });
  const state = { profiles: structuredClone(initial), calls: [], snapshots: {}, hooks: {}, opened: [], closedSettings: 0, closedChats: 0 };
  const listeners = new Set();
  const panel = window.document.createElement("section");
  window.document.body.append(panel);
  const changed = id => listeners.forEach(fn => fn({ id }));
  window.desktop = { nodes: {
    onChanged(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async request(input) {
      state.calls.push(structuredClone(input));
      if (state.hooks[input.action]) return state.hooks[input.action](input);
      if (input.action === "list") return structuredClone(state.profiles);
      if (input.action === "snapshot") return structuredClone(state.snapshots[input.id] || snapshot(input.id));
      if (input.action === "add") {
        const existing = state.profiles.find(p => p.baseUrl === input.address);
        if (existing) return structuredClone(existing);
        const next = { ...profile("new", "signed-out"), baseUrl: input.address };
        state.profiles.push(next);
        return structuredClone(next);
      }
      const p = state.profiles.find(item => item.id === input.id);
      assert.ok(p, "operation must target an existing connection");
      if (input.action === "login" || input.action === "resume") { p.status = "online"; changed(p.id); return; }
      if (input.action === "logout") { p.status = "signed-out"; changed(p.id); return; }
      if (input.action === "remove") { state.profiles = state.profiles.filter(item => item.id !== p.id); return { remoteRevoked: true }; }
      throw new Error(`Unexpected action: ${input.action}`);
    },
  } };
  window.__beebotNodeChat = {
    close() { state.closedChats++; },
    open(...args) { state.opened.push(args); },
  };
  state.sessions = [
    { id: "self", device_name: "Current laptop", dpop_jkt: "public-key-thumbprint-only", created_at: Date.now(), revoked_at: null, idle_expires: Date.now()+100000, absolute_expires: Date.now()+100000, grant: { role: "admin", botIds: "*" } },
    { id: "other", device_name: "Office computer", dpop_jkt: "another-public-key-thumbprint", created_at: Date.now(), revoked_at: null, idle_expires: Date.now()+100000, absolute_expires: Date.now()+100000, grant: { role: "operator", botIds: ["bot-a"] } },
  ];
  state.requests = []; state.devices = []; state.recoveryCodesRemaining = 8;
  state.hooks.securitySessions = () => ({ currentSessionId: "self", sessions: structuredClone(state.sessions), requests: structuredClone(state.requests), devices: structuredClone(state.devices), recoveryCodesRemaining: state.recoveryCodesRemaining });
  state.hooks.securityEvents = () => ({ events: [{ kind: "session.authorized", time: Date.now() }] });
  state.hooks.setSessionGrant = async input => { state.sessions.find(s => s.id === input.sessionId).grant = { role: input.role, botIds: input.botIds }; };
  state.hooks.revokeSession = async input => { state.sessions.find(s => s.id === input.sessionId).revoked_at = Date.now(); };
  window.eval(snippet);
  const cleanup = window.__beebotMountServersSettings(panel, { onOpenBot() { state.closedSettings++; } });
  const find = label => [...panel.querySelectorAll("button")].find(button => button.textContent === label);
  const click = label => { const found = find(label); assert.ok(found, label); assert.equal(found.disabled, false, `${label} must be enabled`); found.click(); };
  const select = value => { const picker = panel.querySelector("#bb-node-picker"); picker.value = value; picker.dispatchEvent(new window.Event("change")); };
  const submit = value => {
    const field = panel.querySelector("#bb-node-address");
    field.value = value; field.dispatchEvent(new window.Event("input"));
    panel.querySelector("form").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
  };
  return { window, panel, state, changed, cleanup, click, select, submit, find, listeners,
    async close() { cleanup(); await window.happyDOM.close(); },
  };
}


async function openSecurity(h) {
  await until(() => h.find("Bot a")); h.click("Security & devices");
  await until(() => h.panel.querySelector('[data-session-id="other"]'));
  const row = h.panel.querySelector('[data-session-id="other"]'); row.open = true;
  return row;
}
function rowClick(row, label) { const b = [...row.querySelectorAll("button")].find(x => x.textContent === label); assert.ok(b, label); b.click(); }
const writes = h => h.state.calls.filter(c => ["revokeSession","setSessionGrant"].includes(c.action));

test("real packaged security panel reads sessions without exposing credentials or replacing chat", async () => {
  const h = harness();
  try { await openSecurity(h); assert.match(h.panel.textContent,/public-key-thumbprint-only/); assert.match(h.panel.textContent,/Device authorized/); assert.equal(h.state.closedChats,0); assert.equal(h.state.closedSettings,0); assert.equal(writes(h).length,0); }
  finally { await h.close(); }
});
test("permission confirmation binds role and exact Bot scope, and changes invalidate approval", async () => {
  const h = harness();
  try {
    const row = await openSecurity(h); const role = row.querySelector('select'), scope = row.querySelector('select[multiple]');
    role.value = "viewer"; role.dispatchEvent(new h.window.Event("change"));
    [...scope.options].forEach(o => o.selected = o.value === "bot-a"); scope.dispatchEvent(new h.window.Event("change"));
    rowClick(row,"Save permissions"); assert.equal(writes(h).length,0); assert.match(h.panel.querySelector('#bb-node-security .bb-confirm p').textContent,/viewer, scope: Bot a/);
    role.value = "operator"; role.dispatchEvent(new h.window.Event("change")); assert.ok(h.panel.querySelector('#bb-node-security .bb-confirm').hidden);
    h.click("Confirm operation"); assert.equal(writes(h).length,0,"stale hidden confirmation cannot invoke the bridge");
    role.value="viewer";role.dispatchEvent(new h.window.Event("change")); rowClick(row,"Save permissions");h.click("Confirm operation");
    await until(()=>h.state.sessions[1].grant.role==="viewer");
    assert.deepEqual(writes(h),[{action:"setSessionGrant",id:"a",sessionId:"other",role:"viewer",botIds:["bot-a"]}]);
    await until(()=>!h.panel.querySelector('#bb-node-security').hidden && h.panel.querySelector('[data-session-id="other"]'));
  } finally { await h.close(); }
});
test("Escape cancels revocation and a confirmed revocation is not sent twice", async () => {
  const h=harness();
  try {
    const row=await openSecurity(h);rowClick(row,"Revoke session");
    h.panel.dispatchEvent(new h.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true}));assert.equal(writes(h).length,0);
    rowClick(row,"Revoke session");h.click("Confirm operation");h.find("Confirm operation").click();
    await until(()=>h.panel.textContent.includes("Inactive. This session cannot access the Node."));assert.equal(writes(h).length,1);
  } finally {await h.close();}
});
test("switching to another Node invalidates a pending security confirmation", async () => {
  const h=harness();
  try {const row=await openSecurity(h);rowClick(row,"Revoke session");h.select("b");await until(()=>h.find("Bot b"));h.find("Confirm operation").click();assert.equal(writes(h).length,0);assert.ok(h.panel.querySelector('#bb-node-security').hidden);}
  finally {await h.close();}
});
test("a late security response cannot reappear after logout or panel disposal", async () => {
  const h=harness(),pending=deferred();
  try {
    await until(()=>h.find("Bot a"));h.state.hooks.securitySessions=()=>pending.promise;h.click("Security & devices");
    h.state.profiles[0].status="signed-out";h.changed("a");pending.resolve({currentSessionId:"self",sessions:h.state.sessions});
    await until(()=>h.find("Sign in")&&!h.find("Sign in").hidden);assert.ok(h.panel.querySelector('#bb-node-security').hidden);assert.equal(h.panel.querySelectorAll('[data-session-id]').length,0);
  }finally{pending.resolve({sessions:[]});await h.close();}
});
test("expired reauthentication reports unconfirmed change rather than success", async () => {
  const h=harness();
  try {h.state.hooks.revokeSession=()=>{throw new Error("Sign in again before revoking another session.")};const row=await openSecurity(h);rowClick(row,"Revoke session");h.click("Confirm operation");await until(()=>h.panel.textContent.includes("Change not confirmed"));assert.equal(h.state.sessions[1].revoked_at,null);assert.ok(h.find("Verify identity again"));}
  finally{await h.close();}
});
test("server-supplied session names are text, and language switching preserves edited scope and focus", async () => {
  const h=harness();
  try {h.state.sessions[1].device_name='<img src=x onerror="window.xss=1">';const row=await openSecurity(h);assert.equal(h.panel.querySelector("img"),null);assert.equal(h.window.xss,undefined);const role=row.querySelector("select");role.value="viewer";role.focus();h.window.__sandUiLanguage="zh";h.window.dispatchEvent(new h.window.Event("sand-ui-language-changed"));assert.equal(role.value,"viewer");assert.equal(h.window.document.activeElement,role);assert.ok(h.find("安全与设备"));}
  finally{await h.close();}
});

const pendingKey = "A".repeat(43);
function pending(h) {
  h.state.requests = [{id:"10000000-0000-4000-8000-000000000001",jkt:pendingKey,device_name:"New device",version:1,status:"pending",created_at:Date.now(),expires:Date.now()+300000}];
  h.state.hooks.approveDevice = input => {h.state.requests=[];return {ok:true};};
  h.state.hooks.denyDevice = input => {h.state.requests=[];return {ok:true};};
}
const enrollmentWrites = h => h.state.calls.filter(call=>["approveDevice","denyDevice","blockDevice","rotateRecoveryCodes"].includes(call.action));
test("new device defaults to no Bot scope, shows exact key, and approval binds selected permissions",async()=>{
  const h=harness();pending(h);
  try{
    await openSecurity(h);const row=h.panel.querySelector('[data-request-id]');assert.ok(row);assert.match(row.textContent,new RegExp(pendingKey));
    const role=row.querySelector('select'),scope=row.querySelector('select[multiple]');assert.equal(role.value,"viewer");assert.equal(scope.selectedOptions.length,0);
    role.value="operator";role.dispatchEvent(new h.window.Event("change"));[...scope.options].forEach(o=>o.selected=o.value==="bot-a");scope.dispatchEvent(new h.window.Event("change"));
    rowClick(row,"Approve device");assert.equal(enrollmentWrites(h).length,0);assert.match(h.panel.querySelector('.bb-security .bb-confirm').textContent,/Bot a/);
    h.click("Confirm operation");h.find("Confirm operation").click();await until(()=>enrollmentWrites(h).length===1);
    assert.deepEqual(enrollmentWrites(h)[0],{action:"approveDevice",id:"a",requestId:"10000000-0000-4000-8000-000000000001",expectedVersion:1,thumbprint:pendingKey,role:"operator",botIds:["bot-a"]});
  }finally{await h.close();}
});
test("edited scope and changed server cancel a pending device approval without hidden writes",async()=>{
  const h=harness();pending(h);
  try{
    await openSecurity(h);const row=h.panel.querySelector('[data-request-id]');rowClick(row,"Approve device");
    const role=row.querySelector('select');role.value="admin";role.dispatchEvent(new h.window.Event("change"));h.find("Confirm operation").click();assert.equal(enrollmentWrites(h).length,0);
    rowClick(row,"Approve device");h.select("b");await until(()=>h.find("Bot b"));h.find("Confirm operation").click();assert.equal(enrollmentWrites(h).length,0);
  }finally{await h.close();}
});
test("a denied or stale device decision is not displayed as successful approval",async()=>{
  const h=harness();pending(h);h.state.hooks.approveDevice=()=>{throw Error("Device request changed. Refresh before deciding.");};
  try{await openSecurity(h);rowClick(h.panel.querySelector('[data-request-id]'),"Approve device");h.click("Confirm operation");await until(()=>h.panel.textContent.includes("Change not confirmed"));assert.equal(h.state.requests.length,1);assert.equal(enrollmentWrites(h).length,1);}
  finally{await h.close();}
});
test("blocking a device targets its version and key, not a same-named session",async()=>{
  const h=harness();h.state.devices=[{jkt:pendingKey,device_name:"Office computer",status:"approved",version:7}];h.state.hooks.blockDevice=()=>{h.state.devices[0].status="blocked";};
  try{await openSecurity(h);rowClick(h.panel.querySelector('[data-device-key]'),"Block device sessions");assert.match(h.panel.querySelector('.bb-security .bb-confirm').textContent,/Accepted work is not cancelled/);h.click("Confirm operation");await until(()=>h.state.devices[0].status==="blocked");assert.deepEqual(enrollmentWrites(h),[{action:"blockDevice",id:"a",thumbprint:pendingKey,expectedVersion:7}]);}
  finally{await h.close();}
});
test("recovery codes appear only after explicit regeneration and disappear on leaving the server",async()=>{
  const h=harness();const codes=Array.from({length:8},(_,i)=>String(i).repeat(43));h.state.hooks.rotateRecoveryCodes=()=>({codes});
  try{await openSecurity(h);const area=h.panel.querySelector('textarea');assert.equal(area.value,"");h.click("Regenerate recovery codes");assert.equal(enrollmentWrites(h).length,0);h.click("Confirm operation");await until(()=>area.value.includes(codes[0]));assert.equal(enrollmentWrites(h).length,1);h.click("Saved; hide recovery codes");assert.equal(area.value,"");h.click("Regenerate recovery codes");h.click("Confirm operation");await until(()=>area.value.includes(codes[0]));h.select("b");await until(()=>h.find("Bot b"));assert.equal(area.value,"");assert.equal(h.window.localStorage.length,0);}
  finally{await h.close();}
});
test("late recovery output cannot be exposed after switching accounts or closing the panel",async()=>{
  const h=harness(),p=deferred();h.state.hooks.rotateRecoveryCodes=()=>p.promise;
  try{await openSecurity(h);h.click("Regenerate recovery codes");h.click("Confirm operation");await until(()=>enrollmentWrites(h).length===1);h.state.profiles[0].status="signed-out";h.changed("a");p.resolve({codes:Array(8).fill("Z".repeat(43))});await until(()=>h.find("Sign in")&&!h.find("Sign in").hidden);assert.equal(h.panel.querySelector('textarea').value,"");}
  finally{p.resolve({codes:[]});await h.close();}
});
