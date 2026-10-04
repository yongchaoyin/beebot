/* Conversation-owned collection. Only durable public SendMessage entries are
 * evidence of delivery; private assistant text, drafts and work receipts are not. */
function RLibraryTarget(value) {
  if (typeof value !== "string" || !value || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const raw=value.trim();
  try {
    if(raw.startsWith("/")&&!raw.startsWith("//"))return {url:raw,local:true};
    const url=new URL(raw);
    if(url.username||url.password)return null;
    if(url.protocol==="file:"&&(!url.host||url.host==="localhost")&&!url.search&&!url.hash)return {url:url.href,local:true};
    if(url.protocol==="https:"||url.protocol==="http:")return {url:url.href,local:false};
  } catch {}
  return null;
}
function RProjectConversationLibrary(snapshot,agentId) {
  const items=[],seen=new Set(),pending=snapshot?.pendingEntryIds,failed=snapshot?.failedEntryIds;
  const entries=Array.isArray(snapshot?.entries)?snapshot.entries:[];
  for(let order=entries.length-1;order>=0&&items.length<2000;order--){
    const entry=entries[order],message=entry?.message;
    if(entry?.kind!=="send-message"||typeof entry.id!=="string"||!entry.id||entry.streaming===true||entry.isStreaming===true||entry.branched===true||pending?.has?.(entry.id)||failed?.has?.(entry.id)||!message||message.channel||entry.channel)continue;
    const delivery=typeof entry.delivery==="string"?entry.delivery:entry.delivery?.state;
    if(delivery&&!["sent","replied","processed"].includes(delivery))continue;
    const text=message.type==="text"&&typeof message.content==="string"?message.content:"";
    let count=0;
    const add=(url,title)=>{
      if(count>=128||items.length>=2000)return;
      const target=RLibraryTarget(url);if(!target)return;
      const key=entry.id+"\u0000"+target.url;if(seen.has(key))return;seen.add(key);count++;
      let path=target.url;
      try{path=new URL(target.url).pathname;}catch{}
      let fileName=path.split("/").filter(Boolean).at(-1)||target.url;
      try{fileName=decodeURIComponent(fileName);}catch{}
      const extension=fileName.split(".").at(-1)?.toLowerCase()||"";
      const kind=target.local?(["html","htm","md","markdown"].includes(extension)?"page":"file"):"link";
      items.push({id:key,url:target.url,local:target.local,kind,extension,title:typeof title==="string"&&title.trim()?title.trim().slice(0,300):fileName.slice(0,300),sourceEntryId:entry.id,sourceText:text.slice(0,1200),authorId:typeof entry.author?.id==="string"?entry.author.id:agentId,authorName:typeof entry.author?.name==="string"?entry.author.name:null,timestampMs:Number.isFinite(entry.timestampMs)&&entry.timestampMs>0?entry.timestampMs:null,order});
    };
    if(message.type==="attachment")add(message.url,message.file_name||message.artifact?.fileName||message.alt);
    if(message.type==="text"){
      if(Array.isArray(message.images))for(const image of message.images)add(image?.url,image?.alt||image?.artifact?.fileName);
      // Code examples and inline code do not advertise delivered links.
      const prose=text.slice(0,524288).replace(/```[^]*?```|~~~[^]*?~~~/g,"").replace(/`[^`\n]*`/g,"");
      for(const match of prose.matchAll(/!?\[([^\]\n]{0,300})\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g))add(match[2]||match[3],match[1]);
      for(const match of prose.matchAll(/https?:\/\/[^\s<>\[\]"`]+/g))add(match[0].replace(/[.,;:!?，。；：！？)]+$/g,""));
    }
  }
  return items.sort((a,b)=>b.order-a.order);
}
function RBindConversationLibrary(runtime) {
  if(!runtime?.selection?.snapshots||!runtime?.transcript?.snapshotsFor)return;
  if(window.__beebotConversationLibrary?.runtime===runtime)return;
  window.__beebotConversationLibrary?.dispose();
  const t=(cn,en)=>window.__sandUiLanguage==="zh"?cn:en,node=(tag,cls)=>{const el=document.createElement(tag);if(cls)el.className=cls;return el;};
  const root=node("section","bb-library"),heading=node("h2"),intro=node("p","bb-library-intro"),filters=node("div","bb-library-filters"),list=node("div","bb-library-list"),empty=node("p","bb-library-empty"),status=node("p","bb-library-status"),older=node("button","bb-library-older");
  root.id="beebot-conversation-library";root.dataset.bbLibrary="";heading.id="bb-library-heading";root.setAttribute("aria-labelledby",heading.id);filters.setAttribute("role","group");status.setAttribute("role","status");older.type="button";
  const choices=new Map();for(const key of ["all","page","file","link"]){const button=node("button");button.type="button";button.dataset.filter=key;button.onclick=()=>{filter=key;render();};choices.set(key,button);filters.append(button);}
  root.append(heading,intro,filters,list,empty,status,older);
  let disposed=false,room=null,entryStore=null,offEntries,remoteActive=false,epoch=0,serial=0,filter="all",items=[],pageBusy=false,error="",host=null,expandedId=null,installGeneration=null;
  const disposers=[],cards=new Map(),selected=()=>runtime.selection.snapshots.get()?.currentAgentId??null,remote=()=>document.body?.dataset.beebotRemoteActive==="true",down=()=>runtime.connection?.snapshots?.get?.()?.transport==="down";
  const snapshot=()=>entryStore?.get?.()??{},rows=()=>runtime.roster?.snapshots?.get?.()?.agents?.rows??[];
  const name=item=>rows().find(row=>row.id===item.authorId)?.name||item.authorName||t("Bot 同事","Colleague");
  const current=(at,id,request)=>!disposed&&at===epoch&&room===id&&selected()===id&&request===serial&&!remote()&&!down()&&host?.isConnected&&host.closest(".sand-info-pane")?.getAttribute("aria-hidden")!=="true";
  const clearPreview=()=>{serial++;expandedId=null;for(const card of cards.values()){card.preview.hidden=true;card.preview.replaceChildren();card.open.setAttribute("aria-expanded","false");}};
  if(!document.getElementById("bb-library-style")){
    const style=node("style");style.id="bb-library-style";style.textContent=`
      .bb-library{min-width:0;font:13px/1.5 system-ui;color:var(--bee-text-primary,var(--cursor-text-primary,CanvasText));-webkit-app-region:no-drag;border-top:1px solid var(--cursor-stroke-secondary,#8884);padding:15px 0 8px;margin-top:10px}
      .bb-library[hidden],.bb-library [hidden]{display:none!important}.bb-library h2{font:inherit;font-weight:600;margin:0 0 5px}.bb-library p{overflow-wrap:anywhere}
      .bb-library-intro,.bb-library-empty,.bb-library-status{font-size:12px;color:var(--bee-text-secondary,var(--cursor-text-secondary,GrayText));margin:0 0 11px}.bb-library-status:empty{display:none}
      .bb-library-filters{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}.bb-library button{font:inherit;color:inherit;cursor:pointer;border:0;background:transparent}
      .bb-library-filters button{font-size:12px;padding:4px 8px;border-radius:7px}.bb-library-filters button[aria-pressed="true"]{background:color-mix(in srgb,currentColor 9%,transparent);font-weight:550}.bb-library button:hover{background:color-mix(in srgb,currentColor 5%,transparent)}
      .bb-library button:focus-visible{outline:2px solid var(--bee-accent,var(--cursor-accent,Highlight));outline-offset:2px}.bb-library button:disabled{opacity:.5;cursor:default}
      .bb-library-card{min-width:0;border-top:1px solid var(--cursor-stroke-secondary,#8883);padding:6px 0}.bb-library-card:first-child{border-top:0}.bb-library-open{width:100%;text-align:left;border-radius:8px;display:flex;align-items:flex-start;gap:9px;padding:7px 5px}
      .bb-library-icon{flex:none;width:25px;height:28px;display:grid;place-items:center;font-size:18px;color:var(--bee-text-secondary,var(--cursor-text-secondary,GrayText))}.bb-library-body{display:grid;min-width:0;flex:1}.bb-library-title{font-size:13px;font-weight:500;overflow-wrap:anywhere}.bb-library-meta{font-size:11px;color:var(--bee-text-secondary,var(--cursor-text-secondary,GrayText));overflow-wrap:anywhere}
      .bb-library-preview{padding:4px 6px 10px;min-width:0}.bb-library-preview pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,monospace;max-height:260px;overflow:auto;padding:9px;border-radius:8px;background:color-mix(in srgb,currentColor 4%,transparent)}.bb-library-preview img,.bb-library-preview video{max-width:100%;max-height:260px;border-radius:8px}.bb-library-preview audio{width:100%}
      .bb-library-source{font-size:11px;color:var(--bee-text-secondary,var(--cursor-text-secondary,GrayText));margin:7px 0}.bb-library-source-text{white-space:pre-wrap}.bb-library-link{font-size:12px;border:1px solid var(--cursor-stroke-secondary,#8884)!important;border-radius:7px;padding:5px 9px}.bb-library-older{font-size:12px!important;border-radius:7px;padding:6px 8px;margin-top:6px}
      @media(max-width:500px){.bb-library-open{padding:6px 2px;gap:6px}.bb-library-filters button{padding:4px 6px}}
    `;document.head.append(style);
  }
  function sync(){
    if(disposed)return;
    const next=selected(),isRemote=remote();
    if(next!==room||isRemote!==remoteActive){epoch++;clearPreview();room=next;remoteActive=isRemote;offEntries?.();offEntries=null;entryStore=null;pageBusy=false;error="";filter="all";items=[];for(const card of cards.values())card.root.remove();cards.clear();
      if(room&&!isRemote){entryStore=runtime.transcript.snapshotsFor(room);offEntries=entryStore.subscribe(sync);}}
    const generation=snapshot().installGeneration??null;if(generation!==installGeneration){installGeneration=generation;epoch++;clearPreview();pageBusy=false;}
    items=room&&!isRemote?RProjectConversationLibrary(snapshot(),room):[];
    render();
  }
  function source(card,item){
    const label=node("p","bb-library-source");label.textContent=t("来源消息","Source message")+" · "+name(item)+(item.timestampMs?" · "+new Date(item.timestampMs).toLocaleString(window.__sandUiLanguage==="zh"?"zh-CN":"en-US"):"");card.preview.append(label);
    if(item.sourceText){const text=node("p","bb-library-source bb-library-source-text");text.textContent=item.sourceText;card.preview.append(text);}
  }
  async function preview(card,item){
    const existing=items.find(value=>value.id===item.id);if(!existing||!room||remote()||down())return;
    const close=expandedId===item.id;clearPreview();if(close)return;expandedId=item.id;
    card.open.setAttribute("aria-expanded","true");card.preview.hidden=false;
    const at=epoch,id=room,request=serial;
    source(card,item);
    const content=node("div");card.preview.prepend(content);
    if(!item.local){
      const url=node("p","bb-library-source");url.textContent=item.url;content.append(url);
      if(typeof runtime.desktop?.openExternal==="function"){
        const open=node("button","bb-library-link");open.type="button";open.textContent=t("打开链接","Open link");content.append(open);
        open.onclick=async()=>{if(!current(at,id,request)||!RLibraryTarget(item.url)||!items.some(value=>value.id===item.id))return;open.disabled=true;try{await runtime.desktop.openExternal({url:item.url});}catch{if(current(at,id,request)){const failure=node("p","bb-library-status");failure.textContent=t("链接未能打开，可从来源消息重试。","The link could not open. Try again from its source message.");content.append(failure);}}finally{if(current(at,id,request))open.disabled=false;}};
      }
      return;
    }
    content.textContent=t("正在读取预览…","Loading preview…");
    try{
      const media=["avif","bmp","gif","jpeg","jpg","png","webp","mp4","mov","webm","m4v","mp3","wav","m4a","ogg","flac"].includes(item.extension);
      const result=media&&typeof runtime.desktop?.resolveAttachmentMedia==="function"?await runtime.desktop.resolveAttachmentMedia({source:item.url}):typeof runtime.desktop?.readAttachmentText==="function"?await runtime.desktop.readAttachmentText({path:item.url}):null;
      if(!current(at,id,request)||expandedId!==item.id||!items.some(value=>value.id===item.id))return;
      content.replaceChildren();
      if(result?.kind==="image"&&typeof result.dataUrl==="string"&&/^data:image\/(?:png|jpeg|gif|webp|bmp|avif);base64,/i.test(result.dataUrl)){const image=node("img");image.alt=item.title;image.src=result.dataUrl;content.append(image);}
      else if(["video","audio"].includes(result?.kind)&&typeof result.src==="string"&&/^(?:sand-media|beebot-media):\/\//.test(result.src)){const player=node(result.kind);player.controls=true;player.preload="metadata";player.src=result.src;content.append(player);}
      else if(typeof result==="string"||result?.kind==="text"&&typeof result.text==="string"){const text=node("pre");text.textContent=(typeof result==="string"?result:result.text).slice(0,65536);content.append(text);if(result?.truncated){const hint=node("p","bb-library-source");hint.textContent=t("这是部分预览。完整文件保留在来源消息中。","Partial preview. The full file remains in its source message.");content.append(hint);}}
      else content.textContent=t("暂时无法预览这份文件，请从来源消息查看。","This file cannot be previewed here. Open it from its source message.");
    }catch{if(current(at,id,request))content.textContent=t("预览暂不可用，文件与来源消息已保留。","Preview is unavailable. The file and source message are retained.");}
  }
  function render(){
    if(disposed)return;
    const nextHost=[...document.querySelectorAll("[data-beebot-library-host]")].find(el=>el.getAttribute("data-beebot-library-host")===room);
    const pane=nextHost?.closest(".sand-info-pane"),open=!!nextHost&&pane?.getAttribute("aria-hidden")!=="true"&&!nextHost.closest("[hidden],[inert]");
    if(nextHost!==host||!open){if(host||expandedId)clearPreview();pageBusy=false;host=nextHost||null;}
    if(nextHost&&root.parentElement!==nextHost)nextHost.append(root);
    root.hidden=!open||remote()||!room;
    heading.textContent=t("成果资料库","Library");intro.textContent=t("对话中已分享的页面、文件与链接。","Pages, files and links shared in this conversation.");filters.setAttribute("aria-label",t("成果类型","Item type"));
    const labels={all:t("全部","All"),page:t("页面","Pages"),file:t("文件","Files"),link:t("链接","Links")};
    for(const [key,button]of choices){button.textContent=labels[key];button.setAttribute("aria-pressed",String(key===filter));}
    const wanted=new Set();
    for(const item of items){
      wanted.add(item.id);let card=cards.get(item.id);
      if(!card){const article=node("article","bb-library-card"),button=node("button","bb-library-open"),icon=node("span","bb-library-icon"),body=node("span","bb-library-body"),title=node("span","bb-library-title"),meta=node("span","bb-library-meta"),view=node("div","bb-library-preview");button.type="button";button.setAttribute("aria-expanded","false");icon.setAttribute("aria-hidden","true");body.append(title,meta);button.append(icon,body);view.hidden=true;article.append(button,view);card={root:article,open:button,icon,title,meta,preview:view,item};button.onclick=()=>void preview(card,card.item);cards.set(item.id,card);}
      card.item=item;card.root.dataset.sourceEntryId=item.sourceEntryId;card.icon.textContent=item.kind==="page"?"▤":item.kind==="link"?"↗":"▧";card.title.textContent=item.title;card.meta.textContent=name(item)+(item.timestampMs?" · "+new Date(item.timestampMs).toLocaleDateString(window.__sandUiLanguage==="zh"?"zh-CN":"en-US"):"");card.root.hidden=filter!=="all"&&filter!==item.kind;
      if(card.root.parentElement!==list)list.append(card.root);
    }
    for(const [id,card]of cards)if(!wanted.has(id)){if(expandedId===id)clearPreview();card.root.remove();cards.delete(id);}
    items.forEach((item,index)=>{const card=cards.get(item.id).root;if(list.children[index]!==card)list.insertBefore(card,list.children[index]||null);});
    const count=items.filter(item=>filter==="all"||item.kind===filter).length;
    empty.hidden=count>0;empty.textContent=items.length?t("此类型暂无成果。","No items of this type yet."):t("分享的成果会出现在这里。","Shared results will appear here.");
    const state=snapshot();status.textContent=down()?t("连接已断开，显示上次载入的记录。","Disconnected. Showing the last loaded records."):error||state.olderFailure?t("较早的记录暂不可用，可重试载入。","Earlier records are unavailable. You can retry loading."):state.isShowingRestoredTranscript?t("显示已保存的记录，正在同步。","Showing saved records while syncing."):"";
    older.hidden=!state.hasOlder;older.disabled=pageBusy||state.isLoadingOlder||down();older.textContent=pageBusy||state.isLoadingOlder?t("正在载入…","Loading…"):t("载入较早的成果","Load earlier results");
  }
  older.onclick=async()=>{
    if(!room||remote()||down()||pageBusy||!snapshot().hasOlder||typeof runtime.transcript.loadOlder!=="function")return;
    clearPreview();const at=epoch,id=room,request=serial;pageBusy=true;error="";render();
    try{await runtime.transcript.loadOlder(id);}catch{if(current(at,id,request))error="older";}finally{if(current(at,id,request)){pageBusy=false;sync();}}
  };
  const connectionChanged=()=>{epoch++;clearPreview();pageBusy=false;error="";sync();},navigationChanged=()=>{epoch++;clearPreview();pageBusy=false;error="";sync();};
  disposers.push(runtime.selection.snapshots.subscribe(sync));if(runtime.connection?.snapshots)disposers.push(runtime.connection.snapshots.subscribe(connectionChanged));if(runtime.roster?.snapshots)disposers.push(runtime.roster.snapshots.subscribe(render));
  window.addEventListener("sand-ui-language-changed",render);window.addEventListener("beebot-node-selection",navigationChanged);
  const observer=new MutationObserver(records=>{if(records.some(record=>record.type==="attributes"?!record.target.closest?.("[data-bb-library]"):[...record.addedNodes,...record.removedNodes].some(el=>el.nodeType===1&&!el.matches?.("[data-bb-library]")&&!el.closest?.("[data-bb-library]"))))render();});observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["aria-hidden","hidden","inert","data-beebot-library-host"]});
  window.__beebotConversationLibrary={runtime,dispose(){disposed=true;epoch++;clearPreview();offEntries?.();disposers.forEach(off=>off?.());observer.disconnect();root.remove();cards.clear();items=[];window.removeEventListener("sand-ui-language-changed",render);window.removeEventListener("beebot-node-selection",navigationChanged);if(window.__beebotConversationLibrary?.runtime===runtime)delete window.__beebotConversationLibrary;}};
  sync();
}
