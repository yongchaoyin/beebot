import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createPackage } from "@electron/asar";
import { parse } from "acorn";
import { applyOriginalRendererRouterPatch } from "../scripts/lib/router-renderer-patch.mjs";
import { presenceHtml } from "../scripts/lib/build-presence.mjs";
import { patchPresenceRenderer } from "../scripts/lib/presence-renderer-patch.mjs";
import { verifyPresenceRendererArchive } from "../scripts/lib/presence-package-verification.mjs";

const sourceRoot = path.resolve("src/app/dist/renderer");

test("Presence modifies only explicit file entry anchors and preserves the CSP", async () => {
  const before = await readFile(path.join(sourceRoot, "index.html"), "utf8");
  const after = presenceHtml(before);
  assert.match(after, /<html data-beebot-theme="presence"/);
  assert.match(after, /<title>BeeBot<\/title>/);
  assert.match(after, /href="\.\/assets\/beebot-presence.css"/);
  assert.equal(after.match(/content="default-src[^\"]+"/)[0], before.match(/content="default-src[^\"]+"/)[0]);
  assert.equal((after.match(/<script/g) || []).length, (before.match(/<script/g) || []).length, "no additional inline scripts or runtimes");
  assert.throws(() => presenceHtml(after), /already installed/);
  assert.throws(() => presenceHtml(before + "</head>"), /exactly one head/);
  assert.throws(() => presenceHtml(before.replace("</head>", "")), /exactly one head/);
});

test("actual packaged renderer uses original personas, live mirrors, status and theme assets", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "presence-package-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stage = path.join(directory, "stage");
  await cp(sourceRoot, path.join(stage, "dist/renderer"), { recursive: true });
  const original = await readFile(path.join(sourceRoot, "assets/index-UbX-y3il.js"), "utf8");
  await applyOriginalRendererRouterPatch({ stageRoot: stage });
  const extension = JSON.parse(await readFile(path.join(stage, "dist/renderer-router-extension.json"), "utf8"));
  const main = await readFile(path.join(stage, "dist/renderer/assets/index-UbX-y3il.js"), "utf8");
  parse(main, { ecmaVersion: "latest", sourceType: "module" });
  assert.match(main, /RPresenceUI\.createCharacterSvg\(document,shape,colorId,size\)/);
  assert.match(main, /viewBox:"0 0 64 64",children:p.jsx\("use",\{href:k\}\)/);
  assert.match(main, /p.jsx\(RPresenceWorkStatus\(\),\{agent:t\}\)/);
  assert.match(main, /className:"sand-agent-avatar","data-size":f,sizePx:O,src:s/); // custom photo branch retained
  assert.match(main, /function dqn\(n\)\{return n.children\}/);
  assert.match(main, /sourceId:"bb-visible-"\+sourceId,avatarIdentity:kct\(t\)/);
  assert.match(main, /RPresenceUI\.avatarExpressionFromAgent\(n\?\?e\?\?\{\}\)/);
  assert.match(main, /RPresenceUI\.avatarShapes\.map/);
  assert.match(main, /RPresenceUI\.createPresenceAvatarPreview/);
  assert.match(main, /p.jsx\(RPresenceMotionSetting\(\),\{\}\)/);
  assert.match(main, /new URL\("beebot-app-icon.svg",import.meta.url\)/);
  assert.ok(extension.presence.assets.some(asset => asset.path.endsWith("beebot-app-icon.svg")));
  assert.equal(await readFile(path.join(sourceRoot, "assets/index-UbX-y3il.js"), "utf8"), original);
  assert.throws(() => patchPresenceRenderer(main), /differs from the pinned/);
  const archivePath = path.join(directory, "app.asar");
  await createPackage(stage, archivePath);
  const verified = await verifyPresenceRendererArchive({ archivePath, sourceRendererRoot: sourceRoot, extension });
  assert.ok(verified.fileCount > 2); assert.equal(verified.presence.version, 1);
  await assert.rejects(verifyPresenceRendererArchive({ archivePath, sourceRendererRoot: sourceRoot, extension: { ...extension, bypass: true } }), /differs from the reproducible/);
  await writeFile(path.join(stage, "dist/renderer/assets/beebot-presence.css"), "body{display:none}");
  await createPackage(stage, archivePath);
  await assert.rejects(verifyPresenceRendererArchive({ archivePath, sourceRendererRoot: sourceRoot, extension }), /packaged bytes differ/);
});
