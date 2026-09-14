import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadCopy() {
  const source = await readFile(path.join(repoRoot, "frontend/src/recovered/features/account/session/account-menu-copy.ts"), "utf8");
  const { code } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

async function loadShared() {
  const source = await readFile(path.join(repoRoot, "source/shared/ui-language.ts"), "utf8");
  const { code } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

test("recovered account menu copy matches shared BeeBot copy", async () => {
  const copy = await loadCopy();
  const shared = await loadShared();
  assert.deepEqual(copy.accountMenuCopy("en"), shared.accountMenuCopy("en"));
  assert.deepEqual(copy.accountMenuCopy("zh"), shared.accountMenuCopy("zh"));
  assert.deepEqual(copy.accountMenuActions(), ["settings", "configureAi", "about", "documentation", "feedback"]);
});

test("recovered AccountMenu source has no official rows", async () => {
  const source = await readFile(path.join(repoRoot, "frontend/src/recovered/features/account/session/menu.tsx"), "utf8");
  assert.match(source, /onOpenConfigureAi/);
  assert.match(source, /accountMenuActions/);
  assert.doesNotMatch(source, /Get Grok Bot for iOS/);
  assert.doesNotMatch(source, /onOpenIos/);
  assert.doesNotMatch(source, /onRequestLogout/);
  assert.doesNotMatch(source, /Help Center/);
});
