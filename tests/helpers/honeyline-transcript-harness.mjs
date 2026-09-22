import { build } from "esbuild";
import path from "node:path";
/** Actual transcript/composer components, with a controlled transport. No native
 * window, real coordinator, voice or model execution is simulated as passed. */
export async function buildHoneylineTranscriptHarness() {
  const result = await build({
    absWorkingDir: path.resolve("."), bundle: true, write: false, format: "iife", globalName: "HoneylineTestUI",
    platform: "browser", target: "chrome136", jsx: "automatic", loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"development"' },
    stdin: { resolveDir: path.resolve("."), sourcefile: "honeyline-regression-harness.tsx", loader: "tsx", contents: `
      import * as React from "react";
      import { createRoot } from "react-dom/client";
      import { flushSync } from "react-dom";
      import { ConversationTranscript } from "./frontend/src/recovered/features/conversation/workspace/transcript";
      import { ConversationComposer } from "./frontend/src/recovered/features/conversation/workspace/composer";
      import { createComposerSubmissionQueue, ComposerSubmissionRejectedError } from "./frontend/src/recovered/features/conversation/workspace/submission";
      import { createHoneylineWorkStatus } from "./frontend/src/honeyline/packaged-ui";
      const WorkStatus = createHoneylineWorkStatus(React);
      const initial = { kind:"message", id:"m1", role:"user", author:"You", text:"请核对方案并保留引用。", timestampMs:0, delivery:"sent" };
      export function mountTranscript(element) {
        const root = createRoot(element); let entry = {...initial}, readOnly = false;
        let deleted = 0, resent = 0, replies = 0;
        const render = () => flushSync(() => root.render(<ConversationTranscript entries={[entry]} isReadOnly={readOnly} onCopyMessage={()=>{}} onReply={()=>{replies++}} onDeleteFailedSend={()=>{deleted++}} onResendFailedSend={()=>{resent++}}/>));
        render();
        return { update: change=>{entry={...entry,...change};render()}, readOnly: value=>{readOnly=value;render()}, counts:()=>({deleted,resent,replies}), unmount:()=>flushSync(()=>root.unmount()) };
      }
      export function mountChat(element, conversationId = "group-project") {
        const root=createRoot(element), calls=[], pending=new Map(); let api;
        function Chat() {
          const [draft,setDraft]=React.useState({prompt:"",attachments:[]});
          const [entries,setEntries]=React.useState([]); const counter=React.useRef(0);
          const [queue]=React.useState(()=>createComposerSubmissionQueue({
            isTransportDown:()=>false,
            send: msg=>{calls.push(msg);return new Promise((resolve,reject)=>pending.set(msg.nonce,{resolve,reject}))},
            onPhase: msg=>setEntries(current=>current.map(e=>e.clientNonce===msg.nonce?{...e,delivery:msg.phase,deliveryFailure:msg.failureKind}:e))
          }));
          React.useEffect(()=>()=>queue.dispose(),[queue]);
          const send=()=>{
            const nonce="s"+(++counter.current), text=draft.prompt.trim();if(!text)return;
            setEntries(current=>[...current,{...initial,id:nonce,clientNonce:nonce,text,delivery:"pending"}]);
            queue.submit({nonce,agentId:conversationId,prompt:text,attachments:[],createdAtMs:counter.current});setDraft({prompt:"",attachments:[]});
          };
          api={calls,pending,queue};
          return <><header><h1>BeeBot · Honeyline 回归</h1><p>真实组件 · 可控测试数据，不连接真实 Bot</p><WorkStatus agent={{isRunning:entries.some(e=>e.delivery==="pending")}}/></header>
            <ConversationTranscript entries={entries} onCopyMessage={()=>{}} onReply={()=>{}} onCancelQueuedSend={e=>queue.cancelQueued(e.clientNonce)} onDeleteFailedSend={e=>{queue.discard(e.clientNonce);setEntries(all=>all.filter(x=>x.id!==e.id))}}/>
            <ConversationComposer draft={draft} onChange={setDraft} onSubmit={send} enableVoice={false} enableAttachments={false} onStageFiles={()=>{}} transcribeAudio={async()=>({text:""})}/></>;
        }
        flushSync(()=>root.render(<Chat/>));
        return { order:()=>calls.map(c=>c.prompt), succeed:nonce=>pending.get(nonce).resolve(), fail:(nonce,known=false)=>pending.get(nonce).reject(known?new ComposerSubmissionRejectedError("not dispatched"):new Error("unconfirmed")), unmount:()=>flushSync(()=>root.unmount()) };
      }
    ` }
  });
  return result.outputFiles[0].text;
}
