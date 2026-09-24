import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, openSync, closeSync, fstatSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test, after } from "node:test";
import { build } from "esbuild";
const root=path.resolve(import.meta.dirname,".."), temp=mkdtempSync(path.join(tmpdir(),"bb-model-binding-"));
const entry=path.join(temp,"entry.ts"), output=path.join(temp,"module.cjs");
writeFileSync(entry, ["shared/node/local-inference-snapshot", "shared/node/settings/sand-settings-store", "electron-main/main-edge", "host/extensions/inference/resolve-inference", "electron-main/coordinator/coordinator-resync", "shared/node/atomic-write"].map(p=>`export * from ${JSON.stringify(path.join(root,"source",p+".ts"))};`).join("\n"));
await build({entryPoints:[entry],bundle:true,platform:"node",format:"cjs",outfile:output,logLevel:"silent"});
const m=createRequire(import.meta.url)(output);
after(()=>rmSync(temp,{recursive:true,force:true}));
let n=0;
function setup(){
 const directory=path.join(temp,String(++n)), file=path.join(directory,"settings.json");
 const store=new m.SandSettingsStore(file), updates=[];
 const handlers=m.createMainEdgeHandlers({settingsStore:store,onboardingSeen:{apply:()=>{}},cursorAccount:{syncPresentedAuth:()=>{}},syncHostSettingsToBox:async v=>{updates.push(v);return v;}});
 return {store,file,directory,handlers,updates};
}
const api=(label="A",extras={})=>({provider:"custom",label,baseUrl:"https://models.example.test/v1",modelId:"model-a",apiKey:"test-key-a",...extras});
function host(file,fn){const old=process.env.BEEBOT_LOCAL_INFERENCE_SNAPSHOT;process.env.BEEBOT_LOCAL_INFERENCE_SNAPSHOT=path.join(m.localInferenceDirectory(file),"current.json");try{return fn();}finally{if(old===undefined)delete process.env.BEEBOT_LOCAL_INFERENCE_SNAPSHOT;else process.env.BEEBOT_LOCAL_INFERENCE_SNAPSHOT=old;}}
function routed(file,id){return host(file,()=>{const store=new m.SandSettingsStore(path.join(temp,"stale-host-settings.json"));const resolved=m.resolveInferenceForAgent("bot-a",{readProfile:()=>({inferenceVendorId:id}),getInferenceVendor:i=>store.getInferenceVendor(i),getInferenceProvider:()=>store.getInferenceProvider()});return {...resolved,session:m.snapshotHttpSession(m.readLocalInferenceSnapshot(),resolved.provider,resolved.vendor)};});}

test("already-running local host sees newly saved API, exact identity and its own key",async()=>{
 const x=setup();x.store.setInferenceVendors([]);m.publishLocalInferenceSnapshot(x.file);
 const saved=await x.handlers.upsertInferenceVendor(api());const id=saved.vendors[0].id;
 assert.equal(routed(x.file,id).vendor.id,id);assert.equal(routed(x.file,id).session.apiKey,"test-key-a");
 assert.equal(x.updates.at(-1).inferenceVendors[0].id,id);
 assert.equal(JSON.stringify(saved).includes("test-key-a"),false);
});
test("API rotation through first-run/router path updates the same named account key",async()=>{
 const x=setup(),{vendors}=await x.handlers.upsertInferenceVendor(api());
 await x.handlers.setInferenceRouter({...api(),apiKey:"rotated-key"});
 assert.equal(x.store.getInferenceVendors()[0].id,vendors[0].id);
 assert.equal(routed(x.file,vendors[0].id).session.apiKey,"rotated-key");
 assert.equal(x.updates.at(-1).defaultInferenceVendorId,vendors[0].id);
});
test("editing one account does not select another account or share its key",async()=>{
 const x=setup(),first=await x.handlers.upsertInferenceVendor(api());
 const second=await x.handlers.upsertInferenceVendor(api("B",{modelId:"model-b",apiKey:"key-b"}));
 const b=second.vendors.find(v=>v.label==="B");assert.equal(second.defaultVendorId,first.defaultVendorId);
 assert.equal(routed(x.file,b.id).session.apiKey,"key-b");assert.equal(routed(x.file,first.defaultVendorId).session.apiKey,"test-key-a");
 assert.equal(x.store.getInferenceHttp().modelId,"model-a");
 await x.handlers.upsertInferenceVendor({...api("B"),id:b.id,modelId:"model-b",apiKey:""});
 assert.equal(routed(x.file,b.id).session.apiKey,"key-b");
});
test("new named API cannot borrow an unrelated provider credential",async()=>{
 const x=setup();x.store.setInferenceVendors([]);writeFileSync(path.join(x.directory,"box-secrets.json"),JSON.stringify({version:1,secrets:{CUSTOM_API_KEY:"unrelated"}}));
 await assert.rejects(()=>x.handlers.upsertInferenceVendor(api("New",{apiKey:""})),/needs an API key/);
 assert.deepEqual(x.store.getInferenceVendors(),[]);
});
test("deleted bound API does not silently fallback; deletion reaches the host and backup",async()=>{
 const x=setup(),a=await x.handlers.upsertInferenceVendor(api());
 await x.handlers.upsertInferenceVendor(api("B",{modelId:"model-b",apiKey:"key-b"}));
 await x.handlers.deleteInferenceVendor({id:a.defaultVendorId});
 assert.throws(()=>routed(x.file,a.defaultVendorId),/not available/);
 for(const v of x.store.getInferenceVendors())await x.handlers.deleteInferenceVendor({id:v.id});
 assert.deepEqual(x.updates.at(-1).inferenceVendors,[]);
 assert.deepEqual(new m.SandSettingsStore(x.file).getInferenceVendors(),[]);
 assert.deepEqual(JSON.parse(readFileSync(x.file+".bak","utf8")).inferenceVendors,[]);
});
test("invalid or unavailable declared snapshot never falls back to old container settings",()=>{
 const x=setup();assert.throws(()=>host(x.file,()=>new m.SandSettingsStore(x.file).getInferenceProvider()),/unavailable|invalid/);
});
test("failed snapshot publication preserves prior complete payload and never echoes keys",async()=>{
 const x=setup();await x.handlers.upsertInferenceVendor(api());const file=path.join(m.localInferenceDirectory(x.file),"current.json"),before=readFileSync(file);
 writeFileSync(x.file,'{"inferenceVendors": "broken"}');assert.throws(()=>m.publishLocalInferenceSnapshot(x.file),e=>!e.message.includes("test-key-a")&&/malformed/.test(e.message));
 assert.deepEqual(readFileSync(file),before);
});
test("snapshot includes only routing keys, not unrelated desktop secrets",async()=>{
 const x=setup();await x.handlers.upsertInferenceVendor(api());const f=path.join(x.directory,"box-secrets.json"),s=JSON.parse(readFileSync(f));s.secrets.SSH_PRIVATE_KEY="never-share";writeFileSync(f,JSON.stringify(s));m.publishLocalInferenceSnapshot(x.file);
 assert.equal(readFileSync(path.join(m.localInferenceDirectory(x.file),"current.json"),"utf8").includes("never-share"),false);
 assert.equal(statSync(m.localInferenceDirectory(x.file)).mode&0o777,0o700);
});
test("snapshot and settings use replacement, so existing file handles never see partial JSON",async()=>{
 const x=setup();await x.handlers.upsertInferenceVendor(api());const f=path.join(m.localInferenceDirectory(x.file),"current.json"),fd=openSync(f,"r");
 try{const old=fstatSync(fd).ino;await x.handlers.upsertInferenceVendor(api("B",{modelId:"model-b",apiKey:"key-b"}));assert.notEqual(statSync(f).ino,old);assert.equal(JSON.parse(readFileSync(fd,"utf8")).vendors.length,1);assert.equal(JSON.parse(readFileSync(f,"utf8")).vendors.length,2);}finally{closeSync(fd);}
});
test("raw keys alone cannot reconstruct an unknown endpoint/model or revive missing catalog",()=>{
 const x=setup();x.store.setInferenceVendors([]);const raw=JSON.parse(readFileSync(x.file));delete raw.inferenceVendors;writeFileSync(x.file,JSON.stringify(raw));
 writeFileSync(path.join(x.directory,"box-secrets.json"),JSON.stringify({version:1,secrets:{VENDOR_lost_KEY:"key",DEEPSEEK_API_KEY:"key"}}));
 assert.deepEqual(new m.SandSettingsStore(x.file).getInferenceVendors(),[]);
});
test("reconnect resends authoritative catalog including deletions and default, after secrets",async()=>{
 const calls=[];let catalog={inferenceVendors:[{id:"a"}],defaultInferenceVendorId:"a"};
 const chain=m.createCoordinatorResyncChain({legs:{getHostSettings:async()=>({}),setHostSettings:async s=>calls.push(s)},getMcpCustomInstructionsAccountScope:()=>null,getMcpCustomInstructionsByServerId:()=>({}),getMcpDisabledToolsByServerId:()=>({}),setMcpCustomInstructionsByServerId:()=>{},setMcpDisabledToolsByServerId:()=>{},detectTimeZone:()=>null,getUserTimeZoneOverride:()=>null,getComputerUseModel:()=>null,getAutoReviewInstructions:()=>({}),getLocalToolPermission:()=>"ask",getWebauthnProxyEnabled:()=>false,getFeatureFlagOverrides:()=>({}),pushBoxSecrets:async()=>calls.push("secrets"),syncWindowFocused:async()=>{},getInferenceSettings:()=>catalog});
 await chain.onTransportConnected();assert.ok(calls.indexOf("secrets")<calls.indexOf(catalog));
 catalog={inferenceVendors:[],defaultInferenceVendorId:null};await chain.onTransportConnected();assert.ok(calls.includes(catalog));
});
test("changed model metadata between resolution and execution fails rather than rerouting",async()=>{
 const x=setup(),saved=await x.handlers.upsertInferenceVendor(api()),before=saved.vendors[0];
 await x.handlers.upsertInferenceVendor({...api(),id:before.id,baseUrl:"https://another.example.test/v1"});
 assert.throws(()=>host(x.file,()=>m.snapshotHttpSession(m.readLocalInferenceSnapshot(),"custom",before)),/changed or is missing/);
});

test("router cannot send an existing key to a newly entered endpoint without explicit key input",async()=>{
 const x=setup();await x.handlers.upsertInferenceVendor(api());
 await assert.rejects(()=>x.handlers.setInferenceRouter({...api(),baseUrl:"https://other.example.test/v1",apiKey:""}),/needs/);
 assert.equal(x.store.getInferenceVendors().length,1);
 assert.equal(x.store.getInferenceHttp().baseUrl,"https://models.example.test/v1");
});
