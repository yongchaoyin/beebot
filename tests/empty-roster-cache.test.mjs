import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import test from 'node:test';
import {parse} from 'acorn';
import {patchOriginalLanding} from '../scripts/lib/router-renderer-patch.mjs';

// Execute the actual shipped roster/selection/cache logic. Only the transport,
// persistence registry and unrelated model-catalog service are controlled here.
const source=patchOriginalLanding(await readFile(new URL('../src/app/dist/renderer/assets/index-UbX-y3il.js',import.meta.url),'utf8'));
const functions=new Map(),constants=new Map(),classes=new Map();
for(const node of parse(source,{ecmaVersion:'latest',sourceType:'module'}).body){
  if(node.type==='FunctionDeclaration')functions.set(node.id.name,source.slice(node.start,node.end));
  if(node.type==='ClassDeclaration')classes.set(node.id.name,source.slice(node.start,node.end));
  if(node.type==='VariableDeclaration')for(const item of node.declarations)constants.set(item.id.name,source.slice(item.start,item.end));
}
const pick=(map,names,prefix='')=>names.map(name=>{assert.ok(map.has(name),`actual pinned ${name}`);return prefix+map.get(name)+(prefix?';':'')}).join('\n');
const runtime=new Function(`
${pick(constants,['oKe','QUn','eHn','aKe','GUn','WUn','KUn','Ihe','fHn','gne','VUn','r9e','EBe'],'const ')}
${pick(classes,['K0t','rne'])}
${pick(functions,['Dn','NBe','xBe','EMt','CMt','IMt','AMt','gie','PMt','G0t','W0t','cKe','Ppe','Mpe','lKe','tHn','nHn','sHn','rHn','Y0t','YUn','ZUn','XUn','hHn'])}
const oHn=()=>({snapshots:Dn([]),reconcileDefaultModel(){},connect(){},noteReconnect(){},noteWindowFocus(){},reset(){},dispose(){}});
class wn extends Error{};
return{createRoster:hHn,createSelection:PMt,createCache:rHn};`)();
const currentAgent=new Function('Qe','es',`${functions.get('SNe')};return SNe;`);
const clone=value=>structuredClone(value);
const row=(id,{name='Grok',isGroup=false}={})=>({id,name,description:'Synthetic colleague',title:'',avatarShape:'cloud',avatarColor:'green',avatarVersion:null,avatarDataUrl:null,createdAt:1,updatedAt:2,path:`/synthetic/${id}`,lastEntry:null,lastMessageId:null,hasUnread:false,awaitingUserResponse:null,notificationsEnabled:true,notifyOnUpdatesEnabled:false,origin:'local',isGroup,memberIds:isGroup?['member-a','member-b']:[],conversationPartnerIds:[]});
function registry(){
  const disk=new Map(),writes=[];let readHook;
  return{disk,writes,setReadHook(hook){readHook=hook},register(descriptor){
    const key=slot=>`${slot}:${descriptor.slice}`;
    return{async read(slot){const bytes=disk.get(key(slot));const result=bytes==null?{kind:'absent'}:{kind:'envelope',envelope:JSON.parse(bytes),receipt:{classify(){}}};return readHook?readHook(descriptor,slot,result):result},async write({accountSlot,value}){disk.set(key(accountSlot),JSON.stringify({schemaVersion:descriptor.schemaVersion,value}));writes.push({slice:descriptor.slice,value:clone(value)})},async clear(slot){disk.delete(key(slot))}};
  }};
}
async function seed(storage,rows){const cache=runtime.createCache({registry:storage});await cache.restore('fixture-account');cache.write(rows);await setImmediate();cache.dispose()}
async function fixture(t,{storage=registry(),list=async()=>[]}={}){
  const roster=runtime.createRoster({registry:storage,source:{listAgents:list,getAgentAvatar:async()=>({dataUrl:null,version:null})},desktop:{getAgentDefaultModel:async()=>null}});
  const selection=runtime.createSelection({registry:storage,roster:roster.snapshots,openAgent:async()=>{},beginOptimisticMarkReadOnOpen:()=>null});
  const project=currentAgent(()=>({roster,selection}),store=>store.get());
  t.after(()=>{selection.dispose();roster.dispose()});
  await selection.restore('fixture-account');
  return{roster,selection,project,storage,snapshot:()=>roster.snapshots.get()};
}
function accepted(roster,predicate){const snapshots=roster.snapshots;if(predicate(snapshots.get()))return Promise.resolve();return new Promise(resolve=>{const stop=snapshots.subscribe(()=>{if(predicate(snapshots.get())){stop();resolve()}})})}
const savedRows=storage=>JSON.parse(storage.disk.get('fixture-account:roster.last-roster')).value.rows;

// Render the actual final language-adapted local route with real React/compiler
// hooks. Transcript/context and composer contents are controlled leaf fixtures.
const {build}=await import('esbuild');
const {Window}=await import('happy-dom');
const {brandProductLiterals}=await import('../scripts/lib/product-branding.mjs');
const {patchUiLanguageRenderer,uiLanguageBindings}=await import('../scripts/lib/ui-language-renderer-patch.mjs');
const branded=brandProductLiterals(source).source;
const translated=patchUiLanguageRenderer(branded,uiLanguageBindings(branded,'index-UbX-y3il.js')).source;
const uiFunctions=new Map(parse(translated,{ecmaVersion:'latest',sourceType:'module'}).body.filter(node=>node.type==='FunctionDeclaration').map(node=>[node.id.name,translated.slice(node.start,node.end)]));
const uiRuntime=patchUiLanguageRenderer('',{main:true}).source;
const uiBundle=await build({bundle:true,write:false,platform:'browser',format:'iife',globalName:'EmptyRosterUI',define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent',stdin:{resolveDir:process.cwd(),loader:'js',contents:`
import * as S from'react';import * as p from'react/jsx-runtime';import * as he from'react/compiler-runtime';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
${uiRuntime}
const re=(...values)=>values.filter(Boolean).join(' '),aht=({children})=>children,q6n=({children})=>children,BLn=()=>null;
${uiFunctions.get('qLn')}
${uiFunctions.get('RLocalChatLayout')}
let observed;const originalLayout=RLocalChatLayout;RLocalChatLayout=props=>{observed=props;return p.jsx(originalLayout,props)};
export function mount(host){const root=createRoot(host),entries=[],header=p.jsx('header',{'data-fixture-header':true,children:'General 用户原文'}),trays=p.jsx('div',{'data-fixture-trays':true});let last;
 const render=mode=>{last={isChatActive:mode==='single'||mode==='group',isNewChatOpen:mode==='new-chat',isNewAgentOpen:mode==='new-agent',isNewChatPreviewActive:false,isReadOnlyExchange:false,isCurrentGroup:mode==='group',surface:'transcript',entries,chatHeader:header,trays,heroComposer:p.jsx('textarea',{'data-composer':'hero'}),composer:p.jsx('textarea',{'data-composer':'existing',defaultValue:mode}),newChatComposer:p.jsx('textarea',{'data-composer':'new-chat'}),newAgentPane:p.jsx('section',{'data-management':'new-agent',children:'Create explicit Bot'}),renderTranscriptBoundary:children=>children,transcript:p.jsx('p',{'data-transcript':true,children:'Synthetic conversation'})};flushSync(()=>root.render(p.jsx(qLn,last)))};
 return{render,observed:()=>observed,last:()=>last,unmount:()=>flushSync(()=>root.unmount())};}
`}});
const settle=async window=>{await Promise.resolve();await setImmediate();await window.happyDOM.whenAsyncComplete()};
async function uiFixture(t){const window=new Window({url:'https://beebot.test',settings:{enableJavaScriptEvaluation:true}});window.console.timeStamp=()=>{};const errors=[];window.addEventListener('error',event=>errors.push(event.message));window.desktop={agent:{getUiLanguage:async()=>({language:'en'}),setUiLanguage:async language=>({language})}};window.__beebotNodeChat={subscribe:()=>()=>{},getSnapshot:()=>({active:false})};window.document.body.innerHTML='<main></main>';window.eval(uiBundle.outputFiles[0].text+';window.EmptyRosterUI=EmptyRosterUI');const host=window.document.querySelector('main'),app=window.EmptyRosterUI.mount(host);t.after(async()=>{app.unmount();await window.happyDOM.close()});return{window,host,app,errors}}


test('actual pinned cold start accepts and persists authoritative [] without inventing a Bot',{timeout:3000},async t=>{
  const f=await fixture(t);await f.roster.restore('fixture-account');assert.equal(f.project(),null);
  const ready=accepted(f.roster,s=>s.hasCompleteRoster);f.roster.connect();await ready;await setImmediate();
  assert.equal(f.snapshot().loadState,'ready');assert.deepEqual(f.snapshot().agents,{selectedId:null,rows:[]});assert.equal(f.selection.readCurrentAgentId(),null);assert.deepEqual(savedRows(f.storage),[]);
});
for(const isGroup of[false,true])test(`actual pinned deletion of final ${isGroup?'Group':'individual Bot'} clears selection and restart cache`,{timeout:3000},async t=>{
  const f=await fixture(t),agent=row(isGroup?'group':'single',{isGroup});await f.roster.restore('fixture-account');
  f.roster.ingestAgentsEvent({agents:[agent],activeAgentId:agent.id});assert.equal(f.project().id,agent.id);await setImmediate();assert.equal(savedRows(f.storage).length,1);
  f.roster.ingestAgentsEvent({agents:[],activeAgentId:''});await setImmediate();
  assert.deepEqual(f.snapshot().agents,{selectedId:null,rows:[]});assert.equal(f.snapshot().isShowingRestoredRoster,false);assert.equal(f.selection.readCurrentAgentId(),null);assert.equal(f.project(),null);assert.deepEqual(savedRows(f.storage),[]);
  const fresh=runtime.createCache({registry:f.storage});t.after(()=>fresh.dispose());assert.deepEqual(await fresh.restore('fixture-account'),[]);
  const restarted=await fixture(t,{storage:f.storage});await restarted.roster.restore('fixture-account');assert.equal(restarted.project(),null);assert.deepEqual(restarted.snapshot().agents.rows,[]);
});
test('host [] supersedes a historical restored Grok and remains empty after reconnect',{timeout:3000},async t=>{
  const storage=registry();await seed(storage,[row('old-default')]);const f=await fixture(t,{storage});await f.roster.restore('fixture-account');
  assert.equal(f.snapshot().isShowingRestoredRoster,true);assert.equal(f.snapshot().agents.rows[0].name,'Grok');
  const ready=accepted(f.roster,s=>s.hasCompleteRoster);f.roster.connect();await ready;await setImmediate();assert.equal(f.project(),null);assert.equal(f.snapshot().isShowingRestoredRoster,false);assert.deepEqual(savedRows(storage),[]);
  const before=f.snapshot().confirmedFetches,refreshed=accepted(f.roster,s=>s.confirmedFetches>before);f.roster.noteReconnect();await refreshed;assert.equal(f.project(),null);assert.deepEqual(f.snapshot().agents.rows,[]);
});
test('actual ordered complete empty snapshot rejects a stale pre-deletion snapshot',{timeout:3000},async t=>{
  const f=await fixture(t);await f.roster.restore('fixture-account');const agent=row('deleted');
  const event=(sequence,agents,activeAgentId)=>({agents,activeAgentId,ordered:{replicaKey:'roster',epoch:'fixture-epoch',sequence},coverage:{kind:'complete-roster'}});
  f.roster.ingestAgentsEvent(event(1,[agent],agent.id));assert.equal(f.project().id,agent.id);
  f.roster.ingestAgentsEvent(event(2,[],''));f.roster.ingestAgentsEvent(event(1,[agent],agent.id));await setImmediate();
  assert.equal(f.project(),null);assert.deepEqual(f.snapshot().agents.rows,[]);assert.deepEqual(savedRows(f.storage),[]);
});
test('a late historical cache restore cannot resurrect rows after authoritative empty event',{timeout:3000},async t=>{
  const storage=registry();await seed(storage,[row('old-default')]);const started=Promise.withResolvers(),release=Promise.withResolvers();t.after(()=>release.resolve());
  storage.setReadHook(async(descriptor,slot,result)=>{if(descriptor.slice==='roster.last-roster'){started.resolve();await release.promise}return result});
  const f=await fixture(t,{storage});const restoring=f.roster.restore('fixture-account');await started.promise;
  f.roster.ingestAgentsEvent({agents:[],activeAgentId:''});release.resolve();await restoring;await setImmediate();
  assert.equal(f.snapshot().hasCompleteRoster,true);assert.equal(f.snapshot().isShowingRestoredRoster,false);assert.equal(f.project(),null);assert.deepEqual(savedRows(storage),[]);
});
test('actual selected-agent projection cannot show a deleted Bot even during a pending selection',{timeout:3000},async t=>{
  const f=await fixture(t);f.roster.ingestAgentsEvent({agents:[],activeAgentId:''});f.selection.snapshots.set({currentAgentId:'old-default',isLoadPending:true});
  assert.equal(f.project(),null,'the selected ID must still resolve to an actual current roster row');
});

test('actual empty local route has no composer or placeholder avatar and switches Chinese/English while retaining trays',async t=>{
  const {window,host,app,errors}=await uiFixture(t);app.render('empty');await settle(window);
  const trays=host.querySelector('[data-fixture-trays]');
  for(const language of['zh','en','zh']){await window.__beebotUiLanguage.set(language);await settle(window);assert.equal(host.querySelector('.sand-empty p')?.textContent,language==='zh'?'还没有聊天':'No chats yet');assert.equal(host.querySelector('textarea,[contenteditable="true"]'),null);assert.equal(host.querySelector('[data-fixture-header],.sand-chat-header__avatar-placeholder'),null);assert.equal(host.querySelector('[data-fixture-trays]'),trays)}
  assert.deepEqual(errors,[]);
});
test('actual wrapper preserves explicit New chat/New Bot routes and existing individual/Group conversation props',async t=>{
  const {window,host,app,errors}=await uiFixture(t);
  for(const mode of['new-chat','new-agent','single','group','empty','single','empty']){app.render(mode);await settle(window);const observed=app.observed(),last=app.last();
    for(const key of Object.keys(last))if(mode!=='empty'||!['heroComposer','chatHeader'].includes(key))assert.equal(observed[key],last[key],`${mode} forwards ${key}`);
    assert.equal(host.querySelectorAll('.sand-empty').length,mode==='empty'?1:0);
    assert.equal(host.querySelector('[data-management="new-agent"]')!=null,mode==='new-agent');
    assert.equal(host.querySelector('[data-composer="new-chat"]')!=null,mode==='new-chat');
    assert.equal(host.querySelector('[data-composer="existing"]')!=null,mode==='single'||mode==='group');
    assert.equal(host.querySelector('[data-composer="hero"]'),null);
  }
  assert.deepEqual(errors,[]);
});
test('actual wrapper keeps active remote Node route separate from local empty handling',()=>{
  const window={__beebotNodeChat:{subscribe(){},getSnapshot:()=>({active:true})}};
  const S={useSyncExternalStore:(subscribe,get)=>get(),useRef:()=>({current:null}),useEffect(){},createElement:(type,props)=>({type,props})};
  // The async module effect is intentionally not run in this descriptor check;
  // Node chat itself has dedicated functional tests. Inspect actual return here.
  const remote=functions.get('qLn');
  const executable=remote.replace('import.meta.url','"https://beebot.test/fixture.js"');
  assert.equal(remote.split('import.meta.url').length,2,'only module URL is adapted for Function evaluation');
  const route=new Function('S','window','RLocalChatLayout',`${executable};return qLn;`)(S,window,()=>assert.fail('remote route cannot render local empty view'));
  const result=route({isChatActive:false,isNewChatOpen:false,isNewAgentOpen:false});assert.equal(result.type,'div');assert.equal(result.props.id,'beebot-node-chat');assert.equal(result.props.children,undefined);
});
