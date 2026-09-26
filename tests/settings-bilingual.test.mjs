import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Window } from "happy-dom";

const source = `
import * as React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {SettingsModalShell} from './frontend/src/recovered/features/settings/overlay/view';
import {GeneralSettingsPanel,RouterSettingsPanel,UpdatesSettingsPanel,UsageSettingsPanel} from './frontend/src/recovered/features/settings/overlay/panels';
import {SettingsDesktopSurface} from './frontend/src/recovered/features/settings/overlay/desktop-surface';
export {updateStatusMessage,egressTunnelStatusDescription} from './frontend/src/recovered/features/settings/overlay/updates';
const noop=()=>{},subscribe=()=>noop;
export function mount(host,desktop=false){
 const root=createRoot(host),calls=[];let api,saveLanguage,failLanguage=false,readLanguage;
 const bridge={platform:'darwin',agent:{getUiLanguage:()=>new Promise(resolve=>readLanguage=resolve),setUiLanguage:language=>{calls.push(['language',language]);return new Promise((resolve,reject)=>saveLanguage=()=>failLanguage?reject(new Error('storage failed')):resolve({language}));},getInferenceVendors:async()=>({vendors:[]}),getInferenceRouter:async()=>({provider:'openrouter'}),clientPersistence:{read:async()=>null,write:async()=>{}}},cursorAccount:{getStatus:async()=>({kind:'logged-out'}),getAvatar:async()=>null,getUsageSummary:async()=>null,onStatusChanged:subscribe},autoReviewInstructions:{get:async()=>({isEnabled:true,allowInstructions:[],blockInstructions:[]})},theme:{get:async()=>({preference:'system'}),onChanged:subscribe},timeZone:{get:async()=>({detectedTimeZone:'Asia/Shanghai',overrideTimeZone:null})},localToolPermission:{get:async()=>'ask',ceiling:async()=>'ask'},foreverBox:{webauthnProxy:{get:async()=>false,onChanged:subscribe},egressTunnel:{initial:false,onChanged:subscribe,onStatusChanged:subscribe}},update:{getStatus:async()=>null,onStatusEvent:subscribe},experiments:{getSnapshot:async()=>({}),onChanged:subscribe}};
 function Fixture(){const [language,setLanguage]=React.useState('en'),[section,setSection]=React.useState('general'),[rules,setRules]=React.useState({isEnabled:true,allowInstructions:['Appearance — user text'],blockInstructions:['Ask first — user text']}),[http,setHttp]=React.useState({apiKey:'test-only-key',baseUrl:'https://example.invalid/General',modelId:'Appearance'});
 api={setLanguage,setSection};return <SettingsModalShell language={language} isOpen initialSection={section} onClose={noop} renderSection={s=>s==='general'?<GeneralSettingsPanel account={{kind:'logged-in',name:'Appearance',email:'example@example.invalid'}} theme='system' onAccountAction={()=>calls.push('account')} onThemeChange={x=>calls.push(['theme',x])} onLanguageChange={setLanguage} timeZone={{state:{detectedTimeZone:'Asia/Shanghai',overrideTimeZone:null},onChange:x=>calls.push(['zone',x])}} localToolPermission={{state:{permission:'ask',ceiling:'ask'},onChange:x=>calls.push(['permission',x])}} securityKey={{enabled:false,platform:'darwin',onChange:x=>calls.push(['key',x])}} autoReview={{settings:rules,onChange:x=>{calls.push(['rules',x]);setRules(x)}}}/>:s==='router'?<RouterSettingsPanel provider='openrouter' onChange={x=>calls.push(['provider',x])} http={{...http,onApiKeyChange:apiKey=>setHttp(x=>({...x,apiKey})),onBaseUrlChange:baseUrl=>setHttp(x=>({...x,baseUrl})),onModelIdChange:modelId=>setHttp(x=>({...x,modelId})),onSave:()=>calls.push(['http',http])}} vendorAccounts={{vendors:[{id:'one',label:'Appearance',provider:'openrouter',baseUrl:'https://example.invalid/General',modelId:'Appearance'}],defaultVendorId:'one',onAdd:x=>calls.push(['vendor',x]),onRemove:x=>calls.push(['remove',x]),onMakeDefault:x=>calls.push(['default',x])}}/>:s==='usage'?<UsageSettingsPanel provider='openai'/>:<UpdatesSettingsPanel status={{state:{type:'ready',version:'2.0'},currentTrack:'stable',currentVersion:'1.0'}} availableTracks={['stable','nightly']} computer={{state:{isUpdateBoxPending:false,isResetBoxPending:false,canUpdateBaseline:true,canUpdateBox:true,canResetBox:true,isRebuildBlocked:false,isBoxUpToDate:false,isDevBuild:false,workingAgentNames:[],isUpdateQueued:false},actions:{onUpdateBox:force=>calls.push(['computer-update',force]),onResetBox:()=>calls.push('reset'),queueUpdateWhenIdle:noop,cancelQueuedUpdate:noop}}} autoUpdateWhenIdle={false} onCheck={()=>calls.push('check')} onInstall={()=>calls.push('install')} onSetTrack={x=>calls.push(['track',x])} onSetAutoUpdateWhenIdle={x=>calls.push(['idle-update',x])}/>}/>;
 }
 flushSync(()=>root.render(desktop?<SettingsDesktopSurface bridge={bridge} isOpen onClose={noop}/>:<Fixture/>));
 return {language:x=>flushSync(()=>api.setLanguage(x)),section:x=>flushSync(()=>api.setSection(x)),flush:fn=>flushSync(fn),calls:()=>calls.slice(),readLanguage:x=>readLanguage({language:x}),finishSave:failure=>{failLanguage=failure;saveLanguage();},unmount:()=>flushSync(()=>root.unmount())};
}`;
const built = await build({stdin:{contents:source,resolveDir:process.cwd(),sourcefile:'settings-bilingual-fixture.tsx',loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',globalName:'SettingsBilingualUI',jsx:'automatic',target:'chrome136',loader:{'.css':'empty','.woff2':'empty'},define:{'process.env.NODE_ENV':'"development"'}});
async function rig(t,desktop=false){
 const win=new Window({url:'https://beebot.test'});win.console.timeStamp=()=>{};win.eval(built.outputFiles[0].text);const host=win.document.createElement('main');win.document.body.append(host);
 const ui=win.SettingsBilingualUI,api=ui.mount(host,desktop),calls=api.calls;api.calls=()=>JSON.parse(JSON.stringify(calls()));
 const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setTimeout(resolve,0));};
 const click=async element=>{assert.ok(element,'target control exists');api.flush(()=>element.click());await settle();};
 const byText=text=>[...win.document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
 const input=(node,value)=>{assert.ok(node);api.flush(()=>{Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?win.HTMLTextAreaElement.prototype:win.HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new win.Event('input',{bubbles:true}));});};
 t.after(async()=>{api.unmount();await win.happyDOM.close();});await settle();return {win,doc:win.document,host,api,ui,settle,click,byText,input};
}

test('settings navigation and owned General copy switch in place without changing rules, account data or permissions',async t=>{
 const r=await rig(t),nav=r.doc.querySelector('.sand-settings-nav'),theme=r.doc.querySelector('[aria-label="Theme"]');
 r.api.language('zh');await r.settle();assert.equal(nav,r.doc.querySelector('.sand-settings-nav'));assert.equal(theme,r.doc.querySelector('[aria-label="主题"]'));
 for(const text of ['通用','服务器','路由','用量','更新','外观','跟随系统','时区','在本机执行','每次询问','自动审核','自动审核规则','安全密钥','每次使用都需要你确认','内置安全检查始终有效'])assert.ok(r.doc.body.textContent.includes(text),text);
 assert.ok(r.doc.body.textContent.includes('Appearance — user text'));assert.ok(r.doc.body.textContent.includes('Ask first — user text'));assert.ok(r.doc.body.textContent.includes('example@example.invalid'));
 assert.deepEqual(r.api.calls(),[]);
 await r.click(r.doc.querySelector('[aria-label="在本机执行"]'));const forbidden=[...r.doc.querySelectorAll('[role=option]')].find(x=>x.textContent.includes('始终允许'));assert.equal(forbidden.getAttribute('aria-disabled'),'true');await r.click(forbidden);assert.deepEqual(r.api.calls(),[]);
});

test('rule drafts and an open behavior menu preserve their DOM, selection and stored rule behavior across language changes',async t=>{
 const r=await rig(t),draft=r.doc.querySelector('[aria-label="Auto-review rule draft"]');r.input(draft,'Draft Appearance 保留');draft.focus();draft.setSelectionRange(3,8);
 r.api.language('zh');await r.settle();assert.equal(r.doc.activeElement,draft);assert.equal(draft.value,'Draft Appearance 保留');assert.equal(draft.selectionStart,3);assert.equal(draft.selectionEnd,8);
 await r.click(r.doc.querySelector('[aria-label="规则处理方式"]'));const menu=r.doc.querySelector('[role=listbox]');r.api.language('en');await r.settle();assert.equal(menu,r.doc.querySelector('[role=listbox]'));await r.click([...r.doc.querySelectorAll('[role=option]')].find(x=>x.textContent==='Ask first'));
 await r.click(r.byText('Add Rule'));const result=r.api.calls().find(x=>x[0]==='rules')[1];assert.ok(result.blockInstructions.includes('Draft Appearance 保留'));assert.deepEqual(result.allowInstructions,['Appearance — user text']);
});

test('editing a rule survives language changes and keeps its user-authored content',async t=>{
 const r=await rig(t);await r.click(r.doc.querySelector('[aria-label="Edit rule 1"]'));const editor=r.doc.querySelector('textarea');r.input(editor,'General / Theme / 修改中');editor.focus();editor.setSelectionRange(4,9);
 r.api.language('zh');await r.settle();assert.equal(editor,r.doc.querySelector('textarea'));assert.equal(r.doc.activeElement,editor);assert.equal(editor.value,'General / Theme / 修改中');assert.equal(editor.selectionStart,4);
 await r.click(r.doc.querySelector('[aria-label="保存规则 1"]'));assert.ok(r.api.calls().find(x=>x[0]==='rules')[1].allowInstructions.includes('General / Theme / 修改中'));
});

test('Router copy and vendor edit drafts translate without changing URLs, model IDs, keys or user labels',async t=>{
 const r=await rig(t);r.api.section('router');await r.settle();await r.click(r.byText('Edit'));const name=r.doc.querySelector('[aria-label="Name"]');r.input(name,'General custom vendor');const key=r.doc.querySelector('[aria-label="API key"]');r.input(key,'not-a-real-secret');key.focus();key.setSelectionRange(2,5);
 r.api.language('zh');await r.settle();assert.equal(name,r.doc.querySelector('[aria-label="名称"]'));assert.equal(name.value,'General custom vendor');assert.equal(r.doc.activeElement,key);assert.equal(key.value,'not-a-real-secret');assert.equal(key.selectionStart,2);assert.ok(r.doc.body.textContent.includes('Bot 请求使用的服务'));assert.ok(r.doc.body.textContent.includes('模型 API'));assert.ok(r.doc.body.textContent.includes('Appearance'));assert.deepEqual(r.api.calls(),[]);
 await r.click(r.byText('保存'));const saved=r.api.calls().find(x=>x[0]==='vendor')[1];assert.equal(saved.label,'General custom vendor');assert.equal(saved.apiKey,'not-a-real-secret');assert.equal(saved.baseUrl,'https://example.invalid/General');assert.equal(saved.modelId,'Appearance');
});

test('update UI preserves available actions and translates typed progress while retaining upstream errors verbatim',async t=>{
 const r=await rig(t);r.api.section('beta');r.api.language('zh');await r.settle();for(const text of ['更新通道','稳定版','空闲时自动更新','重启以更新','BeeBot 2.0 已准备就绪'])assert.ok(r.doc.body.textContent.includes(text),text);assert.deepEqual(r.api.calls(),[]);
 await r.click(r.byText('重启以更新'));assert.deepEqual(r.api.calls(),['install']);
 for(const type of ['checking','available','downloading','staging','ready','idle','disabled']){const state={type,version:'General',progress:.25,lastCheck:{result:'error',errorMessage:'Theme raw error'},reason:'not-packaged'},status={state,currentTrack:'stable',currentVersion:'1'};const zh=r.ui.updateStatusMessage(status,'zh'),en=r.ui.updateStatusMessage(status,'en');assert.notEqual(zh.text,en.text);if(['ready','idle'].includes(type)){assert.ok(zh.text.includes('Theme raw error'));assert.equal(zh.tone,'error');}}
 assert.ok(r.ui.egressTunnelStatusDescription({state:'connected',activeStreams:2,relayedStreams:9},'zh').includes('2 个连接'));
});

test('desktop language persistence rejects stale reads, rolls back failures and synchronizes successful changes without rebuilding input',async t=>{
 const r=await rig(t,true);await r.click(r.doc.querySelector('[aria-label="Language"]'));await r.click([...r.doc.querySelectorAll('[role=option]')].find(x=>x.textContent==='中文'));
 const draft=r.doc.querySelector('[aria-label="自动审核规则草稿"]');r.input(draft,'still unsaved');r.api.readLanguage('en');await r.settle();assert.ok(r.doc.querySelector('[aria-label="主题"]'),'late initial read cannot replace the requested language');assert.equal(r.doc.querySelector('[aria-label="语言"]').disabled,true);
 r.api.finishSave(true);await r.settle();assert.equal(draft,r.doc.querySelector('[aria-label="Auto-review rule draft"]'));assert.equal(draft.value,'still unsaved');assert.ok(r.doc.body.textContent.includes('Your previous language has been restored'));
 await r.click(r.doc.querySelector('[aria-label="Language"]'));await r.click([...r.doc.querySelectorAll('[role=option]')].find(x=>x.textContent==='中文'));r.api.finishSave(false);await r.settle();assert.equal(r.win.__sandUiLanguage,'zh');assert.equal(draft,r.doc.querySelector('[aria-label="自动审核规则草稿"]'));assert.equal(draft.value,'still unsaved');assert.deepEqual(r.api.calls(),[['language','zh'],['language','zh']]);
 r.win.__sandUiLanguage='en';r.win.dispatchEvent(new r.win.Event('sand-ui-language-changed'));await r.settle();assert.equal(draft,r.doc.querySelector('[aria-label="Auto-review rule draft"]'));
});


test('computer update confirmation survives a language change without altering the action or forcing an update',async t=>{
 const r=await rig(t);r.api.section('beta');r.api.language('zh');await r.settle();const button=r.doc.querySelector('.sand-settings-reset');assert.equal(button.textContent,'更新');await r.click(button);assert.equal(button.textContent,'再次点击确认');assert.deepEqual(r.api.calls(),[]);
 r.api.language('en');await r.settle();assert.equal(button,r.doc.querySelector('.sand-settings-reset'));assert.equal(button.textContent,'Click Again to Confirm');await r.click(button);assert.deepEqual(r.api.calls(),[['computer-update',false]]);
});

test('saved language initializes navigation and server fallback, and language events keep the mounted fallback node',async t=>{
 const r=await rig(t,true);r.api.readLanguage('zh');await r.settle();assert.equal(r.win.__sandUiLanguage,'zh');await r.click([...r.doc.querySelectorAll('.sand-settings-nav button')].find(b=>b.textContent.includes('服务器')));const fallback=[...r.doc.querySelectorAll('p')].find(p=>p.textContent==='此版本暂不支持服务器连接。');assert.ok(fallback);
 r.win.__sandUiLanguage='en';r.win.dispatchEvent(new r.win.Event('sand-ui-language-changed'));await r.settle();assert.equal(fallback.textContent,'Server connections are not available in this build.');assert.ok(fallback.isConnected);assert.deepEqual(r.api.calls(),[]);
});
