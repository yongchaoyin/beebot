import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Window } from "happy-dom";

// Uses the same DOM dependency and real packaged adapter as node-workbench.test.mjs.
const snippet = await readFile(new URL("../scripts/lib/beebot-node-workbench.snippet.js", import.meta.url), "utf8");
const profile = (id, status = "online") => ({ id, nodeId: `node-${id}`, name: `Server ${id}`, baseUrl: `https://${id}.example`, status });
const snapshot = id => ({ node: { id: `node-${id}` }, bots: [{ id: `bot-${id}`, name: `Bot ${id}` }], goals: [], cursor: 0 });
async function until(check, message = "condition was not reached") {
  const end = Date.now() + 1500;
  while (!check()) {
    if (Date.now() > end) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(initial = []) {
  const window = new Window({ url: "https://beebot.local" });
  const state = { profiles: structuredClone(initial), calls: [], snapshots: {}, hooks: {}, opened: [], closedSettings: 0, closedChats: 0 };
  const listeners = new Set();
  const panel = window.document.createElement("section");
  window.document.body.append(panel);
  const changed = id => listeners.forEach(fn => fn({ id }));
  window.desktop = { nodes: {
    onChanged(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async request(input) {
      state.calls.push(structuredClone(input));
      if (state.hooks[input.action]) return state.hooks[input.action](input);
      if (input.action === "list") return structuredClone(state.profiles);
      if (input.action === "snapshot") return structuredClone(state.snapshots[input.id] || snapshot(input.id));
      if (input.action === "add") {
        const existing = state.profiles.find(p => p.baseUrl === input.address);
        if (existing) return structuredClone(existing);
        const next = { ...profile("new", "signed-out"), baseUrl: input.address };
        state.profiles.push(next);
        return structuredClone(next);
      }
      const p = state.profiles.find(item => item.id === input.id);
      assert.ok(p, "operation must target an existing connection");
      if (input.action === "login" || input.action === "resume") { p.status = "online"; changed(p.id); return; }
      if (input.action === "logout") { p.status = "signed-out"; changed(p.id); return; }
      if (input.action === "remove") { state.profiles = state.profiles.filter(item => item.id !== p.id); return { remoteRevoked: true }; }
      throw new Error(`Unexpected action: ${input.action}`);
    },
  } };
  window.__beebotNodeChat = {
    close() { state.closedChats++; },
    open(...args) { state.opened.push(args); },
  };
  window.eval(snippet);
  const cleanup = window.__beebotMountServersSettings(panel, { onOpenBot() { state.closedSettings++; } });
  const find = label => [...panel.querySelectorAll("button")].find(button => button.textContent === label);
  const click = label => { const found = find(label); assert.ok(found, label); assert.equal(found.disabled, false, `${label} must be enabled`); found.click(); };
  const select = value => { const picker = panel.querySelector("#bb-node-picker"); picker.value = value; picker.dispatchEvent(new window.Event("change")); };
  const submit = value => {
    const field = panel.querySelector("#bb-node-address");
    field.value = value; field.dispatchEvent(new window.Event("input"));
    panel.querySelector("form").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
  };
  return { window, panel, state, changed, cleanup, click, select, submit, find, listeners,
    async close() { cleanup(); await window.happyDOM.close(); },
  };
}

test("server origin validation blocks unsafe inputs before calling the trusted bridge", async () => {
  const h = harness();
  try {
    await until(() => !h.panel.querySelector("input").disabled);
    for (const input of ["", "not a URL", "http://192.168.1.3", "https://a.example/path", "https://user:secret@a.example", "https://a.example?token=x", "file:///tmp/file"]) {
      h.submit(input);
      assert.equal(h.panel.querySelector("input").getAttribute("aria-invalid"), "true", input);
      assert.equal(h.window.document.activeElement, h.panel.querySelector("input"));
    }
    assert.equal(h.state.calls.filter(call => call.action === "add").length, 0);
  } finally { await h.close(); }
});

test("loopback HTTP remains valid and a repeated submit never duplicates the command", async () => {
  const h = harness(), pending = deferred();
  try {
    await until(() => !h.panel.querySelector("input").disabled);
    h.state.hooks.add = async input => { await pending.promise; const p = { ...profile("new", "signed-out"), baseUrl: input.address }; h.state.profiles.push(p); return p; };
    h.submit("http://127.0.0.1:8787/"); h.submit("https://different.example");
    assert.deepEqual(h.state.calls.filter(call => call.action === "add"), [{ action: "add", address: "http://127.0.0.1:8787" }]);
    pending.resolve();
    await until(() => h.find("Sign in") && !h.find("Sign in").disabled);
    assert.equal(h.panel.querySelector(".bb-server-url").textContent, "http://127.0.0.1:8787");
  } finally { pending.resolve(); await h.close(); }
});

test("a slow snapshot on A does not block B or replace B after it finishes", async () => {
  const h = harness([profile("a"), profile("b")]), pending = deferred();
  try {
    h.state.hooks.snapshot = input => input.id === "a" ? pending.promise : snapshot("b");
    await until(() => h.state.calls.some(call => call.action === "snapshot" && call.id === "a"));
    h.select("b");
    await until(() => h.find("Bot b"));
    pending.resolve(snapshot("a"));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(h.find("Bot a"), undefined);
    h.click("Bot b");
    await until(() => h.state.closedSettings === 1);
    assert.equal(h.state.opened[0][0], "b");
    assert.equal(h.state.closedChats, 0);
  } finally { pending.resolve(snapshot("a")); await h.close(); }
});

test("a sign-out event invalidates a pending snapshot before the next list reply", async () => {
  const h = harness([profile("a")]), pending = deferred();
  try {
    h.state.hooks.snapshot = () => pending.promise;
    await until(() => h.state.calls.some(call => call.action === "snapshot"));
    h.state.profiles[0].status = "signed-out"; h.changed("a");
    pending.resolve(snapshot("a"));
    await until(() => h.find("Sign in") && !h.find("Sign in").hidden);
    assert.equal(h.find("Bot a"), undefined);
    assert.equal(h.state.calls.filter(call => call.action === "snapshot").length, 1);
  } finally { pending.resolve(snapshot("a")); await h.close(); }
});

test("a different node identity at the same connection never displays the old snapshot", async () => {
  const h = harness([profile("a")]);
  try {
    h.state.snapshots.a = { ...snapshot("a"), node: { id: "different-node" } };
    await until(() => h.panel.querySelector(".bb-notice-title").textContent.includes("Could not load"));
    assert.equal(h.find("Bot a"), undefined);
  } finally { await h.close(); }
});

test("removal needs confirmation, Escape cancels it, and partial revocation is not success", async () => {
  const h = harness([profile("a"), profile("b")]);
  try {
    await until(() => h.find("Bot a"));
    h.click("Remove");
    assert.equal(h.window.document.activeElement, h.find("Cancel"));
    assert.equal(h.state.calls.filter(call => call.action === "remove").length, 0);
    h.find("Cancel").dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(h.window.document.activeElement, h.find("Remove"));
    assert.equal(h.panel.querySelector(".bb-confirm").hidden, true);
    h.state.hooks.remove = input => { h.state.profiles = h.state.profiles.filter(p => p.id !== input.id); return { remoteRevoked: false }; };
    h.click("Remove"); h.click("Remove connection");
    await until(() => h.panel.querySelector(".bb-notice-title").textContent.includes("was not revoked"));
    assert.equal(h.panel.querySelector("select").value, "");
    assert.equal(h.state.calls.filter(call => call.action === "remove").length, 1);
    assert.equal(h.state.calls.some(call => ["cancel", "createBot", "submitGoal"].includes(call.action)), false);
  } finally { await h.close(); }
});

test("an external connection change invalidates a confirmation immediately", async () => {
  const h = harness([profile("a")]);
  try {
    await until(() => h.find("Bot a")); h.click("Remove");
    const oldConfirm = h.find("Remove connection");
    h.state.profiles = []; h.changed("a");
    oldConfirm.click();
    assert.equal(h.state.calls.some(call => call.action === "remove"), false);
  } finally { await h.close(); }
});

test("failed logout does not claim that the device session was revoked", async () => {
  const h = harness([profile("a")]);
  try {
    await until(() => h.find("Bot a"));
    h.state.hooks.logout = () => { throw new Error("Network unavailable"); };
    h.click("Sign out"); h.click("Confirm sign-out");
    await until(() => h.panel.querySelector(".bb-notice-title").textContent.includes("may still be active"));
    assert.equal(h.state.profiles[0].status, "online");
  } finally { await h.close(); }
});

test("reconnecting and unknown states are never promoted to online", async () => {
  const h = harness([profile("a", "reconnecting"), profile("b", "future-status")]);
  try {
    await until(() => h.panel.querySelector(".bb-status").textContent === "Reconnecting");
    assert.equal(h.panel.querySelector(".bb-status").textContent, "Reconnecting");
    h.select("b");
    await until(() => h.panel.querySelector(".bb-status").textContent === "Unknown status");
    assert.equal(h.state.calls.some(call => call.action === "snapshot"), false);
  } finally { await h.close(); }
});

test("language changes preserve the address draft and keyboard focus", async () => {
  const h = harness();
  try {
    await until(() => !h.panel.querySelector("input").disabled);
    const input = h.panel.querySelector("input"); input.value = "https://draft.example"; input.focus();
    h.window.__sandUiLanguage = "zh";
    h.window.dispatchEvent(new h.window.Event("sand-ui-language-changed"));
    assert.equal(input.value, "https://draft.example");
    assert.equal(h.window.document.activeElement, input);
    assert.equal(h.panel.querySelector("h2").textContent, "服务器连接");
  } finally { await h.close(); }
});

test("failed Bot opening leaves Settings open and reports a retryable UI error", async () => {
  const h = harness([profile("a")]);
  try {
    h.window.__beebotNodeChat.open = () => { throw new Error("Chat unavailable"); };
    await until(() => h.find("Bot a")); h.click("Bot a");
    await until(() => h.panel.querySelector(".bb-notice-title").textContent.includes("Settings remain open"));
    assert.equal(h.state.closedSettings, 0);
    assert.equal(h.find("Bot a").disabled, false);
  } finally { await h.close(); }
});

test("Bot metadata and common credential-bearing errors are never interpreted as markup", async () => {
  const h = harness([profile("a")]);
  try {
    h.state.snapshots.a = { ...snapshot("a"), bots: [{ id: "x", name: '<img src=x onerror="window.xss=1">', description: "<script>alert(1)</script>" }] };
    await until(() => h.panel.querySelector(".bb-node-bot"));
    assert.equal(h.panel.querySelector("img"), null);
    assert.equal(h.window.xss, undefined);
    h.state.hooks.snapshot = () => { throw new Error("access_token=secret123 Bearer abc456"); };
    h.changed("a");
    await until(() => h.panel.querySelector(".bb-notice-detail").textContent.includes("[redacted]"));
    assert.equal(h.panel.textContent.includes("secret123"), false);
    assert.equal(h.panel.textContent.includes("abc456"), false);
  } finally { await h.close(); }
});
