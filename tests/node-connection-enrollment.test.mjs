import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import test from "node:test";
const temp=await mkdtemp(path.join(tmpdir(),"beebot-connection-enroll-"));
await build({stdin:{contents:"export * from './source/node/server.ts';export * from './source/client-connections/manager.ts';",resolveDir:path.resolve(import.meta.dirname,"..")},outfile:path.join(temp,"api.mjs"),bundle:true,platform:"node",format:"esm",banner:{js:'import{createRequire}from"node:module";const require=createRequire(import.meta.url);'},logLevel:"silent"});
const {BeeBotServer,NodeConnectionManager}=await import(pathToFileURL(path.join(temp,"api.mjs")));
test.after(()=>rm(temp,{recursive:true,force:true}));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<200;i++){if(await check())return;await delay(10);}assert.fail("condition not reached");}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return{resolve,promise};}
async function fixture(t){
  const probe=createServer();await new Promise(r=>probe.listen(0,"127.0.0.1",r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const origin=`http://127.0.0.1:${port}`,dataDir=await mkdtemp(path.join(temp,"data-"));
  const server=new BeeBotServer({config:{version:1,nodeId:randomUUID(),name:"Existing server",bindHost:"127.0.0.1",port,publicUrl:origin,maxConcurrentRuns:1},dataDir,runtime:{execute:async()=>({text:"fixture",transcript:[]}),close:async()=>{}}});
  await server.listen();const managers=[];t.after(async()=>{managers.forEach(m=>m.close());await server.close();});
  const password="temporary-test-owner-passphrase";
  const form=async url=>{const r=await fetch(url),page=await r.text();assert.equal(r.status,200);return{flow_id:/name="flow_id" value="([^"]+)"/.exec(page)[1],csrf:/name="csrf" value="([^"]+)"/.exec(page)[1],cookie:r.headers.get("set-cookie").split(";")[0]};};
  const post=(route,body,b)=>fetch(origin+route,{method:"POST",redirect:"manual",headers:{Origin:origin,Cookie:b.cookie,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(body)});
  const setupForm=await form(origin+"/setup?code="+server.auth.getSetupInfo().code);
  const setup=await post("/setup",{...setupForm,username:"owner",password},setupForm);assert.equal(setup.status,200);
  const recoveryCode=/<code data-recovery-code>([^<]+)/.exec(await setup.text())[1];
  const create=open=>{let records=[];const persistence={async load(){return structuredClone(records)},async save(value){records=structuredClone(value)}};const manager=new NodeConnectionManager(persistence,open);managers.push(manager);return{manager,records:()=>records}};
  const reply=async r=>{assert.equal(r.status,303,await r.clone().text());const done=await fetch(r.headers.get("location"));assert.equal(done.status,200);assert.match(await done.text(),/Authorization received/);};
  const admin=create(async url=>{const b=await form(url);await reply(await post("/oauth/authorize",{...b,username:"owner",password,decision:"allow",recovery_code:recoveryCode,confirm_recovery:"yes"},b));});
  const adminId=(await admin.manager.confirmConnection((await admin.manager.inspect(origin)).previewId)).id;
  await admin.manager.login(adminId,"Administrator test device");await until(async()=> (await admin.manager.list())[0].status==="online");
  async function begin(url){const b=await form(url),r=await post("/oauth/authorize",{...b,username:"owner",password,decision:"allow"},b);assert.equal(r.status,200);const page=await r.text();assert.match(page,/等待可信设备批准/);return{b,id:/name="request_id" value="([^"]+)"/.exec(page)[1],jkt:new URL(url).searchParams.get("dpop_jkt")};}
  async function finish(flow){await reply(await post("/oauth/device-approval",{request_id:flow.id,csrf:flow.b.csrf,decision:"check"},flow.b));}
  return{server,origin,create,admin,adminId,begin,finish};
}
test("existing server -> client preview -> browser login -> exact device approval -> scoped Bots",async t=>{
  const f=await fixture(t),pending=deferred();
  const first=await f.admin.manager.createBot(f.adminId,{name:"Allowed",description:"test"},randomUUID());
  await f.admin.manager.createBot(f.adminId,{name:"Private",description:"test"},randomUUID());
  const client=f.create(async url=>{assert.equal(new URL(url).searchParams.get("device_name"),"Work Mac");pending.resolve(await f.begin(url));});
  const inspected=await client.manager.inspect(f.origin);assert.equal(client.records().length,0);
  const id=(await client.manager.confirmConnection(inspected.previewId)).id;
  const login=client.manager.login(id,"Work Mac");void login.catch(()=>{});const flow=await pending.promise;
  assert.equal((await client.manager.list())[0].loginStage,"browser-authorization");
  assert.equal(client.records()[0].refreshToken,undefined);
  await assert.rejects(client.manager.snapshot(id),/Sign in/);
  const state=await f.admin.manager.securitySessions(f.adminId);const request=state.requests.find(r=>r.id===flow.id);assert.ok(request);
  await f.admin.manager.decideDevice(f.adminId,flow.id,request.version,flow.jkt,{role:"viewer",botIds:[first.bot.id]});
  await f.finish(flow);await login;await until(async()=> (await client.manager.list())[0].status==="online");
  const snapshot=await client.manager.snapshot(id);assert.deepEqual(snapshot.bots.map(b=>b.id),[first.bot.id]);
  await assert.rejects(client.manager.createBot(id,{name:"Forbidden",description:"test"},randomUUID()),/authorized/);
  assert.equal((await client.manager.list())[0].loginStage,undefined);
  for(const secret of [client.records()[0].deviceKeyPem,client.records()[0].refreshToken])assert.ok(!JSON.stringify(await client.manager.list()).includes(secret));
});
test("cancelling local browser waiting grants no access, revokes no existing device and starts no task",async t=>{
  const f=await fixture(t),pending=deferred(),client=f.create(async url=>pending.resolve(await f.begin(url)));
  const id=(await client.manager.add(f.origin)).id;
  const login=client.manager.login(id);const rejected=assert.rejects(login,/cancelled/);const flow=await pending.promise;
  await client.manager.cancelLogin(id);await rejected;
  assert.equal((await client.manager.list())[0].status,"signed-out");assert.equal(client.records()[0].refreshToken,undefined);
  const security=await f.admin.manager.securitySessions(f.adminId);
  assert.ok(security.requests.some(r=>r.id===flow.id),"server request is not claimed revoked by local cancellation");
  assert.equal(security.devices.length,1,"only the original admin remains trusted");
  assert.equal((await f.admin.manager.snapshot(f.adminId)).goals.length,0);
});
