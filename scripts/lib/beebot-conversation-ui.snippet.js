/* Inline conversation state. The layout supplies an explicit conversation identity;
 * no selected DOM row, Bot display name or model-written status grants authority. */
function RConversationActivity({conversationId,entries,interactions}){
  const [snapshot,setSnapshot]=S.useState(null),[error,setError]=S.useState(""),[busy,setBusy]=S.useState(false),[expanded,setExpanded]=S.useState(false);
  const [language,setLanguage]=S.useState(window.__sandUiLanguage);
  const live=S.useRef(true),serial=S.useRef(0),refreshRef=S.useRef(()=>{});
  const text=(cn,en)=>language==="zh"?cn:en;
  const api=()=>window.desktop?.agent;
  S.useEffect(()=>{
    live.current=true;let pending=false,timer;
    const refresh=async()=>{
      if(pending||!live.current||typeof api()?.getConversationActivity!=="function")return;
      pending=true;const generation=++serial.current;
      try{
        const next=await api().getConversationActivity({agentId:conversationId});
        if(!live.current||generation!==serial.current)return;
        if(next?.conversationId!==conversationId||!Array.isArray(next.items)||!next.counts)throw new Error(text("会话状态不匹配，请重新打开。","Conversation state changed. Reopen this chat."));
        setSnapshot(next);setError("");
      }catch(e){if(live.current&&generation===serial.current)setError(text("暂时无法确认工作状态，消息没有因此被取消。","Work status could not be confirmed. Messages were not cancelled."));}
      finally{pending=false;}
    };
    refreshRef.current=refresh;void refresh();timer=setInterval(()=>void refresh(),4000);
    return()=>{live.current=false;serial.current++;clearInterval(timer);};
  },[conversationId]);
  S.useEffect(()=>{const timer=setTimeout(()=>void refreshRef.current(),120);return()=>clearTimeout(timer);},[entries]);
  S.useEffect(()=>{const update=()=>setLanguage(window.__sandUiLanguage);window.addEventListener("sand-ui-language-changed",update);return()=>window.removeEventListener("sand-ui-language-changed",update);},[]);
  S.useEffect(()=>{
    if(document.getElementById("beebot-conversation-status-style"))return;
    const style=document.createElement("style");style.id="beebot-conversation-status-style";
    style.textContent=`.bb-conversation-status{font:12px/1.55 system-ui;color:var(--cursor-text-secondary,GrayText);margin:0 0 8px;min-width:0}.bb-conversation-status button{font:inherit;color:inherit;background:transparent;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:7px;min-height:30px;padding:4px 9px;cursor:pointer;-webkit-app-region:no-drag}.bb-conversation-status button:disabled{opacity:.5;cursor:default}.bb-conversation-status button:focus-visible{outline:2px solid var(--cursor-accent,Highlight);outline-offset:2px}.bb-conversation-status__line{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.bb-conversation-status__line>span{flex:1;min-width:100px}.bb-conversation-status__items{max-height:220px;overflow:auto;overscroll-behavior:contain;border-top:1px solid var(--cursor-stroke-secondary,#8884);margin:8px 0 0;padding:0;list-style:none}.bb-conversation-status__items li{padding:9px 0;border-bottom:1px solid var(--cursor-stroke-secondary,#8882)}.bb-conversation-status__preview{display:block;font-weight:500;color:var(--cursor-text-primary,CanvasText);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.bb-conversation-status__recipients{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0}.bb-conversation-status__error{margin:5px 0;color:var(--cursor-text-red-primary,#bc4352)}`;
    document.head.append(style);
  },[]);
  const run=async action=>{
    if(busy||snapshot?.readOnly)return;
    setBusy(true);setError("");
    try{await action();if(live.current)void refreshRef.current();}
    catch(e){if(live.current)setError(text("操作尚未确认，请刷新后核查；没有自动重试。","The action was not confirmed. Refresh to check; it was not retried automatically."));}
    finally{if(live.current)setBusy(false);}
  };
  const counts=snapshot?.counts;
  if(!error&&(!counts||(!counts.queued&&!counts.processing&&!counts.attention)))return null;
  const label=counts?[
    counts.processing?text(`${counts.processing} 项处理中`,`${counts.processing} processing`):"",
    counts.queued?text(`${counts.queued} 项已接收，等待处理`,`${counts.queued} received, waiting`):"",
    counts.attention?text(`${counts.attention} 项需要核查`,`${counts.attention} need attention`):"",
  ].filter(Boolean).join(" · "):text("状态待确认","Status unconfirmed");
  const phases={queued:text("等待处理","Waiting"),processing:text("处理中","Processing"),responded:text("已回复","Replied"),silent:text("无需补充","No addition"),failed:text("未完成，请核查","Incomplete; review"),uncertain:text("结果未知，请核查","Outcome unknown"),paused:text("已暂停","Paused"),cancelled:text("已取消等待","Queue cancelled")};
  const itemNodes=expanded&&snapshot?snapshot.items.map(item=>{
    const recipientNodes=item.recipients.map(recipient=>S.createElement("span",{key:recipient.botId},`${recipient.name} · ${phases[recipient.phase]||text("状态待确认","Unconfirmed")}`));
    const actions=[];
    if(typeof interactions?.onReply==="function")actions.push(S.createElement("button",{key:"reply",type:"button",onClick:()=>interactions.onReply(item.messageId)},text("引用追问","Reply to this message")));
    if(item.recipients.some(recipient=>recipient.phase==="queued")&&!snapshot.readOnly)actions.push(S.createElement("button",{key:"cancel",type:"button",disabled:busy,onClick:()=>run(()=>api().cancelQueuedConversationMessage({agentId:conversationId,messageId:item.messageId,expectedRevision:item.revision}))},text("取消尚未开始的处理","Cancel queued processing")));
    if(item.recipients.some(recipient=>["failed","uncertain","paused"].includes(recipient.phase)))actions.push(S.createElement("span",{key:"review"},text("先核查已有操作；追问不会自动重跑原请求。","Check prior effects. A follow-up does not automatically replay the request.")));
    return S.createElement("li",{key:item.messageId},
      S.createElement("span",{className:"bb-conversation-status__preview"},item.preview||text("附件消息","Attachment message")),
      S.createElement("div",{className:"bb-conversation-status__recipients"},...recipientNodes),
      S.createElement("div",{className:"bb-conversation-status__line"},...actions));
  }):[];
  if(expanded&&snapshot?.truncated)itemNodes.push(S.createElement("li",{key:"truncated"},text("仅展示最近 100 项；其余消息仍保留。","Showing the latest 100 items; other messages are retained.")));
  return S.createElement("section",{className:"bb-conversation-status","aria-label":text("会话工作状态","Conversation work status")},
    S.createElement("div",{className:"bb-conversation-status__line"},
      S.createElement("span",{role:"status"},label),
      snapshot?S.createElement("button",{type:"button","aria-expanded":expanded,onClick:()=>setExpanded(value=>!value)},text(expanded?"收起":"查看",expanded?"Hide":"Details")):null,
      counts&&(counts.processing||counts.queued)&&!snapshot.readOnly?S.createElement("button",{type:"button",disabled:busy,onClick:()=>run(()=>api().stopConversation({agentId:conversationId}))},text("停止本会话工作","Stop this conversation's work")):null,
      error?S.createElement("button",{type:"button",disabled:busy,onClick:()=>void refreshRef.current()},text("刷新","Refresh")):null),
    error?S.createElement("p",{role:"status",className:"bb-conversation-status__error"},error):null,
    expanded&&snapshot?S.createElement("ul",{className:"bb-conversation-status__items"},...itemNodes):null);
}
