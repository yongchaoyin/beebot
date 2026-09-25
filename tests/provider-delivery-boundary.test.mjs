import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { scriptedChatModel, publicReply } from "./helpers/http-provider-fixture.mjs";
import { continuityHarness, deferred, until } from "./helpers/continuity-harness.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const moduleDir = await mkdtemp(path.join(os.tmpdir(), "bb-delivery-module-"));
const outfile = path.join(moduleDir, "provider.cjs");
await build({
  stdin: { contents: `
    export { createProviderPromptSession, runRoutedProviderText, GROK_ROUTER_SYSTEM_PROMPT } from "./source/host/extensions/inference/provider-session.ts";
    export { SandSettingsStore } from "./source/shared/node/settings/sand-settings-store.ts";
    export { buildSandBaseSystemPrompt, buildSandSubagentSystemPrompt } from "./source/host/runner/system-prompt.ts";
    export { COLLEAGUE_CONVERSATION_POLICY } from "./source/shared/colleague-conversation.ts";
  `, resolveDir: root, loader: "ts" },
  outfile, bundle: true, format: "cjs", platform: "node", target: "node26", logLevel: "silent",
});
const api = createRequire(import.meta.url)(outfile);
test.after(() => rm(moduleDir, { recursive: true, force: true }));
const definitions = [{ name: "SendMessage", inputSchema: { type: "object", properties: { type: { type: "string" }, content: { type: "string" } }, required: ["type", "content"] } }];

async function fixture(t, steps) {
  const server = await scriptedChatModel(t, steps);
  const data = await mkdtemp(path.join(os.tmpdir(), "bb-delivery-data-"));
  // No owner's profile or credentials are used; isolate settings and model key.
  const overrides = { SAND_DATA_ROOT: data, CUSTOM_API_KEY: "loopback-test-only" };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await rm(data, { recursive: true, force: true });
  });
  const settings = new api.SandSettingsStore(path.join(data, "settings.json"));
  settings.setInferenceHttp({ baseUrl: server.baseUrl, modelId: "colleague-fixture" });
  const session = api.createProviderPromptSession("custom");
  async function inference(messages = [{ role: "user", content: "Hello" }]) {
    const execution = session.getExecutor(messages).stream(undefined, crypto.randomUUID(), definitions);
    const events = [];
    for await (const event of execution.fullStream) events.push(event);
    await Promise.all([execution.response, execution.usage, execution.extendedUsage]);
    assert.equal(events.filter(event => event.type === "error").length, 0);
    return events;
  }
  return { ...server, inference };
}
const sent = events => events.filter(event => event.type === "tool-call" && event.toolName === "SendMessage");
const raw = events => events.filter(event => event.type === "text-delta").map(event => event.textDelta).join("");

// These cases exercise the real HTTP adapter and SDK stream parser. There is
// no mock of withSyntheticSendMessage/the public delivery boundary itself.
test("a private final completion after a real SendMessage never becomes a second public tool call", async t => {
  const answer = "可以。先明确账号方向，你主要想做个人品牌还是产品推广？";
  const internal = "已回复用户（消息已发出）。本轮处理：解释能力，等待账号方向。";
  const f = await fixture(t, [publicReply(answer), { deltas: [internal.slice(0, 13), internal.slice(13)] }]);
  const first = await f.inference();
  assert.equal(sent(first).length, 1);
  assert.equal(sent(first)[0].args.content, answer);
  const followup = await f.inference([
    { role: "user", content: "可以帮我做账号吗？" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "call-0", toolName: "SendMessage", args: { type: "text", content: answer } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "call-0", toolName: "SendMessage", result: { delivered: true } }] },
  ]);
  assert.equal(raw(followup), internal, "private completion remains available to the runner and checkpoints");
  assert.deepEqual(sent(followup), [], "private final text must not manufacture a SendMessage");
  f.assertComplete();
});

test("plain text without any earlier tool call stays private, even when it looks like an answer", async t => {
  const text = "Scratchpad with a private member note. Here is an apparent answer.";
  const f = await fixture(t, [{ text }]);
  const events = await f.inference();
  assert.equal(raw(events), text);
  assert.deepEqual(sent(events), []);
  f.assertComplete();
});

test("an explicit requested summary is not filtered and real public tool IDs stay intact", async t => {
  const summary = "本轮处理：这是用户明确要求我整理的会议总结。";
  const f = await fixture(t, [publicReply(summary)]);
  const events = await f.inference([{ role: "user", content: "请总结刚才的讨论" }]);
  assert.equal(sent(events).length, 1);
  assert.equal(sent(events)[0].args.content, summary);
  assert.equal(sent(events)[0].toolCallId, "call-0");
  f.assertComplete();
});

test("text-only direct routes still return the complete answer and streamed deltas", async t => {
  const f = await fixture(t, [{ deltas: ["第一点，", "这是你要的摘要。"] }]);
  const deltas = [];
  const answer = await api.runRoutedProviderText("custom", [{ role: "user", content: "帮我总结" }], { onTextDelta: delta => deltas.push(delta) });
  assert.equal(answer, "第一点，这是你要的摘要。");
  assert.equal(deltas.join(""), answer);
  f.assertComplete();
});

test("three queued group questions publish only their real answers, with no summaries or artificial tasks", async t => {
  const answers = ["可以，我负责内容。账号定位还需要你确认。", "先聊定位，不发布内容。", "产品推广可以先从使用场景讲起。"];
  const f = await fixture(t, answers.flatMap(answer => [publicReply(answer), { text: "已回复用户。本轮处理：已解释范围，无实际任务执行。" }]));
  const gates = [deferred(), deferred()];
  t.after(() => gates.forEach(gate => gate.resolve()));
  const h = await continuityHarness(t, { members: ["a"], runMember: async (call, turn) => {
    if (gates[turn - 1]) await gates[turn - 1].promise;
    // Model/runner boundary is scripted, real adapter + group queue + SQLite
    // publication are not replaced. No user history or real external account.
    for (let i = 0; i < 2; i++) for (const event of await f.inference()) {
      if (event.type === "text-delta") call.update({ type: "text-delta", text: event.textDelta });
      if (event.type === "tool-call" && event.toolName === "SendMessage") call.publish(event.args);
    }
    return [];
  } });
  // Each follow-up arrives during the previous active turn. A burst queued
  // before a turn starts may legitimately coalesce and is tested elsewhere.
  await h.send("可以帮忙运营账号吗？");
  await until(() => h.calls.length === 1);
  await h.send("先讨论，不发布");
  gates[0].resolve();
  await until(() => h.calls.length === 2);
  await h.send("我主要想做产品推广");
  gates[1].resolve();
  await h.drain();
  const messages = h.entries("room").filter(entry => entry.kind === "send-message");
  assert.equal(messages.length, 3);
  assert.deepEqual(messages.map(entry => entry.message.content), answers);
  const incoming = h.entries("room").filter(entry => entry.role === "user");
  assert.deepEqual(messages.map(entry => entry.replyTo), incoming.map(entry => entry.id));
  assert.equal(h.runtime.projectCollaboration(h.entries("room")).size, 0, "ordinary discussion must not manufacture task records");
  assert.doesNotMatch(JSON.stringify(messages), /已回复用户|本轮处理/);
  assert.ok(h.calls.every(call => call.systemPrompt.includes(api.COLLEAGUE_CONVERSATION_POLICY)));
  f.assertComplete();
});

test("main, group and direct provider policy distinguish conversation from execution without changing subagent reporting", () => {
  for (const cloudAgentsEnabled of [true, false]) {
    const prompt = api.buildSandBaseSystemPrompt({ cloudAgentsEnabled });
    assert.ok(prompt.includes(api.COLLEAGUE_CONVERSATION_POLICY));
    assert.match(prompt, /ordinary conversation ends with its direct answer/);
    assert.doesNotMatch(prompt, /Every task follows the same rhythm|Multi-message by default/);
  }
  assert.ok(api.GROK_ROUTER_SYSTEM_PROMPT.includes(api.COLLEAGUE_CONVERSATION_POLICY));
  assert.match(api.COLLEAGUE_CONVERSATION_POLICY, /tool-call count is not evidence/);
  assert.match(api.COLLEAGUE_CONVERSATION_POLICY, /explicitly requested summary/);
  assert.match(api.COLLEAGUE_CONVERSATION_POLICY, /Publishing, sending externally, paying or expanding access still require/);
  const delegated = api.buildSandSubagentSystemPrompt({ subagentType: "research", readonly: true });
  assert.match(delegated, /delivered back to the parent agent/);
  assert.match(delegated, /readonly mode/);
});
