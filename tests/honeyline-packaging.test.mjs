import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createPackage } from "@electron/asar";
import { parse } from "acorn";
import { applyOriginalRendererRouterPatch } from "../scripts/lib/router-renderer-patch.mjs";
import { honeylineHtml } from "../scripts/lib/build-honeyline.mjs";
import { patchHoneylineRenderer } from "../scripts/lib/honeyline-renderer-patch.mjs";
import { verifyHoneylineRendererArchive } from "../scripts/lib/honeyline-package-verification.mjs";

const sourceRoot = path.resolve("src/app/dist/renderer");

test("Presence modifies only explicit file entry anchors and preserves the CSP", async () => {
  const before = await readFile(path.join(sourceRoot, "index.html"), "utf8");
  const after = honeylineHtml(before);
  assert.match(after, /<html data-beebot-theme="presence"/);
  assert.match(after, /<title>BeeBot<\/title>/);
  assert.match(after, /href="\.\/assets\/beebot-presence.css"/);
  assert.equal(after.match(/content="default-src[^\"]+"/)[0], before.match(/content="default-src[^\"]+"/)[0]);
  assert.equal((after.match(/<script/g) || []).length, (before.match(/<script/g) || []).length, "no additional inline scripts or runtimes");
  assert.throws(() => honeylineHtml(after), /already installed/);
  assert.throws(() => honeylineHtml(before + "</head>"), /exactly one head/);
  assert.throws(() => honeylineHtml(before.replace("</head>", "")), /exactly one head/);
});

test("actual packaged renderer owns visible avatars, retains photos, and preserves verified assets", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "honeyline-package-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stage = path.join(directory, "stage");
  await cp(sourceRoot, path.join(stage, "dist/renderer"), { recursive: true });
  const original = await readFile(path.join(sourceRoot, "assets/index-UbX-y3il.js"), "utf8");
  await applyOriginalRendererRouterPatch({ stageRoot: stage });
  const extension = JSON.parse(await readFile(path.join(stage, "dist/renderer-router-extension.json"), "utf8"));
  const main = await readFile(path.join(stage, "dist/renderer/assets/index-UbX-y3il.js"), "utf8");
  parse(main, { ecmaVersion: "latest", sourceType: "module" });
  assert.match(main, /RHoneylineUI\.createCharacterSvg\(document,shape,colorId,size\)/);
  assert.match(main, /viewBox:"0 0 64 64",children:p.jsx\("use",\{href:k\}\)/);
  assert.match(main, /identityKey:kct\(t\),style:m/);
  assert.match(main, /isFollowingPointer:n.isFollowingPointer,followTarget:n.followTarget/);
  assert.match(main, /function wbe\(n\)\{return RHoneylineUI.presenceFromWork\(n\?\?\{\}\)\}/);
  assert.match(main, /Q=p.jsx\(ml,\{agent:t,fillPx:28,isStatic:!1,size:"md"\}\)/);
  const dispatcher = main.slice(main.indexOf("function Iee(n){"), main.indexOf("function pln(", main.indexOf("function Iee(n){")));
  assert.doesNotMatch(dispatcher, /wct|Nlt|"use"/); // visible portraits must not point at an unobserved hidden source
  assert.match(main, /p.jsx\(RHoneylineWorkStatus\(\),\{agent:t\}\)/);
  assert.match(main, /className:"sand-agent-avatar","data-size":f,sizePx:O,src:s/); // custom photo branch retained
  assert.equal(await readFile(path.join(sourceRoot, "assets/index-UbX-y3il.js"), "utf8"), original);
  assert.throws(() => patchHoneylineRenderer(main), /differs from the pinned/);
  const archivePath = path.join(directory, "app.asar");
  await createPackage(stage, archivePath);
  const verified = await verifyHoneylineRendererArchive({ archivePath, sourceRendererRoot: sourceRoot, extension });
  assert.ok(verified.fileCount > 2); assert.equal(verified.honeyline.version, 1);
  await assert.rejects(verifyHoneylineRendererArchive({ archivePath, sourceRendererRoot: sourceRoot, extension: { ...extension, bypass: true } }), /differs from the reproducible/);
  await writeFile(path.join(stage, "dist/renderer/assets/beebot-presence.css"), "body{display:none}");
  await createPackage(stage, archivePath);
  await assert.rejects(verifyHoneylineRendererArchive({ archivePath, sourceRendererRoot: sourceRoot, extension }), /packaged bytes differ/);
});
