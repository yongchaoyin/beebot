import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Window } from "happy-dom";

const snippet = await readFile(path.resolve(import.meta.dirname, "../scripts/lib/beebot-node-sidebar.snippet.js"), "utf8");
const cacheKey = "beebot.server-bot-catalog.v1";
const copy = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
const server = (id, status = "online") => ({ id: `connection-${id}`, nodeId: `node-${id}`, name: `Server ${id.toUpperCase()}`, baseUrl: `https://${id}.example`, status });
const bot = (id, name) => ({ id, name, description: "Server-owned work", avatarColor: "blue", avatarShape: "hex" });

async function boot(t, { initialProfiles = [server("a"), server("b")], initialCache, snapshot, create } = {}) {
  const window = new Window({ url: "https://beebot.local" });
  t.after(() => window.happyDOM.close());
  const { document } = window;
  let profiles = copy(initialProfiles);
  const calls = { requests: [], opened: [], closed: 0, observerBatches: 0, observerLoop: false };
  const snapshots = new Map([
    ["connection-a", { node: { id: "node-a" }, bots: [bot("same-bot-id", "Writer A")], goals: [], cursor: 0 }],
    ["connection-b", { node: { id: "node-b" }, bots: [bot("same-bot-id", "Writer B")], goals: [], cursor: 0 }],
  ]);
  const listeners = new Set();
  window.__sandUiLanguage = "en";
  window.desktop = { nodes: {
    onChanged(listener) { listeners.add(listener);return () => listeners.delete(listener); },
    async request(request) {
      calls.requests.push(copy(request));
      if(request.action === "list") return copy(profiles);
      if(request.action === "snapshot") return snapshot ? snapshot(request.id, snapshots.get(request.id)) : copy(snapshots.get(request.id));
      if(request.action === "createBot") return create ? create(request) : { bot: bot("new-bot", request.name) };
      throw new Error(`Unexpected request ${request.action}`);
    },
  } };
  window.__beebotNodeChat = { open: async (connectionId, bot) => { calls.opened.push({ connectionId, bot: copy(bot) }); }, close: () => {} };
  window.__beebotCloseNodeWorkbench = () => { calls.closed++; };
  const OriginalObserver = window.MutationObserver;
  window.MutationObserver = class extends OriginalObserver {
    constructor(callback) {
      super((records, observer) => {
        calls.observerBatches++;
        if(calls.observerBatches > 60) { calls.observerLoop = true;observer.disconnect();return; }
        callback(records, observer);
      });
    }
  };
  // This is the native production list, not the simpler test-only rows class.
  document.body.innerHTML = '<div class="sand-agents-list"><div data-native-scrollbar="none"><div id="native-scroll-content"><button data-agent-id="local-existing">Local existing</button></div></div></div>';
  const target = document.getElementById("native-scroll-content");
  if(initialCache !== undefined) window.localStorage.setItem(cacheKey, JSON.stringify(initialCache));
  window.eval(snippet);
  await tick();
  await window.__beebotServerBots.refresh();
  await tick();
  return {
    window, document, target, calls, snapshots,
    rows: () => [...document.querySelectorAll(".bb-server-bot")],
    cache: () => JSON.parse(window.localStorage.getItem(cacheKey) || "{}"),
    setProfiles(next) { profiles = copy(next); },
    emit() { for(const listener of listeners) listener(); },
    refresh: () => window.__beebotServerBots.refresh(),
  };
}

test("server Bots mount inside the native scroll content and observation settles without rerendering", async t => {
  const ui = await boot(t);
  const section = ui.document.getElementById("beebot-server-bot-list");
  assert.equal(section.parentElement, ui.target);
  assert.equal(ui.rows().length, 2);
  assert.equal(ui.target.querySelector("[data-agent-id]").textContent, "Local existing");
  const originalRow = ui.rows()[0];
  const before = ui.calls.observerBatches;
  const unrelated = ui.document.createElement("div");ui.document.body.append(unrelated);
  await tick();await tick();
  assert.equal(ui.rows()[0], originalRow, "an unrelated native DOM update must not rebuild remote rows");
  assert.equal(ui.calls.observerLoop, false);
  assert.ok(ui.calls.observerBatches - before <= 2, "self-rendering must not produce an observer loop");
  const settled = ui.calls.observerBatches;await tick();assert.equal(ui.calls.observerBatches, settled);
  const replacement = ui.document.createElement("div");replacement.id = "replacement-scroll-content";
  ui.target.parentElement.replaceChildren(replacement);await tick();
  assert.equal(ui.document.getElementById("beebot-server-bot-list").parentElement, replacement, "native list remounts must recover the catalog");
  assert.equal(ui.rows().length, 2);assert.equal(ui.calls.observerLoop, false);
});

test("same Bot IDs on different servers remain distinct and open their server conversation", async t => {
  const ui = await boot(t);
  const [a, b] = ui.rows();
  assert.equal(a.dataset.nodeBotId, b.dataset.nodeBotId);
  assert.equal(a.dataset.nodeConnectionId, "connection-a");assert.equal(b.dataset.nodeConnectionId, "connection-b");
  assert.equal(ui.document.querySelectorAll("#beebot-server-bot-list [data-agent-id]").length, 0);
  b.click();await tick();
  assert.deepEqual(ui.calls.opened, [{ connectionId: "connection-b", bot: bot("same-bot-id", "Writer B") }]);
  ui.window.dispatchEvent(new ui.window.CustomEvent("beebot-node-selection", { detail: { connectionId: "connection-b", botId: "same-bot-id" } }));
  assert.deepEqual(ui.rows().map(row => row.getAttribute("aria-current")), ["false", "true"]);
  assert.equal(ui.document.body.dataset.beebotRemoteActive, "true");
  ui.document.querySelector('[data-agent-id="local-existing"]').click();
  assert.equal(ui.calls.closed, 1);assert.equal(ui.document.body.hasAttribute("data-beebot-remote-active"), false);
  assert.deepEqual(ui.rows().map(row => row.getAttribute("aria-current")), ["false", "false"]);
});

test("signed-out and removed connections immediately clear cached Bots while other servers remain", async t => {
  const ui = await boot(t);
  ui.setProfiles([server("a", "signed-out"), server("b")]);
  await ui.window.__beebotServerBots.listServers();
  assert.deepEqual(ui.rows().map(row => row.dataset.nodeConnectionId), ["connection-b"]);
  assert.equal(Object.hasOwn(ui.cache(), "connection-a"), false);
  ui.setProfiles([server("a", "signed-out")]);await ui.window.__beebotServerBots.listServers();
  assert.equal(ui.rows().length, 0);assert.deepEqual(ui.cache(), {});
});

test("one failed server preserves its offline Bots without blocking another server's updated snapshot", async t => {
  let failA = false;
  const ui = await boot(t, { snapshot: (id, value) => {
    if(id === "connection-a" && failA) throw new Error("connection A is offline");
    return copy(value);
  } });
  failA = true;ui.setProfiles([server("a", "reconnecting"), server("b")]);
  ui.snapshots.set("connection-b", { node: { id: "node-b" }, bots: [bot("second-b", "Updated B")], goals: [], cursor: 1 });
  await ui.refresh();
  assert.equal(ui.rows().length, 2);
  assert.match(ui.rows()[0].textContent, /Writer A.*Offline/);
  assert.match(ui.rows()[1].textContent, /Updated B/);
  assert.equal(ui.cache()["connection-a"].bots[0].name, "Writer A");
  assert.equal(ui.cache()["connection-b"].bots[0].id, "second-b");
});

test("a stalled snapshot on one server does not delay another server's catalog update", async t => {
  let stallA = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  const ui = await boot(t, { snapshot: async (id, value) => {
    if(stallA && id === "connection-a") await gate;
    return copy(value);
  } });
  stallA = true;
  ui.snapshots.set("connection-b", { node: { id: "node-b" }, bots: [bot("live-b", "Live update B")], goals: [], cursor: 2 });
  const pending = ui.refresh();
  try {
    await tick();await tick();
    assert.match(ui.rows().find(row => row.dataset.nodeConnectionId === "connection-b").textContent, /Live update B/, "B must update while A is still waiting for its response");
  } finally { release();await pending; }
});

test("a changed node identity drops the previous node's cache and rejects mismatched snapshots", async t => {
  const ui = await boot(t);
  ui.setProfiles([{ ...server("a"), nodeId: "replacement-node" }, server("b")]);
  await ui.refresh();
  assert.deepEqual(ui.rows().map(row => row.dataset.nodeConnectionId), ["connection-b"]);
  assert.equal(Object.hasOwn(ui.cache(), "connection-a"), false);
});

test("malformed persisted Bot arrays are discarded without breaking other connected servers", async t => {
  const ui = await boot(t, {
    initialProfiles: [server("a", "reconnecting"), server("b")],
    initialCache: { "connection-a": { nodeId: "node-a", bots: { stale: true } } },
    snapshot: (id, value) => { if(id === "connection-a") throw new Error("offline");return copy(value); },
  });
  assert.deepEqual(ui.rows().map(row => row.dataset.nodeConnectionId), ["connection-b"]);
  assert.equal(Object.hasOwn(ui.cache(), "connection-a"), false);
});

test("remote creation forwards only its public allowlist and open does not include secret fields", async t => {
  const ui = await boot(t);
  const result = await ui.window.__beebotServerBots.create({
    connectionId: "connection-b", name: "New remote", description: "Review work", avatarColor: "blue", avatarShape: "hex", key: "command-key",
    access_token: "must-not-leave-test", refresh_token: "must-not-leave-test", inferenceVendorId: "local-vendor", isKickstartRequested: true, origin: "user",
  });
  const creates = ui.calls.requests.filter(request => request.action === "createBot");
  assert.deepEqual(creates, [{ action: "createBot", id: "connection-b", name: "New remote", description: "Review work", avatarColor: "blue", avatarShape: "hex", key: "command-key" }]);
  await ui.window.__beebotServerBots.open("connection-b", { ...result.bot, access_token: "not-public", internalConfig: { token: "not-public" } });
  assert.deepEqual(ui.calls.opened, [{ connectionId: "connection-b", bot: bot("new-bot", "New remote") }]);
  assert.doesNotMatch(JSON.stringify(ui.cache()), /token|inferenceVendorId|isKickstartRequested|origin/);
});

test("a late snapshot cannot restore Bots after their connection has been signed out", async t => {
  let release, started = false;
  const gate = new Promise(resolve => { release = resolve; });
  const ui = await boot(t, { snapshot: async (id, value) => {
    if(started && id === "connection-a") await gate;
    return copy(value);
  } });
  started = true;
  const pending = ui.refresh();await tick();
  ui.setProfiles([server("a", "signed-out"), server("b")]);await ui.window.__beebotServerBots.listServers();
  release();await pending;
  assert.equal(Object.hasOwn(ui.cache(), "connection-a"), false);
  assert.deepEqual(ui.rows().map(row => row.dataset.nodeConnectionId), ["connection-b"]);
});

test("a late create acknowledgement cannot restore the catalog cleared by sign-out", async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const ui = await boot(t, { create: async request => { await gate;return { bot: bot("late-bot", request.name) }; } });
  const pending = ui.window.__beebotServerBots.create({ connectionId: "connection-a", name: "In flight", description: "", key: "late-command" });
  await tick();
  ui.setProfiles([server("a", "signed-out"), server("b")]);await ui.window.__beebotServerBots.listServers();
  assert.equal(Object.hasOwn(ui.cache(), "connection-a"), false);
  release();await assert.rejects(pending, /connection changed/);
  assert.equal(Object.hasOwn(ui.cache(), "connection-a"), false, "do not retain Bot data for a signed-out device");
  assert.deepEqual(ui.rows().map(row => row.dataset.nodeConnectionId), ["connection-b"]);
});

test("only selecting a local sidebar Bot closes the remote conversation", async t => {
  const ui=await boot(t);
  const chat=ui.document.createElement("section");chat.dataset.agentId="local-context";
  const field=ui.document.createElement("textarea");chat.append(field);ui.document.body.append(chat);
  field.click();assert.equal(ui.calls.closed,0,"metadata outside the sidebar must not steal the chat focus");
  ui.rows()[0].click();await tick();assert.equal(ui.calls.closed,0);
  ui.target.querySelector('[data-agent-id="local-existing"]').click();
  assert.equal(ui.calls.closed,1,"local sidebar selection returns to its original conversation");
});
