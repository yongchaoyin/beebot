import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { api, fixture, identity, issuer } from "./helpers/tenant-fixture.mjs";

const input = name => ({ name, description:"Scoped colleague" });
test("two authenticated principals receive independent Bot lists, event cursors and idempotent receipts",async t=>{
  const f=await fixture(t),{workspaces:w}=f;
  const a=await w.createBot(f.scopeA,"same-command",input("A-private"));
  const b=await w.createBot(f.scopeB,"same-command",input("B-private"));
  assert.notEqual(a.bot.id,b.bot.id);assert.equal(a.bot.ownerId,f.tenantA);assert.equal(b.bot.ownerId,f.tenantB);
  assert.deepEqual((await w.snapshot(f.scopeA)).bots,[a.bot]);assert.deepEqual((await w.snapshot(f.scopeB)).bots,[b.bot]);
  assert.deepEqual(await w.createBot(f.scopeA,"same-command",input("A-private")),a);
  assert.equal((await w.events(f.scopeA,0)).events.length,1);
  assert.ok(!JSON.stringify(await w.events(f.scopeA,0)).includes("B-private"));
  await assert.rejects(w.bot(f.scopeA,b.bot.id),{code:"bot_not_found"});
});
test("raw tenant IDs, copied handles, other-directory handles and another customer's scope cannot impersonate membership",async t=>{
  const f=await fixture(t);
  assert.throws(()=>f.directory.scope(()=>f.a,f.tenantB),{code:"workspace_unavailable"});
  for(const handle of [{tenantId:f.tenantB},{...f.scopeA},Object.freeze({tenantId:f.tenantA})])await assert.rejects(f.workspaces.snapshot(handle),{code:"workspace_access_denied"});
  assert.throws(()=>f.directory.scope(()=>f.a,"../../another-db"),{code:"workspace_unavailable"});
  const g=await fixture(t);await assert.rejects(f.workspaces.snapshot(g.scopeA),{code:"workspace_access_denied"});
});
test("identity issuer is part of the principal key, and unknown issuers are denied",async t=>{
  const f=await fixture(t);
  assert.throws(()=>f.directory.scope(()=>({...f.a,issuer:"https://other-issuer.example.test"}),f.tenantA),{code:"workspace_unavailable"});
  assert.throws(()=>f.directory.scope(()=>({...f.a,issuer:"https://attacker.invalid"}),f.tenantA),{code:"workspace_access_denied"});
});
test("member roles intersect the current device grant; viewers cannot create or manage members",async t=>{
  const f=await fixture(t),editor=identity("editor"),viewer=identity("viewer");
  assert.equal(f.directory.setMember(f.scopeA,editor,"editor",0),1);
  f.directory.setMember(f.scopeA,viewer,"viewer",0);
  const e=f.directory.scope(()=>editor,f.tenantA),v=f.directory.scope(()=>viewer,f.tenantA);
  await f.workspaces.createBot(e,"editor-create",input("team work"));
  assert.equal((await f.workspaces.snapshot(v)).bots.length,1);
  await assert.rejects(f.workspaces.createBot(v,"viewer-create",input("no")),{code:"workspace_access_denied"});
  assert.throws(()=>f.directory.setMember(e,identity("intruder"),"owner",0),{code:"workspace_access_denied"});
  editor.deviceRole="viewer";
  await assert.rejects(f.workspaces.createBot(e,"after-device-change",input("no")),{code:"workspace_access_denied"});
});
test("membership removal and role change invalidate existing handles without a new login",async t=>{
  const f=await fixture(t),bScope=()=>f.directory.scope(()=>f.b,f.tenantA);
  f.directory.setMember(f.scopeA,f.b,"editor",0);const s=bScope();
  await f.workspaces.createBot(s,"create-by-member",input("member"));
  f.directory.setMember(f.scopeA,f.b,"viewer",1);
  await assert.rejects(f.workspaces.snapshot(s),{code:"workspace_access_denied"});
  const updated=bScope();assert.equal((await f.workspaces.snapshot(updated)).bots.length,1);
  f.directory.setMember(f.scopeA,f.b,null,2);
  await assert.rejects(f.workspaces.snapshot(updated),{code:"workspace_access_denied"});
});
test("last owner cannot be removed or demoted; stale membership writes are rejected",async t=>{
  const f=await fixture(t);
  assert.throws(()=>f.directory.setMember(f.scopeA,f.a,null,1),{code:"workspace_access_denied"});
  assert.throws(()=>f.directory.setMember(f.scopeA,f.a,"viewer",1),{code:"workspace_access_denied"});
  assert.throws(()=>f.directory.setMember(f.scopeA,f.b,"editor",100),{code:"stale_membership"});
  f.directory.setMember(f.scopeA,f.b,"owner",0);
  f.directory.setMember(f.scopeA,f.a,"editor",1);
  await assert.rejects(f.workspaces.snapshot(f.scopeA),{code:"workspace_access_denied"});
  const a=f.directory.scope(()=>f.a,f.tenantA);assert.equal(f.directory.assert(a,"write").tenantId,f.tenantA);
});
test("account switching or revoked sessions cannot reuse a previously authorized scope",async t=>{
  const f=await fixture(t);let current=f.a,revoked=false;
  const s=f.directory.scope(()=>{if(revoked)throw new Error("expired");return current;},f.tenantA);
  await f.workspaces.snapshot(s);current=f.b;
  await assert.rejects(f.workspaces.snapshot(s),{code:"workspace_access_denied"});
  current=f.a;revoked=true;
  await assert.rejects(f.workspaces.snapshot(s),{code:"workspace_access_denied"});
});
test("suspending A denies its cached access but leaves B operational; stale lifecycle updates fail",async t=>{
  const f=await fixture(t);await f.workspaces.snapshot(f.scopeA);
  const v=f.directory.inspect(f.tenantA).version;
  f.directory.setStatus(f.tenantA,v,"suspended");
  await assert.rejects(f.workspaces.snapshot(f.scopeA),{code:"workspace_access_denied"});
  await f.workspaces.createBot(f.scopeB,"b-still-operates",input("B works"));
  assert.throws(()=>f.directory.setStatus(f.tenantA,v,"active"),{code:"stale_workspace"});
  f.directory.setStatus(f.tenantA,v+1,"active");
  assert.equal((await f.workspaces.snapshot(f.scopeA)).bots.length,0);
});
test("scoped devices see only permitted Bot events and cannot create or elevate workspace membership",async t=>{
  const f=await fixture(t),one=await f.workspaces.createBot(f.scopeA,"bot-one1",input("one")),two=await f.workspaces.createBot(f.scopeA,"bot-two2",input("two"));
  const scoped={...f.a,deviceRole:"operator",botIds:[one.bot.id]},s=f.directory.scope(()=>scoped,f.tenantA);
  assert.deepEqual((await f.workspaces.snapshot(s)).bots.map(b=>b.id),[one.bot.id]);
  const events=await f.workspaces.events(s,0);assert.equal(events.events.length,1);assert.equal(events.cursor,2);
  await assert.rejects(f.workspaces.bot(s,two.bot.id),{code:"workspace_access_denied"});
  await assert.rejects(f.workspaces.createBot(s,"scoped-create",input("no")),{code:"workspace_access_denied"});
  assert.throws(()=>f.directory.setMember(s,f.b,"owner",0),{code:"workspace_access_denied"});
});
test("same command key used by two members is independent, not another member's cached result",async t=>{
  const f=await fixture(t);f.directory.setMember(f.scopeA,f.b,"editor",0);
  const b=f.directory.scope(()=>f.b,f.tenantA);
  const first=await f.workspaces.createBot(f.scopeA,"common-command",input("A"));
  const second=await f.workspaces.createBot(b,"common-command",input("B"));
  assert.notEqual(first.bot.id,second.bot.id);assert.equal((await f.workspaces.snapshot(b)).bots.length,2);
});
test("forged owner fields, invalid identity grants, invalid cursors and invalid command IDs are rejected",async t=>{
  const f=await fixture(t);
  await assert.rejects(f.workspaces.createBot(f.scopeA,"valid-key1",{...input("bad"),ownerId:f.tenantB}));
  await assert.rejects(f.workspaces.createBot(f.scopeA,"x",input("bad")),{code:"invalid_idempotency_key"});
  for(const after of [-1,Infinity,NaN,0.5])await assert.rejects(f.workspaces.events(f.scopeA,after),{code:"invalid_cursor"});
  assert.throws(()=>f.directory.scope(()=>({...f.a,deviceRole:"super-admin"}),f.tenantA),{code:"workspace_access_denied"});
  assert.throws(()=>f.directory.scope(()=>({...f.a,botIds:["not-a-bot"]}),f.tenantA),{code:"workspace_access_denied"});
});
test("provisioning retries retain the tenant/key; concurrent duplicate requests do not create extra tenants",async t=>{
  const f=await fixture(t),w=f.workspaces;
  const [one,two]=await Promise.all([
    w.provision(()=>f.a,"one-new-space","Private-new"),
    w.provision(()=>f.a,"one-new-space","Private-new"),
  ]);
  assert.equal(one,two);
  const key=f.directory.protectedKey(one);
  assert.equal(await w.provision(()=>f.a,"one-new-space","Private-new"),one);
  assert.deepEqual(f.directory.protectedKey(one),key);
  await assert.rejects(w.provision(()=>f.a,"one-new-space","changed"),{code:"provision_conflict"});
});
test("tenant profile name and Bot descriptions are encrypted even in directory/WAL, not only control tables",async t=>{
  const f=await fixture(t);await f.workspaces.createBot(f.scopeA,"private-body",input("UNIQUE-ALICE-DATA-742"));
  const {readdir}=await import("node:fs/promises");
  for(const name of (await readdir(f.dir)).filter(x=>x.startsWith("tenants.sqlite"))){
    const raw=await readFile(path.join(f.dir,name));assert.equal(raw.includes(Buffer.from("Alice private space")),false);assert.equal(raw.includes(Buffer.from("Bob private space")),false);
  }
  const file=path.join(f.dir,"workspaces",f.tenantA,"control.sqlite");
  for(const suffix of ["","-wal"]){
    const raw=await readFile(file+suffix);assert.equal(raw.includes(Buffer.from("UNIQUE-ALICE-DATA-742")),false);
  }
});
test("key unavailability leaves a resumable provisioning record and does not reset or activate it",async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"bb-provision-failure-"));
  const wrapper=new api.LocalTenantKeyWrapper("external-test-key",randomBytes(32)),directory=new api.TenantDirectory(dir,[issuer]),a=identity("a");
  let fail=false,unwrapCount=0;
  const flaky={id:wrapper.id,wrap:(...args)=>wrapper.wrap(...args),unwrap:(...args)=>{if(fail&&++unwrapCount>1)return Promise.reject(new Error("KMS denied"));return wrapper.unwrap(...args);}};
  const w=new api.TenantWorkspaces(directory,flaky);
  t.after(async()=>{await w.close();directory.close();wrapper.close();await rm(dir,{recursive:true,force:true});});
  fail=true;await assert.rejects(w.provision(()=>a,"persistent-key","Retain"),{code:"tenant_storage_unavailable"});
  const db=new DatabaseSync(path.join(dir,"tenants.sqlite"));
  const row=db.prepare("SELECT id,key_json,status FROM tenants").get();db.close();
  assert.equal(row.status,"provisioning");fail=false;
  const id=await w.provision(()=>a,"persistent-key","Retain");
  assert.equal(id,row.id);assert.equal(JSON.stringify(directory.protectedKey(id)),row.key_json);assert.equal(directory.inspect(id).status,"active");
});
test("session revoked during key unwrap cannot return plaintext or create a Bot",async t=>{
  const f=await fixture(t);let allowed=true,release;
  const s=f.directory.scope(()=>{if(!allowed)throw new Error("revoked");return f.a;},f.tenantA);
  await f.workspaces.release(s);
  const real=f.wrapper.unwrap.bind(f.wrapper);
  f.wrapper.unwrap=async(...args)=>{await new Promise(resolve=>{release=resolve;});return real(...args);};
  const attempt=f.workspaces.createBot(s,"revoked-in-flight",input("never persisted"));
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  allowed=false;release();
  await assert.rejects(attempt,{code:"workspace_access_denied"});
  f.wrapper.unwrap=real;
  assert.equal((await f.workspaces.snapshot(f.scopeA)).bots.length,0);
});
test("the storage gateway rejects execution without accepting, dispatching or producing fake results",async t=>{
  const f=await fixture(t),created=await f.workspaces.createBot(f.scopeA,"create-fenced",input("No shared execution"));
  const before=await f.workspaces.events(f.scopeA,0);
  await assert.rejects(f.workspaces.submitGoal(f.scopeA,created.bot.id),{code:"tenant_execution_unavailable"});
  assert.deepEqual(await f.workspaces.events(f.scopeA,0),before);
  assert.equal((await f.workspaces.snapshot(f.scopeA)).execution,"unavailable");
});
test("NodeAuth adapter rereads grants and preserves issuer, principal, Bot scope and revocation",()=>{
  let role="operator",revoked=false,calls=0;
  const identity={principalId:randomUUID(),sessionId:randomUUID()},id=identity.principalId,botId=randomUUID();
  const read=api.nodeTenantIdentity({grant(captured){calls++;assert.equal(captured.principalId,id);if(revoked)throw new Error("revoked");return {role,botIds:[botId]};}},issuer,identity);
  identity.principalId="attempted-mutation";
  assert.deepEqual(read(),{issuer,subject:id,deviceRole:"operator",botIds:[botId]});
  role="viewer";assert.equal(read().deviceRole,"viewer");
  revoked=true;assert.throws(read,/revoked/);assert.equal(calls,3);
});
test("private database directory cannot be redirected through a symlink",async t=>{
  const f=await fixture(t);await f.workspaces.release(f.scopeA);
  const original=path.join(f.dir,"workspaces",f.tenantA),replacement=path.join(f.dir,"redirect-target");
  const {rename,mkdir}=await import("node:fs/promises");
  await rename(original,original+"-saved");await mkdir(replacement,{mode:0o700});await symlink(replacement,original,"dir");
  await assert.rejects(f.workspaces.snapshot(f.scopeA),/private and owned/);
});
test("per-tenant Bot quota does not block authorized idempotent retries or another tenant",async t=>{
  const f=await fixture(t,{maxBots:1});
  const a=await f.workspaces.createBot(f.scopeA,"one-only-bot",input("one"));
  assert.deepEqual(await f.workspaces.createBot(f.scopeA,"one-only-bot",input("one")),a);
  await assert.rejects(f.workspaces.createBot(f.scopeA,"two-too-many",input("two")),{code:"bot_capacity"});
  await f.workspaces.createBot(f.scopeB,"b-one-bot",input("B"));
  assert.equal((await f.workspaces.snapshot(f.scopeB)).bots.length,1);
});
test("directory and encrypted cells restart with the same keys, membership and content",async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"bb-tenants-restart-")),key=randomBytes(32),who=identity("a");
  const wrapper=new api.LocalTenantKeyWrapper("external-test-key",key);
  let d=new api.TenantDirectory(dir,[issuer]),w=new api.TenantWorkspaces(d,wrapper);
  t.after(async()=>{await w.close();d.close();wrapper.close();await rm(dir,{recursive:true,force:true});});
  const id=await w.provision(()=>who,"restart-space","remember"),s=d.scope(()=>who,id);
  const b=await w.createBot(s,"restart-bot",input("Remember"));
  await w.close();d.close();d=new api.TenantDirectory(dir,[issuer]);w=new api.TenantWorkspaces(d,wrapper);
  const fresh=d.scope(()=>who,id);assert.deepEqual(await w.bot(fresh,b.bot.id),b.bot);
  await assert.rejects(w.snapshot(s),{code:"workspace_access_denied"});
});

test("storage shutdown aborts an unresponsive key service and a late key cannot reopen a cell",async t=>{
  const f=await fixture(t);await f.workspaces.release(f.scopeA);
  let finish;
  f.wrapper.unwrap=()=>new Promise(resolve=>{finish=resolve;});
  const read=f.workspaces.snapshot(f.scopeA);
  while(!finish)await new Promise(r=>setImmediate(r));
  const rejected=assert.rejects(read,{code:"tenant_storage_unavailable"});
  await f.workspaces.close();await rejected;
  const late=randomBytes(32);finish(late);await new Promise(r=>setImmediate(r));
  assert.ok(late.every(x=>x===0));await assert.rejects(f.workspaces.snapshot(f.scopeA),{code:"workspace_access_denied"});
});
test("finite open-cell capacity fails without stealing another tenant's database lock",async t=>{
  const f=await fixture(t,{maxOpen:1});
  await f.workspaces.snapshot(f.scopeA);
  await assert.rejects(f.workspaces.snapshot(f.scopeB),{code:"workspace_capacity"});
  assert.equal((await f.workspaces.snapshot(f.scopeA)).bots.length,0);
  await f.workspaces.release(f.scopeA);
  assert.equal((await f.workspaces.snapshot(f.scopeB)).bots.length,0);
});

test("cached data keys have a bounded idle lease and unavailable wrapping keys prevent reopening",async t=>{
  const f=await fixture(t,{keyLeaseMs:30});
  await f.workspaces.createBot(f.scopeA,"lease-bot-key",input("Bounded lease"));
  f.wrapper.close();
  await new Promise(resolve=>setTimeout(resolve,80));
  await assert.rejects(f.workspaces.snapshot(f.scopeA),{code:"tenant_storage_unavailable"});
});
