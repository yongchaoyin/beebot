import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const overlayPath = path.join(repoRoot, "scripts/lib/sand-create-overlay.snippet.js");

const AGENTS = [
  { id: "bot-test", name: "测试" },
  { id: "bot-ceshi", name: "ceshi" },
  { id: "bot-new", name: "New Bot" },
];

async function waitFor(document, selector, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const node = document.querySelector(selector);
    if (node) return node;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${selector}`);
}

function createButton(document) {
  return [...document.querySelectorAll("button")].find((button) => button.textContent === "Create");
}

function visibleAgentButtons(document) {
  return [...document.querySelectorAll("#sand-create-group-sheet button")].filter((button) => {
    const label = button.textContent ?? "";
    return label !== "×" && label !== "Create" && !label.endsWith(" ×");
  });
}

async function openGroupSheet() {
  const source = await readFile(overlayPath, "utf8");
  const window = new Window({ url: "https://beebot.local/" });
  const { document } = window;
  window.desktop = {
    agent: {
      getUiLanguage: async () => ({ language: "en" }),
    },
  };
  for (const agent of AGENTS) {
    const row = document.createElement("div");
    row.setAttribute("data-agent-id", agent.id);
    const name = document.createElement("span");
    name.className = "agent-name";
    name.textContent = agent.name;
    row.append(name);
    document.body.append(row);
  }
  const overlaySource = source.slice(0, source.indexOf("function MOn("));
  assert.ok(overlaySource.includes("__sandPickCreateGroup"));
  window.eval(overlaySource);
  const resultPromise = window.__sandPickCreateGroup();
  await waitFor(document, "#sand-create-group-sheet");
  return { window, document, resultPromise };
}

async function closeWindow(window) {
  await window.happyDOM.close();
}

test("Create stays disabled until both a group name and members exist", async () => {
  const { window, document } = await openGroupSheet();
  try {
    assert.equal(createButton(document)?.disabled, true);
    const nameInput = document.querySelector("input[placeholder='Group name']");
    nameInput.value = "测试12133";
    nameInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal(createButton(document)?.disabled, true);
  } finally {
    await closeWindow(window);
  }
});

test("Create enables after selecting bots and then typing the group name", async () => {
  const { window, document, resultPromise } = await openGroupSheet();
  try {
    for (const agent of AGENTS) {
      const row = visibleAgentButtons(document).find((button) => button.textContent === agent.name);
      assert.ok(row, `missing agent row for ${agent.name}`);
      row.click();
    }
    assert.equal(createButton(document)?.disabled, true, "Create should stay disabled until the group is named");

    const nameInput = document.querySelector("input[placeholder='Group name']");
    nameInput.value = "测试12133";
    nameInput.dispatchEvent(new window.Event("input", { bubbles: true }));

    const submit = createButton(document);
    assert.equal(submit?.disabled, false);
    submit.click();
    const created = await resultPromise;
    assert.equal(created.name, "测试12133");
    assert.deepEqual([...created.memberAgentIds], AGENTS.map((agent) => agent.id));
  } finally {
    await closeWindow(window);
  }
});

test("account menu snippet does not block group create", async () => {
  const overlay = await readFile(overlayPath, "utf8");
  const accountMenu = await readFile(path.join(repoRoot, "scripts/lib/sand-account-menu.snippet.js"), "utf8");
  const window = new Window({ url: "https://beebot.local/" });
  const { document } = window;
  window.desktop = {
    agent: { getUiLanguage: async () => ({ language: "en" }) },
    openExternal: async () => {},
  };
  for (const agent of AGENTS) {
    const row = document.createElement("div");
    row.setAttribute("data-agent-id", agent.id);
    const name = document.createElement("span");
    name.className = "agent-name";
    name.textContent = agent.name;
    row.append(name);
    document.body.append(row);
  }
  const plus = document.createElement("button");
  plus.className = "sand-agents-sidebar__new";
  plus.textContent = "+";
  document.body.append(plus);
  const account = document.createElement("div");
  account.className = "sand-agents-sidebar__account";
  account.innerHTML = `<button aria-haspopup="menu" aria-label="Account">Local</button>`;
  document.body.append(account);
  window.eval(overlay.slice(0, overlay.indexOf("function MOn(")));
  window.eval(accountMenu);
  plus.click();
  assert.ok(document.getElementById("sand-plus-menu"), "plus menu should open");
  assert.equal(document.getElementById("sand-account-menu"), null);
  const resultPromise = window.__sandPickCreateGroup();
  await waitFor(document, "#sand-create-group-sheet");
  try {
    visibleAgentButtons(document)[0].click();
    const nameInput = document.querySelector("input[placeholder='Group name']");
    nameInput.value = "测试12133";
    nameInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    const submit = createButton(document);
    assert.equal(submit?.disabled, false);
    submit.click();
    const created = await resultPromise;
    assert.equal(created.name, "测试12133");
    assert.deepEqual([...created.memberAgentIds], ["bot-test"]);
  } finally {
    await closeWindow(window);
  }
});

test("Create enables after naming the group and then selecting bots", async () => {
  const { window, document, resultPromise } = await openGroupSheet();
  try {
    const nameInput = document.querySelector("input[placeholder='Group name']");
    nameInput.value = "测试12133";
    nameInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal(createButton(document)?.disabled, true);

    for (const agent of AGENTS) {
      const row = visibleAgentButtons(document).find((button) => button.textContent === agent.name);
      assert.ok(row, `missing agent row for ${agent.name}`);
      row.click();
    }

    const submit = createButton(document);
    assert.equal(submit?.disabled, false);
    submit.click();
    const created = await resultPromise;
    assert.equal(created.name, "测试12133");
    assert.deepEqual([...created.memberAgentIds], AGENTS.map((agent) => agent.id));
  } finally {
    await closeWindow(window);
  }
});
