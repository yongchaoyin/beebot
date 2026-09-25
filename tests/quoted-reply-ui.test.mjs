import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { quotedUIFixture } from './helpers/quoted-ui-fixture.mjs';
import { patchQuotedReplies } from '../scripts/lib/quoted-reply-patch.mjs';
const tick=()=>new Promise(r=>setTimeout(r,15));
const assignment={id:'assignment',kind:'send-message',author:{id:'a',name:'BotA'},message:{type:'text',content:'@BotB 修改输入框，保持原来的风格。'}};
async function setup(t,record=assignment){
 const window=new Window({url:'https://beebot.local/quoted-replies'});window.__sandUiLanguage='zh';
 // happy-dom omits this optional browser profiling API used by React development builds.
 window.console.timeStamp=()=>{};
 window.document.body.innerHTML='<main><article data-entry-id="assignment">原始派活消息</article><section id="quote"></section><textarea aria-label="聊天输入">保留我的草稿</textarea></main>';
 window.eval(await quotedUIFixture());window.quoteFixture.mount(window.document.getElementById('quote'),record);await tick();
 t.after(async()=>{window.quoteFixture.dispose();await window.happyDOM.close()});
 return{window,document:window.document,api:window.quoteFixture,quote:()=>window.document.querySelector('.bb-quoted-reply'),composer:()=>window.document.querySelector('.bb-composer-quote')};
}
test('actual packaged quote shows author and original message inline with no hover popup',async t=>{
 const ui=await setup(t);assert.match(ui.quote().textContent,/BotA.*修改输入框/);assert.match(ui.composer().getAttribute('aria-label'),/回复 BotA/);assert.match(ui.composer().textContent,/BotA：/);
 ui.quote().dispatchEvent(new ui.window.MouseEvent('mouseenter',{bubbles:true}));ui.quote().focus();await tick();
 assert.equal(ui.document.querySelector('[role=tooltip],[role=dialog]'),null);
 ui.quote().click();await tick();assert.deepEqual(JSON.parse(JSON.stringify(ui.api.calls)),[['quote','group','assignment']]);
 assert.equal(ui.document.querySelector('[data-entry-id=assignment]').getAttribute('data-located'),'true');assert.equal(ui.document.querySelector('textarea').value,'保留我的草稿');
});
test('composer cancellation removes only the quote and keeps unrelated typing',async t=>{
 const ui=await setup(t);const input=ui.document.querySelector('textarea');input.focus();input.value+='，继续说';
 ui.composer().querySelector('button').click();await tick();assert.equal(ui.composer(),null);assert.equal(input.value,'保留我的草稿，继续说');
 assert.equal(ui.api.calls[0][0],'clear');assert.equal(ui.api.calls.length,1);
});
test('language changes preserve quote target, focused node and draft',async t=>{
 const ui=await setup(t);const original=ui.quote();original.focus();
 ui.window.__sandUiLanguage='en';ui.window.dispatchEvent(new ui.window.Event('sand-ui-language-changed'));await tick();
 assert.equal(ui.quote(),original);assert.equal(ui.document.activeElement,original);assert.match(ui.composer().getAttribute('aria-label'),/Reply to BotA/);
 assert.equal(original.dataset.replyTargetId,'assignment');assert.equal(ui.document.querySelector('textarea').value,'保留我的草稿');
});
test('unavailable originals remain visible and retryable, never mislabeled deleted',async t=>{
 const ui=await setup(t);ui.api.remove();await tick();assert.match(ui.quote().textContent,/暂不可用/);assert.doesNotMatch(ui.quote().textContent,/deleted|已删除/);
 ui.api.navigate(()=>false);ui.quote().click();await tick();assert.match(ui.document.querySelector('.bb-quote-feedback').textContent,/引用关系仍保留/);assert.equal(ui.api.calls.length,1);
 ui.api.update(assignment);await tick();assert.match(ui.quote().textContent,/BotA/);assert.equal(ui.document.querySelector('.bb-quote-feedback').textContent,'');
});
test('late navigation failure after switching conversations cannot leak feedback or steal draft',async t=>{
 const ui=await setup(t);let reject;ui.api.navigate(()=>new Promise((_,no)=>{reject=no}));ui.api.remove();await tick();ui.quote().click();await tick();
 ui.api.switchChat('single');await tick();reject(new Error('private details'));await tick();
 assert.equal(ui.document.querySelector('.bb-quote-feedback').textContent,'');assert.equal(ui.document.body.textContent.includes('private details'),false);assert.equal(ui.document.querySelector('textarea').value,'保留我的草稿');
});
test('files, images and untrusted author strings are text, not executable preview resources',async t=>{
 const ui=await setup(t,{id:'assignment',kind:'send-message',author:{name:'<img src=x onerror=window.bad=1>'},message:{type:'attachment',file_name:'版本一<script>.md',url:'file:///private/snapshot-1.md'}});
 assert.match(ui.quote().textContent,/版本一/);assert.equal(ui.quote().querySelector('img,script'),null);assert.equal(ui.window.bad,undefined);
 ui.api.update({...assignment,message:{type:'attachment',url:'https://untrusted.invalid/photo.png'}});await tick();assert.match(ui.quote().textContent,/图片/);assert.equal(ui.document.querySelector('img'),null);
 assert.equal(ui.api.preview({...assignment,message:{type:'secret_request',prompt:'secret'}}).kind,'missing');
 for (const entry of [{kind:'message',content:{}},{kind:'user-attachment',file_path:null},{...assignment,message:{type:'attachment',url:{}}}]) assert.equal(ui.api.preview(entry).kind,'missing');
});
test('single Bot uses the same original-user quote presentation',async t=>{
 const ui=await setup(t,{id:'assignment',kind:'message',role:'user',content:'第一件工作'});assert.match(ui.quote().textContent,/你.*第一件/);assert.match(ui.composer().getAttribute('aria-label'),/回复 你/);
 ui.api.changeTarget({id:'second',kind:'message',role:'user',content:'第二件工作'});await tick();assert.equal(ui.quote().dataset.replyTargetId,'second');assert.doesNotMatch(ui.composer().textContent,/第一件/);
});
test('explicit message reference links use inline quotes, not inherited hover dialogs',async t=>{
 const ui=await setup(t);ui.api.mode('link');await tick();ui.quote().click();await tick();assert.equal(ui.api.calls[0][0],'quote');assert.equal(ui.document.querySelector('[role=tooltip],[role=dialog]'),null);
});
test('pinned production navigation has a separate current-room route and rejects drift',()=>{
 const source=readFileSync(new URL('../src/app/dist/renderer/assets/index-UbX-y3il.js',import.meta.url),'utf8');const patched=patchQuotedReplies(source);
 assert.match(patched,/revealQuotedEntry:e\.revealQuotedEntry/);assert.match(patched,/De\.quoted===true\?oe\(De.entryId\):Pe/);
 assert.throws(()=>patchQuotedReplies(source.replace('function pCn(n){','function changedQuote(n){')),/anchor|mismatch/);
});
const loadTs=async name=>{const code=buildSync({entryPoints:[new URL('../frontend/src/recovered/features/conversation/workspace/'+name,import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'}).outputFiles[0].text;return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))};
test('quote navigation loads earlier pages and reveals original in the same conversation',async()=>{
 const {locateQuotedMessage}=await loadTs('quoted-message-navigation.ts');let data={scope:'account:group',entries:[{id:'new'}],hasOlder:true},loads=0;const jumps=[];
 assert.equal(await locateQuotedMessage({targetId:'old',snapshot:()=>data,loadOlder:async()=>{loads++;data={...data,entries:[{id:'old'},...data.entries]}},reveal:id=>{jumps.push(id);return true}}),true);
 assert.equal(loads,1);assert.deepEqual(jumps,['old']);
});
test('history navigation stops on scope changes, exhausted or non-progressing pages',async()=>{
 const {locateQuotedMessage}=await loadTs('quoted-message-navigation.ts');let scope='one',calls=0;
 assert.equal(await locateQuotedMessage({targetId:'missing',snapshot:()=>({scope,entries:[],hasOlder:true}),loadOlder:async()=>{scope='two'},reveal:()=>{calls++;return true}}),false);assert.equal(calls,0);
 let pages=0;assert.equal(await locateQuotedMessage({targetId:'missing',snapshot:()=>({scope:'one',entries:[],hasOlder:true}),loadOlder:async()=>{pages++},reveal:()=>true}),false);assert.equal(pages,1);
});
test('readable reply controller retains author and never focuses composer when reading a quote',async()=>{
 const {createReplyThreadController}=await loadTs('reply-thread-controller.ts');let focus=0;
 const control=createReplyThreadController({scope:{accountSlot:'account',agentId:'group'},onRestoreFocus:()=>focus++});
 control.replaceEntries([{kind:'message',id:'assignment',role:'assistant',author:'BotA',text:'负责输入框',timestampMs:1}]);
 assert.equal(control.resolve('assignment').preview.author,'BotA');control.navigate('assignment');assert.equal(focus,0);
 control.selectReply('assignment');control.setScope({accountSlot:'account',agentId:'other'});assert.equal(control.getSelection(),null);assert.equal(control.resolve('assignment').status,'missing');
});

test('restored quoted drafts retain their exact submission target and cancel clears only the quote',async()=>{
 const {createReplyThreadController}=await loadTs('reply-thread-controller.ts');
 const controller=createReplyThreadController({scope:{accountSlot:'owner',agentId:'group'}});
 const restored={prompt:'我继续回答这件事',attachments:[],replyToId:'original-old-message'};
 const submit=draft=>controller.projectSubmission({agentId:'group',nonce:'n',createdAtMs:1,...draft});
 assert.equal(controller.getSelection(),null);assert.equal(submit(restored).replyToId,'original-old-message');
 const cleared=controller.clearReplyFromDraft(restored);
 assert.equal(submit(cleared).replyToId,undefined);assert.equal(cleared.prompt,restored.prompt);
 controller.setScope({accountSlot:'owner',agentId:'other-group'});
 assert.equal(submit(restored).replyToId,undefined);
 controller.dispose();assert.equal(submit(restored).replyToId,undefined);
});

test('original history paging preserves the quote-only navigation marker on every page',()=>{
 const source=readFileSync(new URL('../src/app/dist/renderer/assets/index-UbX-y3il.js',import.meta.url),'utf8');
 const start=source.indexOf('function vOn('),end=source.indexOf('function bOn(',start);
 const decide=Function('const wOn=30000,kOn=12;'+source.slice(start,end)+';return vOn')();
 const request={agentId:'group',fromAgentId:'group',entryId:'older-assignment',pagesRequested:1,parkedAtMs:1,quoted:true};
 const next=decide(request,{currentAgentId:'group',nowMs:2,isEntryInWindow:false,isWindowLoading:false,hasOlderHistory:true,isLoadingOlderHistory:false});
 assert.equal(next.kind,'load-older');assert.equal(next.requested.quoted,true);assert.equal(next.requested.pagesRequested,2);
 assert.equal(decide(next.requested,{currentAgentId:'group',nowMs:3,isEntryInWindow:true,isRevealSurfaceReady:false}).kind,'wait');
 assert.equal(decide(next.requested,{currentAgentId:'other-group',nowMs:3}).kind,'drop');
});


test('shipped quote is below the reply bubble, never inside it or above it', async t => {
 const ui=await setup(t);ui.api.mode('message');await tick();
 const block=ui.document.querySelector('.sand-message-block');
 const bubble=block.querySelector('.sand-message'),wrap=block.querySelector('.bb-quote-wrap');
 assert.ok(bubble);assert.ok(wrap);assert.equal(block.children[0],bubble);assert.equal(block.children[1],wrap);
 assert.equal(bubble.querySelector('.bb-quoted-reply'),null);
 assert.equal(block.dataset.quoteOwnerRole,'user');
 assert.equal(ui.quote().textContent,'BotA：@BotB 修改输入框，保持原来的风格。');
 ui.api.role('assistant');await tick();assert.equal(ui.document.querySelector('.sand-message-block').dataset.quoteOwnerRole,'assistant');
 assert.equal(ui.quote().dataset.replyTargetId,'assignment');
});

test('quote thumbnails only use authorized ready raster cache, never attachment URLs', async t => {
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZkY8wAAAABJRU5ErkJggg==';
 const url='https://untrusted.invalid/private-photo.png';
 const ui=await setup(t,{...assignment,message:{type:'attachment',url}});
 assert.equal(ui.quote().querySelector('img'),null);
 for(const src of [url,'file:///private/photo.png','data:image/svg+xml;base64,PHN2Zy8+','javascript:alert(1)']) {
  ui.api.setMedia(url,{status:'ready',kind:'image',src});await tick();assert.equal(ui.quote().querySelector('img'),null);
 }
 ui.api.setMedia(url,{status:'ready',kind:'image',src:png});await tick();
 assert.equal(ui.quote().querySelector('img').getAttribute('src'),png);
 assert.equal(ui.composer().querySelector('img').getAttribute('src'),png);
 ui.api.setMedia(url,null);await tick();assert.equal(ui.quote().querySelector('img'),null);
 assert.match(ui.quote().textContent,/图片/);
});

test('replying to an already quoted message keeps a single direct reference', async t => {
 const original={...assignment,replyTo:'first-task',workOn:'first-task'};
 const ui=await setup(t,original);ui.api.mode('message');await tick();
 assert.equal(ui.document.querySelectorAll('.sand-message-block .bb-quoted-reply').length,1);
 assert.equal(ui.quote().dataset.replyTargetId,original.id);
 assert.equal(original.replyTo,'first-task');assert.equal(original.workOn,'first-task');
});

test('draft quote has no extra heading and mouse cancellation does not move the text caret', async t => {
 const ui=await setup(t);const input=ui.document.querySelector('textarea');input.focus();input.setSelectionRange(2,4);
 const clear=ui.composer().querySelector('button');
 const event=new ui.window.MouseEvent('mousedown',{bubbles:true,cancelable:true});clear.dispatchEvent(event);
 assert.equal(event.defaultPrevented,true);assert.equal(ui.document.activeElement,input);
 assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,4);
 assert.doesNotMatch(ui.composer().textContent,/回复|Reply to/);
 clear.click();await tick();assert.equal(ui.composer(),null);assert.equal(input.value,'保留我的草稿');
});

test('shipped composer preserves the editor position while moving reference below it', () => {
 const source=readFileSync(new URL('../src/app/dist/renderer/assets/index-UbX-y3il.js',import.meta.url),'utf8');
 const patched=patchQuotedReplies(source);
 assert.match(patched,/children:\[Vr,si,Yi,null,ii,Gr,ri,br\]/);
 assert.throws(()=>patchQuotedReplies(source.replace('children:[Vr,si,Yi,ri,ii,Gr,br]','children:[Vr,si,Yi,ii,Gr,br]')),/draft quote below editor/);
 assert.throws(()=>patchQuotedReplies(source.replace('style:I.style,children:[O,_]','style:I.style,children:[_,O]')),/reply below message/);
});
