import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, rm, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import test from "node:test";
import { brandProductLiterals } from "../scripts/lib/product-branding.mjs";
import { applyOriginalRendererRouterPatch } from "../scripts/lib/router-renderer-patch.mjs";
const root=path.resolve(import.meta.dirname,".."),exec=promisify(execFile);

test("compile-time branding changes product copy but never rewrites conversation data, protocol or notices",()=>{
 const source='const label="Grok Bot settings";const url="https://cursor.com/grokbot";const notice="Copyright Grok Bot. All rights reserved.";function render(message){return `${label}: ${message} — Grok Bot`};';
 const changed=brandProductLiterals(source);assert.equal(changed.count,2);
 const value=new Function(changed.source+'return {render,url,notice};')();
 assert.equal(value.render("Grok Bot is mentioned in my document"),"BeeBot settings: Grok Bot is mentioned in my document — BeeBot");
 assert.equal(value.url,"https://cursor.com/grokbot");assert.equal(value.notice,"Copyright Grok Bot. All rights reserved.");
 assert.equal(brandProductLiterals(changed.source).count,0);
});
test("actual staged renderer brands welcome, settings, permissions and lazy panels with reproducible records",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"bb-brand-renderer-"));
 try{
  await cp(path.join(root,"src/app/dist/renderer"),path.join(dir,"dist/renderer"),{recursive:true});
  const record=await applyOriginalRendererRouterPatch({stageRoot:dir});
  assert.ok(record.branding.reduce((n,row)=>n+row.replacements,0)>100);
  for(const row of record.branding){const source=await readFile(path.join(dir,row.path),"utf8");assert.equal(brandProductLiterals(source).count,0);}
  const main=await readFile(path.join(dir,"dist/renderer/assets/index-UbX-y3il.js"),"utf8");
  assert.ok(main.includes('title:"Meet BeeBot"'));assert.ok(main.includes('Welcome to BeeBot'));
  assert.ok(main.includes('new URL("beebot-app-icon.svg",import.meta.url)'));
  assert.ok(main.includes('data-beebot-settings-owner'));
  const original=await readFile(path.join(root,"src/app/dist/renderer/assets/index-UbX-y3il.js"),"utf8");assert.ok(original.includes('Meet Grok Bot'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("main and all Electron helper metadata rename together without changing payload bytes",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"bb-brand-bundle-"));
 try{
  const app=path.join(dir,"BeeBot.app"), suffixes=[""," (Renderer)"," (GPU)"," (Plugin)"];
  const bundles=[[app,"Grok Bot"],...suffixes.map(s=>[path.join(app,`Contents/Frameworks/Grok Bot Helper${s}.app`),`Grok Bot Helper${s}`])];
  for(const [bundle,name] of bundles){await mkdir(path.join(bundle,"Contents/MacOS"),{recursive:true});await writeFile(path.join(bundle,"Contents/MacOS",name),"unchanged-mach-o-payload");await writeFile(path.join(bundle,"Contents/Info.plist"),`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>${name}</string><key>CFBundleIdentifier</key><string>com.anysphere.sand.helper</string><key>NSMicrophoneUsageDescription</key><string>Grok Bot uses microphone</string></dict></plist>`);}
  const script=path.join(root,"scripts/lib/rebrand-macos.py");await exec("python3",[script,app]);await exec("python3",[script,app]);await exec("python3",[script,app,"--verify"]);
  assert.equal(await readFile(path.join(app,"Contents/MacOS/BeeBot"),"utf8"),"unchanged-mach-o-payload");
  for(const suffix of suffixes){const b=path.join(app,`Contents/Frameworks/BeeBot Helper${suffix}.app`);assert.equal(await readFile(path.join(b,`Contents/MacOS/BeeBot Helper${suffix}`),"utf8"),"unchanged-mach-o-payload");}
  assert.equal((await readdir(path.join(app,"Contents/Frameworks"))).some(n=>n.startsWith("Grok")),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("packager validates branded identity while preserving shell invariant and reference-only archive",async()=>{
 const code=await readFile(path.join(root,"scripts/package-macos.mjs"),"utf8");
 assert.ok(code.includes('rebrand-macos.py'));assert.ok(code.includes('reconstructedExecutable: "BeeBot"'));
 assert.ok(code.includes('verifyOfficialMacReference'));assert.ok(code.includes('verifyReconstructedMacPackage'));assert.ok(code.includes('verifyChecksumPinnedRendererPackage'));
 const text=await readFile(path.join(root,"source/electron-main/startup/startup-move-check.ts"),"utf8");assert.ok(text.includes('Move BeeBot to Applications'));assert.equal(text.includes('Grok Bot'),false);
});


test("native application role labels cannot expose the retained credential namespace", async () => {
 const { build } = await import("esbuild");
 const { createRequire } = await import("node:module");
 const dir = await mkdtemp(path.join(tmpdir(), "bb-brand-menu-"));
 try {
  const output = path.join(dir, "menu.cjs");
  await build({ entryPoints:[path.join(root,"source/electron-main/application-menu.ts")], outfile:output, bundle:true, platform:"node", format:"cjs" });
  const { buildApplicationMenuTemplate } = createRequire(import.meta.url)(output);
  for (const language of ["en", "zh"]) {
   const menu = buildApplicationMenuTemplate({ applyWindowShortcut(){}, canUseDevTools:()=>false, emitOpenAbout(){}, uiLanguage:language, platform:"darwin" }, { appName:"BeeBot", openExternal:async()=>{} });
   assert.equal(menu[0].label, "BeeBot");
   const labels = menu[0].submenu;
   assert.equal(labels.find(item=>item.role==="hide").label, language==="zh" ? "隐藏 BeeBot" : "Hide BeeBot");
   assert.equal(labels.find(item=>item.role==="quit").label, language==="zh" ? "退出 BeeBot" : "Quit BeeBot");
   assert.equal(JSON.stringify(menu).includes("Grok Bot"), false);
  }
  const identity = JSON.parse(await readFile(path.join(root,"src/app/package.json"),"utf8"));
  assert.equal(identity.name, "sand");
  assert.equal(identity.productName, "Grok Bot");
 } finally { await rm(dir,{recursive:true,force:true}); }
});
