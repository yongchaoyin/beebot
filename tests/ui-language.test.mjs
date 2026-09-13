import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function load() {
  const source = await readFile(path.join(repoRoot, "source/shared/ui-language.ts"), "utf8");
  const { code } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

test("UI copy follows Settings language, not the operating system", async () => {
  const language = await load();
  assert.equal(language.parseUiLanguage("zh"), "zh");
  assert.equal(language.parseUiLanguage("en"), "en");
  assert.equal(language.parseUiLanguage("fr"), "en");
  assert.equal(language.createBotCopy("zh").title, "新建 Bot");
  assert.equal(language.createBotCopy("zh").nameLabel, "名称");
  assert.equal(language.createBotCopy("zh").create, "开始使用");
  assert.equal(language.createBotCopy("zh").newGroup, "新建群聊");
  assert.equal(language.createBotCopy("zh").vendor, "使用的 API");
  assert.equal(language.createBotCopy("en").title, "New Bot");
  assert.equal(language.createBotCopy("en").create, "Get started");
  assert.equal(language.createBotCopy("en").newGroup, "New group chat");
  assert.equal(language.createBotCopy("en").vendor, "API");
});
