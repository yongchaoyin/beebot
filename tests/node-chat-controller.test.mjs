import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Window } from "./helpers/renderer-controller-window.mjs";

const snippet = await readFile(path.resolve(import.meta.dirname, "../scripts/lib/beebot-node-chat-controller.snippet.js"), "utf8");
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const profile = (id, status = "online") => ({ id: `connection-${id}`, nodeId: `node-${id}`, name: `Server ${id}`, baseUrl: `https://${id}.example`, status });
const bot = (id = "shared-bot", name = "Assistant") => ({ id, name, description: "Server Bot", avatarColor: "blue", avatarShape: "hex" });
const goal = (id, overrides = {}) => ({ id, botId: "shared-bot", prompt: `Prompt ${id}`, result: null, error: null, status: "queued", version: 1, createdAt: 100, updatedAt: 100, ...overrides });
const deferred = () => { let resolve;const promise = new Promise(done => { resolve = done; });return { promise, resolve }; };

async function boot(t, { submit, snapshot } = {}) {
  const window = new Window({ url: "https://beebot.local" });
  t.after(() => window.close());
  let profiles = [profile("a"), profile("b")], sequence = 0;
  const snapshots = new Map([
    ["connection-a", { node: { id: "node-a" }, bots: [bot(), bot("other-bot", "Other")], goals: [], cursor: 0 }],
    ["connection-b", { node: { id: "node-b" }, bots: [bot()], goals: [], cursor: 0 }],
  ]);
  const calls = [], localCalls = [], changed = new Set(), selections = [];
  const local = (...args) => { localCalls.push(args);throw new Error("Remote chat must never call the local Host"); };
  window.__sandRoster = { createAgent: local, sendPrompt: local };
  window.desktop = {
    agent: { sendPrompt: local, cancel: local },
    nodes: {
      onChanged(listener) { changed.add(listener);return () => changed.delete(listener); },
      async request(input) {
        const request = clone(input);calls.push(request);
        if(request.action === "list") return clone(profiles);
        if(request.action === "snapshot") return snapshot ? snapshot(request, snapshots.get(request.id)) : clone(snapshots.get(request.id));
        if(request.action === "submitGoal") {
          if(submit) return submit(request, snapshots.get(request.id));
          const created = goal(`goal-${++sequence}`, { botId: request.botId, prompt: request.prompt, createdAt: 100 + sequence });
          snapshots.get(request.id).goals.push(created);
          return { goalId: created.id, commandId: `command-${sequence}` };
        }
        if(request.action === "resume") {
          profiles = profiles.map(p => p.id === request.id ? { ...p, status: "online" } : p);return;
        }
        const target = snapshots.get(request.id)?.goals.find(g => g.id === request.goalId);
        assert.ok(target, "only a goal on the selected server can be updated");
        if(request.action === "accept") {
          if(target.status !== "review" || target.version !== request.expectedVersion) throw new Error("stale_review: refresh before accepting");
          target.status = "succeeded";target.version++;return { goal: clone(target) };
        }
        if(request.action === "cancel") {
          target.status = target.status === "queued" ? "cancelled" : "cancelling";target.version++;return { goal: clone(target) };
        }
        if(request.action === "reconcile") {
          if(target.status !== "uncertain" || target.version !== request.expectedVersion || request.note.trim().length < 8) throw new Error("invalid reconciliation");
          target.status = "failed";target.version++;return { goal: clone(target) };
        }
        throw new Error(`Unexpected action ${request.action}`);
      },
    },
  };
  window.__beebotCloseNodeWorkbench = () => {};
  window.addEventListener("beebot-node-selection", event => selections.push(event.detail == null ? null : clone(event.detail)));
  window.eval(snippet);await tick();
  const controller = window.__beebotNodeChat;
  return {
    window, controller, calls, localCalls, snapshots, selections,
    state: () => controller.getSnapshot(),
    requests: action => calls.filter(request => request.action === action),
    setProfiles(next) { profiles = clone(next); },
    emit() { for(const listener of changed) listener(); },
    open: (id = "connection-a", botId = "shared-bot") => controller.open(id, snapshots.get(id)?.bots.find(b => b.id === botId) || bot(botId)),
  };
}

test("send targets the selected server and Bot, retries the same command key, and never calls local Host", async t => {
  let attempt = 0;
  const ui = await boot(t, { submit: request => {
    if(++attempt === 1) throw new Error("The acknowledgement was lost");
    return { goalId: "remote-goal", commandId: request.key };
  } });
  await ui.open("connection-b");ui.controller.setDraft("Please summarize");
  await ui.controller.send("Please summarize");
  assert.equal(ui.state().draft, "Please summarize");assert.match(ui.state().error, /acknowledgement/);assert.equal(ui.state().busy, false);
  await ui.controller.send("Please summarize");
  const requests = ui.requests("submitGoal");assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);assert.match(requests[0].key, /^[\da-f-]{36}$/i);
  assert.deepEqual(Object.keys(requests[0]).sort(), ["action", "botId", "id", "key", "prompt"]);
  assert.equal(requests[0].id, "connection-b");assert.equal(requests[0].botId, "shared-bot");assert.equal(ui.state().draft, "");
  await ui.controller.send("Please summarize");
  assert.notEqual(ui.requests("submitGoal")[2].key, requests[0].key, "a later intentional identical message is a new command");
  assert.deepEqual(ui.localCalls, []);
});

test("history is chronological user/assistant messages for just this Bot, with no invented streaming content", async t => {
  const ui = await boot(t);
  ui.snapshots.get("connection-a").goals = [
    goal("last", { createdAt: 300, status: "running", result: null }),
    goal("foreign", { botId: "other-bot", createdAt: 50, result: "Must not appear" }),
    goal("first", { createdAt: 100, status: "review", version: 3, result: "Actual response <img src=x>" }),
    goal("middle", { createdAt: 200, status: "succeeded", result: [{ text: "Part one" }, { content: "Part two" }] }),
  ];
  await ui.open();
  const messages = clone(ui.state().messages);
  assert.deepEqual(messages.map(m => [m.id, m.role, m.text]), [
    ["first:user", "user", "Prompt first"], ["first:assistant", "assistant", "Actual response <img src=x>"],
    ["middle:user", "user", "Prompt middle"], ["middle:assistant", "assistant", "Part one\n\nPart two"],
    ["last:user", "user", "Prompt last"], ["last:assistant", "assistant", ""],
  ]);
  assert.equal(messages.some(m => m.streaming === true), false);
  assert.deepEqual(clone(ui.state().runningGoal), { id: "last", status: "running" });
  assert.equal(ui.requests("goal").length, 0);
  const stableIds = messages.map(m => m.id);
  ui.snapshots.get("connection-a").goals.find(g => g.id === "last").status = "review";
  ui.snapshots.get("connection-a").goals.find(g => g.id === "last").result = "Final server response";
  await ui.controller.refresh();
  assert.deepEqual([...ui.state().messages].map(m => m.id), stableIds);
  assert.equal(ui.state().messages.at(-1).text, "Final server response");assert.equal(ui.state().runningGoal, null);
});

test("drafts are isolated by server, node identity and Bot", async t => {
  const ui = await boot(t);
  await ui.open();ui.controller.setDraft("A first Bot");
  await ui.open("connection-a", "other-bot");assert.equal(ui.state().draft, "");ui.controller.setDraft("A second Bot");
  await ui.open("connection-b");assert.equal(ui.state().draft, "");ui.controller.setDraft("B same Bot ID");
  await ui.open();assert.equal(ui.state().draft, "A first Bot");
  await ui.open("connection-a", "other-bot");assert.equal(ui.state().draft, "A second Bot");
  ui.setProfiles([{ ...profile("a"), nodeId: "replacement-node-a" }, profile("b")]);
  ui.snapshots.get("connection-a").node.id = "replacement-node-a";
  await ui.open();assert.equal(ui.state().draft, "", "a replacement node must not receive its predecessor's draft");
  await ui.open("connection-b");assert.equal(ui.state().draft, "B same Bot ID");
});

test("a late acknowledgement after switching chats cannot clear either a newer draft or the new chat", async t => {
  const gate = deferred();t.after(gate.resolve);
  const ui = await boot(t, { submit: async () => { await gate.promise;return { goalId: "accepted-a", commandId: "accepted" }; } });
  await ui.open();ui.controller.setDraft("Original A message");
  const pending = ui.controller.send("Original A message");await tick();
  assert.equal(ui.state().busy, true);
  await ui.controller.send("Original A message");assert.equal(ui.requests("submitGoal").length, 1, "busy blocks a duplicate send");
  ui.controller.setDraft("Newer A draft");await ui.open("connection-b");ui.controller.setDraft("New B draft");
  gate.resolve();await pending;
  assert.equal(ui.state().connectionId, "connection-b");assert.equal(ui.state().draft, "New B draft");assert.equal(ui.state().busy, false);
  await ui.open();assert.equal(ui.state().draft, "Newer A draft");
});

test("review acceptance uses the displayed version and exposes stale CAS rejection", async t => {
  const ui = await boot(t);
  const item = goal("review-me", { status: "review", version: 4, result: "Delivered work" });
  ui.snapshots.get("connection-a").goals = [item, goal("other-review", { botId: "other-bot", status: "review", version: 4 })];
  await ui.open();await ui.controller.accept("review-me", 3);
  assert.match(ui.state().error, /stale_review/);assert.equal(item.status, "review");
  assert.equal(ui.requests("accept")[0].expectedVersion, 3);
  await ui.controller.accept("review-me", 4);
  assert.equal(ui.requests("accept")[1].expectedVersion, 4);assert.equal(item.status, "succeeded");
  assert.equal(ui.state().messages.find(m => m.id === "review-me:assistant").status, "succeeded");
  await ui.controller.accept("other-review", 4);assert.equal(ui.requests("accept").length, 2, "another Bot's result cannot be accepted from this conversation");
});

test("Stop preserves cancellation pending until the server resolves it", async t => {
  const ui = await boot(t);
  const item = goal("running", { status: "running", version: 2 });ui.snapshots.get("connection-a").goals = [item];
  await ui.open();await ui.controller.stop("running");
  assert.deepEqual(ui.requests("cancel").map(({ key, ...request }) => request), [{ action: "cancel", id: "connection-a", goalId: "running" }]);
  assert.deepEqual(clone(ui.state().runningGoal), { id: "running", status: "cancelling" });
  assert.equal(ui.state().messages.at(-1).status, "cancelling");assert.equal(ui.state().messages.at(-1).text, "");
  item.status = "uncertain";item.version++;item.error = "External effects need inspection";await ui.controller.refresh();
  assert.equal(ui.state().runningGoal, null);assert.equal(ui.state().uncertainGoal.id, "running");
  assert.equal(ui.state().messages.at(-1).status, "uncertain");
});

test("an uncertain execution blocks messages until server reconciliation succeeds", async t => {
  const ui = await boot(t);
  const item = goal("interrupted", { status: "uncertain", version: 5, error: "Inspect external effects" });ui.snapshots.get("connection-a").goals = [item];
  await ui.open();ui.controller.setDraft("Continue work");await ui.controller.send("Continue work");
  assert.equal(ui.requests("submitGoal").length, 0);assert.equal(ui.state().draft, "Continue work");
  await ui.controller.reconcile("interrupted", 5, "Verified the process stopped and inspected its external effects");
  const reconcile = ui.requests("reconcile")[0];
  assert.equal(reconcile.id, "connection-a");assert.equal(reconcile.expectedVersion, 5);assert.equal(reconcile.goalId, "interrupted");
  assert.equal(ui.state().uncertainGoal, null);assert.equal(item.status, "failed");
  await ui.controller.send("Continue work");assert.equal(ui.requests("submitGoal").length, 1);
});

test("offline or removed connections keep their identity and never fall back to another server", async t => {
  const ui = await boot(t);await ui.open("connection-b");ui.controller.setDraft("Only for B");
  ui.setProfiles([profile("a"), profile("b", "reconnecting")]);await ui.controller.refresh();await ui.controller.send("Only for B");
  assert.equal(ui.state().connectionId, "connection-b");assert.equal(ui.state().draft, "Only for B");assert.equal(ui.requests("submitGoal").length, 0);
  await ui.controller.reconnect();assert.equal(ui.requests("resume")[0].id, "connection-b");
  ui.setProfiles([profile("a")]);await ui.controller.refresh();await ui.controller.send("Only for B");
  assert.equal(ui.state().connectionId, "connection-b");assert.equal(ui.state().server?.status, "unavailable");assert.equal(ui.requests("submitGoal").length, 0);
  assert.match(ui.state().error, /cannot receive|connection changed/);
});

test("a connection whose node identity changed cannot send to the replacement server", async t => {
  const ui = await boot(t);await ui.open();ui.controller.setDraft("For the original node");
  ui.setProfiles([{ ...profile("a"), nodeId: "unexpected-node" }, profile("b")]);
  await ui.controller.refresh();await ui.controller.send("For the original node");
  assert.equal(ui.requests("submitGoal").length, 0);
  assert.equal(ui.state().connectionId, "connection-a");assert.equal(ui.state().draft, "For the original node");
});

test("signed-out and still-authorizing servers do not fetch protected snapshots", async t => {
  const ui = await boot(t);
  for(const status of ["signed-out", "connecting"]) {
    ui.setProfiles([profile("a", status), profile("b")]);
    await assert.rejects(ui.open(), { code: "connection_unavailable" });
    assert.equal(ui.requests("snapshot").length, 0);assert.deepEqual([...ui.state().messages], []);assert.equal(ui.state().loading, false);
    await ui.controller.send("Not authorized");assert.equal(ui.requests("submitGoal").length, 0);
  }
  ui.setProfiles([profile("a"), profile("b")]);await ui.open();assert.equal(ui.requests("snapshot").length, 1);
});

test("signing back in restores unchanged chat history after sign-out cleared it", async t => {
  const ui = await boot(t);ui.snapshots.get("connection-a").goals = [goal("existing-result", { status: "review", result: "Saved answer" })];
  await ui.open();assert.equal(ui.state().messages.length, 2);
  ui.setProfiles([profile("a", "signed-out"), profile("b")]);await ui.controller.refresh();
  assert.equal(ui.state().messages.length, 0);
  ui.setProfiles([profile("a"), profile("b")]);await ui.controller.refresh();
  assert.equal(ui.state().messages.length, 2);assert.equal(ui.state().messages.at(-1).text, "Saved answer");
});

test("closing a conversation leaves the server execution running and preserves its draft", async t => {
  const ui = await boot(t);ui.snapshots.get("connection-a").goals = [goal("active-work", { status: "running" })];
  await ui.open();ui.controller.setDraft("Next message");ui.controller.close();
  assert.equal(ui.state().active, false);assert.equal(ui.requests("cancel").length, 0);assert.equal(ui.snapshots.get("connection-a").goals[0].status, "running");
  assert.equal(ui.selections.at(-1), null);
  await ui.open();assert.equal(ui.state().draft, "Next message");assert.equal(ui.state().runningGoal.id, "active-work");
});

test("failed open preserves the previous selection, draft and owning Settings dialog", async t => {
  let fail = false, closed = 0;
  const ui = await boot(t, { snapshot: (request, data) => { if (fail) throw new Error("Read failed"); return clone(data); } });
  ui.window.__beebotCloseNodeWorkbench = () => { closed++; };
  await ui.open(); ui.controller.setDraft("Keep this draft"); const previous = clone(ui.state());
  fail = true;
  await assert.rejects(ui.open("connection-b"), /Read failed/);
  assert.deepEqual(clone(ui.state()), previous);
  assert.equal(closed, 0, "the caller, not the controller, owns Settings lifecycle");
  assert.equal(ui.selections.length, 1);
  assert.equal(ui.calls.some(c => ["submitGoal", "cancel", "createBot"].includes(c.action)), false);
});

test("successful open publishes one verified selection and no empty interim conversation", async t => {
  const ui = await boot(t), observed = [];
  ui.snapshots.get("connection-a").goals = [goal("delivered", { status: "review", result: "Readable output" })];
  const unsubscribe = ui.controller.subscribe(() => observed.push(clone(ui.state()))); t.after(unsubscribe);
  await ui.open();
  assert.equal(observed.length, 1);
  assert.equal(observed[0].messages.at(-1).text, "Readable output");
  assert.equal(observed[0].loading, false);
  assert.deepEqual(ui.calls.map(c => c.action), ["list", "snapshot", "list"]);
});

test("a newer selection wins over a slow earlier open without modifying either draft", async t => {
  const gate = deferred(); t.after(gate.resolve); let hold = false;
  const ui = await boot(t, { snapshot: async (request, data) => { if (hold && request.id === "connection-a") await gate.promise; return clone(data); } });
  await ui.open(); ui.controller.setDraft("A draft"); hold = true;
  const earlier = ui.open(); const rejected = assert.rejects(earlier, { code: "open_superseded" });
  await tick(); await ui.open("connection-b"); ui.controller.setDraft("B draft");
  gate.resolve(); await rejected;
  assert.equal(ui.state().connectionId, "connection-b"); assert.equal(ui.state().draft, "B draft");
  hold = false; await ui.open(); assert.equal(ui.state().draft, "A draft");
});

test("closing a view cancels its pending open via AbortSignal without stopping server work", async t => {
  const gate = deferred(); t.after(gate.resolve);
  const ui = await boot(t, { snapshot: async (_request, data) => { await gate.promise; return clone(data); } });
  const abort = new AbortController();
  const pending = ui.controller.open("connection-a", bot(), { signal: abort.signal });
  const rejected = assert.rejects(pending, { code: "open_cancelled" });
  await tick(); abort.abort(); await rejected; gate.resolve(); await tick();
  assert.equal(ui.state().active, false); assert.equal(ui.selections.length, 0);
  assert.equal(ui.requests("cancel").length, 0); assert.equal(ui.requests("submitGoal").length, 0);
});

test("an already aborted open performs no bridge calls", async t => {
  const ui = await boot(t), abort = new AbortController(); abort.abort();
  await assert.rejects(ui.controller.open("connection-a", bot(), { signal: abort.signal }), { code: "open_cancelled" });
  assert.equal(ui.calls.length, 0); assert.equal(ui.state().active, false);
});

test("controller close supersedes an outstanding open", async t => {
  const gate = deferred(); t.after(gate.resolve);
  const ui = await boot(t, { snapshot: async (_request, data) => { await gate.promise; return clone(data); } });
  const pending = ui.open(), rejected = assert.rejects(pending, { code: "open_superseded" });
  await tick(); ui.controller.close(); gate.resolve(); await rejected;
  assert.equal(ui.state().active, false);
});

test("sign-out racing a snapshot rejects the open even without an onChanged notification", async t => {
  const gate = deferred(); t.after(gate.resolve);
  const ui = await boot(t, { snapshot: async (_request, data) => { await gate.promise; return clone(data); } });
  const pending = ui.open(), rejected = assert.rejects(pending, { code: "connection_changed" });
  await tick(); ui.setProfiles([profile("a", "signed-out"), profile("b")]); gate.resolve(); await rejected;
  assert.equal(ui.state().active, false); assert.equal(ui.selections.length, 0);
});

test("removed or replaced connection cannot receive a stale opening result", async t => {
  for (const latest of [[profile("b")], [{ ...profile("a"), nodeId: "replacement" }, profile("b")]]) {
    const gate = deferred(); t.after(gate.resolve);
    const ui = await boot(t, { snapshot: async (_request, data) => { await gate.promise; return clone(data); } });
    const rejected = assert.rejects(ui.open(), { code: "connection_changed" });
    await tick(); ui.setProfiles(latest); gate.resolve(); await rejected;
    assert.equal(ui.state().active, false);
  }
});

test("an authorization epoch change invalidates a pending open even after quick re-login", async t => {
  const gate = deferred(); t.after(gate.resolve);
  const ui = await boot(t, { snapshot: async (_request, data) => { await gate.promise; return clone(data); } });
  const rejected = assert.rejects(ui.open(), { code: "connection_changed" });
  await tick(); ui.emit(); gate.resolve(); await rejected;
  assert.equal(ui.selections.length, 0);
});

test("missing Bot, mismatched node and malformed snapshots fail without entering the chat", async t => {
  for (const [snapshot, code] of [
    [{ node: { id: "other-node" }, bots: [bot()], goals: [] }, "connection_changed"],
    [{ node: { id: "node-a" }, bots: [], goals: [] }, "bot_unavailable"],
    [{ node: { id: "node-a" }, bots: [bot()], goals: null }, "invalid_response"],
    [{ node: { id: "node-a" }, bots: [bot()], goals: [{ botId: "shared-bot" }] }, "invalid_response"],
  ]) {
    const ui = await boot(t, { snapshot: () => clone(snapshot) });
    await assert.rejects(ui.open(), { code }); assert.equal(ui.state().active, false);
  }
});

test("refresh does not restore messages after sign-out raced a snapshot", async t => {
  const gate = deferred(); t.after(gate.resolve); let hold = false;
  const ui = await boot(t, { snapshot: async (_request, data) => { if (hold) await gate.promise; return clone(data); } });
  ui.snapshots.get("connection-a").goals = [goal("result", { status: "review", result: "Private result" })];
  await ui.open(); hold = true; const refresh = ui.controller.refresh(); await tick();
  ui.setProfiles([profile("a", "signed-out"), profile("b")]); gate.resolve(); await refresh;
  assert.equal(ui.state().server.status, "signed-out"); assert.equal(ui.state().messages.length, 0);
  await ui.controller.accept("result", 1); assert.equal(ui.requests("accept").length, 0);
});

test("a connection event blocks actions immediately until the fresh read succeeds", async t => {
  const ui = await boot(t); ui.snapshots.get("connection-a").goals = [goal("result", { status: "review" })];
  await ui.open(); ui.emit();
  await ui.controller.send("Do not send"); await ui.controller.accept("result", 1);
  assert.equal(ui.requests("submitGoal").length, 0); assert.equal(ui.requests("accept").length, 0);
  await ui.controller.refresh(); await ui.controller.send("Now checked"); assert.equal(ui.requests("submitGoal").length, 1);
});

test("reopening the same Bot during a pending submission cannot unlock duplicate sending", async t => {
  const gate = deferred(); t.after(gate.resolve);
  const ui = await boot(t, { submit: async request => { await gate.promise; return { goalId: "g", commandId: request.key }; } });
  await ui.open(); const pending = ui.controller.send("Only once"); await tick();
  await ui.open(); assert.equal(ui.state().busy, true);
  await ui.controller.send("Only once"); assert.equal(ui.requests("submitGoal").length, 1);
  gate.resolve(); await pending; assert.equal(ui.state().busy, false);
});

test("transient snapshot failure retains history without inventing task failure and blocks writes", async t => {
  let fail = false;
  const ui = await boot(t, { snapshot: (_request, data) => { if (fail) throw new Error("Network interrupted"); return clone(data); } });
  ui.snapshots.get("connection-a").goals = [goal("working", { status: "running" })];
  await ui.open(); fail = true; await ui.controller.refresh();
  assert.equal(ui.state().runningGoal.status, "running"); assert.match(ui.state().error, /Network interrupted/);
  await ui.controller.stop("working"); assert.equal(ui.requests("cancel").length, 0);
  fail = false; await ui.controller.refresh(); await ui.controller.stop("working"); assert.equal(ui.requests("cancel").length, 1);
});

test("opening times out without letting a late read change the selected conversation", async t => {
  const gate = deferred(); t.after(gate.resolve);
  const ui = await boot(t, { snapshot: async (_request, data) => { await gate.promise; return clone(data); } });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const rejected = assert.rejects(ui.open(), { code: "open_timeout" });
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(15001); await rejected; gate.resolve();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(ui.state().active, false); assert.equal(ui.selections.length, 0);
});

test("a safety-frozen Bot keeps an editable draft and never submits on release automatically",async t=>{
  let frozen=true;const ui=await boot(t,{snapshot:(_request,current)=>({...clone(current),bots:current.bots.map(b=>({...b,securityFrozen:frozen}))})});
  await ui.open();ui.controller.setDraft("Keep this unsent text");await ui.controller.send("Keep this unsent text");
  assert.equal(ui.requests("submitGoal").length,0);assert.equal(ui.state().draft,"Keep this unsent text");assert.match(ui.state().error,/safety frozen/);
  frozen=false;await ui.open();assert.equal(ui.requests("submitGoal").length,0);assert.equal(ui.state().draft,"Keep this unsent text");
  await ui.controller.send(ui.state().draft);assert.equal(ui.requests("submitGoal").length,1);
});
