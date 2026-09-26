import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { parse } from "acorn";
import { simple } from "acorn-walk";
import { patchUiLanguageRenderer, uiLanguageBindings } from "../scripts/lib/ui-language-renderer-patch.mjs";
import { UI_ZH_TRANSLATIONS } from "../scripts/lib/ui-language-catalog.mjs";
import { applyOriginalRendererRouterPatch } from "../scripts/lib/router-renderer-patch.mjs";
import { sourceAppDir } from "../scripts/lib/config.mjs";

const routerSource = await readFile(new URL("../scripts/lib/router-renderer-patch.mjs", import.meta.url), "utf8");
const rowStart = routerSource.indexOf("function RLanguageRow(){");
const rowEnd = routerSource.indexOf("function RServersPanel", rowStart);
assert.ok(rowStart >= 0 && rowEnd > rowStart);
const row = routerSource.slice(rowStart, rowEnd);
const fixture = `
import * as S from 'react';
import * as compiler from 'react/compiler-runtime';
import * as p from 'react/jsx-runtime';
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
const de=S,a=p,stats={inputs:[],outputs:[],builds:0,effects:0,mounts:0,unmounts:0};
const he={c(size){const cache=compiler.c(size);stats.inputs.push(cache);return cache}};
const staticOption={label:'General',value:'General'};
const moduleLabel='General',label='General';
const userPayload={value:'General',name:'General',message:'General',role:'General'};
export function aliases(value){const local='General';return {code:Object.freeze({value:local,title:local}),user:{value,title:value},module:{value:moduleLabel,title:moduleLabel},predicate:local==='General'}}
export function templates(value){const detected=\`Auto-detect (\${value})\`;return {computed:{value:detected,title:detected},direct:{value,title:\`Auto-detect (\${value})\`}}}
export function comparisons(value){return {children:value==='General'&&'Close'}}
export function catchScope(value){const before={title:label};let inside;try{throw value}catch(label){inside={title:label}}return {before,inside,after:{title:label}}}
export function loopScopes(values){const before={title:label},titles=[];for(let label of values)titles.push({title:label});for(let label in {General:true})titles.push({title:label});for(let label=values[0],i=0;i<1;i++)titles.push({title:label});return {before,titles,after:{title:label}}}
export function switchScope(value){const before={title:label};let inside;switch(value){case 'General':let label=value;inside={title:label};break;default:inside={title:value}}return {before,inside,after:{title:label}}}
let draftSetter;
function ie({label,children}){return p.jsxs('label',{children:[p.jsx('span',{children:label}),children]})}
function ye({options,onValueChange,value,disabled,...props}){return p.jsx('select',{'aria-label':props['aria-label'],disabled,value,onChange:e=>onValueChange(e.currentTarget.value),children:options.map(o=>p.jsx('option',{value:o.value,children:o.label},o.value))})}
${row}
function Compiled({user,revision}){
  const cache=he.c(2);stats.outputs.push(cache);
  const [draft,setDraft]=S.useState('General');draftSetter=setDraft;
  S.useEffect(()=>{stats.mounts++;return()=>{stats.unmounts++}},[]);
  if(cache[0]===Symbol.for('react.memo_cache_sentinel')){cache[0]=p.jsx('h1',{children:'General'});stats.builds++}
  if(cache[1]===Symbol.for('react.memo_cache_sentinel'))cache[1]={kind:'stable-effect-input'};
  S.useEffect(()=>{stats.effects++},[cache[1]]);
  return p.jsxs('section',{children:[cache[0],p.jsx('textarea',{placeholder:'General','aria-label':'General',value:draft,onChange:e=>setDraft(e.currentTarget.value)}),p.jsx('p',{'data-user':true,children:user}),p.jsx('span',{'data-revision':true,children:revision}),p.jsx(RLanguageRow,{})]})
}
export function mount(host,user='General'){
 const root=createRoot(host);let revision=0;
 const render=()=>flushSync(()=>root.render(p.jsx(Compiled,{user,revision})));render();
 return {stats,staticOption,userPayload,rerender(){revision++;render()},setDraft(value){flushSync(()=>draftSetter(value))},unmount(){flushSync(()=>root.unmount())}}
}
`;
const patched = patchUiLanguageRenderer(fixture, { main: true, cacheBinding: "he", reactBinding: "S" });
const bundled = await build({ bundle: true, write: false, format: "iife", globalName: "LanguageFixture", platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' }, stdin: { resolveDir: path.resolve(import.meta.dirname, ".."), contents: patched.source } });
const code = bundled.outputFiles[0].text;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async win => { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); await win.happyDOM.whenAsyncComplete(); };
async function rig(t, { get = async () => ({ language: "en" }), set = async language => ({ language }), initial } = {}) {
  const win = new Window({ url: "https://beebot.test", settings: { enableJavaScriptEvaluation: true } });
  win.console.timeStamp = () => {};
  const errors = []; win.addEventListener("error", event => errors.push(event.message));
  win.desktop = { agent: { getUiLanguage: get, setUiLanguage: set } };
  if (initial) win.__sandUiLanguage = initial;
  win.document.body.innerHTML = "<main></main>";
  win.eval(code + ";window.LanguageFixture=LanguageFixture;");
  const host = win.document.querySelector("main"), app = win.LanguageFixture.mount(host);
  t.after(async () => { app.unmount(); await win.happyDOM.close(); });
  await settle(win);
  return { win, host, app, errors, api: win.__beebotUiLanguage };
}

test("actual compiler caches survive ordinary renders and only invalidate their UI copy when language changes", async t => {
  const r = await rig(t), zh = UI_ZH_TRANSLATIONS.General;
  assert.ok(zh && zh !== "General"); assert.ok(patched.translated.includes("General"));
  const before = r.app.stats.builds, effects = r.app.stats.effects;
  r.app.rerender(); r.app.rerender(); await settle(r.win);
  assert.equal(r.app.stats.builds, before, "React clones its compiler cache; that alone must not invalidate it");
  assert.equal(r.app.stats.effects, effects, "same-language renders must retain memoized effect dependencies");
  for (const [index, language] of ["zh", "en", "zh"].entries()) {
    await r.api.set(language); await settle(r.win);
    assert.equal(r.host.querySelector("h1").textContent, language === "zh" ? zh : "General",
      `language=${r.api.snapshot()}, renders=${r.app.stats.inputs.length}, builds=${r.app.stats.builds}, cacheLanguage=${String(r.app.stats.inputs.at(-1).at(-1))}`);
    assert.equal(r.app.stats.builds, before + index + 1);
    r.app.rerender(); await settle(r.win);
    assert.equal(r.app.stats.builds, before + index + 1);
  }
  assert.ok(r.app.stats.inputs.length > 4);
  for (const [index, cache] of r.app.stats.inputs.entries()) assert.equal(r.app.stats.outputs[index], cache, "the adapter must return the exact cache supplied by React");
  assert.equal(r.app.stats.mounts, 1); assert.equal(r.app.stats.unmounts, 0); assert.deepEqual(r.errors, []);
});

for (const conversation of ["single-bot", "group-room"]) test(`${conversation}: switching language preserves composing drafts, DOM focus and dynamic user text`, async t => {
  const r = await rig(t), input = r.host.querySelector("textarea");
  let compositions = 0; input.addEventListener("compositionstart", () => compositions++); input.addEventListener("compositionend", () => compositions--);
  input.focus(); input.dispatchEvent(new r.win.CompositionEvent("compositionstart", { bubbles: true, data: "未完成" }));
  for (const [index, language] of ["zh", "en", "zh"].entries()) {
    const draft = ["General", "第二条 未完成输入", "第三条 draft"][index];
    r.app.setDraft(draft); input.setSelectionRange(1, 3);
    await r.api.set(language); await settle(r.win);
    assert.equal(r.host.querySelector("textarea"), input); assert.equal(r.win.document.activeElement, input);
    assert.equal(input.value, draft); assert.equal(input.selectionStart, 1); assert.equal(input.selectionEnd, 3);
    assert.equal(compositions, 1, "language changes do not end or replace the in-progress composition surface");
    assert.equal(r.host.querySelector("[data-user]").textContent, "General", "a user's text is not UI copy even when equal to a catalog key");
    assert.equal(JSON.stringify(r.app.userPayload), JSON.stringify({ value: "General", name: "General", message: "General", role: "General" }));
  }
  input.dispatchEvent(new r.win.CompositionEvent("compositionend", { bubbles: true, data: "完成" })); assert.equal(compositions, 0);
  assert.equal(r.app.stats.mounts, 1); assert.deepEqual(r.errors, []);
});

test("initial saved language refreshes mounted UI, static menu labels, placeholder and aria text", async t => {
  const initial = deferred(), r = await rig(t, { get: () => initial.promise });
  assert.equal(r.host.querySelector("h1").textContent, "General"); assert.equal(r.app.staticOption.label, "General");
  initial.resolve({ language: "zh" }); await settle(r.win);
  const zh = UI_ZH_TRANSLATIONS.General;
  assert.equal(r.host.querySelector("h1").textContent, zh); assert.equal(r.app.staticOption.label, zh);
  assert.equal(r.app.staticOption.value, "General"); assert.equal(r.host.querySelector("textarea").placeholder, zh);
  assert.equal(r.host.querySelector("textarea").getAttribute("aria-label"), zh); assert.equal(r.win.document.documentElement.lang, "zh-CN");
});

test("a shared display alias cannot translate an input value or dynamic user content", async t => {
  const r = await rig(t);
  for (const language of ["zh", "en", "zh"]) {
    await r.api.set(language); await settle(r.win);
    const result = r.win.LanguageFixture.aliases("General"), label = language === "zh" ? UI_ZH_TRANSLATIONS.General : "General";
    assert.equal(result.code.value, "General", "a code-owned local reused by value and title retains its non-display bytes");
    assert.equal(result.code.title, label); assert.ok(Object.isFrozen(result.code)); assert.equal(result.predicate, true);
    assert.equal(result.user.value, "General"); assert.equal(result.user.title, "General", "dynamic user content remains untouched");
    assert.equal(result.module.value, "General"); assert.equal(result.module.title, label);
  }
});

test("Auto-detect templates translate their display shell while keeping dynamic values and raw aliases intact", async t => {
  const r = await rig(t);
  for (const language of ["zh", "en", "zh"]) {
    await r.api.set(language); await settle(r.win);
    for (const value of ["General", "Asia/Shanghai", "a.b+[]()\\path", "第一行\n第二行", null, undefined]) {
      const result = r.win.LanguageFixture.templates(value);
      const expected = language === "zh" ? UI_ZH_TRANSLATIONS["Auto-detect ({0})"].replace("{0}", value) : `Auto-detect (${value})`;
      assert.equal(result.computed.value, `Auto-detect (${value})`); assert.equal(result.direct.value, value);
      assert.equal(result.computed.title, expected); assert.equal(result.direct.title, expected);
    }
  }
});

test("comparison operands remain protocol values while only their resulting UI text translates", async t => {
  const r = await rig(t); assert.ok(UI_ZH_TRANSLATIONS.Close);
  for (const language of ["zh", "en", "zh"]) {
    await r.api.set(language); await settle(r.win);
    assert.equal(r.win.LanguageFixture.comparisons("General").children, language === "zh" ? UI_ZH_TRANSLATIONS.Close : "Close");
    assert.equal(r.win.LanguageFixture.comparisons(UI_ZH_TRANSLATIONS.General).children, false, "Chinese display copy cannot change the comparison's accepted value");
    assert.equal(r.win.LanguageFixture.comparisons("user text").children, false);
  }
});

test("catch parameters shadow module UI constants without translating caught user text", async t => {
  const r = await rig(t);
  for (const language of ["zh", "en", "zh"]) {
    await r.api.set(language); await settle(r.win);
    const expected = language === "zh" ? UI_ZH_TRANSLATIONS.General : "General";
    for (const value of ["General", "Close", "用户原文"]) {
      const result = r.win.LanguageFixture.catchScope(value);
      assert.equal(result.before.title, expected); assert.equal(result.after.title, expected);
      assert.equal(result.inside.title, value, "the caught value does not inherit the module constant's UI provenance");
    }
  }
});

test("for and switch bindings preserve their own data and do not shadow module UI constants outside their lexical scope", async t => {
  const r = await rig(t);
  for (const language of ["zh", "en", "zh"]) {
    await r.api.set(language); await settle(r.win);
    const expected = language === "zh" ? UI_ZH_TRANSLATIONS.General : "General";
    const loop = r.win.LanguageFixture.loopScopes(["General", "Close", "用户原文"]);
    assert.equal(loop.before.title, expected); assert.equal(loop.after.title, expected);
    assert.equal(JSON.stringify(loop.titles.map(row => row.title)), JSON.stringify(["General", "Close", "用户原文", "General", "General"]));
    for (const value of ["General", "Close", "用户原文"]) {
      const result = r.win.LanguageFixture.switchScope(value);
      assert.equal(result.before.title, expected); assert.equal(result.after.title, expected); assert.equal(result.inside.title, value);
    }
  }
});

test("a delayed initial read cannot overwrite a newer explicitly saved language", async t => {
  const initial = deferred(), r = await rig(t, { get: () => initial.promise });
  await r.api.set("zh"); initial.resolve({ language: "en" }); await settle(r.win);
  assert.equal(r.api.snapshot(), "zh"); assert.equal(r.host.querySelector("h1").textContent, UI_ZH_TRANSLATIONS.General);
});

test("out-of-order writes cannot roll the UI back to an older request", async t => {
  const pending = [], r = await rig(t, { set: language => { const d = deferred(); pending.push({ language, ...d }); return d.promise; } });
  const first = r.api.set("en"), second = r.api.set("zh");
  pending[1].resolve({ language: "zh" }); await second;
  pending[0].resolve({ language: "en" }); await first; await settle(r.win);
  assert.equal(r.api.snapshot(), "zh"); assert.equal(r.host.querySelector("h1").textContent, UI_ZH_TRANSLATIONS.General);
});

test("the actual packaged language row retains its saved selection and shows an inline persistence error", async t => {
  const r = await rig(t, { get: async () => ({ language: "zh" }), set: async () => { throw new Error("fixture: save rejected"); } });
  const select = r.host.querySelector("select"); assert.equal(select.value, "zh");
  select.value = "en"; select.dispatchEvent(new r.win.Event("change", { bubbles: true })); await settle(r.win);
  assert.equal(r.api.snapshot(), "zh"); assert.equal(select.value, "zh"); assert.equal(select.disabled, false);
  assert.match(r.host.querySelector('[role="alert"]').textContent, /语言未能保存/);
  assert.equal(r.host.querySelector("h1").textContent, UI_ZH_TRANSLATIONS.General); assert.deepEqual(r.errors, []);
});

test("compiler and React bindings are identified from actual chunk import names", () => {
  assert.deepEqual(uiLanguageBindings('import {c as v,w as R,x as unrelated} from "./index-UbX-y3il.js";', "settings.js"), { cacheBinding: "v", reactBinding: "R", name: "settings.js" });
  assert.deepEqual(uiLanguageBindings("const c={c(){}};", "unrelated.js"), { cacheBinding: undefined, reactBinding: undefined, name: "unrelated.js" });
});

test("the actual pinned adapter translates settings copy in emitted chunks and records its exact coverage", async t => {
  const stage = await mkdtemp(path.join(tmpdir(), "beebot-ui-language-pinned-")); t.after(() => rm(stage, { recursive: true, force: true }));
  await cp(path.join(sourceAppDir, "dist/renderer"), path.join(stage, "dist/renderer"), { recursive: true });
  const record = await applyOriginalRendererRouterPatch({ stageRoot: stage });
  assert.ok(record.localization.length > 1, "settings lazy chunks must be included, not only the main chunk");
  for (const keyword of ["General", "Appearance", "Theme", "Updates"]) {
    const owners = record.localization.filter(item => item.copy.includes(keyword)); assert.ok(owners.length, keyword);
    for (const owner of owners) {
      const actual = await readFile(path.join(stage, owner.path), "utf8");
      assert.ok(actual.includes(`BB_uiText(${JSON.stringify(keyword)})`), `${keyword} must be an executable translated display expression`);
      assert.ok(actual.includes("BB_uiMemo("), "the owning renderer subscribes and invalidates its compiled cache");
    }
  }
  const index = await readFile(path.join(stage, "dist/renderer/assets/index-UbX-y3il.js"), "utf8");
  assert.ok(index.includes("window.__beebotUiLanguage=api"));
  const emitted = new Set();
  for (const item of record.localization) {
    const source = await readFile(path.join(stage, item.path), "utf8");
    simple(parse(source, { ecmaVersion: "latest", sourceType: "module" }), {
      CallExpression(node) {
        if (["BB_uiText", "BB_uiFormat"].includes(node.callee.name) && typeof node.arguments[0]?.value === "string") emitted.add(node.arguments[0].value);
        if (node.callee.name === "BB_uiComputed" && node.arguments[1]?.type === "ArrayExpression") {
          for (const value of node.arguments[1].elements) if (typeof value?.value === "string") emitted.add(value.value);
        }
      },
    });
  }
  for (const key of [
    "Dismissed", "Open account menu", "Open account menu, new update available", "Resize sidebar", "Agent list", "Conversation transcript", "Agent message", "All members",
    "Open {0}'s chat", "Reply to {0}", "Message actions for {0} ({1})", "Message actions for {0} at {1} ({2})", "Open {0}", "Save {0}",
    "BeeBot's computer wasn't provisioned with the egress tunnel — start a new one to use this.",
    "Stable is the safe default. Other tracks ship new builds earlier and more often. Switching checks for updates right away.",
    "Updates the computer your assistants share. Your files and logins stay. All assistants update together.", "Update",
  ]) assert.ok(emitted.has(key), `${key} must reach an executable translation call in the actual emitted renderer`);
});
