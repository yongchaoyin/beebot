import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyOriginalRendererRouterPatch } from "../scripts/lib/router-renderer-patch.mjs";
import { parse } from "acorn";

// Exercise the shipped baseline, not September 17's superseded minified anchors.
test("registry Router item survives composed landing patches in the actual renderer", async t => {
  const stageRoot = await mkdtemp(path.join(os.tmpdir(), "beebot-composed-router-"));
  t.after(() => rm(stageRoot, {recursive: true, force: true}));
  await cp(path.resolve("src/app/dist/renderer"), path.join(stageRoot, "dist/renderer"), {recursive: true});
  await applyOriginalRendererRouterPatch({stageRoot});
  const assets = path.join(stageRoot, "dist/renderer/assets");
  const sources = await Promise.all((await readdir(assets)).filter(x=>x.endsWith(".js")).map(x=>readFile(path.join(assets,x),"utf8")));
  const main=sources.find(x=>x.includes("const wDn=")&&x.includes("RVendorSetup"));
  assert.ok(main,"registry and landing patches coexist in the same shipped chunk");
  const declaration=parse(main,{ecmaVersion:"latest",sourceType:"module"}).body
    .flatMap(node=>node.type==="VariableDeclaration"?node.declarations:[]).find(node=>node.id.name==="wDn");
  let language="en";
  const sections=new Function("BB_uiText",`return ${main.slice(declaration.init.start,declaration.init.end)}`)(value=>language==="zh"&&value==="Router"?"路由":value);
  assert.equal(sections.find(x=>x.id==="router").label,"Router");
  language="zh";
  assert.equal(sections.find(x=>x.id==="router").label,"路由","the same registry follows language changes without replacing section IDs");
  assert.ok(sources.some(x=>/RRouterPanel/.test(x)));
});
