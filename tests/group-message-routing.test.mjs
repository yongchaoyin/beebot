import assert from "node:assert/strict";
import test from "node:test";
import { loadGroupRuntime } from "./helpers/load-group-runtime.mjs";

const members = [
  { id: "a", name: "小林", description: "体验" },
  { id: "b", name: "小林同学", description: "开发" },
  { id: "c", name: "Bob Smith", description: "验证" },
];
const user = content => ({ speaker: { kind: "user" }, content });
const bot = (id, content) => ({ speaker: { kind: "member", id, name: members.find(m => m.id === id)?.name || id }, content });

for (const [name, text, ids, everyone = false] of [
  ["Chinese exact mention", "@小林同学 请看代码", ["b"]],
  ["Chinese comma is a boundary", "@小林，请看体验", ["a"]],
  ["Chinese prefix is not a second mention", "@小林同学你好", []],
  ["full English name", "@Bob Smith please review", ["c"]],
  ["compact English alias", "@bobsmith please review", ["c"]],
  ["stable member ID", "@{b} 请帮忙", ["b"]],
  ["repeated references are deduplicated", "@小林 @小林 @小林同学", ["a", "b"]],
  ["email is not a mention", "mail@小林.com and x@bobsmith.dev", []],
  ["underscore suffix is not a mention", "@Bob_old", []],
  ["escaped mention", "\\@小林 is documentation", []],
  ["inline code", "Use `@小林` in examples", []],
  ["fenced code", "```text\n@小林\n```\n@Bob Smith review", ["c"]],
  ["quoted message is not a handoff", "> @小林 do this\n@小林同学 review", ["b"]],
  ["URL mention is not a handoff", "https://example.com/@小林", []],
  ["everyone Chinese", "@所有人 范围变更", [], true],
  ["everyone English", "@all please check", [], true],
  ["everyone prefix Unicode", "@all成员", []],
]) test(name, async t => {
  const runtime = await loadGroupRuntime(t);
  assert.deepEqual(runtime.parseGroupMentions(text, members), { isEveryone: everyone, memberIds: ids });
});

test("ambiguous short names fail explicitly, full names and IDs remain usable", async t => {
  const { parseGroupMentions } = await loadGroupRuntime(t);
  const roster = [{ id: "one", name: "Alex Chen" }, { id: "two", name: "Alex Lee" }];
  assert.throws(() => parseGroupMentions("@Alex help", roster), { code: "ambiguous_group_mention" });
  assert.deepEqual(parseGroupMentions("@Alex Chen help", roster).memberIds, ["one"]);
  assert.deepEqual(parseGroupMentions("@{two} help", roster).memberIds, ["two"]);
});

test("duplicate names never silently fan out; unknown IDs never broaden recipients", async t => {
  const { parseGroupMentions } = await loadGroupRuntime(t);
  const roster = [{ id: "one", name: "小林" }, { id: "two", name: "小林" }];
  assert.throws(() => parseGroupMentions("@小林 help", roster), { code: "ambiguous_group_mention" });
  assert.throws(() => parseGroupMentions("@{outsider} help", roster), { code: "unknown_group_member" });
  assert.deepEqual(parseGroupMentions("@{one}", roster).memberIds, ["one"]);
});

test("a later Bot handoff replaces old user addressing; it never wakes its own author", async t => {
  const { resolveResponders } = await loadGroupRuntime(t);
  assert.deepEqual(resolveResponders(members, [user("@小林 help"), bot("a", "@Bob Smith verify")]).map(m => m.id), ["c"]);
  assert.deepEqual(resolveResponders(members, [bot("a", "@小林 self")]), []);
});

test("concurrent handoffs take the union of this wave's recipients only", async t => {
  const { resolveMessageResponders } = await loadGroupRuntime(t);
  const messages = [bot("a", "@Bob Smith review"), bot("c", "@小林同学 implement")];
  assert.deepEqual(resolveMessageResponders(members, messages).map(m => m.id), ["b", "c"]);
});

function room(runtime, reply, initial = [user("@小林 请开始")], roster = members) {
  const history = [...initial], calls = [], finalized = [];
  let current = true;
  const orchestrator = new runtime.GroupChatOrchestrator({
    resolveMembers: async ids => roster.filter(m => ids.includes(m.id)),
    readHistory: () => history,
    isCurrent: () => current,
    runMemberTurn: async args => { calls.push(args); return reply(args, calls); },
    postMemberMessage: (member, content) => history.push(bot(member.id, content)),
    finalizeMemberTurn: member => finalized.push(member.id),
  });
  return { history, calls, finalized, stop: () => { current = false; }, run: () => orchestrator.run({ group: { name: "产品组", description: "" }, memberIds: roster.map(m => m.id) }) };
}

test("real orchestrator delivers user -> A -> B -> C without the user relaying messages", async t => {
  const runtime = await loadGroupRuntime(t);
  const r = room(runtime, ({ member }) => member.id === "a" ? ["@小林同学 请实现"] : member.id === "b" ? ["@Bob Smith 请检查"] : ["(pass)"]);
  await r.run();
  assert.deepEqual(r.calls.map(c => c.member.id), ["a", "b", "c"]);
  assert.match(r.calls[1].prompt, /You were mentioned/);
  assert.match(r.calls[1].prompt, /小林: @小林同学 请实现/);
  assert.deepEqual(r.finalized, ["a", "b", "c"]);
});

test("open discussion remains concurrent; a crashing colleague does not silence others", async t => {
  const runtime = await loadGroupRuntime(t);
  let active = 0, peak = 0;
  const r = room(runtime, async ({ member }) => {
    active++; peak = Math.max(active, peak);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    if (member.id === "a") throw new Error("model unavailable");
    return ["(pass)"];
  }, [user("一起评审")]);
  await assert.rejects(r.run(), AggregateError);
  assert.equal(peak, 3); assert.equal(r.finalized.length, 3);
});

test("identical follow-up loops stop without suppressing another Bot's identical message", async t => {
  const runtime = await loadGroupRuntime(t);
  const r = room(runtime, () => ["收到"], [user("一起开始")]);
  await r.run();
  assert.equal(r.history.length, 4);
  assert.equal(r.calls.length, 6);
});

test("changing-content ping-pong pauses with an explicit limit error, not success", async t => {
  const runtime = await loadGroupRuntime(t);
  let round = 0;
  const r = room(runtime, ({ member }) => [`@{${member.id === "a" ? "b" : "a"}} 第${++round}次`]);
  await assert.rejects(r.run(), { code: "group_turn_limit" });
  assert.equal(r.calls.length, runtime.GROUP_MAX_MEMBER_TURNS * 2);
});

test("a single Bot remains a valid independent member and does not wake itself", async t => {
  const runtime = await loadGroupRuntime(t);
  const r = room(runtime, () => ["这是结果"], [user("帮我看看")], [members[0]]);
  await r.run(); assert.equal(r.calls.length, 1); assert.equal(r.history.length, 2);
});

test("interruption rejects late group output without changing external task state", async t => {
  const runtime = await loadGroupRuntime(t);
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  const r = room(runtime, async () => { started(); await gate; return ["late output"]; });
  const pending = r.run(); await ready; r.stop(); release(); await pending;
  assert.equal(r.history.length, 1); assert.deepEqual(r.finalized, ["a"]);
});

test("member identity and private-room boundaries stay explicit in Agent context", async t => {
  const runtime = await loadGroupRuntime(t);
  const prompt = runtime.buildGroupMemberSystemPrompt(members[0], { name: "组", description: "" }, members.slice(1));
  assert.match(prompt, /same long-lived Bot/); assert.match(prompt, /discussion, not authorization/);
  assert.match(prompt, /never invent another participant/); assert.match(prompt, /never reveal private one-on-one context/);
});
