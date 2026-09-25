import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { readFile } from 'node:fs/promises';
import { buildWeChatQuoteHarness } from './helpers/wechat-quote-harness.mjs';
const tick=()=>new Promise(r=>setTimeout(r,20));
let fixture;
async function setup(t){const window=new Window({url:'https://beebot.test/quote-layout'});window.__sandUiLanguage='zh';window.console.timeStamp=()=>{};window.document.body.innerHTML='<div id="root"></div>';fixture??=buildWeChatQuoteHarness();window.eval(await fixture);const api=window.WeChatQuoteFixture.mount(window.document.getElementById('root'));await tick();t.after(async()=>{api.unmount();await window.happyDOM.close()});return{window,document:window.document,api};}

test('real editable transcript renders the quote as a sibling below the complete reply',async t=>{
 const {document}=await setup(t);const row=document.querySelector('[data-entry-id="answer"]');
 const bubble=row.querySelector('.sand-message'),quote=row.querySelector('.bb-quote-wrap');
 assert.ok(bubble.closest(".sand-message-action-anchor")?.parentElement===row);assert.ok(quote.parentElement===row);
 assert.ok(bubble.compareDocumentPosition(quote)&4);assert.equal(bubble.querySelector('.bb-quoted-reply'),null);
 assert.equal(quote.querySelector('.bb-quoted-reply').textContent,'小微：请先核对这份方案，再把修改结果发给我。');
});

test('real composer places the draft reference after the editor and cancellation keeps editor state',async t=>{
 const {document,api}=await setup(t);const editor=document.querySelector('[contenteditable="true"]');
 const quote=document.querySelector('#composer .bb-composer-quote');
 assert.ok(editor.compareDocumentPosition(quote)&4);const before=editor.textContent;
 quote.querySelector('button').click();await tick();
 assert.equal(document.querySelector('#composer .bb-composer-quote'),null);assert.equal(document.querySelector('[contenteditable="true"]'),editor);
 assert.equal(editor.textContent,before);assert.equal(api.draft().prompt,'按这版继续完善。');
 api.select();await tick();assert.equal(document.querySelector('[contenteditable="true"]'),editor);
});

test('theme specifies paired neutral quote colors with readable normal and hover contrast',async()=>{
 const source=await readFile('frontend/src/presence/tokens.css','utf8');
 const luminance=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
 const values=name=>[...source.matchAll(new RegExp('--bb-quote-'+name+': (#[0-9A-F]{6});','g'))].map(m=>m[1]);
 const [text,bg,hover]=['text','bg','hover'].map(values);assert.equal(text.length,2);
 for(let i=0;i<2;i++)for(const surface of [bg[i],hover[i]]){const [lo,hi]=[luminance(text[i]),luminance(surface)].sort((a,b)=>a-b);assert.ok((hi+.05)/(lo+.05)>=4.5)}
});
