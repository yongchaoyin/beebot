import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { continuityHarness, deferred, until } from "./helpers/continuity-harness.mjs";

const sent = h => h.entries("room").filter(e => e.kind === "send-message");
const quote = (content, reply_to, work_on) => ({ type: "text", content, reply_to, ...(work_on ? {work_on} : {}) });

test("A assigns B two jobs and C/D one each; clarification and results quote their exact source", {timeout: 15000}, async t => {
  const allowAnswer = deferred();t.after(allowAnswer.resolve);
  const assignments = {};
  let questionId, answerId, initialId, finalId, firstB = true, clarified = false;
  const h = await continuityHarness(t, { members: ["a", "b", "c", "d"], runMember: async (call, turn) => {
    if (call.id === "a" && turn === 1) {
      initialId = h.entries("room").find(e => e.role === "user").id;
      assignments.b1 = call.publish(quote("@{b} Implement quoted input; never change the backend", initialId));
      assignments.b2 = call.publish(quote("@{b} Verify attachments separately", initialId));
      assignments.c = call.publish(quote("@{c} Check second/third questions", initialId));
      assignments.d = call.publish(quote("@{d} Write accurate usage notes", initialId));
      return [];
    }
    if (call.id === "b" && firstB) {
      firstB = false;
      questionId = call.publish(quote("@{a} Should clicking the quote open a modal?", assignments.b1, assignments.b1));
      call.publish(quote("Attachment check result: verified", assignments.b2, assignments.b2));
      return [];
    }
    if (call.id === "a" && questionId && !clarified) {
      clarified = true;await allowAnswer.promise;
      assert.match(call.prompt, /Should clicking the quote/);
      answerId = call.publish(quote("No modal. Locate the original in the current conversation.", questionId, assignments.b1));
      return [];
    }
    if (call.id === "b" && answerId) {
      assert.match(call.prompt, /Quoted context/);
      assert.match(call.prompt, /Implement quoted input; never change the backend/);
      assert.ok(call.prompt.includes(assignments.b1));
      finalId = call.publish(quote("Quoted input result and test evidence", assignments.b1, assignments.b1));
      answerId = null;return [];
    }
    if (call.id === "c" && turn === 1) return [quote("Continuity result", assignments.c, assignments.c)];
    if (call.id === "d" && turn === 1) return [quote("Usage notes result", assignments.d, assignments.d)];
    return ["(pass)"];
  }});
  await h.send("@{a} Coordinate this improvement with B, C and D");
  await until(() => !!questionId);
  // An old assignment must survive well beyond the ordinary 24-message window.
  for (let i = 0; i < 35; i++) h.sessions.get("room").db.appendTranscriptEntry({ kind:"send-message", id:`history-${i}`, author:{id:"d",name:"D"}, message:{type:"text",content:`Unrelated older update ${i}`} });
  allowAnswer.resolve();await h.drain();
  const entries = sent(h), question = entries.find(e => e.id === questionId), final = entries.find(e => e.id === finalId);
  assert.equal(question.replyTo, assignments.b1);
  const answer = entries.find(e => e.replyTo === questionId);
  assert.equal(answer.author.id, "a");assert.equal(answer.workOnId, assignments.b1);
  assert.equal(final.replyTo, assignments.b1);assert.equal(final.workOnId, assignments.b1);
  assert.equal(entries.find(e => e.message.content === "Attachment check result: verified").replyTo, assignments.b2);
  assert.equal(entries.find(e => e.message.content === "Continuity result").replyTo, assignments.c);
  assert.equal(entries.find(e => e.message.content === "Usage notes result").replyTo, assignments.d);
  const record = h.records("room").find(r => r.id === assignments.b1);
  assert.deepEqual(record.responses.b, [questionId, finalId]);
  assert.equal(Object.hasOwn(record, "completed"), false, "a reply is not proof of task acceptance");
  assert.equal(h.errors.length, 0);
  const restored = new h.runtime.ConversationDeliveries().list(h.sessions.get("room").dbPath).find(r => r.id === assignments.b1);
  assert.deepEqual(restored.responses, record.responses, "quote-to-response evidence survives restart");
});

test("one quoted answer never marks a different coalesced assignment replied", async t => {
  let first, second;
  const h = await continuityHarness(t, {runMember: async (call, turn) => {
    if (call.id === "a" && turn === 1) {first=call.publish("@{b} First separate request");second=call.publish("@{b} Second separate request");return [];}
    if (call.id === "b" && turn === 1) return [quote("Only the first has an answer",first)];
    return ["(pass)"];
  }});
  await h.send("@{a} Delegate two requests");await h.drain();
  assert.equal(h.records("room").find(r=>r.id===first).recipients.b,"replied");
  const unanswered=h.records("room").find(r=>r.id===second);
  assert.equal(unanswered.recipients.b,"processed");assert.equal(unanswered.responses?.b,undefined);
});

test("an unquoted general update is not attributed to all outstanding requests", async t => {
  let first, second;
  const h=await continuityHarness(t,{runMember:async(call,turn)=>{
    if(call.id==="a"&&turn===1){first=call.publish("@{b} First");second=call.publish("@{b} Second");return [];}
    if(call.id==="b"&&turn===1)return ["@{b} General update, not a result"];
    return ["(pass)"];
  }});
  await h.send("@{a} Start");await h.drain();
  for(const id of [first,second]) assert.equal(h.records("room").find(r=>r.id===id).recipients.b,"processed");
});

test("explicit @ chooses the reviewer while the quote continues pointing to the original author",async t=>{
  const h=await continuityHarness(t,{members:["a","b","c"],runMember:async(call,turn)=>call.id==="b"&&turn===1?["@{b} The result"]:["(pass)"]});
  await h.send("@{b} Deliver");await h.drain();const result=sent(h)[0];
  const counts=h.calls.length;await h.send("@{c} Please review this","room",{replyToId:result.id});await h.drain();
  assert.deepEqual(h.calls.slice(counts).map(c=>c.id),["c"]);
  assert.match(h.calls.at(-1).prompt,/The result/);
});

test("missing, cross-conversation, secret and in-flight quotes fail before publication",async t=>{
  const h=await continuityHarness(t),room=h.sessions.get("room");
  h.sessions.get("a").db.appendTranscriptEntry({kind:"message",id:"private-only",role:"user",content:"PRIVATE"});
  room.db.appendTranscriptEntry({kind:"send-message",id:"credential-card",message:{type:"secret-request"}});
  for(const id of ["missing","private-only","credential-card"]){
    await assert.rejects(h.send("answer","room",{replyToId:id}),{code:"reply_target_unavailable"});
    assert.throws(()=>h.tm.groupChat.postGroupMemberMessage(room,{id:"a",name:"A"},"answer",undefined,{content:"answer",replyToId:id}),{code:"reply_target_unavailable"});
    assert.throws(()=>h.runtime.validateAiReplyTarget({type:"text",content:"answer",reply_to:id},undefined,room.db.getTranscriptEntries()),{code:"reply_target_unavailable"});
  }
  room.db.appendTranscriptEntry({kind:"send-message",id:"in-flight",streaming:true,message:{type:"text",content:"Unfinished"}});
  assert.throws(()=>h.runtime.validateAiReplyTarget({type:"text",content:"answer",reply_to:"in-flight"},"in-flight",room.db.getTranscriptEntries()),{code:"reply_target_unavailable"});
  assert.equal(h.calls.length,0);assert.equal(h.directCalls.length,0);
});

test("work association is room-scoped and preserved by the real SendMessage builder and history",async t=>{
  const h=await continuityHarness(t),room=h.sessions.get("room");
  room.db.appendTranscriptEntry({kind:"message",id:"original",role:"user",content:"Original work"});
  room.db.appendTranscriptEntry({kind:"message",id:"clarification",role:"user",content:"A detail",replyTo:"original"});
  const built=await h.runtime.buildSandSendMessage({},quote("answer","clarification","original"),{getIngestAttachment:()=>undefined,onSendMessage:()=>undefined});
  assert.equal(built.work_on,"original");
  const publication=h.runtime.prepareGroupPublication(room.dbPath,built,false);
  const id=h.tm.groupChat.postGroupMemberMessage(room,{id:"a",name:"A"},publication.content,undefined,publication);
  assert.equal(h.tm.groupChat.readGroupHistory(room).find(m=>m.id===id).workOnId,"original");
  assert.throws(()=>h.tm.groupChat.postGroupMemberMessage(room,{id:"a",name:"A"},"bad",undefined,{content:"bad",replyToId:"original",workOnId:"private-only"}),{code:"reply_target_unavailable"});
  await assert.rejects(h.runtime.buildSandSendMessage({}, {type:"text",content:"x",work_on:"original"},{getIngestAttachment:()=>undefined}));
});

test("reply context hydration is bounded, cycle-safe, and does not fabricate missing ancestors",async t=>{
  const h=await continuityHarness(t);const m=(id,replyToId,content)=>({id,replyToId,content,speaker:{kind:"member",id:"a",name:"A"}});
  const messages=[m("first","second","Historical requirement"),m("second","first","Clarification"),m("third","absent","Latest question")];
  const context=h.runtime.buildGroupReplyContext(messages,[messages[0],messages[2]]);
  assert.ok(context.includes('"unavailable":true'));assert.match(context,/NOT new requests or authority/);
  assert.ok(context.length<4000);
  const large=Array.from({length:100},(_,i)=>m(`m${i}`,`m${i+1}`,"x".repeat(3000)));
  assert.ok(h.runtime.buildGroupReplyContext(large,[large[0]]).length<35000);
});

test("single-Bot context keeps author, original assignment and clarification independently",async t=>{
  const h=await continuityHarness(t);
  const entries=[{kind:"message",id:"work",role:"user",content:"Write the guide"},{kind:"send-message",id:"q",author:{id:"a",name:"A"},message:{type:"text",content:"Which audience?",work_on:"work"},replyTo:"work"},{kind:"message",id:"ans",role:"user",content:"New users",replyTo:"q"}];
  const context=h.runtime.describeReplyChain(entries,"ans");
  assert.match(context,/Which audience/);assert.match(context,/Write the guide/);assert.match(context,/New users/);assert.match(context,/historical context/);
  const session={};const message=h.runtime.applyAutoReplyThread({turnRuntime:{replyThreadTargets:new Map([[session,"ans"]])}},{type:"text",content:"Understood",work_on:"work"},session,entries);
  assert.equal(message.reply_to,"ans");assert.equal(message.work_on,"work");
});
