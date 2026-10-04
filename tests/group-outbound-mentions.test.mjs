import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadGroupRuntime } from "./helpers/load-group-runtime.mjs";
import { continuityHarness, deferred, until } from "./helpers/continuity-harness.mjs";

const members = [{ id: "a", name: "小丽", description: "" }, { id: "b", name: "小微", description: "" }];
const publicEntries = h => h.entries("room").filter(entry => entry.kind === "send-message");
const rename = (h, id, name) => h.runtime.writeSandProfileFile(h.runtime.getSandProfilePath(path.dirname(h.sessions.get(id).dbPath)), {
  name, description: "Persistent colleague", title: "", avatarShape: "blob", avatarColor: "green", inferenceVendorId: "fixture",
});
const setMembers = (h, memberIds, extra = {}) => h.runtime.writeSandGroupConfig(path.dirname(h.sessions.get("room").dbPath), { version: 1, memberIds, ...extra });

test("new outbound direct names and IDs must exist, while incoming unknown names remain tolerant", async t => {
  const { validateGroupMemberPublication: validate, parseGroupMentions } = await loadGroupRuntime(t);
  for (const content of ["@小鱼 请继续", "@{outside} Please continue", "@{unfinished"]) {
    assert.throws(() => validate(content, members), error => error.code === "unknown_group_member"
      && /Nothing was published/.test(error.message) && /小丽.*@\{a\}.*小微.*@\{b\}/.test(error.message));
  }
  assert.deepEqual(parseGroupMentions("@小鱼 请继续", members), { isEveryone: false, memberIds: [] });
  assert.deepEqual(validate("@小微，继续；@{a} 检查", members), { isEveryone: false, memberIds: ["a", "b"] });
  assert.deepEqual(validate("@everyone 请看", members), { isEveryone: true, memberIds: [] });
  assert.deepEqual(validate("给用户的直接答复，不猜用户名。", members), { isEveryone: false, memberIds: [] });
});

test("code, quoted text, emails and links cannot become outbound addressees", async t => {
  const { validateGroupMemberPublication: validate } = await loadGroupRuntime(t);
  const examples = [
    "`@小鱼` and ``@小微``", "```js\n@小鱼\n```\n~~~\n@小微\n~~~",
    "> @小鱼\n  > @小微", 'He wrote "@小鱼", not a handoff.', "她说“@小鱼”；「@小微」是引用。",
    "The literal '@小鱼' and ‘@小微’ are quoted.", "mail+tag@小鱼.com and <mail@小微.com>",
    "https://example.test/@小鱼 and www.example.test/@小微", "[@小鱼](https://example.test) and [@小微][reference]",
    "<https://example.test/@小鱼>", String.raw`\@小鱼`, "Use the @ key.", "Install @types/node or @openai/codex.",
  ];
  for (const content of examples) assert.deepEqual(validate(content, members), { isEveryone: false, memberIds: [] }, content);
  assert.throws(() => validate('The quote "@小鱼" is context; @小鱼 please act.', members), { code: "unknown_group_member" });
  assert.throws(() => validate("<@小鱼> please act", members), { code: "unknown_group_member" });
  assert.throws(() => validate("Install @types/node; @小鱼/whatever please act", members), { code: "unknown_group_member" });
});

test("duplicate display names require stable IDs and Unicode/full-name aliases remain valid", async t => {
  const { validateGroupMemberPublication: validate } = await loadGroupRuntime(t);
  const duplicates = [{ id: "a", name: "小微" }, { id: "b", name: "小微" }];
  assert.throws(() => validate("@小微 请检查", duplicates), error => error.code === "ambiguous_group_mention" && /@\{a\}.*@\{b\}/.test(error.message));
  assert.deepEqual(validate("@{b} 请检查", duplicates).memberIds, ["b"]);
  const international = [{ id: "a", name: "Renée Smith" }, { id: "b", name: "Alex Jones" }];
  assert.deepEqual(validate("@RENE\u0301E SMITH check; @AlexJones review", international).memberIds, ["a", "b"]);
});

test("the actual publication boundary rejects ghost names for every purpose before stream or persistence, then accepts correction", async t => {
  let h, streamed = 0, attempts = 0;
  h = await continuityHarness(t, { runMember: async call => {
    for (const purpose of [undefined, "update", "discussion", "request"]) {
      assert.throws(() => call.publish({ type: "text", content: "@小鱼 请继续", ...(purpose ? { purpose } : {}) }), error => error.code === "unknown_group_member" && /小丽.*小微/.test(error.message));
      attempts++;
      assert.equal(publicEntries(h).length, 0);
      assert.equal(streamed, 0);
    }
    call.publish({ type: "text", content: "我会继续检查。", purpose: "update" });
    return [];
  } });
  rename(h, "a", "小丽"); rename(h, "b", "小微");
  const stream = h.tm.groupChat.streamGroupMemberUpdate.bind(h.tm.groupChat);
  h.tm.groupChat.streamGroupMemberUpdate = (...args) => { streamed++; return stream(...args); };
  await h.send("@{a} 请检查"); await h.drain();
  assert.equal(attempts, 4); assert.equal(streamed, 0); assert.equal(h.errors.length, 0);
  assert.equal(publicEntries(h).length, 1); assert.equal(publicEntries(h)[0].message.content, "我会继续检查。");
  assert.equal(JSON.stringify(h.entries("room")).includes("小鱼"), false);
  assert.equal(JSON.stringify(h.events).includes("小鱼"), false);
});

test("direct legacy publication callers also cannot save unknown mentions or untargeted requests", async t => {
  const h = await continuityHarness(t), room = h.sessions.get("room"), author = { id: "a", name: "A", description: "" };
  assert.throws(() => h.tm.groupChat.postGroupMemberMessage(room, author, "@小鱼 please act"), { code: "unknown_group_member" });
  assert.throws(() => h.tm.groupChat.postGroupMemberMessage(room, author, "Please act", undefined, { content: "Please act", message: { type: "text", content: "Please act", purpose: "request" } }), { code: "group_recipient_required" });
  assert.equal(publicEntries(h).length, 0);
});

test("an author removed during actual execution cannot publish", async t => {
  const gate = deferred(); t.after(gate.resolve); let h, checked = false;
  h = await continuityHarness(t, { runMember: async call => {
    await gate.promise;
    assert.throws(() => call.publish({ type: "text", content: "Still here", purpose: "update" }), { code: "unknown_group_member" });
    checked = true; return [];
  } });
  await h.send("@{a} Check"); await until(() => h.calls.length === 1);
  setMembers(h, ["b"]); gate.resolve(); await h.drain();
  assert.equal(checked, true); assert.equal(publicEntries(h).length, 0);
});

test("a peer removed during execution cannot be addressed by stale name or ID, including update", async t => {
  const gate = deferred(); t.after(gate.resolve); let h, checked = false;
  h = await continuityHarness(t, { runMember: async call => {
    await gate.promise;
    for (const content of ["@B 请继续", "@{b} 请继续"]) assert.throws(() => call.publish({ type: "text", content, purpose: "update" }), { code: "unknown_group_member" });
    checked = true; return [];
  } });
  await h.send("@{a} Check"); await until(() => h.calls.length === 1);
  setMembers(h, ["a"]); gate.resolve(); await h.drain();
  assert.equal(checked, true); assert.equal(publicEntries(h).length, 0); assert.deepEqual(h.calls.map(call => call.id), ["a"]);
});

test("renamed peer targets and author presentation use the current roster at publication", async t => {
  const gate = deferred(); t.after(gate.resolve); let h;
  h = await continuityHarness(t, { runMember: async call => {
    if (call.id !== "a") return [];
    await gate.promise;
    assert.throws(() => call.publish({ type: "text", content: "@B Please check", purpose: "update" }), { code: "unknown_group_member" });
    call.publish({ type: "text", content: "@小微 Please check", purpose: "request" }); return [];
  } });
  await h.send("@{a} Check"); await until(() => h.calls.length === 1);
  rename(h, "a", "小丽"); rename(h, "b", "小微"); gate.resolve(); await h.drain();
  assert.equal(publicEntries(h).length, 1); assert.equal(publicEntries(h)[0].author.name, "小丽");
  assert.deepEqual(h.calls.map(call => call.id), ["a", "b"]);
  assert.deepEqual(Object.keys(h.records("room").find(record => record.id === publicEntries(h)[0].id).recipients), ["b"]);
});

test("queued execution refreshes member names and roster when it actually starts", { timeout: 20000 }, async t => {
  const gate = deferred(), privateStarted = deferred(), groupQueued = deferred(); t.after(gate.resolve);
  const h = await continuityHarness(t, { members: ["a", "b", "c"], runDirect: async () => { privateStarted.resolve(); await gate.promise; } });
  const enqueue = h.tm.runLifecycle.enqueueExclusiveRun.bind(h.tm.runLifecycle);
  h.tm.runLifecycle.enqueueExclusiveRun = (id, task, options) => {
    const result = enqueue(id, task, options);
    if (id === "a" && options.source === "group-member") groupQueued.resolve();
    return result;
  };
  await h.send("private work", "a"); await privateStarted.promise;
  await h.send("@{a} Group work"); await groupQueued.promise;
  rename(h, "a", "小丽"); rename(h, "b", "小微"); setMembers(h, ["a", "b"]);
  gate.resolve(); await h.drain();
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].systemPrompt, /You are 小丽/);
  assert.match(h.calls[0].systemPrompt, /小微 \[address: @\{b\}\]/);
  assert.doesNotMatch(h.calls[0].systemPrompt, /- C \[address:/);
  assert.match(h.calls[0].systemPrompt, /current room roster/);
});

test("a real quoted current colleague can receive a request without a textual mention", async t => {
  let original;
  const h = await continuityHarness(t, { runMember: async (call, turn) => {
    if (call.id === "b" && turn === 1) original = call.publish({ type: "text", content: "Here is the evidence.", purpose: "update" });
    if (call.id === "a") call.publish({ type: "text", content: "Please check this detail.", purpose: "request", reply_to: original });
    return [];
  } });
  await h.send("@{b} Provide evidence"); await h.drain();
  await h.send("@{a} Ask for a check"); await h.drain();
  assert.deepEqual(h.calls.map(call => call.id), ["b", "a", "b"]); assert.equal(h.errors.length, 0);
});

test("a request replying implicitly to its peer trigger is checked after the orchestrator supplies the quote", async t => {
  const h = await continuityHarness(t, { runMember: async (call, turn) => {
    if (call.id === "b" && turn === 1) call.publish({ type: "text", content: "@{a} Can you review this evidence?", purpose: "request" });
    if (call.id === "a") call.publish({ type: "text", content: "Can you confirm the source?", purpose: "request" });
    return [];
  } });
  await h.send("@{b} Start the discussion"); await h.drain();
  assert.deepEqual(h.calls.map(call => call.id), ["b", "a", "b"]); assert.equal(h.errors.length, 0);
  const [question, reply] = publicEntries(h);
  assert.equal(reply.replyTo, question.id);
});

test("single-Bot and cross-user publication do not inherit local room name restrictions", async t => {
  const h = await continuityHarness(t), room = h.sessions.get("room");
  await h.send("@小鱼 is quoted context", "a"); await until(() => h.directCalls.length === 1);
  assert.equal(h.calls.length, 0);
  setMembers(h, ["a", "b"], { sharedRoomId: "shared-fixture" });
  const id = h.tm.groupChat.postGroupMemberMessage(room, { id: "a", name: "A", description: "" }, "@Someone outside the local Bot roster");
  assert.ok(id); assert.equal(publicEntries(h).length, 1);
});

test("second and third group sends remain continuous after a corrected mention error", async t => {
  const gate = deferred(); t.after(gate.resolve); let h;
  h = await continuityHarness(t, { runMember: async (call, turn) => {
    if (turn === 1) {
      assert.throws(() => call.publish({ type: "text", content: "@小鱼 请继续", purpose: "update" }), { code: "unknown_group_member" });
      await gate.promise;
    }
    call.publish({ type: "text", content: `Visible response ${turn}`, purpose: "update" }); return [];
  } });
  await h.send("@{a} First"); await until(() => h.calls.length === 1);
  await h.send("@{a} Second"); await h.send("@{a} Third"); gate.resolve(); await h.drain();
  assert.equal(h.entries("room").filter(entry => entry.role === "user").length, 3);
  assert.equal(h.errors.length, 0); assert.ok(h.calls.length >= 2);
  assert.match(h.calls.at(-1).prompt, /Second/); assert.match(h.calls.at(-1).prompt, /Third/);
  assert.equal(JSON.stringify(publicEntries(h)).includes("小鱼"), false);
  for (const record of h.records("room").filter(record => record.actorId === undefined)) assert.notEqual(record.recipients?.a, "failed");
});
