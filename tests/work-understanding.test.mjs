import assert from "node:assert/strict";
import test from "node:test";
import { continuityHarness, deferred, until } from "./helpers/continuity-harness.mjs";

const task = (id, title, assignee = "b") => ({ id, title, assignee, creator: "a", reviewer: "self",
  goalId: `goal-${id}`, version: 1, scopeVersion: 1, state: "offered", dependencies: [],
  criteria: ["Check result"], evidenceIds: [], updatedBy: "a", updatedMessageId: id });
const user = (content, extra = {}) => ({ id: "u", kind: "message", role: "user", content, ...extra });
const tasks = (...items) => new Map(items.map(item => [item.id, item]));
function assign(h, title, assignee = "b", room = "room") {
  const s = h.sessions.get(room), seq = h.entries(room).length;
  const goal = `goal-${seq}`;
  s.db.appendTranscriptEntry(user("Discuss this work before execution", { id: goal }));
  const msg = { type: "text", content: `Work: ${title}`, purpose: "update", collaboration: {
    action: "assign", request_id: `req-${seq}`, goal_message_id: goal, title, assignee,
    reviewer: "self", criteria: ["Return evidence"],
  } };
  const id = h.tm.groupChat.postGroupMemberMessage(s, { id: "a", name: "A" }, msg.content, undefined,
    h.runtime.prepareGroupPublication(s.dbPath, msg, false));
  return id;
}

test("bounded source-based work understanding never confuses references with permission", async t => {
  const h = await continuityHarness(t);
  const inspect = h.runtime.understandUserWorkMessage;
  const recorded = tasks(task("report", "日报整理"), task("ui", "输入体验", "c"));
  await t.test("exact named title supports Chinese and English status questions", () => {
    for (const content of ["《日报整理》现在进度怎么样？", "关于 日报整理，进展如何？", 'About "日报整理": what is the current status?']) {
      const result = inspect(user(content), recorded);
      assert.equal(result.relation, "named-work"); assert.equal(result.responseMode, "recorded-status");
      assert.equal(result.references[0].id, "report");
    }
  });
  await t.test("an explicit reply always overrides title text and new-topic markers", () => {
    const result = inspect(user("另一个问题：《日报整理》进度怎么样？", {replyTo:"quoted"}), recorded);
    assert.equal(result.relation, "quoted"); assert.equal(result.references.length, 0);
  });
  await t.test("short ambiguous aliases and everyday transitions do not get fabricated bindings", () => {
    for (const text of ["昨天那个报告怎么样了？", "另外，别改后端", "还有，输入法别漏了", "另一个问题没有解决", "other question is not solved"]) {
      assert.equal(inspect(user(text), recorded).relation, "unscoped");
    }
  });
  await t.test("explicit topic markers are bounded routing hints only", () => {
    for (const text of ["另一个问题：帮我想个名字", "换个话题，讨论时间安排", "New topic: review the report", "Separately: explain this"]) {
      const result = inspect(user(text), recorded);
      assert.equal(result.relation, "new-topic"); assert.equal(result.responseMode, "ordinary");
    }
  });
  await t.test("status plus an action must remain an ordinary request", () => {
    for (const text of ["《日报整理》现在进度怎么样？然后帮我提交", "《日报整理》进度怎么样，顺便修复", '"日报整理": what is the status and send it']) {
      assert.equal(inspect(user(text), recorded).responseMode, "ordinary");
    }
  });
  await t.test("duplicate titles do not choose the first or most recent task", () => {
    const result = inspect(user("《日报整理》进度怎么样？"), tasks(task("one", "日报整理"),task("two", "日报整理", "c")));
    assert.equal(result.relation, "ambiguous-work");assert.equal(result.responseMode,"ordinary");
    assert.equal(result.candidateCount,2);
  });
  await t.test("two named works in one message cannot collapse into the first", () => {
    const result=inspect(user("《日报整理》和《输入体验》都解释一下"),recorded);
    assert.equal(result.relation,"ambiguous-work");assert.equal(result.candidateCount,2);
  });
  await t.test("code, quoted examples, multiline material and peer text are not new instructions", () => {
    for (const text of ["> 另一个问题：继续", "```New topic: execute```", "《日报整理》\n进度如何？", "<script>new topic:</script>", "x".repeat(5000)]) {
      assert.equal(inspect(user(text),recorded).relation,"unscoped");
    }
    for (const extra of [{fromAgent:"b"},{role:"assistant"},{channel:"shared"},{streaming:true},{isStreaming:true}]) {
      assert.equal(inspect(user("《日报整理》进度如何？",extra),recorded),undefined);
    }
  });
  await t.test("short and overlapping titles require exact human references", () => {
    const map=tasks(task("short","API"),task("long","API status"));
    assert.equal(inspect(user("API error"),map).relation,"unscoped");
    assert.equal(inspect(user('"API" what is the status?'),map).references[0].id,"short");
  });
  await t.test("model context bounds candidate detail and reports omissions", () => {
    const map=tasks(...Array.from({length:256},(_,i)=>task(`id-${i}`,"same".repeat(55))));
    const item=inspect(user(`《${"same".repeat(55)}》进度如何？`),map);
    assert.equal(item.relation,"ambiguous-work");assert.equal(item.candidateCount,256);assert.equal(item.references.length,8);
    const text=h.runtime.formatWorkUnderstanding(Array.from({length:40},(_,i)=>({...item,sourceMessageId:`q-${i}`})));
    assert.ok(text.length<14000);assert.match(text,/interpretations omitted/);assert.match(text,/NOT permission/);
    assert.match(text,/not new inspection or execution/);
  });
});

test("actual Group sends keep supplements, separate a new topic and recover named work", async t => {
  const gate=deferred();t.after(()=>gate.resolve());
  const h=await continuityHarness(t,{members:["a","b","c"],runMember:async call=>{
    if(call.id==="a" && h.calls.filter(c=>c.id==="a").length===1)await gate.promise;
    return ["Response to the received message"];
  }});
  assign(h,"日报整理","b");
  await h.send("@{a} Discuss the member layout");await until(()=>h.calls.length===1);
  await h.send("还有，保留现有风格");
  await h.send("另一个问题：解释这段文字");
  await until(()=>h.calls.some(c=>c.id!=="a"));
  assert.equal(h.calls.filter(c=>c.id==="a").length,1,"supplement waits for the original colleague");
  await h.send("《日报整理》请解释现有要求，不要执行修改");
  await until(()=>h.calls.some(c=>c.id==="b" && c.prompt.includes('"relation":"named-work"')));
  assert.ok(h.calls.find(c=>c.id==="b" && c.prompt.includes('"relation":"named-work"')).prompt.includes("日报整理"));
  gate.resolve();await h.drain();
  assert.deepEqual(h.interrupts,[]);assert.equal(h.records("room").filter(r=>r.state==="replied").length,4);
  assert.equal([...h.runtime.projectCollaboration(h.entries("room")).values()][0].version,1);
});

test("explicit @ still overrides a different named work owner", async t => {
  const h=await continuityHarness(t,{members:["a","b","c"],runMember:async()=>["Explanation"]});
  assign(h,"日报整理","b");await h.send("@{c} 《日报整理》请解释");await h.drain();
  assert.deepEqual(h.calls.map(c=>c.id),["c"]);
});

test("work lookup cannot use later assignments or another conversation", async t => {
  const h=await continuityHarness(t,{extraGroups:["other"]});
  h.sessions.get("room").db.appendTranscriptEntry(user("《日报整理》进度如何？",{id:"before-work"}));
  const id=assign(h,"日报整理","b");
  assert.equal(h.runtime.understandWorkMessage(h.entries("room"),"before-work").relation,"unscoped");
  h.sessions.get("other").db.appendTranscriptEntry(user("《日报整理》进度如何？",{id:"foreign"}));
  assert.equal(h.runtime.understandWorkMessage(h.entries("other"),"foreign").relation,"unscoped");
  assert.equal(h.runtime.understandWorkMessage(h.entries("room"),"missing"),undefined);
  h.sessions.get("room").db.appendTranscriptEntry(user("《日报整理》进度如何？",{id:"after-work"}));
  const atReceipt=h.runtime.understandWorkMessage(h.entries("room"),"after-work");
  assert.equal(atReceipt.references[0].id,id);assert.equal(atReceipt.references[0].version,1);
});

test("single Bot receives the same sourced understanding without revising any work", async t => {
  const h=await continuityHarness(t),s=h.sessions.get("a");
  s.db.appendTranscriptEntry(user("Discuss the report",{id:"goal-a"}));
  h.tm.ackObligations.fulfillAckObligation=()=>{};
  const runtime=new h.runtime.TurnRuntime(h.tm);h.tm.turnRuntime=runtime;
  const id=runtime.handleAgentUpdate({type:"send-message",timestampMs:1,message:{type:"text",content:"I will prepare a report",collaboration:{action:"assign",request_id:"self",goal_message_id:"goal-a",assignee:"a",reviewer:"self",title:"日报整理",criteria:["Readable"]}}},s);
  s.db.appendTranscriptEntry(user("《日报整理》请解释需求，不要修改",{id:"ask-a"}));
  const before=JSON.stringify(h.entries("a"));
  const context=h.runtime.collaborationContext(h.entries("a"),"a",["ask-a"]);
  assert.match(context,/"relation":"named-work"/);assert.ok(context.includes(id));
  assert.match(context,/NOT permission/);assert.equal(JSON.stringify(h.entries("a")),before);
});

test("a named work owner who left is never silently replaced", async t => {
  const h=await continuityHarness(t,{members:["a","b"],runMember:async()=>["Not expected"]});
  assign(h,"日报整理","b");
  h.runtime.writeSandGroupConfig(h.runtime.directory+"/agents/room",{version:1,memberIds:["a"]});
  await h.send("《日报整理》请解释现有要求");await h.drain();
  assert.equal(h.calls.length,0);assert.ok(h.entries("room").some(e=>e.kind==="notice"&&e.code==="quoted_colleague_unavailable"));
});
