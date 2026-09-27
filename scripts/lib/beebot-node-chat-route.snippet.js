/* Keep the original local layout and mount the shared chat components in the same route. */
function qLn(props){
  const store=window.__beebotNodeChat;
  const active=S.useSyncExternalStore(store.subscribe,()=>store.getSnapshot().active);
  const language=window.__beebotUiLanguage;
  S.useSyncExternalStore(language?.subscribe??(()=>()=>{}),language?.snapshot??(()=>window.__sandUiLanguage??"en"));
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
    // A workspace without a selected colleague has no valid send target. Keep
    // the ordinary layout and explicit creation routes, with a true empty body.
    const empty=!props.isChatActive&&!props.isNewChatOpen&&!props.isNewAgentOpen;
    return S.createElement(RLocalChatLayout,empty?{...props,chatHeader:null,heroComposer:S.createElement("p",{children:language?.text("No chats yet")??"No chats yet"})}:props);
  }
  return S.createElement("div",{id:"beebot-node-chat",ref:mount,style:{display:"flex",flexDirection:"column",flex:"1 1 0",minWidth:0,minHeight:0,width:"100%",height:"100%",overflow:"hidden"}});
}
