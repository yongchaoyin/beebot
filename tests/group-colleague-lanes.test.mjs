import assert from "node:assert/strict";
import test from "node:test";
import { loadGroupRuntime } from "./helpers/load-group-runtime.mjs";

const group = { name: "Product colleagues", description: "Work together within the user's boundary." };
const member = id => ({ id, name: id.toUpperCase(), description: `Long-lived colleague ${id}` });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(check) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "colleague progress must not depend on releasing an unrelated slow turn");
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}
async function room(t, ids, handle, prompt = "@all Start this work.", options = {}) {
  const runtime = await loadGroupRuntime(t);
  const members = ids.map(member), history = [{ speaker: { kind: "user" }, content: prompt }];
  const calls = [], posted = [], finalized = [], running = new Map(), maximum = new Map();
  let current = true;
  const orchestrator = new runtime.GroupChatOrchestrator({
    resolveMembers: async () => members,
    readHistory: () => history,
    isCurrent: () => current,
    isSharedRoom: options.isSharedRoom,
    async runMemberTurn(input) {
      const id = input.member.id, count = (running.get(id) || 0) + 1;
      running.set(id, count); maximum.set(id, Math.max(maximum.get(id) || 0, count));
      calls.push(input);
      return handle(input, calls.filter(call => call.member.id === id).length);
    },
    postMemberMessage(bot, content) {
      const message = { speaker: { kind: "member", id: bot.id, name: bot.name }, content };
      history.push(message); posted.push(message);
    },
    finalizeMemberTurn(bot) { running.set(bot.id, (running.get(bot.id) || 1) - 1); finalized.push(bot.id); },
  });
  return { runtime, orchestrator, history, calls, posted, finalized, maximum,
    stop: () => { current = false; },
    run: () => orchestrator.run({ group, memberIds: ids }),
  };
}

test("A hands work to B while an unrelated colleague is still running", { timeout: 5000 }, async t => {
  const slow = deferred(); t.after(slow.resolve);
  const ui = await room(t, ["a", "b", "slow"], async ({ member }) => {
    if (member.id === "slow") { await slow.promise; return ["(pass)"]; }
    return member.id === "a" ? ["@{b} Review the actual patch."] : ["(pass)"];
  }, "@{a} @{slow} Start your independent work.");
  const run = ui.run();
  try {
    await until(() => ui.calls.some(call => call.member.id === "b"));
    assert.equal(ui.finalized.includes("slow"), false);
    assert.match(ui.calls.find(call => call.member.id === "b").prompt, /Review the actual patch/);
  } finally { slow.resolve(); await run; }
  assert.equal(ui.calls.filter(call => call.member.id === "b").length, 1);
});

test("a busy Bot receives a handoff even when its own later reply follows that handoff", { timeout: 5000 }, async t => {
  const busy = deferred(); t.after(busy.resolve);
  const ui = await room(t, ["a", "b"], async ({ member }, turn) => {
    if (member.id === "a") return turn === 1 ? ["@{b} Check keyboard focus too."] : ["(pass)"];
    if (turn === 1) { await busy.promise; return ["@{a} Here is my first result."]; }
    return ["(pass)"];
  });
  const run = ui.run();
  try { await until(() => ui.posted.some(message => message.content.includes("Check keyboard"))); }
  finally { busy.resolve(); await run; }
  const turns = ui.calls.filter(call => call.member.id === "b");
  assert.equal(turns.length, 2);
  assert.match(turns[1].prompt, /Check keyboard focus too/);
  assert.match(turns[1].prompt, /You were mentioned/);
  assert.doesNotMatch(turns[1].prompt, /Here is my first result/);
  assert.equal(ui.maximum.get("b"), 1, "a follow-up must never run concurrently on the same Bot");
});

test("several handoffs arriving during one Bot turn are coalesced, not dropped or run concurrently", { timeout: 5000 }, async t => {
  const busy = deferred(); t.after(busy.resolve);
  const ui = await room(t, ["a", "b", "c"], async ({ member }, turn) => {
    if (member.id === "a") return ["@{b} Verify focus restoration."];
    if (member.id === "c") return ["@{b} Verify the Chinese input method."];
    if (turn === 1) await busy.promise;
    return ["(pass)"];
  });
  const run = ui.run();
  try { await until(() => ui.posted.length === 2); await new Promise(resolve => setTimeout(resolve, 5)); }
  finally { busy.resolve(); await run; }
  const turns = ui.calls.filter(call => call.member.id === "b");
  assert.equal(turns.length, 2);
  assert.match(turns[1].prompt, /focus restoration/);
  assert.match(turns[1].prompt, /Chinese input method/);
  assert.equal(ui.maximum.get("b"), 1);
});

test("the trigger belongs to its recipient even if a newer message addresses someone else", async t => {
  const ui = await room(t, ["a", "b", "c"], async () => ["(pass)"]);
  const addressed = { speaker: { kind: "member", id: "a", name: "A" }, content: "@{b} Please review." };
  const other = { speaker: { kind: "member", id: "a", name: "A" }, content: "@{c} A different request." };
  await ui.orchestrator.runOneTurn(group, member("b"), [member("a"), member("b"), member("c")],
    { newMessages: [addressed, other], triggers: [addressed] });
  assert.match(ui.calls[0].prompt, /You were mentioned/);
});

test("pending handoffs survive the ordinary 24-message context window", async t => {
  const ui = await room(t, ["a", "b"], async () => ["(pass)"]);
  const request = { speaker: { kind: "member", id: "a", name: "A" }, content: "@{b} Preserve this unresolved request." };
  const later = Array.from({ length: 30 }, (_, i) => ({ speaker: { kind: "member", id: "a", name: "A" }, content: `Update ${i}` }));
  await ui.orchestrator.runOneTurn(group, member("b"), [member("a"), member("b")],
    { newMessages: [request, ...later], triggers: [request] });
  assert.match(ui.calls[0].prompt, /Pending messages addressed to you/);
  assert.match(ui.calls[0].prompt, /Preserve this unresolved request/);
  assert.match(ui.calls[0].prompt, /not additional user authorization/);
});

test("a failing colleague does not prevent another handoff and all started turns finalize", async t => {
  const ui = await room(t, ["a", "b", "c"], async ({ member }) => {
    if (member.id === "a") throw new Error("Tool failed");
    return member.id === "b" ? ["@{c} Check my result."] : ["(pass)"];
  }, "@{a} @{b} Work independently.");
  await assert.rejects(ui.run(), AggregateError);
  assert.deepEqual(ui.calls.map(call => call.member.id).sort(), ["a", "b", "c"]);
  assert.deepEqual(ui.finalized.sort(), ["a", "b", "c"]);
});

test("one Bot remains independently useful and cannot wake itself with its own message", async t => {
  const ui = await room(t, ["a"], async () => ["@{a} My own verified result."], "Handle this independently.");
  await ui.run();
  assert.equal(ui.calls.length, 1); assert.equal(ui.posted.length, 1);
  assert.match(ui.calls[0].systemPrompt, /same long-lived Bot/);
  assert.doesNotMatch(ui.calls[0].systemPrompt, /Other participants in the room/);
});

test("interrupting the group drops queued follow-ups and fences late output without claiming rollback", { timeout: 5000 }, async t => {
  const busy = deferred(); t.after(busy.resolve);
  const ui = await room(t, ["a", "b"], async ({ member }) => {
    if (member.id === "b") { await busy.promise; return ["Late result"]; }
    return ["@{b} Please follow up."];
  });
  const run = ui.run();
  try { await until(() => ui.posted.length === 1); ui.stop(); }
  finally { busy.resolve(); await run; }
  assert.equal(ui.posted.length, 1);
  assert.equal(ui.calls.filter(call => call.member.id === "b").length, 1);
  assert.equal(ui.finalized.filter(id => id === "b").length, 1);
});

test("routing failure drains already-started work but rejects its late room publications", { timeout: 5000 }, async t => {
  const slow = deferred(); t.after(slow.resolve);
  const ui = await room(t, ["a", "slow"], async ({ member }) => {
    if (member.id === "slow") { await slow.promise; return ["Late room message"]; }
    return ["@{outsider} Do not silently broadcast this."];
  });
  const run = ui.run();
  const rejection = assert.rejects(run, { code: "unknown_group_member" });
  try { await until(() => ui.posted.length === 1); await new Promise(resolve => setTimeout(resolve, 5)); }
  finally { slow.resolve(); await rejection; }
  assert.equal(ui.posted.some(message => message.content === "Late room message"), false);
});

test("turn limits stop changing-content ping-pong with an explicit safety pause", async t => {
  const ui = await room(t, ["a", "b"], async ({ member }, turn) => [
    `@{${member.id === "a" ? "b" : "a"}} follow-up ${turn}`,
  ], "@{a} Start.");
  await assert.rejects(ui.run(), { code: "group_turn_limit" });
  assert.equal(ui.calls.filter(call => call.member.id === "a").length, ui.runtime.GROUP_MAX_MEMBER_TURNS);
  assert.equal(ui.calls.filter(call => call.member.id === "b").length, ui.runtime.GROUP_MAX_MEMBER_TURNS);
});

test("an exhausted pair cannot discard a different colleague's pending handoff", { timeout: 5000 }, async t => {
  const slow = deferred(); t.after(slow.resolve);
  const ui = await room(t, ["a", "b", "c", "d"], async ({ member }, turn) => {
    if (["a", "b"].includes(member.id)) return [`@{${member.id === "a" ? "b" : "a"}} revision ${turn}`];
    if (member.id === "c") { await slow.promise; return ["@{d} Verify this independent artifact."]; }
    return ["(pass)"];
  }, "@{a} @{c} Start your separate work.");
  const run = ui.run(), rejection = assert.rejects(run, { code: "group_turn_limit" });
  try { await until(() => ui.calls.filter(call => ["a", "b"].includes(call.member.id)).length === 20); }
  finally { slow.resolve(); await rejection; }
  assert.equal(ui.calls.filter(call => call.member.id === "d").length, 1);
});

test("shared rooms retain their delivery and privacy contract", async t => {
  const ui = await room(t, ["a", "b"], async ({ member }) => member.id === "a" ? ["@{b} Review the shared result."] : ["(pass)"], "@{a} Start.", { isSharedRoom: true });
  await ui.run();
  assert.match(ui.calls[1].systemPrompt, /only SendMessage plain text is delivered to the room/);
  assert.match(ui.calls[1].systemPrompt, /never reveal private one-on-one context/);
  assert.match(ui.calls[1].prompt, /Review the shared result/);
});


test("a finalized preview inserted before observed history is still included in the next handoff", { timeout: 5000 }, async t => {
  const releaseA = deferred(), releaseB = deferred();
  t.after(releaseA.resolve); t.after(releaseB.resolve);
  const ui = await room(t, ["a", "b"], async ({ member }, turn) => {
    if (member.id === "a") { await releaseA.promise; return ["@{b} Check the newly finalized evidence."]; }
    if (turn === 1) await releaseB.promise;
    return ["(pass)"];
  });
  const run = ui.run();
  try {
    await until(() => ui.calls.length === 2);
    // The real projection excludes streaming entries until finalized, preserving
    // their original transcript position rather than appending by finish time.
    ui.history.unshift({ speaker: { kind: "member", id: "a", name: "A" }, content: "Evidence: the original file must remain unchanged." });
    releaseA.resolve();
    await until(() => ui.posted.length === 1);
  } finally { releaseB.resolve(); releaseA.resolve(); await run; }
  const followup = ui.calls.filter(call => call.member.id === "b")[1];
  assert.match(followup.prompt, /original file must remain unchanged/);
  assert.match(followup.prompt, /newly finalized evidence/);
});

test("equal-content occurrences from another colleague are not erased by history tracking", { timeout: 5000 }, async t => {
  const releaseA = deferred(), releaseB = deferred();
  t.after(releaseA.resolve); t.after(releaseB.resolve);
  const ui = await room(t, ["a", "b"], async ({ member }, turn) => {
    if (member.id === "a") { await releaseA.promise; return ["@{b} Please examine the second observation."]; }
    if (turn === 1) await releaseB.promise;
    return ["(pass)"];
  });
  const note = { speaker: { kind: "member", id: "a", name: "A" }, content: "The check failed." };
  ui.history.unshift(structuredClone(note));
  const run = ui.run();
  try {
    await until(() => ui.calls.length === 2);
    ui.history.unshift(structuredClone(note)); releaseA.resolve();
    await until(() => ui.posted.length === 1);
  } finally { releaseB.resolve(); releaseA.resolve(); await run; }
  const followup = ui.calls.filter(call => call.member.id === "b")[1];
  assert.equal(followup.prompt.split("The check failed.").length - 1, 1);
});

test("simultaneously completed requests start one colleague turn, not an unnecessary second reply", async t => {
  const ui = await room(t, ["a", "b", "c"], async ({ member }) => {
    if (member.id === "a") return ["@{c} Review the implementation."];
    if (member.id === "b") return ["@{c} Also review the acceptance notes."];
    return ["(pass)"];
  }, "@{a} @{b} Start your independent checks.");
  await ui.run();
  const turns = ui.calls.filter(call => call.member.id === "c");
  assert.equal(turns.length, 1);
  assert.match(turns[0].prompt, /Review the implementation/);
  assert.match(turns[0].prompt, /review the acceptance notes/);
});
