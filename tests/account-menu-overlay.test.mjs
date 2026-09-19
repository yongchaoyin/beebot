import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { patchOriginalSettingsPanel } from "../scripts/lib/router-renderer-patch.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snippetPath = path.join(repoRoot, "scripts/lib/sand-account-menu.snippet.js");

const EN_LABELS = ["Settings", "Configure AI", "About", "Documentation", "Feedback"];
const ZH_LABELS = ["设置", "配置 AI", "关于", "文档", "反馈"];
const DOCS_EN = "https://github.com/yongchaoyin/beebot/blob/main/README.md";
const DOCS_ZH = "https://github.com/yongchaoyin/beebot/blob/main/README.zh.md";
const FEEDBACK = "https://github.com/yongchaoyin/beebot/issues/new";
const OFFICIAL_LABELS = ["Get Grok Bot for iOS", "Help Center", "Log out", "Send Feedback"];

async function boot(language = "en", options = {}) {
  const source = await readFile(snippetPath, "utf8");
  const window = new Window({ url: "https://beebot.local/" });
  const { document } = window;
  const opened = [];
  const settingsEvents = [];
  const languageCalls = [];
  let aboutCount = 0;

  window.desktop = {
    openExternal: async (url) => {
      opened.push(url);
    },
    agent: {
      getUiLanguage: async () => {
        languageCalls.push(language);
        return { language };
      },
    },
  };
  if (options.seedLanguage !== false) {
    window.__sandUiLanguage = language;
  }

  window.addEventListener("sand-open-settings", (event) => {
    settingsEvents.push(event.detail);
  });
  window.addEventListener("sand-open-about", () => {
    aboutCount += 1;
  });

  const account = document.createElement("div");
  account.className = "sand-agents-sidebar__account";
  account.innerHTML = `<button aria-haspopup="menu" aria-label="Account">Local</button><button class="sand-agents-sidebar__account-name" type="button">Enter your name</button>`;
  document.body.append(account);

  window.eval(source);

  return {
    window,
    document,
    opened,
    settingsEvents,
    languageCalls,
    get aboutCount() {
      return aboutCount;
    },
    accountButton: account.querySelector("[aria-haspopup='menu']"),
    nameButton: account.querySelector(".sand-agents-sidebar__account-name"),
  };
}

async function closeWindow(window) {
  await window.happyDOM.close();
}

async function openAccountMenu(accountButton, document) {
  accountButton.click();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (document.getElementById("sand-account-menu")) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail("expected #sand-account-menu");
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

test("account button shows BeeBot rows and hides official Grok rows", async () => {
  const { window, document, accountButton } = await boot("en");
  try {
    await openAccountMenu(accountButton, document);
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
    await openAccountMenu(accountButton, document);
    clickMenuRow(document, "Configure AI");
    assert.equal(settingsEvents.at(-1)?.section, "router");
  } finally {
    await closeWindow(window);
  }
});

test("Settings opens settings section general", async () => {
  const { window, document, accountButton, settingsEvents } = await boot("en");
  try {
    await openAccountMenu(accountButton, document);
    clickMenuRow(document, "Settings");
    assert.equal(settingsEvents.at(-1)?.section, "general");
  } finally {
    await closeWindow(window);
  }
});

test("Settings dispatches Cmd/Ctrl+comma keydown on document", async () => {
  const { window, document, accountButton } = await boot("en");
  try {
    const keys = [];
    document.addEventListener("keydown", (event) => {
      keys.push({ key: event.key, code: event.code, metaKey: event.metaKey, ctrlKey: event.ctrlKey });
    });
    await openAccountMenu(accountButton, document);
    clickMenuRow(document, "Settings");
    const comma = keys.find((event) => event.key === "," || event.code === "Comma");
    assert.ok(comma, "expected comma keydown on document");
    assert.equal(comma.metaKey || comma.ctrlKey, true);
  } finally {
    await closeWindow(window);
  }
});

test("About dispatches sand-open-about and calls __sandOpenAboutOverlay", async () => {
  const ctx = await boot("en");
  try {
    let overlayCount = 0;
    ctx.window.__sandOpenAboutOverlay = () => {
      overlayCount += 1;
    };
    await openAccountMenu(ctx.accountButton, ctx.document);
    clickMenuRow(ctx.document, "About");
    assert.equal(ctx.aboutCount, 1);
    assert.ok(overlayCount >= 1, "expected __sandOpenAboutOverlay to run");
  } finally {
    await closeWindow(ctx.window);
  }
});

test("Documentation and Feedback open BeeBot GitHub URLs", async () => {
  const { window, document, accountButton, opened } = await boot("en");
  try {
    await openAccountMenu(accountButton, document);
    clickMenuRow(document, "Documentation");
    await openAccountMenu(accountButton, document);
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
    await openAccountMenu(accountButton, document);
    assert.deepEqual(menuLabels(document), ZH_LABELS);
  } finally {
    await closeWindow(window);
  }
});

test("opening the menu consults getUiLanguage", async () => {
  const { window, document, accountButton, languageCalls } = await boot("zh", { seedLanguage: false });
  try {
    assert.equal(window.__sandUiLanguage, undefined);
    await openAccountMenu(accountButton, document);
    assert.deepEqual(languageCalls, ["zh"]);
    assert.equal(window.__sandUiLanguage, "zh");
    assert.deepEqual(menuLabels(document), ZH_LABELS);
  } finally {
    await closeWindow(window);
  }
});

test("Chinese language opens ZH documentation URL", async () => {
  const { window, document, accountButton, opened } = await boot("zh", { seedLanguage: false });
  try {
    await openAccountMenu(accountButton, document);
    clickMenuRow(document, "文档");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(opened, [DOCS_ZH]);
  } finally {
    await closeWindow(window);
  }
});

test("name editor button does not open the account menu", async () => {
  const { window, document, nameButton } = await boot("en");
  try {
    nameButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(document.getElementById("sand-account-menu"), null);
  } finally {
    await closeWindow(window);
  }
});

test("landing snippet retries settings nav by includes, not exact textContent", async () => {
  const { window, document, accountButton } = await boot("en");
  try {
    let clicked = 0;
    const nav = document.createElement("nav");
    nav.setAttribute("aria-label", "Settings sections");
    const router = document.createElement("button");
    router.className = "sand-settings-nav__item";
    router.textContent = "\u{e123}Router";
    router.addEventListener("click", () => {
      clicked += 1;
    });
    nav.append(router);
    document.body.append(nav);

    await openAccountMenu(accountButton, document);
    clickMenuRow(document, "Configure AI");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(clicked, 1);
  } finally {
    await closeWindow(window);
  }
});

test("both shipped Settings event listeners select Servers without falling back to General", async () => {
  const panel = patchOriginalSettingsPanel(await readFile(path.join(repoRoot, "src/app/dist/renderer/assets/index-BlqerJhg.js"), "utf8"));
  const start = panel.indexOf("if(!window.__sandOpenSettingsBound)");
  const listener = panel.slice(start, panel.indexOf("const RRouterProviders=", start));
  for (const language of ["en", "zh"]) {
    const { window, document } = await boot(language);
    try {
      const clicks = [];
      const nav = document.createElement("nav");
      nav.setAttribute("aria-label", "Settings sections");
      for (const [id, label] of [["general", language === "zh" ? "通用" : "General"], ["servers", language === "zh" ? "服务器" : "Servers"], ["router", language === "zh" ? "路由" : "Router"]]) {
        const button = document.createElement("button");
        button.textContent = `\u{e123}${label}`;
        button.onclick = () => clicks.push(id);
        nav.append(button);
      }
      document.body.append(nav);
      window.eval(listener);
      window.dispatchEvent(new window.CustomEvent("sand-open-settings", { detail: { section: "servers" } }));
      assert.deepEqual(clicks, ["servers", "servers"]);
    } finally {
      await closeWindow(window);
    }
  }
});
