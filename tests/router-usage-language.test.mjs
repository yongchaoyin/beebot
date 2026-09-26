import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { sourceAppDir } from "../scripts/lib/config.mjs";
import { brandProductLiterals } from "../scripts/lib/product-branding.mjs";
import { patchOriginalSettingsPanel } from "../scripts/lib/router-renderer-patch.mjs";
import { patchUiLanguageRenderer, uiLanguageBindings } from "../scripts/lib/ui-language-renderer-patch.mjs";

const name = "index-BlqerJhg.js";
const input = await readFile(path.join(sourceAppDir, "dist/renderer/assets", name), "utf8");
const injected = brandProductLiterals(patchOriginalSettingsPanel(input)).source;
const localized = patchUiLanguageRenderer(injected, uiLanguageBindings(injected, name));
const ast = parse(localized.source, { ecmaVersion: "latest", sourceType: "module" });
const names = ["RRouterNumber", "RRouterCredential", "RRouterPanel", "RRouterUsageSummary", "RRouterUsageRows"];
const components = names.map(name => {
  const matches = ast.body.filter(node => node.type === "FunctionDeclaration" && node.id.name === name);
  assert.equal(matches.length, 1, name);
  const node = matches[0];
  return localized.source.slice(node.start, node.end);
}).join("\n");
const runtime = patchUiLanguageRenderer("", { main: true }).source;
// Real injected components and the production language runtime run under React.
// Only visual primitives and external connection/data dependencies are stand-ins;
// this fixture cannot sign in, alter routes, save credentials or call a model.
const fixture = `
import * as S from 'react';
import * as a from 'react/jsx-runtime';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
const de=S,stats={mounts:0,unmounts:0};
${runtime}
const usage={requests:1234,inputTokens:2345,outputTokens:3456,cacheReadTokens:4000,cacheWriteTokens:567,lastUsedAt:null};
const codex={value:'codex',kind:'local',localKey:'codex',label:'General {0}',description:'Original provider description'};
const claude={value:'claude-code',kind:'local',localKey:'claude-code',label:'Claude Code'};
const local={'codex':{installed:true,authenticated:false},'claude-code':{installed:true,authenticated:false}};
const state={provider:'codex',usage:{providers:{codex:usage}},local,http:null,error:null};
const RRouterProviders=[codex],RRouterOptions=RRouterProviders,RRouterEmptyUsage=usage,RRouterInputClass='fixture-input';
const RRouterState=()=>[state,()=>{throw Error('unexpected route mutation')}];
const RRouterSecrets=()=>[[],()=>{throw Error('unexpected credential refresh')}];
const RBoxRuntime=()=>null,RVendorAccounts=()=>null,k=(...parts)=>parts.join(' ');
function ie({label,description,children}){return a.jsxs('div',{'data-row':true,children:[a.jsx('span',{'data-label':true,children:label}),a.jsx('p',{'data-description':true,children:description}),children]})}
function re({title,children}){return a.jsxs('section',{children:[a.jsx('h2',{children:title}),children]})}
function se({children}){return a.jsx('span',{children})}
function Te({children}){return a.jsx('div',{children})}
function ye({options,value}){return a.jsx('select',{value,readOnly:true,'data-provider':true,children:options.map(item=>a.jsx('option',{value:item.value,children:item.label},item.value))})}
const oe=()=>null;
${components}
function Surface(){
 S.useEffect(()=>{stats.mounts++;return()=>{stats.unmounts++}},[]);
 return a.jsxs('main',{children:[
  a.jsx('div',{'data-summary':true,children:a.jsx(RRouterUsageSummary,{provider:codex,usage,current:true})}),
  a.jsx('div',{'data-panel':true,children:a.jsx(RRouterPanel,{})}),
  a.jsx('div',{'data-claude':true,children:a.jsx(RRouterCredential,{provider:claude,state,keys:[]})})
 ]});
}
export function mount(host){const root=createRoot(host);flushSync(()=>root.render(a.jsx(Surface,{})));return {stats,unmount(){flushSync(()=>root.unmount())}}}
`;
const bundle = await build({ bundle: true, write: false, format: "iife", globalName: "RouterLanguageFixture", platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' }, stdin: { resolveDir: path.resolve(import.meta.dirname, ".."), contents: fixture } });
const settle = async win => { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); await win.happyDOM.whenAsyncComplete(); };

test("actual router templates are included in the shipped language adapter coverage", () => {
  for (const key of ["Sign in with {0}", "Usage for {0}", "{0} requests · {1} input · {2} output · {3} cached"]) {
    assert.ok(localized.translated.includes(key), key);
  }
});

test("actual router components switch usage, title and sign-in copy while preserving counts, provider labels and commands", async t => {
  const win = new Window({ url: "https://beebot.test", settings: { enableJavaScriptEvaluation: true } });
  win.console.timeStamp = () => {};
  const errors = []; win.addEventListener("error", event => errors.push(event.message));
  win.desktop = { agent: { getUiLanguage: async () => ({ language: "en" }), setUiLanguage: async language => ({ language }) } };
  win.document.body.innerHTML = "<div id=host></div>";
  win.eval(bundle.outputFiles[0].text + ";window.RouterLanguageFixture=RouterLanguageFixture;");
  const host = win.document.querySelector("#host"), mounted = win.RouterLanguageFixture.mount(host);
  t.after(async () => { mounted.unmount(); await win.happyDOM.close(); });
  await settle(win);
  const select = host.querySelector("select"); select.focus();
  for (const language of ["zh", "en", "zh"]) {
    await win.__beebotUiLanguage.set(language); await settle(win);
    const summary = host.querySelector("[data-summary]");
    assert.equal(summary.querySelector("[data-label]").textContent, "General {0}");
    assert.equal(summary.querySelector("[data-description]").textContent, language === "zh"
      ? "1,234 次请求 · 2,345 输入 Token · 3,456 输出 Token · 4,567 缓存 Token"
      : "1,234 requests · 2,345 input · 3,456 output · 4,567 cached");
    const title = [...host.querySelectorAll("[data-panel] h2")].at(-1).textContent;
    assert.equal(title, language === "zh" ? "General {0} 的用量" : "Usage for General {0}");
    assert.ok(host.querySelector("[data-panel]").textContent.includes(language === "zh" ? "使用 codex login 登录" : "Sign in with codex login"));
    assert.equal(host.querySelector("[data-claude]").textContent, language === "zh" ? "使用 claude 登录" : "Sign in with claude");
    assert.equal(host.querySelector("select"), select); assert.equal(win.document.activeElement, select);
    assert.equal(select.value, "codex"); assert.equal(select.selectedOptions[0].textContent, "General {0}");
  }
  assert.equal(mounted.stats.mounts, 1); assert.equal(mounted.stats.unmounts, 0); assert.deepEqual(errors, []);
});
