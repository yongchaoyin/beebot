import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snippetPath = path.join(repoRoot, "scripts/lib/sand-account-menu.snippet.js");

const EN_LABELS = ["Settings", "Configure AI", "About", "Documentation", "Feedback"];
const ZH_LABELS = ["设置", "配置 AI", "关于", "文档", "反馈"];
const DOCS_EN = "https://github.com/yongchaoyin/botfly/blob/main/README.md";
const FEEDBACK = "https://github.com/yongchaoyin/botfly/issues/new";
const OFFICIAL_LABELS = ["Get Grok Bot for iOS", "Help Center", "Log out", "Send Feedback"];

async function boot(language = "en") {
  const source = await readFile(snippetPath, "utf8");
  const window = new Window({ url: "https://botfly.local/" });
  const { document } = window;
  const opened = [];
  const settingsEvents = [];
  let aboutCount = 0;

  window.desktop = {
    openExternal: async (url) => {
      opened.push(url);
    },
    agent: { getUiLanguage: async () => ({ language }) },
  };
  window.__sandUiLanguage = language;

  window.addEventListener("sand-open-settings", (event) => {
    settingsEvents.push(event.detail);
  });
  window.addEventListener("sand-open-about", () => {
    aboutCount += 1;
  });

  const account = document.createElement("div");
  account.className = "sand-agents-sidebar__account";
  account.innerHTML = `<button aria-haspopup="menu" aria-label="Account">Local</button>`;
  document.body.append(account);

  window.eval(source);

  return {
    window,
    document,
    opened,
    settingsEvents,
    get aboutCount() {
      return aboutCount;
    },
    accountButton: account.querySelector("button"),
  };
}

async function closeWindow(window) {
  await window.happyDOM.close();
}

function menuLabels(document) {
  const menu = document.getElementById("sand-account-menu");
  assert.ok(menu, "expected #sand-account-menu");
  return [...menu.querySelectorAll("button")].map((button) => button.textContent);
}

function clickMenuRow(document, label) {
  const button = [...document.querySelectorAll("#sand-account-menu button")].find(
    (node) => node.textContent === label,
  );
  assert.ok(button, `missing menu row ${label}`);
  button.click();
}

test("account button shows Botfly rows and hides official Grok rows", async () => {
  const { window, document, accountButton } = await boot("en");
  try {
    accountButton.click();
    const labels = menuLabels(document);
    assert.deepEqual(labels, EN_LABELS);
    for (const label of OFFICIAL_LABELS) {
      assert.equal(labels.includes(label), false, `should not include ${label}`);
    }
  } finally {
    await closeWindow(window);
  }
});

test("Configure AI opens settings section router", async () => {
  const { window, document, accountButton, settingsEvents } = await boot("en");
  try {
    accountButton.click();
    clickMenuRow(document, "Configure AI");
    assert.equal(settingsEvents.at(-1)?.section, "router");
  } finally {
    await closeWindow(window);
  }
});

test("Settings opens settings section general", async () => {
  const { window, document, accountButton, settingsEvents } = await boot("en");
  try {
    accountButton.click();
    clickMenuRow(document, "Settings");
    assert.equal(settingsEvents.at(-1)?.section, "general");
  } finally {
    await closeWindow(window);
  }
});

test("About dispatches sand-open-about", async () => {
  const ctx = await boot("en");
  try {
    ctx.accountButton.click();
    clickMenuRow(ctx.document, "About");
    assert.equal(ctx.aboutCount, 1);
  } finally {
    await closeWindow(ctx.window);
  }
});

test("Documentation and Feedback open Botfly GitHub URLs", async () => {
  const { window, document, accountButton, opened } = await boot("en");
  try {
    accountButton.click();
    clickMenuRow(document, "Documentation");
    accountButton.click();
    clickMenuRow(document, "Feedback");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(opened, [DOCS_EN, FEEDBACK]);
  } finally {
    await closeWindow(window);
  }
});

test("Chinese Settings language uses zh account menu labels", async () => {
  const { window, document, accountButton } = await boot("zh");
  try {
    accountButton.click();
    assert.deepEqual(menuLabels(document), ZH_LABELS);
  } finally {
    await closeWindow(window);
  }
});
