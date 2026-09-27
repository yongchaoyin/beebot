import assert from "node:assert/strict";
import test from "node:test";
import { loadGroupRuntime } from "./helpers/load-group-runtime.mjs";
import { continuityHarness, deferred, until } from "./helpers/continuity-harness.mjs";

const roster = ["a", "b", "c", "d"].map(id => ({id, name:id.toUpperCase(), description:"Colleague"}));
const user = (id, content, extra = {}) => ({id, content, speaker:{kind:"user"}, ...extra});
const peer = (id, content, extra = {}) => ({id, content, speaker:{kind:"member", id:"a", name:"A"}, ...extra});

test("local attention chooses listeners without assigning work or weakening routing", async t => {
  const {selectGroupAttention: choose} = await loadGroupRuntime(t);
  const ctx = {history:[]};
  const ids = (message, context = ctx) => choose(roster, message, context).members.map(m => m.id);
  await t.test("open message chooses one listener, not a permanent manager", () => {
    const selected = new Set();
    for (let i=0;i<30;i++) {const result=choose(roster,user(`u-${i}`,"Discuss the plan"),ctx);assert.equal(result.members.length,1);assert.equal(result.reason,"first-listener");selected.add(result.members[0].id);}
    assert.ok(selected.size>1);
  });
  await t.test("names and roster order do not change an otherwise equal decision", () => {
    const message=user("stable","Discuss");
    assert.deepEqual(ids(message),choose([...roster].reverse().map(m=>({...m,name:"Renamed"})),message,ctx).members.map(m=>m.id));
  });
  await t.test("idle listener is preferred but explicit busy addressee is never replaced", () => {
    const context={history:[],load:id=>id==="b"?0:2};
    assert.deepEqual(ids(user("u","Discuss"),context),["b"]);
    assert.deepEqual(ids(user("v","@{a} Please answer"),context),["a"]);
  });
  await t.test("team invitations start one listener; explicit multiple recipients stay directed", () => {
    assert.equal(ids(user("u","@所有人 请检查")).length,1);
    assert.equal(choose(roster,user("u","@所有人 请检查"),ctx).reason,"team-kickoff");
    assert.deepEqual(ids(user("v","@{b} @{d} 请检查")),["b","d"]);
    assert.deepEqual(ids(peer("m","@everyone Please share independent views",{purpose:"discussion"})),["b","c","d"]);
  });
  await t.test("a saved kickoff keeps its recipient and never substitutes a removed owner", () => {
    assert.deepEqual(ids(user("u","@everyone Work together"),{history:[],priorRecipients:()=>["c"],load:id=>id==="c"?10:0}),["c"]);
    assert.equal(choose(roster,user("u","@everyone Work together"),{history:[],priorRecipients:()=>["gone"]}).reason,"unavailable");
  });
  await t.test("quoted/code examples cannot widen attention", () => {
    assert.equal(ids(user("u","> @everyone\nUse `@all` as an example")).length,1);
  });
  await t.test("runtime work recipients override an update tag, including empty recipients", () => {
    assert.deepEqual(ids(peer("m","progress",{purpose:"update",recipientIds:["b","d"]})),["b","d"]);
    assert.deepEqual(ids(peer("n","@all",{recipientIds:[]})),[]);
  });
  await t.test("information and waiting for a human do not start colleagues", () => {
    assert.deepEqual(ids(peer("m","Progress",{purpose:"update"})),[]);
    assert.deepEqual(ids(peer("n","Which one?",{awaitingUser:true})),[]);
  });
  await t.test("ordinary answer to a user is not a peer request", () => {
    assert.deepEqual(ids(peer("m","Here is the answer",{replyToId:"u"}),{history:[user("u","Question")]}),[]);
  });
  await t.test("deliberate discussion and targeted help are not silenced", () => {
    assert.deepEqual(ids(peer("m","Please discuss",{replyToId:"u",purpose:"discussion"}),{history:[user("u","Question")]}),["b","c","d"]);
    assert.deepEqual(ids(peer("n","@{c} Please check",{replyToId:"u",purpose:"request"}),{history:[user("u","Question")]}),["c"]);
  });
  await t.test("quoting one's earlier request preserves its actual recipients even when busy", () => {
    assert.deepEqual(ids(user("v","Also check this",{replyToId:"u"}),{history:[user("u","Question")],priorRecipients:()=>["c"],load:id=>id==="c"?20:0}),["c"]);
  });
  await t.test("removed colleague cannot be silently replaced for quoted work", () => {
    assert.equal(choose(roster,user("v","Continue",{replyToId:"u"}),{history:[user("u","Question")],priorRecipients:()=>["removed"]}).reason,"unavailable");
    assert.equal(choose(roster,user("v","Continue",{replyToMemberId:"removed"}),ctx).reason,"unavailable");
    assert.deepEqual(ids(user("v","@{b} Please inspect",{replyToMemberId:"removed"})),["b"]);
  });
  await t.test("request without a valid recipient still fails, never broadens", () => {
    assert.throws(()=>ids(peer("m","Please check",{purpose:"request"})),{code:"unknown_group_member"});
    assert.throws(()=>ids(user("u","@{removed} Continue")),{code:"unknown_group_member"});
  });
});

test("actual send: open question, real peer help, quoted answer; no automatic all-hands or fake task", async t => {
  let h, first, helper, rootId;
  h=await continuityHarness(t,{members:["a","b","c","d"],runMember:async call=>{
    assert.match(call.prompt,/first listener/);
    if(!first){
      first=call.id;helper=["a","b","c","d"].find(id=>id!==first);
      rootId=h.entries("room").find(e=>e.kind==="message"&&e.role==="user").id;
      call.publish({type:"text",content:`@{${helper}} Please clarify the existing behavior; do not edit files.`,purpose:"request",reply_to:rootId});
    }else if(call.id===helper){
      const request=h.entries("room").find(e=>e.kind==="send-message"&&e.author?.id===first);
      call.publish({type:"text",content:"Here is the verified limitation.",reply_to:request.id});
    }else if(call.id===first){
      call.publish({type:"text",content:"Here are the options; no code was changed.",reply_to:rootId});
    }return [];
  }});
  await h.send("Please discuss the plan, do not change code.");await h.drain();
  assert.deepEqual(h.calls.map(c=>c.id),[first,helper,first]);
  assert.equal(h.runtime.projectCollaboration(h.entries("room")).size,0);
  assert.deepEqual(Object.keys(h.records("room").find(r=>r.id===rootId).recipients),[first]);
  assert.equal(h.errors.length,0);
});

test("actual send: explicit second question can reach an idle colleague without interrupting the first", async t => {
  const gate=deferred();t.after(()=>gate.resolve());let first;
  const h=await continuityHarness(t,{members:["a","b"],runMember:async call=>{
    if(!first){first=call.id;await gate.promise;}return ["An answer"];
  }});
  await h.send("Discuss question one");await until(()=>h.calls.length===1);
  await h.send(`@{${first === "a" ? "b" : "a"}} A separate question`);await until(()=>h.calls.some(c=>c.id!==first));
  assert.deepEqual(h.interrupts,[]);gate.resolve();await h.drain();
  assert.equal(h.calls.length,2);assert.equal(h.records("room").filter(r=>r.state==="replied").length,2);
});

test("actual send: quoted follow-up stays with its busy listener rather than migrating to another Bot", async t => {
  const gate=deferred();t.after(()=>gate.resolve());let first;
  const h=await continuityHarness(t,{members:["a","b"],runMember:async call=>{if(!first){first=call.id;await gate.promise;}return ["Answer"];}});
  await h.send("Explain this choice");await until(()=>h.calls.length===1);
  const root=h.entries("room").find(e=>e.kind==="message"&&e.role==="user");
  await h.send("Also consider this constraint","room",{replyToId:root.id});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(h.calls.length,1);
  gate.resolve();await h.drain();assert.deepEqual(h.calls.map(c=>c.id),[first,first]);
  assert.equal(h.records("room").filter(r=>r.state==="replied").length,2);
});

test("actual send: failed team listener is visible without automatically replaying the goal elsewhere", async t => {
  const gate=deferred();t.after(()=>gate.resolve());
  const h=await continuityHarness(t,{members:["a","b"],runMember:async()=>{await gate.promise;throw new Error("Provider unavailable");}});
  await h.send("@everyone Work together");await until(()=>h.calls.length===1);gate.resolve();await h.drain();
  assert.equal(h.calls.length,1);assert.equal(h.errors.length,1);
  assert.ok(h.entries("room").some(e=>e.kind==="notice"&&e.code==="delivery_failed"||e.kind==="notice"&&JSON.stringify(e).includes("delivery_failed")));
});

test("actual team kickoff accounts for a colleague already busy in a direct conversation", {timeout:10000}, async t => {
  const gate=deferred(), started=deferred(); t.after(gate.resolve);
  const h=await continuityHarness(t,{members:["a","b"],runDirect:async()=>{started.resolve();await gate.promise;},runMember:async()=>["Handled the team question"]});
  await h.send("Private work", "a"); await started.promise;
  await h.send("@everyone Coordinate this question");
  await Promise.all([...h.tm.groupChat.activeRooms.values()].map(room=>room.done));
  assert.deepEqual(h.calls.map(call=>call.id),["b"]);
  assert.deepEqual(h.interrupts,[]);
  gate.resolve();await h.drain();
});

test("a genuine user decision widget is not mistaken for an unaddressed colleague request", async t => {
  const h=await continuityHarness(t,{runMember:async call=>{
    call.publish({type:"widget",purpose:"request",widget:{prompt:"Choose the required direction",allowCustom:false,options:[{label:"Keep",value:"keep"},{label:"Change",value:"change"}]}});
    return [];
  }});
  await h.send("@everyone Clarify the consequential choice");await h.drain();
  assert.equal(h.calls.length,1);assert.equal(h.errors.length,0);
  assert.equal(h.entries("room").filter(entry=>entry.kind==="send-message"&&entry.message.type==="widget").length,1);
});

test("actual send: removed quoted author is reported without executing a replacement", async t => {
  const h=await continuityHarness(t,{members:["a","b"],runMember:async()=>["Should not run"]});
  h.sessions.get("room").db.appendTranscriptEntry({id:"former-answer",kind:"send-message",message:{type:"text",content:"Earlier result"},author:{id:"former",name:"Former"}});
  await h.send("Continue this","room",{replyToId:"former-answer"});await h.drain();
  assert.equal(h.calls.length,0);
  assert.ok(h.entries("room").some(e=>JSON.stringify(e).includes("quoted_colleague_unavailable")));
});


test("actual send: an unquoted mid-work supplement stays with its original listener", async t => {
  const gate=deferred();t.after(()=>gate.resolve());let first;
  const h=await continuityHarness(t,{members:["a","b"],runMember:async call=>{if(!first){first=call.id;await gate.promise;}return ["Handled request"];}});
  await h.send("Discuss the new layout");await until(()=>h.calls.length===1);
  await h.send("One more constraint: do not change the backend.");
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(h.calls.length,1);
  gate.resolve();await h.drain();assert.deepEqual(h.calls.map(c=>c.id),[first,first]);
  assert.match(h.calls[1].prompt,/do not change the backend/);
  assert.deepEqual(h.interrupts,[]);
});
