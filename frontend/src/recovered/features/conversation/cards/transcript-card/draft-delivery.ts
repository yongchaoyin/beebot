import type * as ReactType from "react";

export type DraftPayload = {type:"email-draft";draft:{from?:string;to:string[];cc?:string[];subject:string;body:string}} | {type:"slack-draft";draft:{workspace?:string;target:string;thread?:string;body:string}};
export interface DraftSnapshot {agentId:string;entryId:string;version:number;hash:string;state:"editable"|"sending"|"sent"|"needs-review"|"discarded";message:DraftPayload;receipt?:{messageId:string};error?:string;senders?:{id:string;label:string;bindingHash:string}[]}
export interface DraftDeliveryAdapter {
  getScope():{agentId:string|null;generation:string|number;available:boolean;language?:string};
  subscribe(listener:()=>void):()=>void;
  getSnapshot(args:{agentId:string;entryId:string}):Promise<unknown>;
  resolve(args:{agentId:string;entryId:string;requestId:string;expectedVersion:number;expectedHash:string;action:"send"|"discard";senderId?:string;expectedSenderHash?:string;message?:DraftPayload}):Promise<unknown>;
}
function payload(raw:any):DraftPayload|null {
  const d=raw?.draft;
  if(!d||typeof d.body!=="string")return null;
  if(raw.type==="email-draft"&&Array.isArray(d.to)&&d.to.every((v:unknown)=>typeof v==="string")&&typeof d.subject==="string")return {type:raw.type,draft:{...d,to:[...d.to],...(Array.isArray(d.cc)?{cc:[...d.cc]}:{})}};
  if(raw.type==="slack-draft"&&typeof d.target==="string")return {type:raw.type,draft:{...d}};
  return null;
}
function checked(raw:any,agentId:string,entryId:string,type:string):DraftSnapshot {
  if(raw?.agentId!==agentId||raw?.entryId!==entryId||!Number.isInteger(raw.version)||raw.version<0||typeof raw.hash!=="string"||!/^[a-f0-9]{64}$/.test(raw.hash)||!["editable","sending","sent","needs-review","discarded"].includes(raw.state)||!payload(raw.message)||raw.message.type!==type||raw.state==="sent"&&(typeof raw.receipt?.messageId!=="string"||!raw.receipt.messageId.trim()))throw new Error("Unverified draft state");
  if(raw.senders!==undefined&&(!Array.isArray(raw.senders)||!raw.senders.every((s:any)=>typeof s.id==="string"&&s.id&&typeof s.label==="string"&&typeof s.bindingHash==="string"&&/^[a-f0-9]{64}$/.test(s.bindingHash))))throw new Error("Unverified sender list");
  return raw;
}
async function bounded<T>(run:Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([run,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Draft request timed out")),15000);})]);}finally{clearTimeout(timer!);}}
const recipients=(value:string)=>value.split(",").map(v=>v.trim()).filter(Boolean);
const sameScope=(a:ReturnType<DraftDeliveryAdapter["getScope"]>,b:ReturnType<DraftDeliveryAdapter["getScope"]>)=>a.agentId===b.agentId&&a.generation===b.generation&&b.available;
function secureRequestId(){if(typeof globalThis.crypto?.randomUUID==="function")return globalThis.crypto.randomUUID();if(!globalThis.crypto?.getRandomValues)throw new Error("Secure request identity unavailable");return "draft-"+Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,"0")).join("");}
const styles=`.bb-draft{width:100%;min-width:0;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:12px;padding:14px;color:var(--cursor-text-primary,CanvasText);background:var(--cursor-bg-primary,Canvas);font:13px/1.5 system-ui;-webkit-app-region:no-drag;box-sizing:border-box}.bb-draft *{box-sizing:border-box}.bb-draft header{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.bb-draft h3{margin:0;font-size:14px}.bb-draft label{display:grid;gap:5px;margin:10px 0}.bb-draft :is(input,textarea,select){width:100%;min-width:0;color:inherit;background:var(--cursor-bg-input,Canvas);border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:7px;padding:8px;font:inherit}.bb-draft textarea{min-height:110px;resize:vertical}.bb-draft p{margin:8px 0;overflow-wrap:anywhere;white-space:pre-wrap}.bb-draft .bb-draft-destination{color:var(--cursor-text-secondary,GrayText);font-size:12px}.bb-draft .bb-draft-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.bb-draft button{color:inherit;background:var(--cursor-bg-secondary,Canvas);border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:7px;padding:7px 12px;min-height:34px;font:inherit;cursor:pointer}.bb-draft button[type=submit]{background:var(--cursor-text-primary,CanvasText);color:var(--cursor-bg-primary,Canvas)}.bb-draft :disabled{opacity:.5;cursor:default}.bb-draft :focus-visible{outline:2px solid var(--cursor-accent,Highlight);outline-offset:2px}.bb-draft [role=alert]{color:var(--cursor-text-red-primary,#b93446)}@media(max-width:440px){.bb-draft{padding:10px}.bb-draft-actions button{flex:1}}`;

/** React is supplied by the actual pinned renderer, so the lazy cards share its
 * hook dispatcher. The readable renderer calls this exact component factory. */
export function createDraftDeliveryCard(React:typeof ReactType) {
  const h=React.createElement;
  return function DraftDeliveryCard({entry,adapter}:{entry:any;adapter:DraftDeliveryAdapter|null}) {
    const initial=payload(entry?.message);
    const [tick,setTick]=React.useState(0),[view,setView]=React.useState<DraftSnapshot|null>(null),[draft,setDraft]=React.useState<DraftPayload|null>(initial),[to,setTo]=React.useState(initial?.type==="email-draft"?initial.draft.to.join(", "):""),[cc,setCc]=React.useState(initial?.type==="email-draft"?initial.draft.cc?.join(", ")||"":""),[sender,setSender]=React.useState(""),[busy,setBusy]=React.useState(false),[uncertain,setUncertain]=React.useState(false),[error,setError]=React.useState("");
    const serial=React.useRef(0),mounted=React.useRef(true),scope=adapter?.getScope(),scopeKey=scope?`${scope.agentId}:${scope.generation}`:"unavailable",titleId=React.useId();
    const t=(cn:string,en:string)=>scope?.language==="zh"?cn:en;
    React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;serial.current++;};},[]);
    React.useEffect(()=>adapter?.subscribe(()=>setTick(v=>v+1)),[adapter]);
    async function load(reset=false){
      const captured=adapter?.getScope(),token=++serial.current;
      if(!adapter||!captured?.agentId||!captured.available){setView(null);setBusy(false);setError(t("当前连接无法处理草稿。内容已保留。","Draft actions are unavailable on this connection. Content is preserved."));return;}
      setBusy(true);setError("");
      try{const next=checked(await bounded(adapter.getSnapshot({agentId:captured.agentId,entryId:entry.id})),captured.agentId,entry.id,initial!.type);if(!mounted.current||token!==serial.current||!sameScope(captured,adapter.getScope()))return;setView(next);setUncertain(false);if(reset||next.state!=="editable"){setDraft(next.message);if(next.message.type==="email-draft"){setTo(next.message.draft.to.join(", "));setCc(next.message.draft.cc?.join(", ")||"");}}setSender(current=>next.senders?.some(s=>s.id===current)?current:next.senders?.length===1?next.senders[0]!.id:"");}
      catch{if(mounted.current&&token===serial.current){setView(null);setError(t("无法核验草稿状态。内容已保留，请重新读取。","Could not verify the draft state. Content is preserved; reload it."));}}
      finally{if(mounted.current&&token===serial.current)setBusy(false);}
    }
    React.useEffect(()=>{setView(null);setUncertain(false);setDraft(initial);if(initial?.type==="email-draft"){setTo(initial.draft.to.join(", "));setCc(initial.draft.cc?.join(", ")||"");}void load(true);return()=>{serial.current++;};},[adapter,scopeKey,entry.id]);
    if(!initial||!draft)return null;
    const locked=busy||uncertain||!view||view.state!=="editable"||!scope?.available;
    const email=draft.type==="email-draft",addresses=recipients(to),carbon=recipients(cc),valid=!!draft.draft.body.trim()&&(!email||addresses.length>0&&[...addresses,...carbon].every(v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)));
    async function act(action:"send"|"discard"){
      const currentDraft=draft;const captured=adapter?.getScope();if(!currentDraft||!adapter||!view||locked||!captured?.agentId||!sameScope(scope!,captured))return;
      if(action==="send"&&(!valid||!sender||!view.senders?.some(s=>s.id===sender)))return;
      let requestId:string;try{requestId=secureRequestId();}catch{setError(t("无法创建安全的发送请求，草稿已保留。","A secure request could not be created. The draft is preserved."));return;}
      const token=++serial.current;setBusy(true);setError("");
      const message:DraftPayload=currentDraft.type==="email-draft"?{type:currentDraft.type,draft:{...(currentDraft.draft.from?{from:currentDraft.draft.from}:{}),subject:currentDraft.draft.subject,body:currentDraft.draft.body,to:addresses,...(carbon.length?{cc:carbon}:{})}}:currentDraft;
      try{const next=checked(await bounded(adapter.resolve({agentId:captured.agentId,entryId:entry.id,requestId,expectedVersion:view.version,expectedHash:view.hash,action,...(action==="send"?{senderId:sender,expectedSenderHash:view.senders?.find(s=>s.id===sender)?.bindingHash,message}:{})})),captured.agentId,entry.id,initial!.type);if(!mounted.current||token!==serial.current||!sameScope(captured,adapter.getScope()))return;if(next.version<=view.version)throw new Error("Stale draft acknowledgement");setView(next);setDraft(next.message);setUncertain(false);}
      catch{if(mounted.current&&token===serial.current){setUncertain(true);setError(t("操作结果尚未确认。请重新读取状态；发送不会自动重试。","The result is unconfirmed. Reload the state; sending will not retry automatically."));}}
      finally{if(mounted.current&&token===serial.current)setBusy(false);}
    }
    const label=email?t("新邮件","New email"):t("Slack 消息","Slack message");
    const status=busy?t("处理中…","Working…"):uncertain||view?.state==="needs-review"?t("需要核查","Needs review"):view?.state==="sent"?t("已发送","Sent"):view?.state==="discarded"?t("已丢弃","Discarded"):view?.state==="sending"?t("发送中…","Sending…"):view?t("待确认发送","Ready for confirmation"):t("正在核验…","Verifying…");
    const destination=draft.type==="email-draft"?draft.draft.to.join(", "):draft.draft.target;
    const head=h("header",null,h("h3",{id:titleId},label),h("span",{role:"status"},status));
    const terminal=view?.state==="sent"||view?.state==="discarded";
    const field=(label:string,value:string,change:(v:string)=>void,textarea=false)=>h("label",null,h("span",null,label),h(textarea?"textarea":"input",{value,disabled:locked,onChange:(event:any)=>change(event.currentTarget.value),...(textarea?{rows:5}:{type:"text"}),"aria-label":label}));
    const change=(key:string,value:string)=>setDraft(current=>current?{...current,draft:{...current.draft,[key]:value}} as DraftPayload:current);
    const footer=h("div",{className:"bb-draft-actions"},!terminal?h("button",{type:"submit",disabled:locked||!valid||!sender||!view?.senders?.some(s=>s.id===sender)},email?t("发送邮件","Send email"):t("发送消息","Send message")):null,!terminal?h("button",{type:"button",disabled:locked,onClick:()=>void act("discard")},t("丢弃草稿","Discard")):null,h("button",{type:"button",disabled:busy,onClick:()=>void load()},t("重新读取状态","Reload state")));
    return h(React.Fragment,null,h("style",null,styles),h("form",{className:`bb-draft ${email?"sand-email-composer":"sand-slack-composer"}`,"aria-labelledby":titleId,"data-draft-entry":entry.id,"aria-busy":busy,onSubmit:(event:any)=>{event.preventDefault();void act("send");}},head,
      email?(draft.type==="email-draft"&&draft.draft.from?h("p",{className:"bb-draft-destination"},t("发件人：","From: ")+draft.draft.from):null):h("p",{className:"bb-draft-destination"},(draft.type==="slack-draft"&&draft.draft.workspace?draft.draft.workspace+" · ":"")+t("发送至：","To: ")+destination+(draft.type==="slack-draft"&&draft.draft.thread?" · "+draft.draft.thread:"")),
      terminal?h("p",null,destination+(draft.type==="email-draft"?" · "+draft.draft.subject:"")):
      h(React.Fragment,null,email?field(t("收件人","To"),to,setTo):null,email?field(t("抄送","Cc"),cc,setCc):null,email&&draft.type==="email-draft"?field(t("主题","Subject"),draft.draft.subject,v=>change("subject",v)):null,field(t("消息内容","Message"),draft.draft.body,v=>change("body",v),true),
        view?.state==="editable"?h("label",null,h("span",null,t("发送连接","Send using")),h("select",{disabled:locked,value:sender,onChange:(event:any)=>setSender(event.currentTarget.value),"aria-label":t("发送连接","Send using")},h("option",{value:""},t("选择发送连接","Choose a sender")),...(view.senders||[]).map(s=>h("option",{key:s.id,value:s.id},s.label)))):null),
      !terminal&&view?.state==="editable"&&!view.senders?.length?h("p",{role:"status"},t("没有支持此草稿的发送连接。你可以在设置中连接兼容服务，或丢弃草稿。","No connected sender supports this draft. Connect a compatible service in Settings or discard the draft.")):null,
      view?.state==="needs-review"?h("p",{role:"alert"},t("发送结果不明确。请先检查目标服务，草稿不会自动重新发送。","Delivery is unconfirmed. Check the destination first. This draft will not send again automatically.")):null,
      error?h("p",{role:"alert"},error):null,footer));
  };
}
