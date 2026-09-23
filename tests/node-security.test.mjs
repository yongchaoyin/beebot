import assert from "node:assert/strict";
import { createHash, createPublicKey, randomUUID, sign, webcrypto } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import test from "node:test";
import WebSocket from "ws";
import { testDevice } from "./helpers/node-device.mjs";

const temporary = await mkdtemp(path.join(tmpdir(), "beebot-security-"));
const bundle = path.join(temporary, "security.mjs");
await build({ stdin: { contents: `export * from './source/shared/security/dpop.ts'; export * from './source/node/server.ts'; export * from './source/client-connections/transport.ts'; export * from './source/client-connections/manager.ts'; export * from './source/client-connections/secure-store.ts';`, resolveDir: path.resolve(import.meta.dirname, "..") }, outfile: bundle, bundle: true, platform: "node", format: "esm", banner: { js: 'import {createRequire} from "node:module";const require=createRequire(import.meta.url);' }, logLevel: "silent" });
const api = await import(pathToFileURL(bundle));
test.after(() => rm(temporary, { recursive: true, force: true }));
const nonce = "unpredictable-server-nonce-for-unit-tests";
const uri = "https://node.example/v1/goals";
const independent = testDevice();
const verify = (proof, options = {}) => api.verifyDpopProof(proof, { uri, method: "POST", nonces: [nonce], accessToken: "access-token", ...options });

test("ES256 proof interoperates with independent WebCrypto and RFC 7638 thumbprints", async () => {
  const proof = independent.proof(uri, "POST", "access-token", nonce);
  assert.equal(verify(proof).thumbprint, independent.jkt);
  const key = api.generateDpopKey(); const value = api.createDpopProof(key, "POST", uri, { nonce, accessToken: "access-token" });
  const [h,p,s] = value.split('.');
  const publicKey = await webcrypto.subtle.importKey("jwk", key.publicKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, Buffer.from(s, "base64url"), Buffer.from(h+'.'+p)));
  assert.equal(api.importDpopKey(api.exportDpopKey(key)).thumbprint, key.thumbprint);
  assert.equal(api.jwkThumbprint({y:key.publicKey.y,x:key.publicKey.x,kty:"EC",crv:"P-256"}),key.thumbprint);
});
const claims = [
  ["wrong method", { htm: "GET" }], ["lowercase method", { htm: "post" }], ["wrong origin", { htu: "https://other.example/v1/goals" }],
  ["wrong path", { htu: "https://node.example/v1/bots" }], ["query in signed target", { htu: uri+"?admin=true" }],
  ["future proof", { iat: Math.floor(Date.now()/1000)+90 }], ["stale proof", { iat: Math.floor(Date.now()/1000)-180 }],
  ["fractional timestamp", { iat: 1.5 }], ["missing access-token hash", { ath: undefined }], ["different access-token hash", { ath: "wrong" }],
  ["empty replay id", { jti: "" }], ["oversized replay id", { jti: "x".repeat(129) }], ["unknown claim", { other: "value" }],
];
for (const [label,changes] of claims) test(`DPoP rejects ${label}`, () => {
  assert.throws(() => verify(independent.proof(uri, "POST", "access-token", nonce, changes)), { code: "invalid_dpop_proof" });
});
for (const [label,changes] of [["none",{alg:"none"}],["symmetric algorithm",{alg:"HS256"}],["wrong typ",{typ:"JWT"}],["critical extension",{crit:["jku"],jku:"https://evil.example/key"}],["private JWK",{jwk:independent.privateKey.export({format:"jwk"})}]]) {
  test(`DPoP rejects ${label} without resolving external key material`, () => assert.throws(() => verify(independent.proof(uri,"POST","access-token",nonce,{},changes)), {code:"invalid_dpop_proof"}));
}
test("nonce is mandatory, signatures are bounded, and duplicate JSON properties fail closed", () => {
  assert.throws(() => verify(independent.proof(uri,"POST","access-token","wrong-server-nonce")), {code:"use_dpop_nonce"});
  assert.throws(() => verify("a".repeat(4097)), {code:"invalid_dpop_proof"});
  const value=independent.proof(uri,"POST","access-token",nonce);const [h,p] = value.split('.');
  const raw=Buffer.from(p,"base64url").toString().replace('"htm":"POST"','"htm":"GET","htm":"POST"');const next=Buffer.from(raw).toString("base64url");
  const sig=sign("sha256",Buffer.from(h+'.'+next),{key:independent.privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url");
  assert.throws(()=>verify(h+'.'+next+'.'+sig),{code:"invalid_dpop_proof"});
  assert.throws(()=>verify(value+'='),{code:"invalid_dpop_proof"});
});

async function fixture(t) {
  const probe=createServer();await new Promise(r=>probe.listen(0,"127.0.0.1",r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const origin=`http://127.0.0.1:${port}`,dataDir=await mkdtemp(path.join(temporary,"node-"));
  const config={version:1,nodeId:randomUUID(),name:"Security fixture",bindHost:"127.0.0.1",port,publicUrl:origin,maxConcurrentRuns:2};
  let server=new api.BeeBotServer({config,dataDir,runtime:{execute:async()=>({text:"fixture",transcript:[]}),close:async()=>{}}});
  await server.listen();t.after(()=>server.close());
  const password="test-only-correct-owner-passphrase";
  const form=async url=>{const res=await fetch(url);const page=await res.text();assert.equal(res.status,200,page);return {flow_id:/name="flow_id" value="([^"]+)"/.exec(page)[1],csrf:/name="csrf" value="([^"]+)"/.exec(page)[1],cookie:res.headers.get("set-cookie").split(';')[0]};};
  const post=async(route,input,browser)=>fetch(origin+route,{method:"POST",redirect:"manual",headers:{"Content-Type":"application/x-www-form-urlencoded",Origin:origin,Cookie:browser.cookie},body:new URLSearchParams(input)});
  const b=await form(origin+"/setup?code="+server.auth.getSetupInfo().code);const setup=await post("/setup",{...b,username:"owner",password},b);assert.equal(setup.status,200);
  const recovery=/<code data-recovery-code>([^<]+)/.exec(await setup.text())[1];let administrator;
  async function consent(url,browser) {
    let res=await post("/oauth/authorize",{...browser,username:"owner",password,decision:"allow",...(!administrator?{recovery_code:recovery,confirm_recovery:"yes"}:{})},browser);
    if(res.status===200) {
      const page=await res.text(),requestId=/name="request_id" value="([^"]+)"/.exec(page)?.[1];assert.ok(requestId,page);
      const approved=await administrator.request(`/v1/security/requests/${requestId}/approve`,{expectedVersion:1,thumbprint:new URL(url).searchParams.get("dpop_jkt"),grant:{role:"admin",botIds:"*"}});assert.equal(approved.status,200,await approved.clone().text());
      res=await post("/oauth/device-approval",{request_id:requestId,csrf:browser.csrf,decision:"check"},browser);
    }
    return res;
  }
  async function open(url) {if(!administrator)await login();const b=await form(url);const res=await consent(url,b);assert.equal(res.status,303,await res.text());assert.equal((await fetch(res.headers.get("location"))).status,200);}
  async function login(device=testDevice()) {
    const verifier=randomUUID()+randomUUID(); const redirect="http://127.0.0.1:54321/oauth/callback";
    const q=new URLSearchParams({client_id:"beebot-desktop",response_type:"code",scope:"owner:node",state:randomUUID(),redirect_uri:redirect,code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256",dpop_jkt:device.jkt,device_name:"Test laptop"});
    const browser=await form(origin+"/oauth/authorize?"+q);
    const res=await consent(origin+"/oauth/authorize?"+q,browser);assert.equal(res.status,303,await res.clone().text());
    const code=new URL(res.headers.get("location")).searchParams.get("code");
    const params={client_id:"beebot-desktop",grant_type:"authorization_code",code,code_verifier:verifier,redirect_uri:redirect};
    const response=await device.request(origin+"/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams(params)});
    assert.equal(response.status,200,await response.clone().text());const tokens=await response.json();
    const request=(route,body)=>device.request(origin+route,{method:body===undefined?"GET":"POST",headers:{Authorization:`DPoP ${tokens.access_token}`,"Content-Type":"application/json","Idempotency-Key":randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const session = {device,tokens,request,params};administrator ??= session;return session;
  }
  const alter=run=>{const db=new DatabaseSync(path.join(dataDir,"auth.sqlite"));try{return run(db);}finally{db.close();}};
  return {origin,dataDir,login,open,alter,get server(){return server;}, async restart(){await server.close();server=new api.BeeBotServer({config,dataDir,runtime:{execute:async()=>({text:"fixture",transcript:[]}),close:async()=>{}}});await server.listen();}};
}

test("stolen tokens, wrong device refresh and revocation never authenticate or revoke the victim", async t=>{
  const f=await fixture(t),owner=await f.login(),thief=testDevice();
  assert.equal((await fetch(f.origin+"/v1/snapshot",{headers:{Authorization:`Bearer ${owner.tokens.access_token}`}})).status,401);
  assert.equal((await thief.request(f.origin+"/v1/snapshot",{headers:{Authorization:`DPoP ${owner.tokens.access_token}`}})).status,401);
  for(const [route,fields] of [["/oauth/token",{grant_type:"refresh_token",refresh_token:owner.tokens.refresh_token}],["/oauth/revoke",{token:owner.tokens.refresh_token}]]) {
    const response=await thief.request(f.origin+route,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:"beebot-desktop",...fields})});assert.equal(response.status,400);
  }
  assert.equal((await owner.request("/v1/snapshot")).status,200);
  const deniedExchange=await thief.request(f.origin+"/oauth/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams(owner.params)});assert.equal(deniedExchange.status,400);
  assert.equal((await owner.request("/v1/snapshot")).status,200,"wrong-key code replay must not revoke its legitimate session");
});

test("a proof is single-use; same business key plus fresh proof remains idempotent; restart preserves replay records", async t=>{
  const f=await fixture(t),owner=await f.login();
  const route="/v1/bots", key=randomUUID(), nonce=f.server.auth.getDpopNonce();
  const proof=owner.device.proof(f.origin+route,"POST",owner.tokens.access_token,nonce);
  const input={method:"POST",headers:{Connection:"close",Authorization:`DPoP ${owner.tokens.access_token}`,DPoP:proof,"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify({name:"One Bot",description:""})};
  const first=await fetch(f.origin+route,input);assert.equal(first.status,201);const bot=(await first.json()).bot;
  assert.equal((await fetch(f.origin+route,input)).status,401);
  const retried=await owner.device.request(f.origin+route,input);assert.equal(retried.status,201);assert.equal((await retried.json()).bot.id,bot.id);
  const count=f.alter(db=>db.prepare("SELECT count(*) AS n FROM auth_proofs").get().n);assert.ok(count>0);
  await f.restart();assert.equal(f.alter(db=>db.prepare("SELECT count(*) AS n FROM auth_proofs").get().n),count);
  assert.equal((await fetch(f.origin+route,input)).status,401);assert.equal((await owner.request("/v1/snapshot")).status,200);
});

test("device permissions protect snapshots, writes, goal reads, administrative APIs and cross-owner Bot IDs", async t=>{
  const f=await fixture(t),admin=await f.login(),limited=await f.login();
  const a=(await (await admin.request("/v1/bots",{name:"A"})).json()).bot;
  const b=(await (await admin.request("/v1/bots",{name:"B"})).json()).bot;
  const sessions=await (await limited.request("/v1/security/sessions")).json();const id=sessions.currentSessionId;
  assert.equal((await admin.request(`/v1/security/sessions/${id}/grant`,{role:"viewer",botIds:[a.id]})).status,200);
  const snapshot=await (await limited.request("/v1/snapshot")).json();assert.deepEqual(snapshot.bots.map(x=>x.id),[a.id]);
  assert.equal((await limited.request("/v1/goals",{botId:a.id,prompt:"not allowed"})).status,403);
  assert.equal((await limited.request("/v1/bots",{name:"not allowed"})).status,403);
  assert.equal((await limited.request("/v1/security/events")).status,403);
  const gb=await (await admin.request("/v1/goals",{botId:b.id,prompt:"work"})).json();assert.equal((await limited.request(`/v1/goals/${gb.goalId}`)).status,403);
  assert.equal((await admin.request(`/v1/security/sessions/${id}/grant`,{role:"operator",botIds:[a.id]})).status,200);
  assert.equal((await limited.request("/v1/goals",{botId:b.id,prompt:"not allowed"})).status,403);
  assert.equal((await limited.request("/v1/goals",{botId:a.id,prompt:"allowed"})).status,202);
  const foreign=f.server.store.createBot("other-principal",randomUUID(),{name:"Foreign",description:""}).bot;
  assert.equal((await admin.request("/v1/goals",{botId:foreign.id,prompt:"not ours"})).status,404);
  assert.equal((await admin.request(`/v1/security/sessions/${id}/grant`,{role:"viewer",botIds:[foreign.id]})).status,404);
  assert.equal((await limited.request(`/v1/security/sessions/${id}/grant`,{role:"admin",botIds:"*"})).status,403);
});

test("event tickets require the owning key; revocation immediately closes a live WebSocket and survives restart", async t=>{
  const f=await fixture(t),admin=await f.login(),other=await f.login();
  const target=(await (await other.request("/v1/security/sessions")).json()).currentSessionId;
  const ticket=await (await other.request("/v1/events/ticket",{})).json();
  async function connect(proof) {
    const ws=new WebSocket(f.origin.replace('http:','ws:')+"/v1/events");ws.on('error',()=>{});
    t.after(()=>ws.terminate());await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
    ws.send(JSON.stringify({ticket:ticket.ticket,proof,after:0}));return ws;
  }
  const wrong=await connect(testDevice().proof(f.origin+"/v1/events","GET",ticket.ticket,ticket.nonce));
  await new Promise(r=>wrong.once('close',code=>{assert.equal(code,4401);r()}));
  const valid=await connect(other.device.proof(f.origin+"/v1/events","GET",ticket.ticket,ticket.nonce));
  await new Promise(r=>valid.once('message',()=>r()));
  const closed=new Promise(r=>valid.once('close',code=>{assert.equal(code,4401);r()}));
  assert.equal((await admin.request(`/v1/security/sessions/${target}/revoke`,{})).status,200);await closed;
  assert.equal((await other.request("/v1/snapshot")).status,401);
  await f.restart();assert.equal((await other.request("/v1/snapshot")).status,401);
  const events=await (await admin.request("/v1/security/events")).json();assert.ok(events.events.some(e=>e.kind==="session.revoked"&&e.target_session_id===target));
  assert.ok(!JSON.stringify(events).includes(other.tokens.refresh_token));
});

test("security mutations require recent owner authorization, not a silently refreshed old session",async t=>{
  const f=await fixture(t),admin=await f.login();const state=await (await admin.request("/v1/security/sessions")).json();
  f.alter(db=>db.prepare("UPDATE auth_sessions SET created_at=?").run(Date.now()-360_000));
  assert.equal((await admin.request(`/v1/security/sessions/${state.currentSessionId}/grant`,{role:"viewer",botIds:[]})).status,428);
  assert.equal((await admin.request("/v1/snapshot")).status,200,"ordinary work is not interrupted");
});

test("legacy unbound sessions are invalidated without deleting owner or Bot data",async t=>{
  const f=await fixture(t),owner=await f.login();const bot=(await (await owner.request("/v1/bots",{name:"Survivor"})).json()).bot;
  f.alter(db=>db.prepare("UPDATE auth_sessions SET dpop_jkt=NULL").run());await f.restart();
  assert.equal((await owner.request("/v1/snapshot")).status,401);assert.equal(f.server.store.bot(bot.id).name,"Survivor");
  assert.equal(f.server.auth.getSetupInfo().required,false);
});

test("real connection manager preserves its device key across restart, denies another Node, and never exports secrets to profiles",async t=>{
  const f=await fixture(t),g=await fixture(t);let saved=[];
  const persistence={load:async()=>structuredClone(saved),save:async data=>{saved=structuredClone(data)}};
  let manager=new api.NodeConnectionManager(persistence,f.open);t.after(()=>manager.close());
  const profile=await manager.add(f.origin);await manager.login(profile.id);const pem=saved[0].deviceKeyPem;
  const secret=saved[0].refreshToken;assert.ok(pem.startsWith('-----BEGIN PRIVATE KEY-----'));
  assert.ok(!JSON.stringify(await manager.list()).includes(secret));assert.ok(!JSON.stringify(await manager.list()).includes('PRIVATE KEY'));
  manager.close();manager=new api.NodeConnectionManager(persistence,()=>{throw Error("Must not open browser")});await manager.resume(profile.id);
  assert.equal(saved[0].deviceKeyPem,pem);assert.notEqual(saved[0].refreshToken,secret);
  const key=api.importDpopKey(pem),channel=new api.DpopClient(g.origin,key);
  await assert.rejects(api.exchangeToken(g.origin,{grant_type:"refresh_token",refresh_token:saved[0].refreshToken},channel),{status:400});
  assert.equal((await manager.snapshot(profile.id)).node.id,profile.nodeId);
  await manager.logout(profile.id);assert.equal(saved[0].refreshToken,undefined);
});


test("rejected proofs are auditable without secrets and repeated failures do not flood the journal", async t => {
  const f = await fixture(t), owner = await f.login(), intruder = testDevice();
  const request = { headers: { Authorization: `DPoP ${owner.tokens.access_token}` } };
  for (let i = 0; i < 4; i++) assert.equal((await intruder.request(f.origin + "/v1/snapshot", request)).status, 401);
  const log = await (await owner.request("/v1/security/events")).json();
  assert.equal(log.events.filter(event => event.kind === "session.proof_rejected").length, 1);
  assert.ok(!JSON.stringify(log).includes(owner.tokens.access_token));
  assert.ok(!JSON.stringify(log).includes(owner.tokens.refresh_token));
});

test("strict JSON accepts whitespace and escaped member names but rejects duplicate escaped names", () => {
  const key = api.generateDpopKey(), value = api.createDpopProof(key, "POST", uri, { nonce, accessToken: "access-token" });
  const [h,p] = value.split(".");
  const resign = raw => { const body = Buffer.from(raw).toString("base64url"); return h+"."+body+"."+sign("sha256",Buffer.from(h+"."+body),{key:key.privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url"); };
  const raw = Buffer.from(p,"base64url").toString();
  assert.equal(verify(resign(JSON.stringify(JSON.parse(raw), null, 2))).thumbprint, key.thumbprint);
  assert.equal(verify(resign(raw.replace('"htm"', String.raw`"h\u0074m"`))).thumbprint, key.thumbprint);
  assert.throws(() => verify(resign(raw.replace('"htm":"POST"', String.raw`"htm":"POST","h\u0074m":"POST"`))), {code:"invalid_dpop_proof"});
});


test("late protected results are discarded after logout and are not retried under another session", async t => {
  const f = await fixture(t); let saved = [];
  const manager = new api.NodeConnectionManager({load:async()=>saved,save:async value=>{saved=structuredClone(value)}},f.open);
  t.after(()=>manager.close()); const profile = await manager.add(f.origin); await manager.login(profile.id);
  const created = await manager.createBot(profile.id,{name:"Race",description:""},randomUUID());
  const goal = await manager.submitGoal(profile.id,{botId:created.bot.id,prompt:"test"},randomUUID());
  const original = globalThis.fetch; let release, notify;
  const pending = new Promise(r=>release=r), reached = new Promise(r=>notify=r); let reads = 0;
  globalThis.fetch = async (url, init) => {
    const response = await original(url, init);
    if (String(url) === f.origin + "/v1/goals/" + goal.goalId) { reads++; notify(); await pending; }
    return response;
  };
  try {
    const read = manager.goal(profile.id,goal.goalId);
    const rejected = assert.rejects(read,/session changed/);
    await reached; await manager.logout(profile.id); release(); await rejected;
    assert.equal(reads,1); assert.equal((await manager.list())[0].status,"signed-out");
  } finally {release();globalThis.fetch=original;}
});


test("native Node listener enforces TLS 1.3 and validates the server certificate", async t => {
  const dataDir = await mkdtemp(path.join(temporary,"tls-"));
  const keyFile=path.join(dataDir,"key.pem"),certFile=path.join(dataDir,"cert.pem");
  execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",keyFile,"-out",certFile,"-days","1","-subj","/CN=localhost","-addext","subjectAltName=IP:127.0.0.1,DNS:localhost"],{stdio:"ignore"});
  const probe=createServer();await new Promise(r=>probe.listen(0,"127.0.0.1",r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const config={version:1,nodeId:randomUUID(),name:"TLS fixture",bindHost:"127.0.0.1",port,publicUrl:`https://127.0.0.1:${port}`,maxConcurrentRuns:1,tls:{certFile,keyFile}};
  const server=new api.BeeBotServer({config,dataDir,runtime:{execute:async()=>({text:"fixture",transcript:[]}),close:async()=>{}}});
  t.after(()=>server.close());await server.listen();const certificate=await readFile(certFile);
  const request = options => new Promise((resolve,reject) => {
    const req=httpsRequest(config.publicUrl+"/v1/node",{agent:false,timeout:5000,...options},res=>{
      const protocol=res.socket.getProtocol();res.resume();res.on("end",()=>resolve({status:res.statusCode,protocol}));
    });req.on("error",reject);req.on("timeout",()=>req.destroy(Error("TLS test timeout")));req.end();
  });
  assert.deepEqual(await request({ca:certificate,minVersion:"TLSv1.3",maxVersion:"TLSv1.3"}),{status:200,protocol:"TLSv1.3"});
  await assert.rejects(request({ca:certificate,maxVersion:"TLSv1.2"}));
  await assert.rejects(request({minVersion:"TLSv1.3"}));
});


async function delayedBody(f, session, route, input) {
  const payload=JSON.stringify(input); let received;
  const authenticated=new Promise(resolve=>received=resolve);
  const original=f.server.auth.authenticate.bind(f.server.auth);
  f.server.auth.authenticate=req=>{const identity=original(req);if(req.url===route) received();return identity;};
  let finishBody;
  const result=new Promise((resolve,reject)=>{
    const req=httpRequest(f.origin+route,{method:"POST",agent:false,headers:{
      Authorization:`DPoP ${session.tokens.access_token}`,
      DPoP:session.device.proof(f.origin+route,"POST",session.tokens.access_token,f.server.auth.getDpopNonce()),
      "Content-Type":"application/json","Content-Length":Buffer.byteLength(payload),"Idempotency-Key":randomUUID(),
    }},res=>{res.resume();res.on("end",()=>resolve(res.statusCode));});
    req.on("error",reject);req.setTimeout(5000,()=>req.destroy(Error("slow-body test timeout")));
    req.write(payload.slice(0,1));finishBody=()=>req.end(payload.slice(1));
  });
  await authenticated;
  f.server.auth.authenticate=original;
  return {result,finish:()=>finishBody()};
}
test("revoking an authenticated session during a delayed body prevents Bot creation",async t=>{
  const f=await fixture(t),admin=await f.login(),other=await f.login();
  const target=(await (await other.request("/v1/security/sessions")).json()).currentSessionId;
  const before=f.server.store.bots().length;
  const pending=await delayedBody(f,other,"/v1/bots",{name:"Must not be created"});
  try {assert.equal((await admin.request(`/v1/security/sessions/${target}/revoke`,{})).status,200);} finally {pending.finish();}
  assert.equal(await pending.result,401);assert.equal(f.server.store.bots().length,before);
});
test("permission downgrade during delayed goal action bodies prevents cancel accept and reconcile",async t=>{
  const f=await fixture(t),admin=await f.login(),other=await f.login();
  const target=(await (await other.request("/v1/security/sessions")).json()).currentSessionId;
  const bot=(await (await admin.request("/v1/bots",{name:"Scope race"})).json()).bot;
  const goal=await (await admin.request("/v1/goals",{botId:bot.id,prompt:"fixture work"})).json();
  for(const [action,body] of [["cancel",{}],["accept",{expectedVersion:1}],["reconcile",{expectedVersion:1,note:"Controlled test only"}]]) {
    assert.equal((await admin.request(`/v1/security/sessions/${target}/grant`,{role:"operator",botIds:[bot.id]})).status,200);
    const pending=await delayedBody(f,other,`/v1/goals/${goal.goalId}/${action}`,body);
    try {assert.equal((await admin.request(`/v1/security/sessions/${target}/grant`,{role:"viewer",botIds:[bot.id]})).status,200);} finally {pending.finish();}
    assert.equal(await pending.result,403,action+" must not use the old grant");
  }
});
