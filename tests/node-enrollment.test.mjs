import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, chmod, symlink, realpath } from "node:fs/promises";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import test from "node:test";
import WebSocket from "ws";
import { testDevice } from "./helpers/node-device.mjs";

// macOS tmpdir uses /var -> /private/var; fixtures must supply the same canonical
// path required of operators. Do not relax the production symlink checks.
const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), "bb-enrollment-")));
const bundle = path.join(temporary, "enrollment.mjs");
await build({ stdin: { contents: `export * from './source/node/server.ts'; export * from './source/node/offline-recovery.ts'; export * from './source/client-connections/manager.ts';`, resolveDir: path.resolve(import.meta.dirname, "..") }, outfile: bundle, bundle: true, format: "esm", platform: "node", banner: { js: 'import {createRequire} from "node:module";const require=createRequire(import.meta.url);' } });
const api = await import(pathToFileURL(bundle).href);
test.after(() => rm(temporary, { recursive: true, force: true }));
const digest = value => createHash("sha256").update(value).digest("base64url");
const ADMIN = { role: "admin", botIds: "*" };
const VIEWER = { role: "viewer", botIds: [] };
async function fixture(t) {
  const dataDir = await mkdtemp(path.join(temporary, "node-"));
  const probe = createServer(); await new Promise(r => probe.listen(0,"127.0.0.1",r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const origin = `http://127.0.0.1:${port}`;
  const config = { version: 1, nodeId: randomUUID(), name: "Enrollment test", bindHost: "127.0.0.1", publicUrl: origin, port, maxConcurrentRuns: 1 };
  const { writeFile } = await import("node:fs/promises"); await writeFile(path.join(dataDir,"node.json"), JSON.stringify(config), {mode:0o600});
  let server, closed = false;
  const start = async () => { server = new api.BeeBotServer({ config, dataDir, runtime: { execute: async () => ({text:"fixture",transcript:[]}), close: async () => {} } }); closed = false; await server.listen(); };
  const stop = async () => { if (!closed) { closed = true; await server.close(); } };
  await start(); t.after(stop);
  const password = "correct-owner-password-for-enrollment";
  const form = async url => { const response=await fetch(url,{headers:{Connection:"close"}});const page=await response.text();assert.equal(response.status,200,page);return {csrf:/name="csrf" value="([^"]+)"/.exec(page)?.[1],flow_id:/name="flow_id" value="([^"]+)"/.exec(page)?.[1],cookie:response.headers.get("set-cookie")?.split(';')[0]}; };
  const post = (route, data, browser, headers={}) => fetch(origin+route,{method:"POST",redirect:"manual",headers:{"Content-Type":"application/x-www-form-urlencoded",Origin:origin,Cookie:browser.cookie,Connection:"close",...headers},body:new URLSearchParams(data)});
  const setup = await form(origin+"/setup?code="+server.auth.getSetupInfo().code);
  const initialized = await post("/setup",{...setup,username:"owner",password},setup); assert.equal(initialized.status,200);
  const recoveryCodes = [...(await initialized.text()).matchAll(/<code data-recovery-code>([^<]+)<\/code>/g)].map(x=>x[1]);assert.equal(recoveryCodes.length,8);
  async function begin(device=testDevice(), options={}) {
    const verifier = randomUUID()+randomUUID();
    const query = new URLSearchParams({client_id:"beebot-desktop",response_type:"code",state:randomUUID(),redirect_uri:"http://127.0.0.1:54321/oauth/callback",code_challenge:digest(verifier),code_challenge_method:"S256",device_name: options.name??"New laptop",dpop_jkt:device.jkt});
    const browser=await form(origin+"/oauth/authorize?"+query);
    const response=await post("/oauth/authorize",{...browser,username:"owner",password,...(options.code?{recovery_code:options.code,confirm_recovery:"yes"}:{}),decision:"allow",...(options.fields??{})},browser);
    const page=await response.text(), redirect=response.headers.get("location"), id=/name="request_id" value="([^"]+)"/.exec(page)?.[1];
    return {device,verifier,browser,response,page,redirect,id};
  }
  async function check(flow, decision="check", browser=flow.browser, fields={}) { return post("/oauth/device-approval",{request_id:flow.id,csrf:flow.browser.csrf,decision,...fields},browser); }
  async function exchange(flow, redirect=flow.redirect) {
    assert.ok(redirect,flow.page); const code=new URL(redirect).searchParams.get("code"); assert.ok(code);
    const params={client_id:"beebot-desktop",grant_type:"authorization_code",code,code_verifier:flow.verifier,redirect_uri:"http://127.0.0.1:54321/oauth/callback"};
    const response=await flow.device.request(origin+"/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams(params)});
    assert.equal(response.status,200,await response.clone().text());const tokens=await response.json();
    const request=(route,body)=>flow.device.request(origin+route,{method:body===undefined?"GET":"POST",headers:{Authorization:`DPoP ${tokens.access_token}`,"Content-Type":"application/json","Idempotency-Key":randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {...flow,tokens,params,request};
  }
  const first = async () => exchange(await begin(testDevice(),{code:recoveryCodes[0]}));
  const approve = (admin,flow,grant=ADMIN,overrides={}) => admin.request(`/v1/security/requests/${flow.id}/approve`,{expectedVersion:1,thumbprint:flow.device.jkt,grant,...overrides});
  async function second(admin,grant=ADMIN,device=testDevice()) {const flow=await begin(device);assert.equal(flow.response.status,200,flow.page);assert.equal((await approve(admin,flow,grant)).status,200);const ready=await check(flow);assert.equal(ready.status,303,await ready.clone().text());return exchange(flow,ready.headers.get("location"));}
  const alter=run=>{const db=new DatabaseSync(path.join(dataDir,"auth.sqlite"));try{return run(db);}finally{db.close();}};
  return {dataDir,origin,password,recoveryCodes,form,post,begin,check,exchange,first,second,approve,alter,stop,start,get server(){return server;},async restart(){await stop();await start();}};
}

test("password-only first login and zero-device restart never create an administrator", async t=>{
  const f=await fixture(t);const a=await f.begin();assert.equal(a.response.status,200);assert.ok(a.id);assert.equal(a.redirect,null);
  assert.equal(f.alter(db=>db.prepare("SELECT count(*) AS n FROM auth_sessions").get().n),0);
  await f.restart();const b=await f.begin();assert.equal(b.response.status,200);assert.ok(b.id);assert.equal((await f.check(a)).status,200,"pending browser flow survives Node restart");
});
test("first trust requires recovery proof plus password and an explicit destructive-recovery confirmation",async t=>{
  const f=await fixture(t),device=testDevice();
  const missing=await f.begin(device,{code:f.recoveryCodes[0],fields:{confirm_recovery:"no"}});assert.equal(missing.response.status,400);
  const wrong=await f.begin(device,{code:f.recoveryCodes[0],fields:{password:"wrong"}});assert.equal(wrong.response.status,401);
  const owner=await f.exchange(await f.begin(device,{code:f.recoveryCodes[0]}));assert.equal((await owner.request("/v1/bots",{name:"Allowed"})).status,201);
  const state=await (await owner.request("/v1/security/sessions")).json();assert.equal(state.recoveryCodesRemaining,7);assert.equal(state.devices[0].jkt,device.jkt);
  assert.ok(!JSON.stringify(state).includes(f.recoveryCodes[0]));
  const raw=await readFile(path.join(f.dataDir,"auth.sqlite"));for(const code of f.recoveryCodes)assert.ok(!raw.includes(Buffer.from(code)));
});
test("new device is denied all business rights until exact request, key, role and Bot scope are approved",async t=>{
  const f=await fixture(t),admin=await f.first(),flow=await f.begin();
  const a=(await (await admin.request("/v1/bots",{name:"A"})).json()).bot;
  const b=(await (await admin.request("/v1/bots",{name:"B"})).json()).bot;
  assert.equal((await flow.device.request(f.origin+"/v1/snapshot")).status,401);
  assert.equal((await f.approve(admin,flow,VIEWER,{thumbprint:testDevice().jkt})).status,409);
  assert.equal((await f.approve(admin,flow,VIEWER,{expectedVersion:2})).status,409);
  const foreign=f.server.store.createBot("other-owner",randomUUID(),{name:"Foreign",description:""}).bot;
  assert.equal((await f.approve(admin,flow,{role:"viewer",botIds:[foreign.id]})).status,404);
  assert.equal((await f.approve(admin,flow,{role:"viewer",botIds:[a.id]})).status,200);
  assert.equal((await f.approve(admin,flow,ADMIN)).status,409);
  const ready=await f.check(flow);assert.equal(ready.status,303);const other=await f.exchange(flow,ready.headers.get("location"));
  const snapshot=await (await other.request("/v1/snapshot")).json();assert.deepEqual(snapshot.bots.map(bot=>bot.id),[a.id]);assert.ok(!JSON.stringify(snapshot).includes(b.id));
  assert.equal((await other.request("/v1/goals",{botId:a.id,prompt:"not allowed"})).status,403);
  assert.equal((await f.check(flow)).status,403,"approved response cannot issue two codes");
});
test("permission ceilings survive same-key logout, new session, and password reauthentication",async t=>{
  const f=await fixture(t),admin=await f.first(),viewer=await f.second(admin,VIEWER);
  const again=await f.exchange(await f.begin(viewer.device));
  assert.equal((await again.request("/v1/security/sessions")).status,403);
  const snapshot=await (await again.request("/v1/snapshot")).json();assert.equal(snapshot.bots.length,0);
  const state=await (await admin.request("/v1/security/sessions")).json();
  const target=state.sessions.find(s=>s.dpop_jkt===viewer.device.jkt);
  assert.equal((await admin.request(`/v1/security/sessions/${target.id}/grant`,{role:"operator",botIds:[]})).status,200);
  const next=await f.exchange(await f.begin(viewer.device));assert.equal((await next.request("/v1/bots",{name:"Not admin"})).status,403);
  const fresh=await (await admin.request("/v1/security/sessions")).json();assert.ok(fresh.sessions.filter(s=>s.dpop_jkt===viewer.device.jkt).every(s=>s.grant.role==="operator"));
});
test("ordinary session logout does not block a trusted device; explicit device block revokes all same-key sessions",async t=>{
  const f=await fixture(t),admin=await f.first(),other=await f.second(admin);
  const state=await (await other.request("/v1/security/sessions")).json();
  assert.equal((await admin.request(`/v1/security/sessions/${state.currentSessionId}/revoke`,{})).status,200);
  const again=await f.exchange(await f.begin(other.device));const device=(await (await admin.request("/v1/security/sessions")).json()).devices.find(x=>x.jkt===other.device.jkt);
  assert.equal((await admin.request(`/v1/security/devices/${device.jkt}/block`,{expectedVersion:device.version+1})).status,409);
  assert.equal((await admin.request(`/v1/security/devices/${device.jkt}/block`,{expectedVersion:device.version})).status,200);
  assert.equal((await again.request("/v1/snapshot")).status,401);await f.restart();assert.equal((await f.begin(other.device)).response.status,403);
});
test("device block immediately closes live events and invalidates outstanding authorization codes",async t=>{
  const f=await fixture(t),admin=await f.first(),other=await f.second(admin),unexchanged=await f.begin(other.device);
  const ticket=await (await other.request("/v1/events/ticket",{})).json();
  const ws=new WebSocket(f.origin.replace('http:','ws:')+"/v1/events");ws.on('error',()=>{});t.after(()=>ws.terminate());
  await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
  const ready=new Promise(r=>ws.once('message',r));ws.send(JSON.stringify({ticket:ticket.ticket,proof:other.device.proof(f.origin+"/v1/events","GET",ticket.ticket,ticket.nonce),after:0}));await ready;
  const closed=new Promise(r=>ws.once('close',code=>{assert.equal(code,4401);r();}));
  const device=(await (await admin.request("/v1/security/sessions")).json()).devices.find(x=>x.jkt===other.device.jkt);
  assert.equal((await admin.request(`/v1/security/devices/${device.jkt}/block`,{expectedVersion:device.version})).status,200);await closed;
  await assert.rejects(f.exchange(unexchanged));
});
test("viewer cannot approve devices and fresh owner login is required for every trust mutation",async t=>{
  const f=await fixture(t),admin=await f.first(),viewer=await f.second(admin,VIEWER),flow=await f.begin();
  assert.equal((await f.approve(viewer,flow)).status,403);
  f.alter(db=>db.prepare("UPDATE auth_sessions SET created_at=? WHERE dpop_jkt=?").run(Date.now()-360000,admin.device.jkt));
  assert.equal((await f.approve(admin,flow)).status,428);assert.equal((await admin.request("/v1/security/recovery-codes",{})).status,428);
});
test("last administrator cannot accidentally be demoted or blocked",async t=>{
  const f=await fixture(t),admin=await f.first(),state=await (await admin.request("/v1/security/sessions")).json();
  assert.equal((await admin.request(`/v1/security/devices/${admin.device.jkt}/block`,{expectedVersion:state.devices[0].version})).status,409);
  assert.equal((await admin.request(`/v1/security/sessions/${state.currentSessionId}/grant`,VIEWER)).status,409);
  assert.equal((await admin.request("/v1/snapshot")).status,200);
});
test("approval browser cannot be switched, cross-origin polled, cancelled then approved, or replayed after expiry",async t=>{
  const f=await fixture(t),admin=await f.first(),a=await f.begin(),b=await f.begin();
  assert.equal((await f.check(a,"check",b.browser)).status,403);
  assert.equal((await f.post("/oauth/device-approval",{request_id:a.id,csrf:a.browser.csrf,decision:"check"},a.browser,{Origin:"https://attacker.invalid"})).status,403);
  assert.equal((await f.check(a,"cancel")).status,303);assert.equal((await f.approve(admin,a)).status,409);
  f.alter(db=>db.prepare("UPDATE auth_device_requests SET expires=0 WHERE id=?").run(b.id));assert.equal((await f.approve(admin,b)).status,410);assert.equal((await f.check(b)).status,410);
});
test("explicit deny keeps the unapproved key untrusted and audits without tokens or request secrets",async t=>{
  const f=await fixture(t),admin=await f.first(),flow=await f.begin(testDevice(),{name:'<img src=x onerror=bad()>'});
  assert.ok(!flow.page.includes('<img src=x'));
  assert.equal((await admin.request(`/v1/security/requests/${flow.id}/deny`,{expectedVersion:1,thumbprint:flow.device.jkt})).status,200);
  assert.equal((await f.check(flow)).status,403);const state=await (await admin.request("/v1/security/sessions")).json();assert.ok(!state.devices.some(x=>x.jkt===flow.device.jkt));
  const log=await (await admin.request("/v1/security/events")).json();assert.ok(log.events.some(x=>x.kind==="device.denied"&&x.subject_id===flow.id));
  for(const secret of [flow.browser.csrf,flow.verifier,admin.tokens.access_token,admin.tokens.refresh_token,...f.recoveryCodes])assert.ok(!JSON.stringify(log).includes(secret));
});
test("recovery replaces all prior device trust, closes sessions and pending approvals, without deleting Bots",async t=>{
  const f=await fixture(t),admin=await f.first(),other=await f.second(admin),pending=await f.begin();
  const bot=(await (await admin.request("/v1/bots",{name:"Keep identity"})).json()).bot;
  const recovering=await f.exchange(await f.begin(testDevice(),{code:f.recoveryCodes[1]}));
  assert.equal((await admin.request("/v1/snapshot")).status,401);assert.equal((await other.request("/v1/snapshot")).status,401);
  assert.equal((await f.check(pending)).status,403);assert.equal((await f.begin(admin.device)).response.status,403);
  const snapshot=await (await recovering.request("/v1/snapshot")).json();assert.equal(snapshot.bots[0].id,bot.id);
  assert.equal((await f.begin(testDevice(),{code:f.recoveryCodes[1]})).response.status,403);assert.equal((await recovering.request("/v1/snapshot")).status,200);
});
test("recovery codes are Node-specific, rotated atomically, and never work without the owner password",async t=>{
  const a=await fixture(t),b=await fixture(t),admin=await a.first();
  assert.equal((await b.begin(testDevice(),{code:a.recoveryCodes[2]})).response.status,403);
  const rotated=await (await admin.request("/v1/security/recovery-codes",{})).json();assert.equal(new Set(rotated.codes).size,8);
  assert.equal((await a.begin(testDevice(),{code:a.recoveryCodes[2]})).response.status,403);
  const recovered=await a.exchange(await a.begin(testDevice(),{code:rotated.codes[0]}));assert.equal((await recovered.request("/v1/snapshot")).status,200);
});
test("device approvals survive restart but approval from a revoked actor during body upload is rejected",async t=>{
  const f=await fixture(t),admin=await f.first(),actor=await f.second(admin),flow=await f.begin();
  const body=JSON.stringify({expectedVersion:1,thumbprint:flow.device.jkt,grant:ADMIN}),route=`/v1/security/requests/${flow.id}/approve`;
  let reached,finish;const received=new Promise(r=>reached=r);const original=f.server.auth.authenticate.bind(f.server.auth);
  f.server.auth.authenticate=req=>{const id=original(req);if(req.url===route)reached();return id;};
  const result=new Promise((r,j)=>{const req=httpRequest(f.origin+route,{method:"POST",headers:{Authorization:`DPoP ${actor.tokens.access_token}`,DPoP:actor.device.proof(f.origin+route,"POST",actor.tokens.access_token,f.server.auth.getDpopNonce()),"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}},res=>{res.resume();res.on('end',()=>r(res.statusCode));});req.on('error',j);req.setTimeout(5000,()=>req.destroy(Error("timeout")));req.write(body[0]);finish=()=>req.end(body.slice(1));});
  await received;f.server.auth.authenticate=original;
  const target=(await (await actor.request("/v1/security/sessions")).json()).currentSessionId;
  try{assert.equal((await admin.request(`/v1/security/sessions/${target}/revoke`,{})).status,200);}finally{finish();}
  assert.equal(await result,401);assert.equal((await f.approve(admin,flow,VIEWER)).status,200);await f.restart();const ready=await f.check(flow);assert.equal(ready.status,303);const limited=await f.exchange(flow,ready.headers.get("location"));assert.equal((await limited.request("/v1/security/sessions")).status,403);
});
test("migration imports only established keys and intersects same-key grants; blocked trust is never recreated",async t=>{
  const f=await fixture(t),admin=await f.first(),other=await f.second(admin),again=await f.exchange(await f.begin(other.device));
  await f.stop();f.alter(db=>{
    const id=db.prepare("SELECT session_id FROM auth_tokens WHERE hash=?").get(digest(again.tokens.access_token)).session_id;
    db.prepare("UPDATE auth_sessions SET grant_json=? WHERE id=?").run(JSON.stringify(VIEWER),id);
    db.exec("DROP TABLE auth_trusted_devices");
  });
  await f.start();const state=await (await admin.request("/v1/security/sessions")).json();assert.equal(state.devices.find(d=>d.jkt===other.device.jkt).grant.role,"viewer");
  assert.equal((await other.request("/v1/security/sessions")).status,403);const device=state.devices.find(d=>d.jkt===other.device.jkt);
  assert.equal((await admin.request(`/v1/security/devices/${device.jkt}/block`,{expectedVersion:device.version})).status,200);await f.restart();assert.equal((await f.begin(other.device)).response.status,403);
});
test("offline recovery requires a stopped Node and private new output; no overwrite or symlink adoption",async t=>{
  const f=await fixture(t),admin=await f.first(),output=path.join(f.dataDir,"offline-codes.json");
  assert.throws(()=>api.writeOfflineRecoveryCodes(f.dataDir,output),/active BeeBot/);await assert.rejects(stat(output));await f.stop();
  const alias=path.join(temporary,"node-alias-"+randomUUID());await symlink(f.dataDir,alias);
  assert.throws(()=>api.writeOfflineRecoveryCodes(alias,path.join(alias,"not-created.json")),/canonical private directory/);
  await assert.rejects(stat(path.join(f.dataDir,"not-created.json")));
  api.writeOfflineRecoveryCodes(f.dataDir,output);assert.equal((await stat(output)).mode&0o777,0o600);
  const saved=JSON.parse(await readFile(output,"utf8"));assert.equal(saved.codes.length,8);assert.equal(saved.nodeId,f.server.options.config.nodeId);
  assert.throws(()=>api.writeOfflineRecoveryCodes(f.dataDir,output));assert.deepEqual(JSON.parse(await readFile(output,"utf8")),saved);
  const linked=path.join(f.dataDir,"linked-codes");await symlink(output,linked);assert.throws(()=>api.writeOfflineRecoveryCodes(f.dataDir,linked));
  await chmod(f.dataDir,0o755);assert.throws(()=>api.writeOfflineRecoveryCodes(f.dataDir,path.join(f.dataDir,"public-output")),/private/);await chmod(f.dataDir,0o700);
  await f.start();const recovered=await f.exchange(await f.begin(testDevice(),{code:saved.codes[0]}));assert.equal((await recovered.request("/v1/snapshot")).status,200);assert.equal((await admin.request("/v1/snapshot")).status,401);
});


test("failed recovery material persistence rolls back rotation and audit", async t => {
  const f = await fixture(t); const admin = await f.first();
  const before = f.alter(db => db.prepare("SELECT hash,used_at FROM auth_recovery_codes ORDER BY hash").all());
  const events = f.alter(db => db.prepare("SELECT count(*) AS n FROM auth_security_events").get().n);
  assert.throws(() => f.server.auth.offlineRecoveryCodes(() => { throw new Error("simulated fsync failure"); }), /fsync failure/);
  assert.deepEqual(f.alter(db => db.prepare("SELECT hash,used_at FROM auth_recovery_codes ORDER BY hash").all()), before);
  assert.equal(f.alter(db => db.prepare("SELECT count(*) AS n FROM auth_security_events").get().n), events);
  assert.equal((await admin.request("/v1/snapshot")).status, 200);
});
