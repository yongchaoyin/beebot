import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import test from "node:test";
import { testDevice } from "./node-device.mjs";

// macOS tmpdir uses /var -> /private/var; fixtures must supply the same canonical
// path required of operators. Do not relax the production symlink checks.
const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), "bb-enrollment-")));
const bundle = path.join(temporary, "enrollment.mjs");
await build({ stdin: { contents: `export * from './source/node/server.ts'; export * from './source/node/offline-recovery.ts'; export * from './source/client-connections/manager.ts'; export * from './source/node/control-store.ts'; export * from './source/node/control-service.ts'; export * from './source/node/runtime.ts';`, resolveDir: path.resolve(import.meta.dirname, "../..") }, outfile: bundle, bundle: true, format: "esm", platform: "node", banner: { js: 'import {createRequire} from "node:module";const require=createRequire(import.meta.url);' } });
export const api = await import(pathToFileURL(bundle).href);
test.after(() => rm(temporary, { recursive: true, force: true }));
const digest = value => createHash("sha256").update(value).digest("base64url");
const ADMIN = { role: "admin", botIds: "*" };
export async function taskFixture(t, options = {}) {
  const dataDir = await mkdtemp(path.join(temporary, "node-"));
  const probe = createServer(); await new Promise(r => probe.listen(0,"127.0.0.1",r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const origin = `http://127.0.0.1:${port}`;
  const config = { version: 1, nodeId: randomUUID(), name: "Enrollment test", bindHost: "127.0.0.1", publicUrl: origin, port, maxConcurrentRuns: 2 };
  const { writeFile } = await import("node:fs/promises"); await writeFile(path.join(dataDir,"node.json"), JSON.stringify(config), {mode:0o600});
  let server, runtime, closed = false;
  const start = async () => { server = new api.BeeBotServer({ config, dataDir, runtime: (runtime = options.runtime?.(dataDir) ?? { execute: async () => ({text:"fixture",transcript:[]}), close: async () => {} }) }); closed = false; await server.listen(); };
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
    const request=(route,body,key=randomUUID())=>flow.device.request(origin+route,{method:body===undefined?"GET":"POST",headers:{Authorization:`DPoP ${tokens.access_token}`,"Content-Type":"application/json","Idempotency-Key":key},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {...flow,tokens,params,request};
  }
  const first = async () => exchange(await begin(testDevice(),{code:recoveryCodes[0]}));
  const approve = (admin,flow,grant=ADMIN,overrides={}) => admin.request(`/v1/security/requests/${flow.id}/approve`,{expectedVersion:1,thumbprint:flow.device.jkt,grant,...overrides});
  async function second(admin,grant=ADMIN,device=testDevice()) {const flow=await begin(device);assert.equal(flow.response.status,200,flow.page);assert.equal((await approve(admin,flow,grant)).status,200);const ready=await check(flow);assert.equal(ready.status,303,await ready.clone().text());return exchange(flow,ready.headers.get("location"));}
  const alter=run=>{const db=new DatabaseSync(path.join(dataDir,"auth.sqlite"));try{return run(db);}finally{db.close();}};
  return {dataDir,origin,password,recoveryCodes,form,post,begin,check,exchange,first,second,approve,alter,stop,start,get runtime(){return runtime;}, get server(){return server;},async restart(){await stop();await start();}};
}

