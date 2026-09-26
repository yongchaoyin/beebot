import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {Window} from 'happy-dom';
const source=await readFile(new URL('../scripts/lib/beebot-collaboration-review.snippet.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,70));
function store(value){const subs=new Set();return{get:()=>value,set:next=>{value=next;subs.forEach(fn=>fn());},subscribe:fn=>{subs.add(fn);return()=>subs.delete(fn);}};}
function task(overrides={}){return{id:'work',title:'Check the delivery',criteria:['Meets the request','Result checked'],state:'claimed',version:3,reviewer:'self',assignee:'b',dependencies:[],canReview:false,evidence:[],...overrides};}
async function boot(t){
 const window=new Window({url:'https://beebot.local'});window.__sandUiLanguage='zh';
 window.document.body.innerHTML='<main><div class="messages">Original conversation</div><div class="sand-chat-input-dock"><textarea id="chat">Keep my draft</textarea></div></main>';
 const selected=store({currentAgentId:'room'}),entries=store({entries:[]}),connection=store({transport:'up'}),roster=store({agents:{rows:[{id:'a',name:'Reviewer'},{id:'b',name:'Writer'}]}}),calls=[];
 const polls=new Map();let token=0;const timeout=window.setTimeout.bind(window),clear=window.clearTimeout.bind(window);
 window.setTimeout=(fn,ms)=>ms>=1000?(polls.set(--token,{fn,ms}),token):timeout(fn,ms);
 window.clearTimeout=id=>id<0?polls.delete(id):clear(id);
 let tasks=[task()],get=async({agentId})=>({agentId,tasks,completions:[]});
 const runtime={selection:{snapshots:selected},transcript:{snapshotsFor:()=>entries},connection:{snapshots:connection},roster:{snapshots:roster,getCollaboration:args=>{calls.push(args);return get(args);},reviewCollaboration:()=>assert.fail('panel must never mutate work')}};
 window.runtime=runtime;window.eval(source+';RBindCollaborationReview(window.runtime);');
 t.after(async()=>{window.__beebotCollaborationReview?.dispose();await window.happyDOM.close();});await tick();
 const root=()=>window.document.getElementById('beebot-collaboration-review');
 return{window,root,selected,entries,connection,roster,calls,polls,get:fn=>get=fn,tasks:next=>tasks=next,
  expand:()=>root().querySelector('.bb-work-toggle').click(),
  update:async(next)=>{tasks=next;entries.set({entries:[{id:String(Math.random()),collaborationEvent:{task:{version:next[0]?.version??1}}}]});await tick();},
  poll:async()=>{const [id,value]=polls.entries().next().value;polls.delete(id);value.fn();await tick();}};
}

test('single-Bot and Group progress is read-only, compact and separate from the draft',async t=>{
 const ui=await boot(t);
 for(const room of ['single','group']){
  ui.selected.set({currentAgentId:room});await tick();ui.expand();
  assert.equal(ui.root().parentElement.className,'sand-chat-input-dock');assert.match(ui.root().textContent,/协作.*1 项进行中/);
  assert.equal(ui.root().querySelectorAll('button').length,1,'only the disclosure remains');
  assert.equal(ui.root().querySelector('select,textarea,input'),null);assert.equal(ui.window.document.querySelector('[role="dialog"]'),null);
  assert.doesNotMatch(ui.root().textContent,/Refresh status|刷新状态|Accepted \d|验收通过|待你验收|Closed against/);
  assert.equal(ui.window.document.querySelector('#chat').value,'Keep my draft');assert.match(ui.root().textContent,/Writer/);
 }
});

test('completed work is grouped separately and distinguishes self checks, peers and stale results',async t=>{
 const ui=await boot(t);await ui.update([
  task({id:'self',state:'completed',completedForCurrentInputs:true}),
  task({id:'peer',state:'accepted',acceptedForCurrentInputs:true,reviewer:'a',review:{reviewer:'a'}}),
  task({id:'stale',state:'completed',completedForCurrentInputs:false}),
  task({id:'legacy',state:'review',reviewer:'user',canReview:true}),
 ]);ui.expand();
 assert.equal(ui.root().querySelector('.bb-work-count').textContent,'2 项进行中 · 2 项已完成');
 const finished=ui.root().querySelector('.bb-work-finished');assert.equal(finished.open,false);assert.equal(finished.querySelectorAll('article').length,2);
 assert.match(finished.textContent,/负责人已自查/);assert.match(finished.textContent,/Reviewer 已核对/);
 assert.match(ui.root().textContent,/需要重新核对/);assert.match(ui.root().textContent,/成果待核对/);assert.doesNotMatch(ui.root().textContent,/待你验收/);
});

test('blocked reasons, dependencies and safe result previews explain progress without technical receipts',async t=>{
 const ui=await boot(t);await ui.update([
  task({id:'first',title:'Research',state:'blocked',reason:'Need the original document'}),
  task({id:'next',dependencies:['first'],state:'waiting',evidence:[{available:true,text:'<img src=x onerror="window.bad=1"> Result text',files:[{sha256:'a'.repeat(64),bytes:12}]}]}),
 ]);ui.expand();
 assert.match(ui.root().textContent,/Need the original document/);assert.match(ui.root().textContent,/等待：Research/);assert.match(ui.root().textContent,/Result text/);
 assert.equal(ui.root().querySelector('img,script'),null);assert.equal(ui.window.bad,undefined);assert.doesNotMatch(ui.root().textContent,/SHA-256|v3/);
 assert.match(ui.root().textContent,/Meets the request/);
});

test('updates and language changes retain open result details, focused disclosure and conversation draft',async t=>{
 const ui=await boot(t);ui.expand();const details=ui.root().querySelector('article details'),summary=details.querySelector('summary');details.open=true;summary.focus();
 await ui.update([task({version:4,state:'review'})]);ui.window.__sandUiLanguage='en';ui.window.dispatchEvent(new ui.window.Event('sand-ui-language-changed'));
 assert.equal(ui.root().querySelector('article details'),details);assert.equal(details.open,true);assert.equal(ui.window.document.activeElement,summary);
 assert.match(ui.root().textContent,/Collaboration/);assert.match(ui.root().textContent,/Checking needed/);assert.equal(ui.window.document.querySelector('#chat').value,'Keep my draft');
});

test('automatic read refresh recovers after a failure without user action or a mutation',async t=>{
 const ui=await boot(t);ui.get(async()=>{throw Error('private server details');});await ui.poll();
 assert.match(ui.root().textContent,/暂时无法更新/);assert.equal(ui.root().textContent.includes('private server details'),false);
 assert.equal([...ui.polls.values()][0].ms,3000);
 ui.get(async({agentId})=>({agentId,tasks:[task({state:'completed',completedForCurrentInputs:true})]}));await ui.poll();
 assert.match(ui.root().textContent,/1 项已完成/);assert.doesNotMatch(ui.root().textContent,/暂时无法更新/);assert.equal([...ui.polls.values()][0].ms,15000);
});

test('disconnect retains last confirmed work and cancels late reads until reconnect',async t=>{
 const ui=await boot(t),gate=Promise.withResolvers();ui.get(()=>gate.promise);const pending=ui.poll();
 ui.connection.set({transport:'down'});gate.resolve({agentId:'room',tasks:[task({title:'Late private result'})]});await pending;
 assert.match(ui.root().textContent,/连接中断/);assert.doesNotMatch(ui.root().textContent,/Late private result/);assert.equal(ui.polls.size,0);
 ui.get(async({agentId})=>({agentId,tasks:[task({title:'Reconnected'})]}));ui.connection.set({transport:'up'});await tick();assert.match(ui.root().textContent,/Reconnected/);
});

test('late snapshots cannot overwrite another chat, remote view or a newer task version',async t=>{
 const ui=await boot(t),gate=Promise.withResolvers();ui.get(()=>gate.promise);const pending=ui.poll();
 ui.selected.set({currentAgentId:'other'});ui.get(async({agentId})=>({agentId,tasks:[task({title:'New conversation'})]}));await tick();
 gate.resolve({agentId:'room',tasks:[task({title:'Old conversation'})]});await pending;assert.match(ui.root().textContent,/New conversation/);assert.doesNotMatch(ui.root().textContent,/Old conversation/);
 ui.window.document.body.dataset.beebotRemoteActive='true';ui.window.dispatchEvent(new ui.window.Event('beebot-node-selection'));assert.equal(ui.root().hidden,true);assert.equal(ui.polls.size,0);
 delete ui.window.document.body.dataset.beebotRemoteActive;ui.window.dispatchEvent(new ui.window.Event('beebot-node-selection'));await tick();assert.equal(ui.root().hidden,false);
});

test('malformed snapshots keep known progress and never expose a fake completed result',async t=>{
 const ui=await boot(t);ui.get(async({agentId})=>({agentId,tasks:[{}]}));await ui.poll();
 assert.match(ui.root().textContent,/暂时无法更新/);assert.match(ui.root().textContent,/Check the delivery/);
 ui.get(async({agentId})=>({agentId,tasks:[task(),task()]}));await ui.poll();assert.equal(ui.root().querySelectorAll('article').length,1);
});

test('hidden documents pause automatic reads and dispose releases all timers and subscriptions',async t=>{
 const ui=await boot(t);Object.defineProperty(ui.window.document,'visibilityState',{value:'hidden',configurable:true});ui.window.document.dispatchEvent(new ui.window.Event('visibilitychange'));assert.equal(ui.polls.size,0);
 Object.defineProperty(ui.window.document,'visibilityState',{value:'visible',configurable:true});ui.window.document.dispatchEvent(new ui.window.Event('visibilitychange'));await tick();assert.equal(ui.polls.size,1);
 const calls=ui.calls.length;ui.window.__beebotCollaborationReview.dispose();assert.equal(ui.polls.size,0);assert.equal(ui.root(),null);
 ui.entries.set({entries:[]});await tick();assert.equal(ui.calls.length,calls);
});

test('ordinary dialogue with no recorded work adds no progress surface',async t=>{
 const ui=await boot(t);await ui.update([]);assert.equal(ui.root().hidden,true);assert.equal(ui.window.document.querySelector('#chat').value,'Keep my draft');
});

test('new blockers move first without losing detail focus and dependency labels track upstream changes',async t=>{
 const ui=await boot(t);await ui.update([task({id:'first',title:'Old source'}),task({id:'second',title:'Downstream',dependencies:['first']})]);ui.expand();
 const cards=[...ui.root().querySelectorAll('article')],details=cards[1].querySelector('details');details.open=true;const summary=details.querySelector('summary');summary.focus();
 await ui.update([task({id:'first',title:'Renamed source',version:4}),task({id:'second',title:'Downstream',state:'blocked',dependencies:['first']})]);
 assert.equal(ui.root().querySelector('article h3').textContent,'Downstream');assert.match(ui.root().querySelector('article').textContent,/Renamed source/);
 assert.doesNotMatch(ui.root().textContent,/Old source/);assert.equal(ui.window.document.activeElement,summary);assert.equal(details.open,true);
});

test('a completed record with unavailable result evidence is shown as needing another check',async t=>{
 const ui=await boot(t);await ui.update([task({state:'completed',completedForCurrentInputs:true,evidence:[{available:false,text:'',files:[]}]})]);ui.expand();
 assert.equal(ui.root().querySelector('.bb-work-finished').hidden,true);assert.match(ui.root().textContent,/需要重新核对/);assert.match(ui.root().textContent,/成果目前不可用/);
});

test('native panel disclosure keys do not reach the actual pinned type-anywhere composer handler',async t=>{
 const ui=await boot(t);ui.expand();
 const pinned=await readFile(new URL('../src/app/dist/renderer/assets/index-UbX-y3il.js',import.meta.url),'utf8');
 const start=pinned.indexOf('function fne(n){'),end=pinned.indexOf('function r9n(',start);
 assert.ok(start>=0&&end>start,'use the actual shipped editing-target and type-anywhere functions');
 const draft=ui.window.document.querySelector('#chat');
 const ref={current:null},chain={focus(){draft.focus();return chain;},insertContent(key){draft.value+=key;return chain;},run(){}};
 ui.window.__keyHarness={ref,he:{c:()=>[]},S:{useRef:()=>ref},editor:{chain:()=>chain}};
 ui.window.eval(`(()=>{const {he,S,editor}=window.__keyHarness;const _m=()=>editor;${pinned.slice(start,end)};s9n({current:{}},false)(document.body);})()`);
 t.after(()=>ref.current?.());
 const press=(target,key,modifiers={})=>{target.focus();const event=new ui.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...modifiers});target.dispatchEvent(event);return event;};
 const outside=ui.window.document.createElement('summary');outside.textContent='Outside panel';ui.window.document.body.append(outside);
 assert.equal(press(outside,' ').defaultPrevented,true,'the original handler reproduces the native composer-stealing bug');
 assert.equal(draft.value,'Keep my draft ');draft.value='Keep my draft';outside.remove();
 for(const summary of ui.root().querySelectorAll('summary'))for(const key of [' ','Enter']){
   const event=press(summary,key);
   assert.equal(event.defaultPrevented,false,'native disclosure activation remains enabled');
   assert.equal(ui.window.document.activeElement,summary);assert.equal(draft.value,'Keep my draft');
 }
 const bubbled=[];ui.window.document.addEventListener('keydown',event=>bubbled.push(event.key));
 const summary=ui.root().querySelector('summary');press(summary,'Tab');press(summary,'c',{metaKey:true});
 assert.deepEqual(bubbled,['Tab','c'],'navigation and app shortcuts keep propagating');
 press(ui.window.document.body,'x');assert.equal(draft.value,'Keep my draftx','typing elsewhere retains the shipped composer behavior');
});
