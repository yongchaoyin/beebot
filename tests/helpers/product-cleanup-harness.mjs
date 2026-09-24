import { build } from "esbuild";
import { parse } from "acorn";
import { simple } from "acorn-walk";
import { readFile } from "node:fs/promises";
import { patchProductConnections, productConnectionsModule } from "../../scripts/lib/product-settings-patch.mjs";

/** Real source GeneralSettingsPanel plus the exact patched shipped Vs.
 * Account/session callbacks and section destinations are controlled fixtures. */
export async function buildProductCleanupHarness() {
  const original = await readFile("src/app/dist/renderer/assets/index-BlqerJhg.js", "utf8");
  const patched = patchProductConnections(original);
  let shipped;
  simple(parse(patched, { ecmaVersion: "latest", sourceType: "module" }), { FunctionDeclaration(node) { if (node.id?.name === "Vs") shipped = patched.slice(node.start, node.end); } });
  if (!shipped) throw new Error("Missing actual shipped connection surface");
  return (await build({ write: false, bundle: true, format: "iife", globalName: "ProductCleanupUI", platform: "browser", jsx: "automatic", target: "chrome136", loader: { ".css": "empty", ".woff2": "empty" }, define: { "process.env.NODE_ENV": '"development"' }, stdin: { resolveDir: process.cwd(), sourcefile: "product-cleanup-fixture.tsx", loader: "tsx", contents: `
import * as de from 'react';
import * as a from 'react/jsx-runtime';
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {GeneralSettingsPanel} from './frontend/src/recovered/features/settings/overlay/panels';
import {SettingsModalShell} from './frontend/src/recovered/features/settings/overlay/view';
const calls=[];let allowConfirm=true;
const Ve=()=>async()=>allowConfirm,Qe={},oe='button';
${productConnectionsModule()}
const RProductConnections=RProductSettings.createProductConnections(de);
${shipped}
export function mount(el){
 const root=createRoot(el);let api;
 function Fixture(){const [language,setLanguage]=de.useState('en'),[surface,setSurface]=de.useState('source'),[section,setSection]=de.useState('general'),[status,setStatus]=de.useState({kind:'logged-out'}),[opened,setOpened]=de.useState(true),[theme,setTheme]=de.useState('light');
  const auth={status,isLoaded:true,logout:async()=>{calls.push('logout');setStatus({kind:'logged-out'})},cancelLogin:async()=>{calls.push('cancel');setStatus({kind:'logged-out'})},login:async()=>{calls.push('login')}};
  de.useLayoutEffect(()=>{window.__sandUiLanguage=language;window.dispatchEvent(new Event('sand-ui-language-changed'));document.documentElement.dataset.beebotTheme='presence';document.documentElement.dataset.theme='cursor-'+theme},[language,theme]);
  de.useEffect(()=>{const listener=e=>{calls.push(e.detail.section);setSection(e.detail.section)};window.addEventListener('sand-open-settings',listener);return()=>window.removeEventListener('sand-open-settings',listener)},[]);
  api={setLanguage,setSurface,setStatus,setTheme,close:()=>setOpened(false),reopen:()=>{setSection('general');setOpened(true)}};
  return <><input id='preserved-draft' defaultValue='草稿与用户提到的 Cursor / Grok Bot 应保持原样' aria-label='Preserved draft'/><SettingsModalShell isOpen={opened} initialSection={section} onClose={()=>setOpened(false)} renderSection={(current,select)=>current==='general'?(surface==='shipped'?<Vs auth={auth}/>:<GeneralSettingsPanel account={{...status,name:status.displayName??'Existing provider',isLocal:status.authId==='local'}} language={language} theme={theme} onThemeChange={setTheme} onAccountAction={()=>{calls.push('disconnect');setStatus({kind:'logged-out'})}} onOpenConnectionSection={s=>{calls.push(s);select(s)}}/>):<p data-destination={current}>{current==='router'?'Model APIs · 测试导航目标':'Server connections · 测试导航目标'}</p>}/></>;
 }
 flushSync(()=>root.render(<Fixture/>));return {language:l=>flushSync(()=>api.setLanguage(l)),surface:s=>flushSync(()=>api.setSurface(s)),session:s=>flushSync(()=>api.setStatus(s)),theme:t=>flushSync(()=>api.setTheme(t)),reopen:()=>{flushSync(()=>api.close());flushSync(()=>api.reopen())},calls:()=>calls.slice(),confirm:value=>{allowConfirm=value},unmount:()=>flushSync(()=>root.unmount())};
}
` } })).outputFiles[0].text;
}
