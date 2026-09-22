/* Keep the original local layout and mount the shared chat components in the same route. */
function qLn(props){
  const store=window.__beebotNodeChat;
  const active=S.useSyncExternalStore(store.subscribe,()=>store.getSnapshot().active);
  const mount=S.useRef(null);
  S.useEffect(()=>{
    if(!active||!mount.current)return;
    const target=mount.current;let disposed=false,cleanup;
    if(!document.getElementById("beebot-node-chat-css")){
      const link=document.createElement("link");link.id="beebot-node-chat-css";link.rel="stylesheet";link.href=new URL("./beebot-node-chat.css",import.meta.url).href;document.head.append(link);
    }
    import("./beebot-node-chat.js").then(module=>{if(!disposed)cleanup=module.mountNodeChat(target,store);}).catch(error=>{if(!disposed)target.textContent=String(error.message||error);});
    return()=>{disposed=true;cleanup?.();};
  },[active]);
  if(!active){
    const id=props.interactions?.agentId;
    const activity=typeof id==="string"&&id&&!props.isReadOnlyExchange&&!props.isNewAgentOpen&&!props.isNewChatOpen
      ?S.createElement(RConversationActivity,{key:id,conversationId:id,entries:props.entries,interactions:props.interactions}):null;
    return S.createElement(RLocalChatLayout,{...props,trays:S.createElement(S.Fragment,null,props.trays,activity)});
  }
  return S.createElement("div",{id:"beebot-node-chat",ref:mount,style:{display:"flex",flexDirection:"column",flex:"1 1 0",minWidth:0,minHeight:0,width:"100%",height:"100%",overflow:"hidden"}});
}
