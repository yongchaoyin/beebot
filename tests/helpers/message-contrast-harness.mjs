import { build } from "esbuild";
import { parse } from "acorn";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** Visual fixture: the shipped KWn/BPn/Sle functions, original StyleQ, and
 * recovered transcript/composer. Roster, schema-valid fixture data, link
 * navigation and network receipts are controlled; this is not an installed
 * app, authentication, provider or actual task-execution test. */
export async function buildMessageContrastHarness(rendererSource) {
  const root = path.resolve(".");
  const source = rendererSource ?? await readFile(path.join(root, "src/app/dist/renderer/assets/index-UbX-y3il.js"), "utf8");
  const declarations = new Map();
  for (const node of parse(source, { ecmaVersion: "latest", sourceType: "module" }).body) {
    if (node.type === "FunctionDeclaration") declarations.set(node.id.name, source.slice(node.start, node.end));
    if (node.type === "VariableDeclaration") for (const entry of node.declarations) {
      if (entry.id.type === "Identifier") declarations.set(entry.id.name, `${node.kind} ${source.slice(entry.start, entry.end)};`);
    }
  }
  const names = ["lie", "x_e", "C2t", "I2t", "Fe", "re", "Ut", "Us", "OFe", "Sle", "tft", "oAe", "_o", "ND", "LPn", "_Pn", "OPn", "KWn", "Tpt", "BPn", "gpt", "ppt", "ypt", "qPn", "jPn", "DPn", "RPn", "FPn", "kpt", "wpt", "_ht", "fEn", "hEn", "iGe", "Jht", "pEn", "gEn", "yEn", "kEn"];
  const extracted = names.map(name => {
    if (!declarations.has(name)) throw new Error(`Pinned message contrast fixture anchor missing: ${name}`);
    return declarations.get(name);
  }).join("\n");
  const result = await build({ absWorkingDir: root, write: false, bundle: true, format: "iife", globalName: "MessageContrastUI", platform: "browser", target: "chrome136", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' }, stdin: { resolveDir: root, sourcefile: "message-contrast-fixture.tsx", loader: "tsx", contents: `
import * as S from "react";
import * as p from "react/jsx-runtime";
import * as he from "react/compiler-runtime";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ConversationTranscript } from "./frontend/src/recovered/features/conversation/workspace/transcript";
import { ConversationComposer } from "./frontend/src/recovered/features/conversation/workspace/composer";
import { createComposerSubmissionQueue } from "./frontend/src/recovered/features/conversation/workspace/submission";
import { createPresenceCharacter } from "./frontend/src/presence/character";
const Character = createPresenceCharacter(S);
${extracted}
let linkClicks = 0;
const Spt=()=>null, xAe=({children})=>children, UPn=({children})=>children;
const KAe=value=>{try{return value?JSON.parse(value):null}catch{return null}};
const E5n=()=>p.jsx(Character,{color:'orange',shape:'blob',sizePx:16,state:'idle',paused:true});
const du=()=>({}), Nee=()=>({onClick:event=>{event.preventDefault();linkClicks++;}}), Qft=({children})=>children({});
const v2e=({children})=>p.jsx('pre',{className:'sand-code-block',children});
const nft=text=>text;
const adjacency={isGroupStart:true,isContinuedFromPrev:false,isContinuedToNext:false,isFollowedByThreadChip:false};
const sample='请继续整理项目进度，保留之前的讨论。';
const rich={type:'doc',content:[{type:'paragraph',content:[{type:'mention',attrs:{id:'bot-a',label:'小微'}},{type:'text',text:' 请核对 '},{type:'text',text:'重要信息',marks:[{type:'bold'}]},{type:'text',text:'，参考 '},{type:'text',text:'项目文档',marks:[{type:'link',attrs:{href:'https://example.test/docs'}}]},{type:'text',text:' 和 '},{type:'text',text:'npm test',marks:[{type:'code'}]}]},{type:'blockquote',content:[{type:'paragraph',content:[{type:'text',text:'原消息：请先检查，再提交。'}]}]}]};
const editableRich={type:'doc',content:[{type:'paragraph',content:[{type:'mention',attrs:{id:'bot-a',label:'小微'}},{type:'text',text:' 请核对内容，参考 '},{type:'text',text:'项目文档',marks:[{type:'link',attrs:{href:'https://example.test/docs'}}]}]}]};
const initial={kind:'message',id:'recovered-user',role:'user',author:'我',text:sample,richText:JSON.stringify(editableRich),timestampMs:0,delivery:'sent'};
export function mount(element) {
 const root=createRoot(element);let api;
 function Fixture() {
  const [theme,setTheme]=S.useState('light'),[room,setRoom]=S.useState('group'),[phase,setPhase]=S.useState('sent');
  const [draft,setDraft]=S.useState({prompt:'',attachments:[]}),[entries,setEntries]=S.useState([]);
  const seq=S.useRef(0), pending=S.useRef(new Map()),calls=S.useRef([]);
  const [queue]=S.useState(()=>createComposerSubmissionQueue({isTransportDown:()=>false,send:msg=>{calls.current.push(msg.prompt);return new Promise((resolve,reject)=>pending.current.set(msg.nonce,{resolve,reject}));},onPhase:msg=>setEntries(all=>all.map(e=>e.clientNonce===msg.nonce?{...e,delivery:msg.phase}:e))}));
  S.useLayoutEffect(()=>{document.documentElement.dataset.beebotTheme='presence';document.documentElement.dataset.theme='cursor-'+theme;},[theme]);
  S.useEffect(()=>()=>queue.dispose(),[queue]);
  const send=()=>{const text=draft.prompt.trim();if(!text)return;const nonce='test-'+(++seq.current);setEntries(all=>[...all,{...initial,richText:undefined,id:nonce,clientNonce:nonce,text,delivery:'pending'}]);queue.submit({nonce,agentId:room,prompt:text,attachments:[],createdAtMs:seq.current});setDraft({prompt:'',attachments:[]});};
  api={setTheme,setRoom,setPhase,order:()=>calls.current.slice(),succeed:nonce=>pending.current.get(nonce)?.resolve()};
  return <main className="contrast-fixture"><header className="fixture-bar"><strong>BeeBot · 消息可读性回归</strong><small>实际组件 · 测试数据</small><button id="toggle-theme" onClick={()=>setTheme(theme==='light'?'dark':'light')}>切换主题</button><button id="toggle-room" onClick={()=>setRoom(room==='group'?'single':'group')}>切换单聊 / 群聊</button></header>
   <section className="fixture-chat" data-room={room}><h1>{room==='group'?'项目讨论群':'小微'}</h1><p className="fixture-label">正式打包气泡</p>
    <div id="packaged-plain" className="fixture-row sand--default-marker" data-role="user"><KWn entry={{content:sample}} adjacency={adjacency}/></div>
    <div id="packaged-rich" className="fixture-row sand--default-marker" data-role="user"><KWn entry={{content:sample,richText:JSON.stringify(rich)}} adjacency={adjacency}/></div>
    <div id="packaged-state" className="fixture-row sand--default-marker" data-role="user"><KWn entry={{content:'消息内容在排队或处理失败时也应清楚可读。'}} adjacency={adjacency}/><span data-bb-delivery data-state={phase==='sent'?'received':phase==='failed'?'failed':'queued'}>{phase==='failed'?'本次处理失败，消息已保留':phase==='sent'?'已收到':'排队中'}</span></div>
    <div id="emoji" className="fixture-row sand--default-marker" data-role="user"><KWn entry={{content:'👍'}} isStandaloneEmoji adjacency={adjacency}/></div>
    <p className="fixture-label">可编辑前端与远端聊天共用组件</p><div id="recovered"><ConversationTranscript entries={[{...initial,delivery:phase,deliveryFailure:'rejected'},{...initial,id:'assistant',role:'assistant',author:'小微',richText:undefined,text:'收到，按原计划检查。\\n\\n[项目文档](https://example.test/docs)\\n\\n'+String.fromCharCode(96).repeat(3)+'js\\nconst ready = true;\\n'+String.fromCharCode(96).repeat(3),delivery:'sent'},...entries]} onReply={()=>{}} onCopyMessage={()=>{}} onResendFailedSend={()=>{}} onCancelQueuedSend={()=>{}}/></div>
    <div className="fixture-composer"><ConversationComposer draft={draft} onChange={setDraft} onSubmit={send} enableVoice={false} enableAttachments={false} onStageFiles={()=>{}} transcribeAudio={async()=>({text:''})}/></div>
   </section></main>;
 }
 flushSync(()=>root.render(<Fixture/>));
 return {theme:value=>flushSync(()=>api.setTheme(value)),room:value=>flushSync(()=>api.setRoom(value)),phase:value=>flushSync(()=>api.setPhase(value)),order:()=>api.order(),succeed:nonce=>api.succeed(nonce),linkClicks:()=>linkClicks,unmount:()=>flushSync(()=>root.unmount())};
}
` } });
  return { code: result.outputFiles[0].text, extractedNames: names };
}
