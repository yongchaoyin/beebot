import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function load() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "botfly-application-menu-"));
  const output = path.join(directory, "application-menu.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/electron-main/application-menu.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  await rm(directory, { recursive: true, force: true });
  return module;
}

function helpItems(template) {
  const help = template.find((item) => item.role === "help");
  return help?.submenu ?? [];
}

test("Help menu opens Botfly docs and GitHub issues, not cursor.com", async () => {
  const menu = await load();
  const opened = [];
  const electron = {
    appName: "Botfly",
    openExternal: async (url) => { opened.push(url); },
  };
  const en = helpItems(menu.buildApplicationMenuTemplate({
    applyWindowShortcut() {},
    canUseDevTools: () => false,
    emitOpenAbout() {},
    uiLanguage: "en",
    platform: "darwin",
  }, electron));
  assert.deepEqual(en.map((item) => item.label), ["Documentation", "Feedback"]);
  assert.equal(en.some((item) => item.label === "Help Center"), false);
  assert.equal(en.some((item) => item.label === "Send Feedback"), false);
  await en[0].click();
  await en[1].click();
  assert.deepEqual(opened, [
    "https://github.com/yongchaoyin/botfly/blob/main/README.md",
    "https://github.com/yongchaoyin/botfly/issues/new",
  ]);

  const zh = helpItems(menu.buildApplicationMenuTemplate({
    applyWindowShortcut() {},
    canUseDevTools: () => false,
    emitOpenAbout() {},
    uiLanguage: "zh",
    platform: "darwin",
  }, electron));
  assert.deepEqual(zh.map((item) => item.label), ["文档", "反馈"]);
  opened.length = 0;
  await zh[0].click();
  assert.equal(opened[0], "https://github.com/yongchaoyin/botfly/blob/main/README.zh.md");
});

test("Help language is seeded from settingsStore before the first installMenu", async () => {
  const source = await readFile(path.join(repoRoot, "source/electron-main/main.ts"), "utf8");
  const seedAt = source.indexOf("settingsStore?.getUiLanguage");
  const installAt = source.indexOf("installMenu();");
  assert.ok(seedAt >= 0, "expected settingsStore.getUiLanguage seed");
  assert.ok(installAt > seedAt, "expected ui language seed before first installMenu()");
  assert.match(source, /registerApplicationMenuRebuild/);
});
