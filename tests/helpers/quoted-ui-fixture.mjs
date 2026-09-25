import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { parse } from 'acorn';
import { patchQuotedReplies } from '../../scripts/lib/quoted-reply-patch.mjs';

let building;
export function quotedUIFixture() {
  return building ??= (async () => {
    const original=await readFile(new URL('../../src/app/dist/renderer/assets/index-UbX-y3il.js',import.meta.url),'utf8');
    const patched=patchQuotedReplies(original),ast=parse(patched,{ecmaVersion:'latest',sourceType:'module'});
    const names=new Set(['pCn','uPn','ide','Kvn','RQuoteComponents','Roe']);
    const actual=ast.body.filter(node=>node.type==='FunctionDeclaration'&&names.has(node.id?.name)||node.type==='VariableDeclaration'&&node.declarations.some(d=>d.id.name==='RQuotedReplyUI')).map(node=>patched.slice(node.start,node.end)).join('\n');
    const source=`
      import * as he from 'react/compiler-runtime';import * as S from 'react';import * as p from 'react/jsx-runtime';import {createRoot} from 'react-dom/client';import {createPortal} from 'react-dom';
      const listeners=new Set();let version=0,entries=new Map(),scope='group',originalId='assignment',navImpl=null,media=new Map(),replyRole='user';
      const calls=[];const publish=()=>{version++;for(const listener of listeners)listener()};
      const store={subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},get:()=>version};
      const navigation=id=>{calls.push(['quote',scope,id]);if(navImpl)return navImpl(id);const row=[...document.querySelectorAll('[data-entry-id]')].find(e=>e.dataset.entryId===id);row?.scrollIntoView?.({block:'center'});row?.setAttribute('data-located','true');return !!row;};
      function r1(){S.useSyncExternalStore(store.subscribe,store.get,store.get);return{agentId:scope,threadRootId:null,isReadOnly:false,getThreadSummary:()=>null,resolveEntry:id=>entries.get(id),revealQuotedEntry:navigation,openThread:id=>calls.push(['thread',id])};}
      function Ra(){return [{id:'group',name:'产品协作群'},{id:'single',name:'BotB'}]}
      function kAe(url){S.useSyncExternalStore(store.subscribe,store.get,store.get);return media.get(url)??null}
      const re=(...classes)=>classes.filter(Boolean).join(' '),pGe=entry=>entry.role??'assistant';
      const mCn=({children})=>children,FEn=()=>null,UEn=()=>null,JEn=()=>null,$ht=()=>false;
      ${actual}
      let root,quotePreview,showComposer=true,mode='quote';
      function View(){S.useSyncExternalStore(store.subscribe,store.get,store.get);return p.jsxs(S.Fragment,{children:[
        mode==='message'?p.jsx(Roe,{entry:{kind:'message',id:'reply',role:replyRole,replyTo:originalId},children:p.jsx('div',{className:'sand-message', 'data-role':replyRole, children:p.jsx('span',{className:'sand-message-content',children:'好的，我会按这个方案处理。'})})}):mode==='link'?p.jsx(uPn,{entry:entries.get(originalId),label:'assignment'}):p.jsx(pCn,{targetId:originalId}),
        showComposer?(document.getElementById('composer-quote')?createPortal(p.jsx(Kvn,{preview:quotePreview,onClear:()=>{calls.push(['clear']);showComposer=false;publish()}}),document.getElementById('composer-quote')):p.jsx(Kvn,{preview:quotePreview,onClear:()=>{calls.push(['clear']);showComposer=false;publish()}})):null]});}
      window.quoteFixture={calls,mount(host,record){entries=new Map([[record.id,record]]);originalId=record.id;quotePreview=ide(record);root=createRoot(host);root.render(p.jsx(View,{}));},
        update(record){entries.set(record.id,record);quotePreview=ide(record);publish()},
        remove(){entries.delete(originalId);publish()},
        navigate(fn){navImpl=fn},
        switchChat(next){scope=next;entries=new Map();publish()},
        changeTarget(record){entries.set(record.id,record);originalId=record.id;quotePreview=ide(record);publish()},
        mode(next){mode=next;publish()},dispose(){root?.unmount();listeners.clear();},
        setMedia(url,value){media.set(url,value);publish()},role(value){replyRole=value;publish()},preview:ide,components:()=>RQuoteComponents(),setPreview(value){quotePreview=value;publish()}}
    `;
    return (await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'js'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022'})).outputFiles[0].text;
  })();
}
