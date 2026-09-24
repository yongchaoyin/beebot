import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, cp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { auditProductIdentity, inspectProductAliases, classifyIdentityReference } from "../scripts/lib/product-identity-audit.mjs";
import { retireUnusedBrandAssets, brandProductLiterals } from "../scripts/lib/product-branding.mjs";
import { patchProductAccountMenu, patchProductConnections } from "../scripts/lib/product-settings-patch.mjs";
import { buildProductCleanupHarness } from "./helpers/product-cleanup-harness.mjs";

const root = path.resolve('.');
const fixture = await buildProductCleanupHarness();
const originalMain = await readFile('src/app/dist/renderer/assets/index-UbX-y3il.js', 'utf8');
const originalPanel = await readFile('src/app/dist/renderer/assets/index-BlqerJhg.js', 'utf8');

test('authored product copy has no unreviewed upstream identity; compatibility names remain explicit', async () => {
  const report = await auditProductIdentity(root);
  assert.deepEqual(report.violations, []);
  assert.ok(report.indexedFiles > 2000);
  assert.equal(classifyIdentityReference('ui.css', 'cursor: pointer'), 'generic-cursor-or-model-identifier-review');
  assert.equal(classifyIdentityReference('ui.css', '--cursor-text-invert: white'), 'renderer-theme-or-glyph-compatibility');
  assert.equal(classifyIdentityReference('NOTICE.md', 'Grok Bot'), 'attribution-or-reconstruction-evidence');
  assert.equal((await inspectProductAliases('frontend/src/new-view.ts', 'export const label="Grok Bot settings"')).length, 1);
  assert.deepEqual(await inspectProductAliases('source/shared/check.ts', '// Grok Bot reference\nexport const value="generic cursor";'), []);
});

test('live UI strings do not depend on historical reconstruction anchors', async () => {
  const source = await readFile('frontend/src/production/ProductionRenderer.tsx', 'utf8');
  assert.match(source, /import \{ UI_TEXT \} from "\.\/ui-text"/);
  assert.doesNotMatch(await readFile('frontend/src/production/evidence.ts', 'utf8'), /export const UI_TEXT/);
  assert.match(await readFile('frontend/index.html','utf8'), /<title>BeeBot<\/title>/);
});

test('retired artwork cleanup refuses live references or changed bytes before deleting anything', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bb-retired-art-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const policy = JSON.parse(await readFile('scripts/lib/retired-brand-assets.json','utf8'));
  for(const e of policy) await cp('src/app/dist/renderer/assets/'+e.file,path.join(dir,e.file));
  await writeFile(path.join(dir,'new.js'),`const icon="${policy[0].file}";`);
  await assert.rejects(retireUnusedBrandAssets(dir),/still referenced/);
  for(const e of policy) await access(path.join(dir,e.file));
  await rm(path.join(dir,'new.js')); await writeFile(path.join(dir,policy[0].file),'unreviewed bytes');
  await assert.rejects(retireUnusedBrandAssets(dir),/artwork changed/);
  await cp('src/app/dist/renderer/assets/'+policy[0].file,path.join(dir,policy[0].file));
  const removed=await retireUnusedBrandAssets(dir);assert.equal(removed.length,9);
  for(const e of policy){await assert.rejects(access(path.join(dir,e.file)));await access('src/app/dist/renderer/assets/'+e.file);}
});

test('product redirects only its retired onboarding help, not providers, models or user text', () => {
  const code='const help="https://cursor.com/bot/onboarding",api="https://api2.cursor.sh",model="grok-4",user="用户的普通内容";';
  const changed=brandProductLiterals(code);
  assert.match(changed.source,/yongchaoyin\/beebot#readme/);
  assert.match(changed.source,/api2\.cursor\.sh/);assert.match(changed.source,/grok-4/);
  assert.equal(brandProductLiterals('const url="https://example.test/Grok Bot";').count,0);
});

test('both shipped component anchors fail closed on drift instead of replacing the wrong function', () => {
  assert.throws(()=>patchProductConnections(originalPanel.replace('function Vs(s){','function Vs(s){void 0;')),/differs from the reviewed/);
  assert.throws(()=>patchProductAccountMenu(originalMain.replace('function Xln(n){','function Xln(n){void 0;')),/differs from the reviewed/);
  const menu = patchProductAccountMenu(originalMain);
  const begin=menu.indexOf('function Xln('),end=menu.indexOf('\n  }',begin);
  const own=menu.slice(begin,end);
  assert.doesNotMatch(own,/onSignIn|cursor\.com|Get Grok Bot|Ttt\(/);
  assert.match(own,/RAccountDocs/);assert.match(own,/RAccountFeedback/);
});

async function rig(t) {
  const w=new Window({settings:{enableJavaScriptEvaluation:true}});t.after(()=>w.happyDOM.close());
  w.console.timeStamp=()=>{};w.document.body.innerHTML='<div id="root"></div>';
  w.eval(fixture+'\nwindow.ProductCleanupUI=ProductCleanupUI;');
  const app=w.ProductCleanupUI.mount(w.document.getElementById('root'));t.after(()=>app.unmount());
  return {w,d:w.document,app};
}
for (const surface of ['source','shipped']) {
  test(`${surface}: connection shortcuts navigate without creating a provider session and preserve user data`, async t => {
    const {w,d,app}=await rig(t);app.surface(surface);const draft=d.querySelector('#preserved-draft');
    for(const lang of ['en','zh']) for(const section of ['router','servers']) {
      app.reopen();app.language(lang);
      assert.equal(d.body.textContent.includes('Sign In with Cursor'),false);
      const button=d.querySelector(`[data-settings-target="${section}"]`);assert.ok(button);
      button.click();await w.happyDOM.whenAsyncComplete();
      assert.ok(d.querySelector(`[data-destination="${section}"]`));
      assert.equal(d.querySelector('#preserved-draft'),draft);
      assert.match(draft.value,/Cursor \/ Grok Bot/);
    }
    assert.deepEqual(Array.from(app.calls()),['router','servers','router','servers']);
    app.reopen();app.session({kind:'logged-in',authId:'local',displayName:'Local'});
    assert.equal(d.body.textContent.includes('Sign Out'),false,'local model configuration is not a legacy provider account');
  });
}

test('shipped legacy session can be cancelled or explicitly signed out, never silently removed', async t => {
  const {w,d,app}=await rig(t);app.surface('shipped');
  app.session({kind:'logged-in',authId:'old-provider',displayName:'Existing account'});app.confirm(false);
  [...d.querySelectorAll('button')].find(e=>e.textContent==='Sign Out').click();await w.happyDOM.whenAsyncComplete();
  assert.deepEqual(Array.from(app.calls()),[]);
  app.confirm(true);[...d.querySelectorAll('button')].find(e=>e.textContent==='Sign Out').click();await w.happyDOM.whenAsyncComplete();
  assert.deepEqual(Array.from(app.calls()),['logout']);
  app.session({kind:'logging-in'});[...d.querySelectorAll('button')].find(e=>e.textContent==='Cancel').click();await w.happyDOM.whenAsyncComplete();
  assert.deepEqual(Array.from(app.calls()),['logout','cancel']);
});

test('Agent identity and repository guidance are provider-independent without increasing granted tools', async () => {
  const result=await build({entryPoints:['source/host/runner/system-prompt.ts'],bundle:true,write:false,platform:'node',format:'cjs'});
  const mod={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)((await import('node:module')).createRequire(import.meta.url),mod,mod.exports);
  for(const enabled of [true,false]) {
    const prompt=mod.exports.buildSandBaseSystemPrompt({cloudAgentsEnabled:enabled});
    assert.doesNotMatch(prompt,/Grok Bot|## Cursor Origin|ALWAYS hand|stronger coder|point them at using Cursor/);
    assert.match(prompt,/only.*authorized|authorized.*only/s);
    assert.match(prompt,/do not force-push/);assert.match(prompt,/Auto-review/);
    assert.match(prompt,/ExternalShell runs on the user's own computer/);
    if(!enabled)assert.match(prompt,/CloudAgent is unavailable/);
  }
});
