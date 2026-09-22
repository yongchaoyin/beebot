import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyOriginalRendererRouterPatch } from "../scripts/lib/router-renderer-patch.mjs";

// Exercise the shipped baseline, not September 17's superseded minified anchors.
test("registry Router item survives composed landing patches in the actual renderer", async t => {
  const stageRoot = await mkdtemp(path.join(os.tmpdir(), "beebot-composed-router-"));
  t.after(() => rm(stageRoot, {recursive: true, force: true}));
  await cp(path.resolve("src/app/dist/renderer"), path.join(stageRoot, "dist/renderer"), {recursive: true});
  await applyOriginalRendererRouterPatch({stageRoot});
  const assets = path.join(stageRoot, "dist/renderer/assets");
  const sources = await Promise.all((await readdir(assets)).filter(x=>x.endsWith(".js")).map(x=>readFile(path.join(assets,x),"utf8")));
  assert.ok(sources.some(x=>/id:"router",label:"Router"/.test(x) && /RVendorSetup/.test(x)), "registry and landing patches coexist in the same shipped chunk");
  assert.ok(sources.some(x=>/RRouterPanel/.test(x)));
});
