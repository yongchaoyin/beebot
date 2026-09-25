import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { parse } from 'acorn';
import path from 'node:path';
import { patchQuotedReplies } from '../../scripts/lib/quoted-reply-patch.mjs';

/** Real shipped reply owner and editable transcript/composer. Transport,
 * history and attachment cache are controlled; no external model is called. */
export async function buildWeChatQuoteHarness() {
 const root=path.resolve('.');
 const source=patchQuotedReplies(await readFile('src/app/dist/renderer/assets/index-UbX-y3il.js','utf8'));
 const names=new Set(['pCn','uPn','ide','Kvn','RQuoteComponents','Roe',
  'lie','x_e','C2t','I2t','Fe','re','Ut','Us','OFe','Sle','tft','oAe','_o','ND','LPn','_Pn','OPn','KWn','Tpt','BPn','gpt','ppt','ypt','qPn','jPn','DPn','RPn','FPn','kpt','wpt','_ht','fEn','hEn','iGe','Jht','pEn','gEn','yEn','kEn']);
 const declarations=[];
 for(const node of parse(source,{ecmaVersion:'latest',sourceType:'module'}).body){
  if(node.type==='FunctionDeclaration'&&names.has(node.id?.name))declarations.push(source.slice(node.start,node.end));
  if(node.type==='VariableDeclaration')for(const d of node.declarations){
   if(names.has(d.id.name)||d.id.name==='RQuotedReplyUI')declarations.push(node.kind+' '+source.slice(d.start,d.end)+';');
  }
 }
 const actual=declarations.join('\n');
 const result=await build({stdin:{sourcefile:'wechat-quote-fixture.tsx',resolveDir:root,loader:'tsx',contents:`
 import * as S from 'react';import * as p from 'react/jsx-runtime';import * as he from 'react/compiler-runtime';
 import {createRoot} from 'react-dom/client';import{flushSync}from'react-dom';
 import {ConversationTranscript} from './frontend/src/recovered/features/conversation/workspace/transcript';
 import {ConversationComposer} from './frontend/src/recovered/features/conversation/workspace/composer';
 import {createComposerSubmissionQueue} from './frontend/src/recovered/features/conversation/workspace/submission';
 import {previewFromTranscript} from './frontend/src/recovered/features/conversation/workspace/quoted-reply-ui';
 const original={kind:'message',role:'assistant',id:'original',author:'小微',text:'请先核对这份方案，再把修改结果发给我。',timestampMs:1};
 let records=new Map([[original.id,original]]),nav=[];
 const locate=id=>{nav.push(id);const target=document.querySelector('[data-entry-id="'+id+'"]');target?.scrollIntoView({block:'nearest'});return !!target};
 function r1(){return{agentId:'group',resolveEntry:id=>records.get(id),revealQuotedEntry:locate,threadRootId:null,isReadOnly:false,getThreadSummary:()=>null,openThread:()=>{throw Error('Quotes must not open threads')}}}
 function Ra(){return[{id:'group',name:'项目讨论群'}]};function kAe(){return null}
 const pGe=e=>e.role??'assistant',mCn=({entry,children})=>S.cloneElement(children,{className:re(children.props.className,'sand-message-action-anchor',entry.role==='user'?'sand-jpp9qh':'sand-kilpe8')}),FEn=()=>null,UEn=()=>null,JEn=()=>null,$ht=()=>false;
 const Spt=()=>null,xAe=({children})=>children,UPn=({children})=>children;
 const KAe=value=>{try{return value?JSON.parse(value):null}catch{return null}};
 const E5n=()=>null,du=()=>({}),Nee=()=>({onClick:event=>event.preventDefault()}),Qft=({children})=>children({});
 const v2e=({children})=>p.jsx('pre',{children}),nft=text=>text;
 const adjacency={isGroupStart:true,isContinuedFromPrev:false,isContinuedToNext:false,isFollowedByThreadChip:false};
 ${actual}
 export function mount(host){const root=createRoot(host);let api;
 function View(){
  const [room,setRoom]=S.useState('group'),[role,setRole]=S.useState('user'),[draft,setDraft]=S.useState({prompt:'按这版继续完善。',attachments:[]});
  const [target,setTarget]=S.useState(original),[entries,setEntries]=S.useState([original,{...original,id:'answer',author:'我',role:'user',text:'好的，我会按这个方案处理。',replyToId:'original'}]);
  const [revision,refresh]=S.useState(0);const calls=S.useRef([]),pending=S.useRef(new Map()),sequence=S.useRef(0);
  const [queue]=S.useState(()=>createComposerSubmissionQueue({isTransportDown:()=>false,send:message=>{calls.current.push(message);return new Promise(resolve=>pending.current.set(message.nonce,resolve))},onPhase:message=>setEntries(all=>all.map(e=>e.id===message.nonce?{...e,delivery:message.phase}:e))}));
  S.useEffect(()=>()=>queue.dispose(),[queue]);
  const submit=()=>{if(!draft.prompt.trim())return;const nonce='send-'+(++sequence.current);const replyToId=target?.id;
    setEntries(all=>[...all,{...original,id:nonce,clientNonce:nonce,author:'我',role:'user',text:draft.prompt,replyToId,delivery:'pending'}]);
    queue.submit({nonce,agentId:room,prompt:draft.prompt,richText:draft.richText,attachments:draft.attachments,replyToId,createdAtMs:Date.now()});
    setDraft({prompt:'',attachments:[]});setTarget(null);
  };
  api={setRoom,setRole,clearQuote:()=>setTarget(null),selectQuote:()=>setTarget(original),longQuote:()=>{const text='很长的原消息内容，需要截断而不是撑开界面。'.repeat(45);original.text=text;records.set('original',{...original});refresh(n=>n+1);setTarget({...original})},calls:()=>calls.current.map(m=>({prompt:m.prompt,replyToId:m.replyToId,agentId:m.agentId})),ack:nonce=>pending.current.get(nonce)?.(),draft:()=>draft,nav:()=>nav};
  return <main className="quote-fixture"><header><b>BeeBot · 引用消息</b><small>实际组件 / 测试数据</small></header>
   <section id="shipped"><h2>正式渲染器 · {role==='user'?'发送的回复':'收到的回复'}</h2>
    <Roe entry={{kind:'message',id:'shipped-answer',role,replyTo:'original'}}>{role==='user'?<KWn entry={{content:'好的，我会按这个方案处理。'}} adjacency={adjacency}/>:<div className="sand-message" data-role={role}><span className="sand-message-content">好的，我会按这个方案处理。</span></div>}</Roe>
   </section>
   <section id="editable"><h2>{room==='group'?'项目讨论群':'小微'} · 共用聊天组件</h2>
    <ConversationTranscript entries={entries} resolveReplyPreview={id=>records.has(id)?previewFromTranscript(records.get(id)):null} isReplyTargetInScope={id=>records.has(id)} onOpenReply={locate} onReply={entry=>setTarget(entry)} onCopyMessage={()=>{}}/>
   </section>
   <section id="composer"><h2>输入中的引用</h2><ConversationComposer draft={draft} onChange={setDraft} onSubmit={submit} replyTarget={target?{targetId:target.id,preview:previewFromTranscript(target)}:undefined} onClearReplyTarget={()=>setTarget(null)} enableVoice={false} enableAttachments={false}/></section>
  </main>;
 }
 flushSync(()=>root.render(<View/>));
 return{room:value=>flushSync(()=>api.setRoom(value)),role:value=>flushSync(()=>api.setRole(value)),clear:()=>flushSync(()=>api.clearQuote()),select:()=>flushSync(()=>api.selectQuote()),long:()=>flushSync(()=>api.longQuote()),calls:()=>api.calls(),ack:nonce=>api.ack(nonce),draft:()=>api.draft(),nav:()=>api.nav(),unmount:()=>flushSync(()=>root.unmount())};
 }
 `},bundle:true,write:false,format:'iife',globalName:'WeChatQuoteFixture',platform:'browser',target:'chrome136',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"development"'}});
 return result.outputFiles[0].text;
}
