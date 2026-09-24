import assert from "node:assert/strict";
import { readFile, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Window } from "happy-dom";
import { installNativeWindowLayout, captionDimension } from "../frontend/src/presence/window-layout.ts";
import { NATIVE_CAPTION_METRICS, MAC_TRAFFIC_LIGHT_POSITION } from "../source/shared/window-layout.ts";
import { applyOriginalRendererRouterPatch } from "../scripts/lib/router-renderer-patch.mjs";
import { parse } from "acorn";

for (const platform of ["darwin", "win32", "linux"]) {
  test(`${platform}: native caption reserves its DIP height through CSS page zoom`, async t => {
    const w = new Window(); t.after(() => w.happyDOM.close());
    const root = w.document.documentElement;
    root.style.setProperty("--sand-zoom-factor", ".5");
    const release = installNativeWindowLayout(w.document, platform, false);
    assert.equal(root.style.getPropertyValue("--bb-caption-block"), captionDimension(NATIVE_CAPTION_METRICS[platform].height));
    assert.equal(root.dataset.bbWindowPlatform, platform);
    assert.equal(w.document.querySelectorAll("#beebot-window-caption").length, 1);
    assert.equal(root.style.getPropertyValue("--sand-zoom-factor"), ".5");
    release();release();
    assert.equal(w.document.querySelector("#beebot-window-caption"), null);
    assert.equal(root.hasAttribute("data-bb-window-platform"), false);
  });
}

test("macOS traffic lights fit entirely inside the shared native strip", () => {
  assert.ok(MAC_TRAFFIC_LIGHT_POSITION.y + 14 + 8 <= NATIVE_CAPTION_METRICS.darwin.height);
  assert.ok(MAC_TRAFFIC_LIGHT_POSITION.x + 3 * 14 + 2 * 8 <= NATIVE_CAPTION_METRICS.darwin.leading);
});
test("overlay ownership and out-of-order disposal never erase another active window layout", async t => {
  const w=new Window(); t.after(()=>w.happyDOM.close()); const root=w.document.documentElement;
  const main=installNativeWindowLayout(w.document,"darwin",false);
  const overlay=installNativeWindowLayout(w.document,"darwin",false);
  main();assert.equal(root.dataset.bbWindowPlatform,"darwin");
  const fullscreen=installNativeWindowLayout(w.document,"darwin",true);
  overlay();assert.equal(root.dataset.bbWindowFullscreen,"true");
  assert.equal(w.document.getElementById("beebot-window-caption").hidden,true);
  assert.equal(root.style.getPropertyValue("--bb-caption-block"),captionDimension(0));
  fullscreen();assert.equal(root.hasAttribute("data-bb-window-fullscreen"),false);
});
test("fullscreen to windowed, repeated mounts and cleanup preserve unrelated styles and draft identity", async t=>{
  const w=new Window();t.after(()=>w.happyDOM.close());const d=w.document,r=d.documentElement;
  r.style.setProperty("--bb-caption-block","7px","important");r.dataset.theme="cursor-dark";
  d.body.innerHTML='<textarea id="draft">保留第二条消息</textarea>';const draft=d.querySelector('textarea');draft.focus();draft.setSelectionRange(2,4);
  const normal=installNativeWindowLayout(d,"darwin",false),fs=installNativeWindowLayout(d,"darwin",true);
  fs();assert.equal(r.dataset.bbWindowFullscreen,"false");assert.equal(d.querySelectorAll('#beebot-window-caption').length,1);
  normal();assert.equal(r.style.getPropertyValue('--bb-caption-block'),'7px');assert.equal(r.style.getPropertyPriority('--bb-caption-block'),'important');
  assert.equal(r.dataset.theme,'cursor-dark');assert.equal(d.querySelector('textarea'),draft);assert.equal(d.activeElement,draft);assert.equal(draft.selectionStart,2);assert.equal(draft.value,'保留第二条消息');
});
test("web/unknown platforms never invent native controls or an empty title row", async t=>{
  const w=new Window();t.after(()=>w.happyDOM.close());
  for(const platform of ['browser','unknown','__proto__','']){installNativeWindowLayout(w.document,platform,false)();assert.equal(w.document.querySelector('#beebot-window-caption'),null);}
  assert.equal(w.document.documentElement.hasAttribute('data-bb-window-platform'),false);
});
test("caption and overlay bounds are shared; only the caption is draggable", async()=>{
  const css=await readFile(new URL('../frontend/src/presence/window-layout.css',import.meta.url),'utf8');
  assert.match(css, /padding-top: var\(--bb-caption-block, 0px\) !important/);
  assert.match(css, /100dvh - 2 \* var\(--bb-dialog-inset\)/);
  assert.match(css, /\.sand-cover-drag\s*\{[^}]*height: 0 !important[^}]*no-drag/s);
  assert.doesNotMatch(css, /zoom:\s*0|display:\s*none.*\.sand-window-controls/);
  const indicator=await readFile(new URL('../frontend/src/recovered/features/window-chrome/workspace-indicator.css',import.meta.url),'utf8');
  assert.doesNotMatch(indicator,/\.sand-chat-header__title/);
});
test("actual pinned packaged renderer installs the shared safe-area lifecycle before its platform branches", async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'bb-window-renderer-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await cp(path.resolve('src/app/dist/renderer'),path.join(dir,'dist/renderer'),{recursive:true});
  await applyOriginalRendererRouterPatch({stageRoot:dir});
  const js=await readFile(path.join(dir,'dist/renderer/assets/index-UbX-y3il.js'),'utf8');
  parse(js,{ecmaVersion:'latest',sourceType:'module'});
  const begin=js.indexOf('function xPe('),end=js.indexOf('function Ipe(',begin),chrome=js.slice(begin,end);
  assert.match(chrome,/S\.useLayoutEffect\(\(\)=>RPresenceUI\.installNativeWindowLayout\(document,s,e\),\[s,e\]\)/);
  assert.ok(chrome.indexOf('useLayoutEffect')<chrome.indexOf('s==="darwin"'));
  assert.match(chrome,/r\.minimize\(\)/);assert.match(chrome,/r\.toggleMaximize\(\)/);assert.match(chrome,/r\.close\(\)/);
  const css=await readFile(path.join(dir,'dist/renderer/assets/beebot-presence.css'),'utf8');
  assert.ok(css.includes('beebot-window-caption'));assert.ok(css.includes('--bb-dialog-inset'));
  const original=await readFile(path.resolve('src/app/dist/renderer/assets/index-UbX-y3il.js'),'utf8');
  assert.equal(original.includes('installNativeWindowLayout'),false);
});

test('fixed viewers and short onboarding keep content separate from native controls', async()=>{
  const css=await readFile(new URL('../frontend/src/presence/window-layout.css',import.meta.url),'utf8');
  for(const name of ['.sand-onboarding','.sand-file-viewer','.sand-media-viewer','.sand-mermaid-viewer'])assert.ok(css.includes(name));
  assert.match(css,/grid-template-rows: minmax\(600px, 1fr\) !important; overflow-y: auto !important/);
  assert.match(css,/\[data-ui-dialog-root\]:not\(\[data-animation-phase\]\):not\(\[data-expanded\]\)/);
});

test('settings navigation, body and close lane work for both recovered and pinned markup',async()=>{
  const css=await readFile(new URL('../frontend/src/presence/window-layout.css',import.meta.url),'utf8');
  assert.match(css,/\.sand-settings-layout \{ display: grid !important/);
  assert.match(css,/\.sand-settings-nav \{[^}]*overflow-y: auto !important/);
  assert.match(css,/\.sand-settings-panel__body \{[^}]*min-height: 0 !important/);
  assert.match(css,/\.sand-settings-pane-header \{[^}]*padding-right: 56px !important/s);
});


test('caption status and long attachment names cannot cover adjacent controls',async()=>{
  const css=await readFile(new URL('../frontend/src/presence/window-layout.css',import.meta.url),'utf8');
  assert.match(css,/\.sand-kit-status-dot \{[^}]*left: calc\(var\(--bb-caption-leading, 0px\) \+ 20px\) !important/s);
  assert.match(css,/\.bb-window-workspace-label \{[^}]*left: calc\(var\(--bb-caption-leading, 0px\) \+ 36px\)/s);
  assert.match(css,/\.sand-file-viewer__header \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto auto/s);
});
