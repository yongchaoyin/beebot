import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";
import { api } from "./helpers/tenant-fixture.mjs";

async function protectedStore(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bb-sealed-control-"));
  const wrapper = new api.LocalTenantKeyWrapper("test-kek", randomBytes(32));
  const key = await api.newTenantKey(randomUUID(), wrapper);
  const codec = await api.TenantRecordCodec.open(key, wrapper);
  let store = new api.ControlStore(dir, codec);
  t.after(async () => { store.close(); codec.close(); wrapper.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, wrapper, key, codec, get store() { return store; },
    restart() { store.close(); store = new api.ControlStore(dir, codec); } };
}
const bot = store => store.createBot("owner", "create-colleague", { name: "PRIVATE-BOT-731", description: "PRIVATE-ROLE-731" }).bot;

test("independent tenant data keys and random nonces; wrong tenant/table/record cannot decrypt", async t => {
  const f = await protectedStore(t), codec = f.codec;
  const secondKey = await api.newTenantKey(randomUUID(), f.wrapper), second = await api.TenantRecordCodec.open(secondKey, f.wrapper);
  t.after(() => second.close());
  const a = codec.encode("bots", "one", { text: "private" }), b = codec.encode("bots", "one", { text: "private" });
  assert.notEqual(a,b); assert.deepEqual(codec.decode("bots","one",a),{text:"private"});
  for (const [c,table,id] of [[second,"bots","one"],[codec,"goals","one"],[codec,"bots","two"]]) {
    assert.throws(() => c.decode(table,id,a), { code:"tenant_storage_unavailable" });
  }
  assert.notEqual(codec.fingerprint("same command"),second.fingerprint("same command"));
});
test("modified/truncated envelopes, short tags, invalid encoding and plaintext never decode", async t => {
  const f=await protectedStore(t), good=f.codec.encode("bots","one",{text:"private"});
  const bytes=Buffer.from(good.slice(5),"base64url");bytes[14]^=1;
  for(const bad of [JSON.stringify({text:"private"}),good.slice(0,-12),"bbt1.AA","bbt1."+bytes.toString("base64url"),good+"=","bbt2."+good.slice(5)]) {
    assert.throws(()=>f.codec.decode("bots","one",bad),{code:"tenant_storage_unavailable"});
  }
});
test("wrapped keys authenticate tenant/key context and unavailable provider never creates a replacement key",async t=>{
  const f=await protectedStore(t);
  for(const key of [{...f.key,tenantId:randomUUID()},{...f.key,keyId:randomUUID()},{...f.key,wrapperId:"unknown"},{...f.key,purpose:"other"}]) {
    await assert.rejects(api.TenantRecordCodec.open(key,f.wrapper),{code:"tenant_storage_unavailable"});
  }
  const denied={id:f.wrapper.id,async unwrap(){throw new Error("secret KMS details");},async wrap(){assert.fail("must not generate a replacement");}};
  await assert.rejects(api.TenantRecordCodec.open(f.key,denied),e=>e.code==="tenant_storage_unavailable"&&!e.message.includes("secret"));
});
test("closed key handles cannot encrypt, decrypt or produce command fingerprints",async t=>{
  const f=await protectedStore(t), c=await api.TenantRecordCodec.open(f.key,f.wrapper), text=c.encode("bots","one",{});
  c.close();
  for(const fn of [()=>c.encode("bots","one",{}),()=>c.decode("bots","one",text),()=>c.fingerprint("x")])assert.throws(fn,{code:"tenant_storage_unavailable"});
});
test("messages, results, receipts, decisions, provenance, events and WAL contain no plaintext business payload",async t=>{
  const f=await protectedStore(t),s=f.store,b=bot(s),prompt="PRIVATE-PROMPT-731",result="PRIVATE-RESULT-731",note="PRIVATE-INSPECTION-731";
  const source={nodeId:randomUUID(),sessionId:randomUUID(),deviceJkt:randomBytes(32).toString("base64url")};
  const {goalId}=s.submitGoal("owner","goal-private",{botId:b.id,prompt},source),start=s.start(goalId);
  s.finish(goalId,start.run.id,"uncertain",{result,transcript:[{role:"assistant",text:"PRIVATE-TRANSCRIPT-731"}]});
  s.reconcile("owner","inspect-private",goalId,s.goal(goalId).version,note);
  s.freezeTasks("owner",randomUUID(),"freeze-private","bot",b.id);
  const db=new DatabaseSync(path.join(f.dir,"control.sqlite"));
  try {
    for(const table of ["bots","goals","tasks","runs","transcripts","decisions","events","task_authorizations","task_freezes"]) {
      const rows=db.prepare(`SELECT data FROM ${table}`).all(); assert.ok(rows.length>0,table);
      assert.ok(rows.every(row=>row.data.startsWith("bbt1.")),table);
    }
    assert.ok(db.prepare("SELECT response FROM commands").all().every(row=>row.response.startsWith("bbt1.")));
    assert.equal(db.prepare("PRAGMA user_version").get().user_version,3);
  }finally{db.close();}
  for(const name of (await readdir(f.dir)).filter(n=>n.includes(".sqlite"))) {
    const raw=await readFile(path.join(f.dir,name));
    for(const marker of [prompt,result,note,"PRIVATE-BOT-731","PRIVATE-ROLE-731","PRIVATE-TRANSCRIPT-731"])assert.equal(raw.includes(Buffer.from(marker)),false,`${name}: ${marker}`);
  }
  f.restart(); assert.equal(f.store.goal(goalId).result,result);assert.equal(f.store.transcript(goalId)[0].text,"PRIVATE-TRANSCRIPT-731");
  assert.equal(f.store.taskSecurity.authorization(goalId).source.deviceJkt,source.deviceJkt);
  assert.equal(f.store.taskSecurity.list("owner").length,1);assert.equal(f.store.taskSecurityEvents("owner").length,1);
});
test("encrypted replay, stale review checks and outcomes survive reopen without changing semantics",async t=>{
  const f=await protectedStore(t),s=f.store,b=bot(s),input={botId:b.id,prompt:"Do useful work"};
  const command=s.submitGoal("owner","goal-idempotent",input),run=s.start(command.goalId).run;
  s.finish(command.goalId,run.id,"review",{result:"done",transcript:[]});
  const review=s.goal(command.goalId);s.accept("owner","review-once",command.goalId,review.version);
  f.restart();const cursor=f.store.cursor;
  assert.deepEqual(f.store.submitGoal("owner","goal-idempotent",input),command);
  assert.equal(f.store.accept("owner","review-once",command.goalId,review.version).goal.status,"succeeded");
  assert.equal(f.store.cursor,cursor);
  assert.throws(()=>f.store.accept("owner","review-new",command.goalId,review.version),{code:"stale_review"});
  assert.throws(()=>f.store.submitGoal("owner","goal-idempotent",{...input,prompt:"changed"}),{code:"idempotency_conflict"});
});
test("encryption failure rolls back the entire command, projection and event",async t=>{
  const f=await protectedStore(t),s=f.store,original=f.codec.encode.bind(f.codec);
  f.codec.encode=(table,id,value)=>{if(table==="commands")throw new api.TenantStorageError();return original(table,id,value);};
  assert.throws(()=>bot(s),{code:"tenant_storage_unavailable"});assert.deepEqual(s.bots(),[]);assert.equal(s.cursor,0);
  f.codec.encode=original;assert.equal(bot(s).name,"PRIVATE-BOT-731");assert.equal(s.cursor,1);
});
test("ciphertext cannot be transplanted between rows or changed event metadata",async t=>{
  const f=await protectedStore(t),b=bot(f.store),other=f.store.createBot("owner","create-other",{name:"other",description:""}).bot;
  const db=new DatabaseSync(path.join(f.dir,"control.sqlite"));
  try{
    db.prepare("UPDATE bots SET data=(SELECT data FROM bots WHERE id=?) WHERE id=?").run(b.id,other.id);
    assert.throws(()=>f.store.bot(other.id),{code:"tenant_storage_unavailable"});
    db.exec("UPDATE events SET type='goal.created' WHERE seq=1");
    assert.throws(()=>f.store.events(0),{code:"tenant_storage_unavailable"});
  }finally{db.close();}
});
test("whole encrypted database cannot reopen under a different tenant, key, or plaintext mode",async t=>{
  const f=await protectedStore(t),other=await api.TenantRecordCodec.open(await api.newTenantKey(randomUUID(),f.wrapper),f.wrapper);
  t.after(()=>other.close());
  const dir=await mkdtemp(path.join(os.tmpdir(),"bb-binding-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  new api.ControlStore(dir,f.codec).close();
  assert.throws(()=>new api.ControlStore(dir),/tenant encryption key/);
  assert.throws(()=>new api.ControlStore(dir,other),/identity or key/);
  new api.ControlStore(dir,f.codec).close();
});
test("plaintext legacy stores are not silently re-encrypted, overwritten or accepted as tenant stores",async t=>{
  const f=await protectedStore(t),dir=await mkdtemp(path.join(os.tmpdir(),"bb-legacy-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let legacy=new api.ControlStore(dir);const b=bot(legacy);legacy.close();
  assert.throws(()=>new api.ControlStore(dir,f.codec),/offline migration/);
  legacy=new api.ControlStore(dir);assert.equal(legacy.bot(b.id).name,b.name);legacy.close();
});
test("failed protected initialization can be retried without half-initialized schema or plaintext fallback",async t=>{
  const f=await protectedStore(t),dir=await mkdtemp(path.join(os.tmpdir(),"bb-init-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const closed=await api.TenantRecordCodec.open(f.key,f.wrapper);closed.close();
  assert.throws(()=>new api.ControlStore(dir,closed),{code:"tenant_storage_unavailable"});
  const s=new api.ControlStore(dir,f.codec);assert.equal(s.cursor,0);s.close();
});
test("encrypted task freeze still fences late completion and recovery does not replay",async t=>{
  const f=await protectedStore(t),s=f.store,b=bot(s),one=s.submitGoal("owner","goal-freeze",{botId:b.id,prompt:"work"}),run=s.start(one.goalId).run;
  const freeze=s.freezeTasks("owner",randomUUID(),"freeze-while-running","bot",b.id).freeze;
  s.finish(one.goalId,run.id,"review",{result:"late result"});
  assert.equal(s.goal(one.goalId).status,"uncertain");
  assert.throws(()=>s.releaseBotFreeze("owner",randomUUID(),"release-too-early",freeze.id,freeze.version),{code:"inspection_required"});
  f.restart();f.store.recoverInterrupted();assert.equal(f.store.goal(one.goalId).status,"uncertain");assert.equal(f.store.start(one.goalId),undefined);
});
test("modified freeze index cannot bypass authenticated freeze record",async t=>{
  const f=await protectedStore(t),b=bot(f.store),freeze=f.store.freezeTasks("owner",randomUUID(),"freeze-metadata","bot",b.id).freeze;
  const db=new DatabaseSync(path.join(f.dir,"control.sqlite"));
  try {db.prepare("UPDATE task_freezes SET target=? WHERE id=?").run(randomUUID(),freeze.id);
    assert.throws(()=>f.store.taskSecurity.get(freeze.id,"owner"),{code:"tenant_storage_unavailable"});}
  finally{db.close();}
});
test("Bot limit is transactional, but a durable retry at the limit returns its original receipt",async t=>{
  const f=await protectedStore(t),s=f.store,input={name:"one",description:""};
  const first=s.createBot("owner","capacity-once",input,1);
  assert.deepEqual(s.createBot("owner","capacity-once",input,1),first);
  assert.throws(()=>s.createBot("owner","capacity-second",input,1),{code:"bot_capacity"});assert.equal(s.bots().length,1);
});

test("aborted key acquisition releases callers and erases late key material from a noncooperative provider",async t=>{
  const f=await protectedStore(t),abort=new AbortController();let resolve,late=randomBytes(32);
  const provider={id:f.wrapper.id,wrap:async()=>new Uint8Array(),unwrap:()=>new Promise(r=>{resolve=r;})};
  const attempt=api.TenantRecordCodec.open(f.key,provider,abort.signal);
  while(!resolve)await new Promise(r=>setImmediate(r));
  abort.abort();await assert.rejects(attempt,{code:"tenant_storage_unavailable"});
  resolve(late);await new Promise(r=>setImmediate(r));assert.ok(late.every(byte=>byte===0));
});
test("invalid key-service output is rejected without an unhandled callback error",async t=>{
  const f=await protectedStore(t);
  for(const bad of ["not bytes",new Uint8Array(12)]){
    const provider={id:f.wrapper.id,wrap:async()=>new Uint8Array(),unwrap:async()=>bad};
    await assert.rejects(api.TenantRecordCodec.open(f.key,provider),{code:"tenant_storage_unavailable"});
  }
});

test("existing shared control service cannot start or recover a tenant-encrypted store",async t=>{
  const f=await protectedStore(t),b=bot(f.store),goal=f.store.submitGoal("owner","no-runtime-start",{botId:b.id,prompt:"not allowed"});
  const before=f.store.cursor;
  assert.throws(()=>new api.ControlService(f.store,{execute(){assert.fail("must not dispatch");},async close(){}},2),{code:"tenant_execution_unavailable"});
  assert.equal(f.store.goal(goal.goalId).status,"queued");assert.equal(f.store.cursor,before);
});
