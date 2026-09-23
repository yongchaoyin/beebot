import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(tmpdir(), "beebot-connect-"));
await build({stdin:{contents:`export * from './source/client-connections/discovery.ts'; export * from './source/client-connections/manager.ts';`,resolveDir:root}, outfile:path.join(temp,"test.mjs"),bundle:true,platform:"node",format:"esm",banner:{js:'import{createRequire}from"node:module";const require=createRequire(import.meta.url);'},logLevel:"silent"});
const { validateNodeDiscovery, NodeConnectionManager } = await import(pathToFileURL(path.join(temp,"test.mjs")));
test.after(()=>rm(temp,{recursive:true,force:true}));
const base="https://node.example";
const node=()=>({id:"test-node",nodeId:"test-node",name:"My Node",protocolVersion:1,security:{dpopRequired:true,trustedDevicesRequired:true}});
const metadata=origin=>({issuer:origin,authorization_endpoint:origin+"/oauth/authorize",token_endpoint:origin+"/oauth/token",revocation_endpoint:origin+"/oauth/revoke",response_types_supported:["code"],grant_types_supported:["authorization_code","refresh_token"],code_challenge_methods_supported:["S256"],token_endpoint_auth_methods_supported:["none"],dpop_signing_alg_values_supported:["ES256"],authorization_response_iss_parameter_supported:true,beebot_dpop_required:true,beebot_trusted_devices_required:true});
function defer(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
async function fixture(t){
  const calls=[],config={node:node(),metadata:null,redirect:null,padding:0,gate:null},persist={records:[],saves:0,gate:null};
  const server=createServer(async(req,res)=>{
    calls.push({url:req.url,headers:req.headers});
    assert.equal(req.headers.authorization,undefined);assert.equal(req.headers.dpop,undefined);assert.equal(req.headers.cookie,undefined);
    if(config.gate)await config.gate.promise;
    if(config.redirect){res.writeHead(302,{Location:config.redirect});return res.end();}
    const result=req.url==="/v1/node"?config.node:{...config.metadata,...(config.padding?{padding:"x".repeat(config.padding)}:{})};
    res.setHeader("Content-Type","application/json");res.end(JSON.stringify(result));
  });
  await new Promise(r=>server.listen(0,"127.0.0.1",r));const origin=`http://127.0.0.1:${server.address().port}`;config.metadata=metadata(origin);
  const persistence={async load(){return structuredClone(persist.records);},async save(value){persist.saves++;if(persist.gate)await persist.gate.promise;persist.records=structuredClone(value);}};
  const manager=new NodeConnectionManager(persistence,()=>assert.fail("Discovery must never open a browser"));
  t.after(async()=>{config.gate?.resolve();persist.gate?.resolve();manager.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
  return{manager,config,persist,calls,origin};
}
test("discovery returns only bounded public identity, never arbitrary server fields",()=>{
  assert.deepEqual(validateNodeDiscovery(base,{...node(),refreshToken:"untrusted",owner:"private"},metadata(base)),{baseUrl:base,nodeId:"test-node",name:"My Node",protocolVersion:1});
});
for(const field of ["issuer","authorization_endpoint","token_endpoint","revocation_endpoint"])test(`discovery rejects mismatched ${field} before authentication`,()=>{
  for(const value of ["https://evil.example/oauth/token",base+"/",base+"/oauth/token?target=other",null])assert.throws(()=>validateNodeDiscovery(base,node(),{...metadata(base),[field]:value}),/identity|endpoints/);
});
for(const field of ["response_types_supported","grant_types_supported","code_challenge_methods_supported","token_endpoint_auth_methods_supported","dpop_signing_alg_values_supported","authorization_response_iss_parameter_supported","beebot_dpop_required","beebot_trusted_devices_required"])test(`discovery refuses missing secure capability ${field}`,()=>{
  assert.throws(()=>validateNodeDiscovery(base,node(),{...metadata(base),[field]:undefined}),/secure|device/);
});
test("invalid and deceptive server identity cannot become a connection label",()=>{
  for(const change of [{name:""},{name:"n".repeat(101)},{name:"trusted\u202ehost"},{id:"\n"},{nodeId:"other"},{protocolVersion:2},{security:{dpopRequired:true}}])assert.throws(()=>validateNodeDiscovery(base,{...node(),...change},metadata(base)));
});
test("inspect is read-only; explicit confirmation rechecks, saves once and stays signed-out",async t=>{
  const f=await fixture(t),p=await f.manager.inspect(f.origin);
  assert.equal(f.persist.saves,0);assert.deepEqual(await f.manager.list(),[]);assert.equal(p.expiresAt-p.checkedAt,300000);
  assert.deepEqual(f.calls.map(c=>c.url),["/v1/node","/.well-known/oauth-authorization-server"]);
  const [a,b]=await Promise.all([f.manager.confirmConnection(p.previewId),f.manager.confirmConnection(p.previewId)]);
  assert.equal(a.id,b.id);assert.equal(a.status,"signed-out");assert.equal(f.persist.saves,1);assert.equal(f.persist.records[0].deviceKeyPem,undefined);
  assert.equal(f.calls.length,4);assert.equal((await f.manager.confirmConnection(p.previewId)).id,a.id);
});
test("forged or expired preview cannot save a connection",async t=>{
  const f=await fixture(t),p=await f.manager.inspect(f.origin);
  await assert.rejects(f.manager.confirmConnection(randomUUID()),/expired/);
  t.mock.method(Date,"now",()=>p.expiresAt);
  await assert.rejects(f.manager.confirmConnection(p.previewId),/expired/);assert.equal(f.persist.saves,0);
});
test("changed server identity or metadata after preview is refused without saving or login",async t=>{
  const f=await fixture(t),p=await f.manager.inspect(f.origin);
  f.config.node={...node(),id:"replacement",nodeId:"replacement"};
  await assert.rejects(f.manager.confirmConnection(p.previewId),/identity changed/);
  f.config.node=node();f.config.metadata.issuer="https://elsewhere.example";
  await assert.rejects(f.manager.confirmConnection(p.previewId),/identity/);assert.equal(f.persist.saves,0);
});
test("saved origin is never silently rebound to another node",async t=>{
  const f=await fixture(t),p=await f.manager.add(f.origin);f.config.node={...node(),id:"replacement",nodeId:"replacement"};
  await assert.rejects(f.manager.add(f.origin),/identity changed/);assert.equal((await f.manager.list())[0].id,p.id);assert.equal(f.persist.saves,1);
});
test("redirects are not followed and discovery documents have a small body bound",async t=>{
  const f=await fixture(t);f.config.redirect=f.origin+"/elsewhere";
  await assert.rejects(f.manager.inspect(f.origin));assert.equal(f.calls.length,1);
  f.config.redirect=null;f.config.padding=65536;await assert.rejects(f.manager.inspect(f.origin),/limit/);assert.equal(f.persist.saves,0);
});
test("closing the manager while a check is in flight prevents a saved connection",async t=>{
  const f=await fixture(t);f.config.gate=defer();const op=f.manager.add(f.origin);
  while(!f.calls.length)await new Promise(r=>setTimeout(r,5));f.manager.close();f.config.gate.resolve();
  await assert.rejects(op,/closed/);assert.equal(f.persist.saves,0);
});
test("concurrent confirms await the same durable save rather than acknowledging early",async t=>{
  const f=await fixture(t),p=await f.manager.inspect(f.origin);f.persist.gate=defer();
  const a=f.manager.confirmConnection(p.previewId);while(!f.persist.saves)await new Promise(r=>setTimeout(r,5));
  let secondDone=false;const b=f.manager.confirmConnection(p.previewId).then(v=>{secondDone=true;return v;});
  await new Promise(r=>setTimeout(r,20));assert.equal(secondDone,false);f.persist.gate.resolve();assert.equal((await a).id,(await b).id);
});
