import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plain = (value) => JSON.parse(JSON.stringify(value));

async function until(predicate, message = "expected UI state") {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

async function boot(t, { create, open } = {}) {
  const [source, paths] = await Promise.all([
    readFile(path.join(repoRoot, "scripts/lib/sand-create-overlay.snippet.js"), "utf8"),
    readFile(path.join(repoRoot, "scripts/lib/persona-shape-paths.json"), "utf8"),
  ]);
  const window = new Window({ url: "https://beebot.local/" });
  t.after(() => window.happyDOM.close());
  const { document } = window;
  const calls = { local: [], group: [], update: [], remote: [], opened: [], closed: 0 };
  window.__beebotCloseNodeWorkbench = () => { calls.closed++; };
  const listeners = new Set();
  let servers = [
    { id: "server-a", name: "Server A", baseUrl: "http://127.0.0.1:7331", status: "online" },
    { id: "server-b", name: "Server B", baseUrl: "http://127.0.0.1:7332", status: "online" },
  ];
  window.desktop = {
    agent: {
      getUiLanguage: async () => ({ language: "en" }),
      getInferenceVendors: async () => ({
        vendors: [{ id: "vendor-a", label: "Vendor A" }, { id: "vendor-b", label: "Vendor B" }],
        defaultVendorId: "vendor-a",
      }),
    },
    nodes: { onChanged: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } },
  };
  window.__beebotServerBots = {
    listServers: async () => plain(servers),
    create: async (request) => {
      calls.remote.push(plain(request));
      return create ? create(request, calls.remote.length) : { bot: { id: "created-remote", name: request.name } };
    },
    open: async (id, bot) => { calls.opened.push({ id, bot: plain(bot) }); await open?.(id, bot); },
    refresh: async () => {},
  };
  const rosterRows = [
    { id: "local-writer", name: "Local Writer", inferenceVendorId: "vendor-a" },
    { id: "local-reviewer", name: "Local Reviewer" },
    { id: "local-group", name: "Existing group", isGroup: true, memberIds: ["local-writer"] },
  ];
  window.__testRoster = {
    snapshots: { get: () => ({ agents: { rows: rosterRows } }) },
    createAgent: async (request) => { assert.ok(calls.closed > 0, "close the remote pane before local creation");calls.local.push(plain(request)); return { agent: { id: "created-local" } }; },
    createGroup: async (request) => { assert.ok(calls.closed > 0, "close the remote pane before local group creation");calls.group.push(plain(request)); return { id: "created-group" }; },
    updateAgent: async (request) => { calls.update.push(plain(request)); },
    deleteAgents: async () => {},
  };
  const sidebar = document.createElement("div");sidebar.className = "sand-agents-sidebar";
  const plus = document.createElement("button");plus.className = "sand-agents-sidebar__new";plus.textContent = "+";sidebar.append(plus);
  for (const bot of rosterRows) {
    const row = document.createElement("button");row.dataset.agentId = bot.id;
    const name = document.createElement("span");name.className = "sand-agent-item__name";name.textContent = bot.name;row.append(name);sidebar.append(row);
  }
  for (const id of ["server-a", "server-b"]) {
    const row = document.createElement("button");row.dataset.nodeBotId = "shared-remote-id";row.dataset.nodeConnectionId = id;
    row.textContent = `Remote ${id}`;sidebar.append(row);
  }
  document.body.append(sidebar);
  // The snippet replaces only MOn's original prefix. Close that prefix with a
  // test return so this executes its real dispatcher and useCallback bindings.
  window.S = { useCallback: (callback) => callback };
  window.lr = (value) => value;
  window.eval(`const R_PATHS=${paths};\n${source}\nreturn {create:t};}\nwindow.__testCallbacks=MOn({roster:window.__testRoster});`);
  const field = (label) => document.querySelector(`#sand-create-bot-sheet [aria-label="${label}"]`);
  const setField = (label, value, event = "input") => {
    const node = field(label);assert.ok(node, `missing ${label}`);node.value = value;
    node.dispatchEvent(new window.Event(event, { bubbles: true }));
  };
  const submit = () => [...document.querySelectorAll("#sand-create-bot-sheet button")].find((button) => ["Get started", "Creating…"].includes(button.textContent));
  const openMenu = async (label) => {
    plus.click();
    const button = [...document.querySelectorAll("#sand-plus-menu button")].find((item) => item.textContent === label);
    assert.ok(button, `missing plus menu item ${label}`);button.click();
    await until(() => document.querySelector(label === "New Bot" ? "#sand-create-bot-sheet" : "#sand-create-group-sheet"));
    if (label === "New Bot") await until(() => field("Deployment server")?.options.length === 3 && field("API")?.options.length === 2);
  };
  const setStatus = async (id, status) => {
    servers = servers.map((server) => server.id === id ? { ...server, status } : server);
    for (const listener of listeners) listener();
    await until(() => field("Deployment server")?.querySelector(`option[value="${id}"]`)?.textContent.includes("Not connected") === (status !== "online"));
  };
  return { window, document, calls, field, setField, submit, openMenu, setStatus, listeners };
}

test("main + New Bot creates on the chosen server without creating a local agent", async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const ui = await boot(t, { create: async (request) => { await gate; return { bot: { id: "created-remote", name: request.name } }; } });
  await ui.openMenu("New Bot");
  ui.setField("Name", "Remote Writer");
  ui.setField("API", "vendor-b", "change");
  ui.document.querySelector("#sand-create-bot-sheet [aria-label='blue']").click();
  ui.document.querySelector("#sand-create-bot-sheet [title='hex']").click();
  ui.setField("Deployment server", "server-b", "change");
  assert.equal(ui.field("Name").value, "Remote Writer");
  assert.equal(ui.field("API"), null, "a server Bot must not use a local vendor selection");
  ui.setField("Responsibilities", "Write release notes");
  ui.submit().click();ui.submit().click();
  await until(() => ui.calls.remote.length === 1);
  assert.equal(ui.submit().disabled, true);
  assert.equal(ui.field("Deployment server").disabled, true);
  assert.deepEqual(ui.calls.remote.map(({ key, ...request }) => request), [{
    connectionId: "server-b", name: "Remote Writer", description: "Write release notes", avatarColor: "blue", avatarShape: "hex",
  }]);
  assert.match(ui.calls.remote[0].key, /^[\da-f-]{36}$/i);
  assert.deepEqual(ui.calls.local, []);assert.deepEqual(ui.calls.group, []);assert.deepEqual(ui.calls.update, []);
  release();
  await until(() => !ui.document.getElementById("sand-create-bot-sheet"));
  assert.deepEqual(ui.calls.opened, [{ id: "server-b", bot: { id: "created-remote", name: "Remote Writer" } }]);
  assert.equal(ui.calls.remote.length, 1);assert.equal(ui.calls.local.length, 0);
  assert.equal(ui.calls.closed, 0, "remote creation keeps its focused server pane");
  assert.equal(ui.listeners.size, 0, "closing the sheet removes the connection subscription");
});

test("chosen deployment survives disconnection and reconnects without changing its destination", async (t) => {
  const ui = await boot(t);
  await ui.openMenu("New Bot");
  ui.setField("Deployment server", "server-b", "change");ui.setField("Name", "Stays on B");
  await ui.setStatus("server-b", "reconnecting");
  assert.equal(ui.field("Deployment server").value, "server-b");assert.equal(ui.submit().disabled, true);
  ui.submit().click();assert.equal(ui.calls.remote.length, 0);assert.equal(ui.calls.local.length, 0);
  await ui.setStatus("server-b", "online");
  assert.equal(ui.field("Deployment server").value, "server-b");assert.equal(ui.submit().disabled, false);
  ui.submit().click();await until(() => ui.calls.opened.length === 1);
  assert.equal(ui.calls.remote[0].connectionId, "server-b");assert.equal(ui.calls.local.length, 0);
});

test("remote failure retains the form and reuses the idempotency key on an unchanged retry", async (t) => {
  const ui = await boot(t, { create: (request, attempt) => {
    if (attempt === 1) throw new Error("The acknowledgement was lost");
    return { bot: { id: "created-on-first-attempt", name: request.name } };
  } });
  await ui.openMenu("New Bot");ui.setField("Deployment server", "server-b", "change");ui.setField("Name", "Only once");
  ui.setField("Responsibilities", "Keep this draft");ui.submit().click();
  await until(() => ui.document.querySelector("#sand-create-bot-sheet [role=status]")?.textContent.includes("acknowledgement"));
  assert.equal(ui.field("Name").value, "Only once");assert.equal(ui.field("Responsibilities").value, "Keep this draft");
  assert.equal(ui.field("Deployment server").value, "server-b");assert.equal(ui.submit().disabled, false);
  ui.submit().click();await until(() => ui.calls.opened.length === 1);
  assert.equal(ui.calls.remote.length, 2);assert.equal(ui.calls.remote[0].key, ui.calls.remote[1].key);
  assert.deepEqual(ui.calls.remote[0], ui.calls.remote[1]);assert.equal(ui.calls.local.length, 0);
});

test("an unavailable remote bridge reports failure instead of falling back to local creation", async (t) => {
  const ui = await boot(t);
  await ui.openMenu("New Bot");ui.setField("Deployment server", "server-b", "change");ui.setField("Name", "Remote only");
  delete ui.window.__beebotServerBots;ui.submit().click();
  await until(() => ui.document.querySelector("#sand-create-bot-sheet [role=status]")?.textContent.includes("unavailable"));
  assert.equal(ui.field("Name").value, "Remote only");assert.equal(ui.calls.local.length, 0);assert.equal(ui.calls.remote.length, 0);
});

test("main + local New Bot preserves the avatar, vendor and original roster behavior", async (t) => {
  const ui = await boot(t);
  await ui.openMenu("New Bot");ui.setField("Name", "Local editor");ui.setField("API", "vendor-b", "change");
  ui.document.querySelector("#sand-create-bot-sheet [aria-label='red']").click();
  ui.document.querySelector("#sand-create-bot-sheet [title='cloud']").click();
  ui.setField("Deployment server", "server-b", "change");ui.setField("Responsibilities", "Server-only draft");
  ui.setField("Deployment server", "", "change");
  assert.equal(ui.field("API").value, "vendor-b");assert.equal(ui.field("Responsibilities"), null);
  ui.submit().click();await until(() => ui.calls.local.length === 1);
  assert.deepEqual(ui.calls.local, [{ name: "Local editor", avatarColor: "red", avatarShape: "cloud", inferenceVendorId: "vendor-b", isKickstartRequested: true, origin: "user" }]);
  assert.equal(ui.window.__sandAgentVendors["created-local"], "vendor-b");
  assert.equal(ui.calls.remote.length, 0);assert.equal(ui.calls.opened.length, 0);
  assert.equal(ui.calls.closed, 1);
});

test("the original create callback routes explicit server requests before its avatar shortcut", async (t) => {
  const ui = await boot(t);
  const result = await ui.window.__testCallbacks.create({ name: "Callback Bot", deploymentServerId: "server-b", avatarShape: "hex", avatarColor: "green", inferenceVendorId: "local-only", isKickstartRequested: true, key: "stable-command-key" });
  assert.equal(result, undefined, "remote results must not enter native local-agent selection");
  assert.deepEqual(ui.calls.remote, [{ connectionId: "server-b", name: "Callback Bot", description: "", avatarShape: "hex", avatarColor: "green", key: "stable-command-key" }]);
  assert.equal(ui.calls.local.length, 0);assert.equal(ui.calls.opened[0].id, "server-b");
  await ui.window.__sandCreateAgent({ name: "Local direct", deploymentServerId: "", connectionId: "unused", key: "unused", avatarShape: "blob", inferenceVendorId: "vendor-b" }, { origin: "import" });
  assert.deepEqual(ui.calls.local, [{ name: "Local direct", avatarShape: "blob", inferenceVendorId: "vendor-b", origin: "import" }]);
});

test("the original callback can change a server preset back to local without leaking its routing fields", async (t) => {
  const ui = await boot(t);
  const pending = ui.window.__testCallbacks.create({ name: "Now local", deploymentServerId: "server-b", description: "Existing description" });
  await until(() => ui.field("Deployment server")?.options.length === 3);
  ui.setField("Deployment server", "", "change");ui.submit().click();
  assert.deepEqual(plain(await pending), { agent: { id: "created-local" } });
  assert.equal(ui.calls.remote.length, 0);assert.equal(ui.calls.local.length, 1);
  assert.equal(ui.calls.local[0].name, "Now local");assert.equal(ui.calls.local[0].description, "Existing description");
  assert.equal(Object.hasOwn(ui.calls.local[0], "deploymentServerId"), false);
});

test("main + New group chat includes only local Bots and preserves local group creation", async (t) => {
  const ui = await boot(t);await ui.openMenu("New group chat");
  const sheet = ui.document.getElementById("sand-create-group-sheet");
  assert.doesNotMatch(sheet.textContent, /Remote server|Existing group/);
  for (const name of ["Local Writer", "Local Reviewer"]) {
    const row = [...sheet.querySelectorAll("button")].find((button) => button.textContent === name);assert.ok(row);row.click();
  }
  const name = sheet.querySelector("input[placeholder='Group name']");name.value = "Local collaboration";name.dispatchEvent(new ui.window.Event("input", { bubbles: true }));
  const submit = [...sheet.querySelectorAll("button")].find((button) => button.textContent === "Create");assert.equal(submit.disabled, false);submit.click();
  await until(() => ui.calls.group.length === 1);
  assert.deepEqual(ui.calls.group, [{ name: "Local collaboration", memberAgentIds: ["local-writer", "local-reviewer"] }]);
  assert.equal(ui.calls.remote.length, 0);assert.equal(ui.calls.local.length, 0);assert.equal(ui.calls.update.length, 0);
  assert.equal(ui.calls.closed, 1);
});
