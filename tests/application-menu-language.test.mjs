import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

const directory = await mkdtemp(path.join(tmpdir(), "beebot-menu-language-"));
const output = path.join(directory, "menu.cjs");
await build({ bundle: true, platform: "node", format: "cjs", target: "node26", outfile: output,
  stdin: { resolveDir: path.resolve(import.meta.dirname, ".."), contents: [
    "electron-main/application-menu", "electron-main/main-edge", "shared/node/settings/sand-settings-store",
  ].map(name => `export * from './source/${name}.ts';`).join("\n") } });
const menu = createRequire(import.meta.url)(output);
test.after(() => rm(directory, { recursive: true, force: true }));

const flatten = items => items.flatMap(item => [item, ...flatten(item.submenu ?? [])]);
function fixture(uiLanguage = "zh", platform = "darwin", devtools = false) {
  const shortcuts = [], external = [], installed = [];
  let about = 0;
  const options = { uiLanguage, platform, canUseDevTools: () => devtools,
    applyWindowShortcut: command => shortcuts.push(command), emitOpenAbout: () => about++ };
  const electron = { appName: "BeeBot", openExternal: async url => external.push(url),
    buildFromTemplate: template => template, setApplicationMenu: template => installed.push(template) };
  return { options, electron, shortcuts, external, installed, about: () => about,
    template: menu.buildApplicationMenuTemplate(options, electron) };
}

test("Chinese native menus explicitly label every app-owned item while retaining macOS roles", () => {
  const x = fixture(), all = flatten(x.template).filter(item => item.type !== "separator");
  assert.deepEqual(x.template.map(item => item.label), ["BeeBot", "文件", "编辑", "视图", "窗口", "帮助"]);
  assert.ok(all.every(item => typeof item.label === "string" && item.label.length), "no role label may fall back to the system language");
  assert.ok(all.filter(item => item.label !== "BeeBot").every(item => /\p{Script=Han}/u.test(item.label)));
  const roles = all.filter(item => item.role).map(item => item.role);
  for (const role of ["services", "hide", "hideOthers", "unhide", "quit", "close", "editMenu", "undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "delete", "selectAll", "showSubstitutions", "toggleSmartQuotes", "toggleSmartDashes", "toggleTextReplacement", "startSpeaking", "stopSpeaking", "togglefullscreen", "windowMenu", "minimize", "zoom", "front", "help"]) {
    assert.ok(roles.includes(role), `preserve native ${role} behavior`);
  }
  for (const item of all.filter(item => item.role)) {
    assert.equal(item.click, undefined, "localization must leave native command dispatch to Electron");
    assert.equal(item.accelerator, undefined, "role-specific platform shortcuts stay owned by Electron");
  }
});

test("English and default native menus remain English with the same editable command structure", () => {
  const en = fixture("en"), zh = fixture("zh"), fallback = fixture(undefined);
  assert.deepEqual(en.template.map(item => item.label), ["BeeBot", "File", "Edit", "View", "Window", "Help"]);
  assert.ok(flatten(en.template).every(item => !/\p{Script=Han}/u.test(item.label ?? "")));
  const commands = template => flatten(template).map(({ role, type, accelerator }) => ({ role, type, accelerator }));
  assert.deepEqual(commands(en.template), commands(zh.template));
  assert.deepEqual(menu.buildApplicationMenuTemplate({ ...fallback.options, uiLanguage: undefined }, fallback.electron).map(item => item.label), en.template.map(item => item.label));
});

test("localized view commands keep shortcuts and the existing developer-tools gate", async () => {
  for (const language of ["zh", "en"]) {
    const hidden = fixture(language), visible = fixture(language, "darwin", true);
    assert.ok(!flatten(hidden.template).some(item => item.accelerator === "Cmd+Alt+I"));
    const reload = flatten(visible.template).find(item => item.accelerator === "CmdOrCtrl+R");
    const devtools = flatten(visible.template).find(item => item.accelerator === "Cmd+Alt+I");
    reload.click(); devtools.click(); visible.template[0].submenu[0].click();
    assert.deepEqual(visible.shortcuts, ["reload", "toggledevtools"]); assert.equal(visible.about(), 1);
    const help = visible.template.find(item => item.role === "help").submenu;
    await help[0].click(); await help[1].click();
    assert.deepEqual(visible.external, [`https://github.com/yongchaoyin/beebot/blob/main/README${language === "zh" ? ".zh" : ""}.md`, "https://github.com/yongchaoyin/beebot/issues/new"]);
  }
});

test("Windows and Linux keep native menu scope, exit labels and fullscreen dispatch", () => {
  for (const platform of ["win32", "linux"]) for (const language of ["zh", "en"]) {
    const x = fixture(language, platform, true), all = flatten(x.template);
    assert.equal(x.template.length, 5); assert.ok(!all.some(item => item.role === "services" || item.role === "front" || item.role === "startSpeaking"));
    assert.equal(x.template[0].submenu[0].label, language === "zh" ? "退出" : platform === "win32" ? "Exit" : "Quit");
    all.find(item => item.accelerator === "F11").click();
    all.find(item => item.accelerator === "Ctrl+Shift+I").click();
    assert.deepEqual(x.shortcuts, ["fullscreen", "toggledevtools"]);
  }
});

test("persisted UI language seeds menus and real main-edge changes rebuild them without changing other settings", async () => {
  const file = path.join(directory, "settings.json"), store = new menu.SandSettingsStore(file);
  store.setUiLanguage("zh");
  const snapshot = JSON.parse(await readFile(file, "utf8")), x = fixture(store.getUiLanguage());
  menu.installApplicationMenu(x.options, x.electron);
  menu.registerApplicationMenuRebuild(language => menu.installApplicationMenu({ ...x.options, uiLanguage: language }, x.electron));
  try {
    const handlers = menu.createMainEdgeHandlers({ settingsStore: store });
    assert.equal(x.installed[0][1].label, "文件");
    for (const language of ["en", "zh", "en", "zh"]) {
      assert.deepEqual(handlers.setUiLanguage({ language }), { language });
      assert.deepEqual(handlers.getUiLanguage({}), { language });
      assert.equal(x.installed.at(-1)[1].label, language === "zh" ? "文件" : "File");
      const persisted = JSON.parse(await readFile(file, "utf8"));
      assert.deepEqual({ ...persisted, uiLanguage: snapshot.uiLanguage }, snapshot, "UI localization must not change model, permission or other persisted settings");
    }
    assert.equal(new menu.SandSettingsStore(file).getUiLanguage(), "zh", "the next process sees the saved language");
    assert.equal(x.installed.length, 5);
  } finally { menu.registerApplicationMenuRebuild(() => {}); }
});

test("failed language persistence cannot rebuild native menus with an unsaved language", () => {
  const x = fixture("zh"); menu.installApplicationMenu(x.options, x.electron);
  menu.registerApplicationMenuRebuild(language => menu.installApplicationMenu({ ...x.options, uiLanguage: language }, x.electron));
  try {
    const handlers = menu.createMainEdgeHandlers({ settingsStore: { setUiLanguage() { throw new Error("fixture: settings write failed"); } } });
    assert.throws(() => handlers.setUiLanguage({ language: "en" }), /settings write failed/);
    assert.equal(x.installed.length, 1); assert.equal(x.installed[0][1].label, "文件");
  } finally { menu.registerApplicationMenuRebuild(() => {}); }
});
