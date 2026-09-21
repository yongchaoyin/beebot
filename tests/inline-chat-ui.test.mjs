import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Window } from "happy-dom";

const createSource = await readFile(new URL("../scripts/lib/sand-create-overlay.snippet.js", import.meta.url), "utf8");
const groupSource = await readFile(new URL("../scripts/lib/sand-group-ui.snippet.js", import.meta.url), "utf8");
const paths = await readFile(new URL("../scripts/lib/persona-shape-paths.json", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await tick(); }
  assert.fail("The expected inline UI state was not reached");
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function boot(t) {
  const window = new Window({ url: "https://beebot.local/" });
  t.after(() => window.happyDOM.close());
  const { document } = window;
  document.body.innerHTML = `<aside class="sand-agents-sidebar"><header><button class="sand-agents-sidebar__new">+</button></header><div class="sand-agents-list"></div></aside><main><header class="sand-chat-header">Current conversation</header><div class="history">Keep this history</div><div class="sand-chat-input-dock"><form class="sand-prompt-form"><textarea aria-label="Message"></textarea></form></div></main>`;
  const roster = [
    { id: "group", name: "Team", isGroup: true, memberIds: ["a", "b"] },
    { id: "a", name: "小林", avatarShape: "blob", avatarColor: "green" },
    { id: "b", name: "阿澈", avatarShape: "hex", avatarColor: "blue" },
  ];
  for (const agent of roster) {
    const row = document.createElement("button"); row.type = "button"; row.dataset.agentId = agent.id;
    row.innerHTML = `<span class="sand-agent-item__avatar"></span><span class="sand-agent-item__body"><span class="sand-agent-item__name"></span></span>`;
    row.querySelector(".sand-agent-item__name").textContent = agent.name;
    document.querySelector(".sand-agents-list").append(row);
  }
  const vendorGate = deferred();
  const calls = [], listeners = new Set();
  window.__sandUiLanguage = "en"; window.__sandGroupUiTest = true; window.__sandVendorPaneBound = true;
  window.__sandRoster = { snapshots: { get: () => ({ agents: { rows: roster } }) } };
  window.desktop = {
    agent: { getUiLanguage: async () => ({ language: window.__sandUiLanguage }), getInferenceVendors: () => vendorGate.promise },
    nodes: { onChanged: fn => { listeners.add(fn); return () => listeners.delete(fn); } },
  };
  window.__beebotServerBots = { listServers: async () => [{ id: "remote", name: "Server", baseUrl: "https://server.example", status: "online" }] };
  window.__sandCreateAgent = async draft => { calls.push({ kind: "bot", draft }); };
  window.__sandCreateGroup = async draft => { calls.push({ kind: "group", draft }); };
  const prefix = createSource.slice(0, createSource.indexOf("function MOn("));
  window.eval(`const R_PATHS=${paths};\n${prefix}\n${groupSource}`);
  const editor = document.querySelector("textarea");
  // Happy DOM has no layout; only the adapter's visibility query is stubbed.
  editor.getClientRects = () => [{ width: 400, height: 100 }];
  const input = (node, value) => { node.value = value; node.dispatchEvent(new window.Event("input", { bubbles: true })); };
  const button = label => [...document.querySelectorAll("button")].find(node => node.textContent === label);
  async function open(kind, onCreate) {
    const result = kind === "group" ? window.__sandPickCreateGroup({ onCreate }) : window.__sandPickCreateBot(undefined, { onCreate });
    await until(() => document.getElementById(`sand-create-${kind}-sheet`));
    return { result, root: document.getElementById(`sand-create-${kind}-sheet`) };
  }
  const select = id => {
    document.querySelectorAll("[data-agent-id]").forEach(row => row.setAttribute("aria-current", String(row.dataset.agentId === id)));
    window.eval("RRefreshGroups()");
  };
  select("group");
  return { window, document, roster, calls, listeners, vendorGate, editor, input, button, open, select };
}

function assertInline(document, node) {
  assert.ok(node.closest(".sand-agents-sidebar"), "the section belongs to the sidebar, not a body overlay");
  assert.equal(document.querySelector('[role="dialog"],[aria-modal="true"]'), null);
  assert.ok(!["fixed", "absolute"].includes(node.style.position));
}

test("plus choices expand in the sidebar without replacing the current chat or draft", async t => {
  const ui = await boot(t), history = ui.document.querySelector(".history");
  ui.input(ui.editor, "Keep the draft");
  const plus = ui.document.querySelector(".sand-agents-sidebar__new"); plus.click();
  assertInline(ui.document, ui.document.getElementById("sand-plus-menu"));
  assert.equal(plus.getAttribute("aria-expanded"), "true");
  assert.equal(ui.document.querySelector(".history"), history); assert.equal(ui.editor.value, "Keep the draft");
  plus.click(); assert.equal(ui.document.getElementById("sand-plus-menu"), null);
  assert.equal(plus.getAttribute("aria-expanded"), "false");
});

test("Bot and Group creation use the same in-flow surface and settle replaced pickers", async t => {
  const ui = await boot(t), first = await ui.open("group"); assertInline(ui.document, first.root);
  const second = await ui.open("bot"); assert.equal(await first.result, null);
  assert.equal(first.root.isConnected, false); assertInline(ui.document, second.root);
  second.root.__sandDismiss(); assert.equal(await second.result, null);
});

test("a late language lookup cannot reopen an older creation request", async t => {
  const ui = await boot(t), gate = deferred(); let count = 0;
  ui.window.desktop.agent.getUiLanguage = () => ++count === 1 ? gate.promise : Promise.resolve({ language: "en" });
  const older = ui.window.__sandPickCreateGroup();
  const current = await ui.open("bot"); gate.resolve({ language: "en" });
  assert.equal(await older, null); assertInline(ui.document, current.root);
  assert.equal(ui.document.getElementById("sand-create-group-sheet"), null);
});

test("searching and selecting group colleagues do not rebuild name or search inputs", async t => {
  const ui = await boot(t), { root } = await ui.open("group");
  const name = root.querySelector("#bb-group-name"), search = root.querySelector("#bb-group-search");
  ui.input(name, "Launch"); search.focus(); ui.input(search, "阿");
  assert.equal(root.querySelector("#bb-group-search"), search); assert.equal(ui.document.activeElement, search);
  assert.equal(root.querySelector('[data-member-id="a"]').hidden, true);
  root.querySelector('[data-member-id="b"]').click(); assert.equal(root.querySelector("#bb-group-name"), name);
  assert.equal(name.value, "Launch"); assert.equal(root.querySelector(".bb-create-submit").disabled, false);
});

test("group creation failure stays inline and preserves its draft and selection", async t => {
  const ui = await boot(t), gate = deferred(); let attempts = 0;
  const { root } = await ui.open("group", async () => { attempts++; await gate.promise; throw new Error("Please retry"); });
  ui.input(root.querySelector("#bb-group-name"), "Launch"); root.querySelector('[data-member-id="a"]').click();
  const submit = root.querySelector(".bb-create-submit"); submit.click(); submit.click();
  assert.equal(attempts, 1); assert.equal(submit.disabled, true); assert.equal(root.__sandDismiss(), false);
  const refused = await ui.window.__sandPickCreateBot(); assert.equal(refused, null);
  gate.resolve(); await until(() => root.querySelector("[role=status]").textContent.includes("retry"));
  assert.equal(root.querySelector("#bb-group-name").value, "Launch");
  assert.equal(root.querySelector('[data-member-id="a"]').getAttribute("aria-pressed"), "true");
  assertInline(ui.document, root); assert.equal(submit.disabled, false);
});

test("group selection is revalidated before submission instead of silently dropping a deleted Bot", async t => {
  const ui = await boot(t); let calls = 0;
  const { root } = await ui.open("group", async () => { calls++; });
  ui.input(root.querySelector("#bb-group-name"), "Launch"); root.querySelector('[data-member-id="a"]').click();
  ui.document.querySelector('[data-agent-id="a"]').remove(); root.querySelector(".bb-create-submit").click();
  assert.equal(calls, 0); assert.match(root.querySelector("[role=status]").textContent, /no longer available/);
});

test("local Bot creation from the + entry executes once and reports failures in place", async t => {
  const ui = await boot(t); let attempts = 0;
  ui.window.__sandCreateAgent = async () => { attempts++; throw new Error("Local creation failed"); };
  ui.document.querySelector(".sand-agents-sidebar__new").click(); ui.button("New Bot").click();
  await until(() => ui.document.getElementById("sand-create-bot-sheet"));
  const root = ui.document.getElementById("sand-create-bot-sheet");
  ui.input(root.querySelector('[aria-label="Name"]'), "Colleague");
  root.querySelector(".bb-create-submit").click(); root.querySelector(".bb-create-submit").click();
  await until(() => root.querySelector("[role=status]").textContent.includes("failed"));
  assert.equal(attempts, 1); assert.equal(root.querySelector('[aria-label="Name"]').value, "Colleague"); assertInline(ui.document, root);
});

test("Bot name IME confirmation does not submit the form", async t => {
  const ui = await boot(t); let calls = 0;
  const { root } = await ui.open("bot", async () => { calls++; });
  const name = root.querySelector('[aria-label="Name"]'); ui.input(name, "中文同事");
  name.dispatchEvent(new ui.window.CompositionEvent("compositionstart", { bubbles: true }));
  name.dispatchEvent(new ui.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(calls, 0);
  name.dispatchEvent(new ui.window.CompositionEvent("compositionend", { bubbles: true }));
  name.dispatchEvent(new ui.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await until(() => calls === 1); assert.equal(calls, 1);
});

test("late vendor metadata does not recreate the Bot name editor or interrupt its composition", async t => {
  const ui = await boot(t), { root } = await ui.open("bot");
  const name = root.querySelector('[aria-label="Name"]'); ui.input(name, "正在选词"); name.focus();
  name.dispatchEvent(new ui.window.CompositionEvent("compositionstart", { bubbles: true }));
  ui.vendorGate.resolve({ vendors: [{ id: "v", label: "Model" }], defaultVendorId: "v" });
  await until(() => root.querySelector('[aria-label="API"]').value === "v");
  assert.equal(root.querySelector('[aria-label="Name"]'), name); assert.equal(ui.document.activeElement, name);
  assert.equal(name.value, "正在选词");
});

test("switching UI language preserves Bot field values and focused field identity", async t => {
  const ui = await boot(t), { root } = await ui.open("bot");
  const name = root.querySelector('[aria-label="Name"]'); ui.input(name, "Colleague"); name.focus(); name.setSelectionRange(2, 4);
  ui.window.__sandUiLanguage = "zh"; ui.window.dispatchEvent(new ui.window.Event("sand-ui-language-changed"));
  const translated = root.querySelector('[aria-label="名称"]');
  assert.equal(ui.document.activeElement, translated); assert.equal(translated.value, "Colleague");
  assert.equal(translated.selectionStart, 2); assert.equal(translated.selectionEnd, 4);
});

test("cancelling a create section never steals focus from ongoing chat input", async t => {
  const ui = await boot(t), { root, result } = await ui.open("group");
  ui.editor.focus(); ui.input(ui.editor, "Still talking"); root.__sandDismiss();
  assert.equal(await result, null); assert.equal(ui.document.activeElement, ui.editor); assert.equal(ui.editor.value, "Still talking");
});

test("successful creation leaves focus chosen by the conversation callback intact", async t => {
  const ui = await boot(t);
  const { root } = await ui.open("group", async () => { ui.editor.focus(); });
  ui.input(root.querySelector("#bb-group-name"), "Launch"); root.querySelector('[data-member-id="a"]').click();
  root.querySelector(".bb-create-submit").click(); await until(() => !root.isConnected);
  assert.equal(ui.document.activeElement, ui.editor);
});

test("group members expand inline, and refresh preserves expansion and keyboard focus", async t => {
  const ui = await boot(t), bar = ui.document.getElementById("sand-beebot-group-bar");
  assert.equal(bar.querySelector("details").open, false);
  bar.querySelector("details").open = true;
  const direct = bar.querySelector('.sand-group-direct[data-member-id="b"]'); direct.focus();
  ui.roster.find(item => item.id === "b").name = "阿澈 renamed"; ui.window.eval("RRefreshGroups()");
  assert.equal(bar.querySelector("details").open, true);
  assert.equal(ui.document.activeElement.dataset.memberId, "b");
  assert.equal(ui.document.activeElement.classList.contains("sand-group-direct"), true);
  assert.equal(ui.document.querySelector('[role="dialog"]'), null);
});

test("group @ choices live inside the composer and selecting one does not submit", async t => {
  const ui = await boot(t); let sent = 0;
  ui.document.querySelector("form").onsubmit = event => { event.preventDefault(); sent++; };
  ui.editor.focus(); ui.editor.value = "@阿"; ui.editor.setSelectionRange(2, 2);
  ui.editor.dispatchEvent(new ui.window.Event("input", { bubbles: true }));
  const choices = ui.document.getElementById("sand-beebot-mention");
  assert.ok(choices.closest(".sand-chat-input-dock")); assert.equal(choices.getAttribute("role"), "listbox");
  ui.editor.dispatchEvent(new ui.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(ui.editor.value, "@阿澈 "); assert.equal(sent, 0);
  assert.equal(ui.document.getElementById("sand-beebot-mention"), null); assert.equal(ui.editor.getAttribute("aria-expanded"), null);
});

test("switching from a group to a single Bot clears group-only controls and restores editor ARIA", async t => {
  const ui = await boot(t);
  ui.editor.setAttribute("aria-controls", "original-controls"); ui.editor.focus(); ui.editor.value = "@"; ui.editor.setSelectionRange(1, 1);
  ui.editor.dispatchEvent(new ui.window.Event("input", { bubbles: true }));
  assert.ok(ui.document.getElementById("sand-beebot-mention"));
  ui.select("a"); assert.equal(ui.document.getElementById("sand-beebot-group-bar"), null);
  assert.equal(ui.document.getElementById("sand-beebot-mention"), null);
  assert.equal(ui.editor.getAttribute("aria-controls"), "original-controls"); assert.equal(ui.editor.value, "@");
});

test("inline controls never introduce modal positioning or browser confirmation APIs", () => {
  const creation = createSource.slice(createSource.indexOf("let RCreateRequestSerial"), createSource.indexOf("if(!window.__sandVendorPaneBound)"));
  assert.doesNotMatch(creation, /position:\s*fixed|aria-modal|showModal\(|window\.(?:alert|confirm|prompt)\(/);
  assert.doesNotMatch(groupSource, /position:\s*fixed|aria-modal|showModal\(/);
});
