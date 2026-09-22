/* Remote Bots belong in the main Bot list, but never enter the local Host roster. */
(function(){
  if(window.__beebotServerBots)return;
  const api=()=>window.desktop?.nodes;
  const t=(cn,en)=>window.__sandUiLanguage==="zh"?cn:en;
  const cacheKey="beebot.server-bot-catalog.v1";
  const cleanBot=b=>({id:b.id,name:b.name,description:b.description||"",avatarColor:b.avatarColor,avatarShape:b.avatarShape});
  let profiles=[],catalog=Object.create(null),active=null,inflight=null,timer,queued=false;
  let connectionEpoch=0,listSerial=0,rowSerial=0,profilesTrusted=false;
  const rows=new Map(),opening=new Set(),openErrors=new Map();
  const rowKey=(p,b)=>JSON.stringify([p.id,p.nodeId,b.id]);
  try{
    const data=JSON.parse(localStorage.getItem(cacheKey)||"{}");
    if(data&&typeof data==="object"&&!Array.isArray(data))for(const [id,entry] of Object.entries(data)){
      if(typeof entry?.nodeId==="string"&&Array.isArray(entry.bots))catalog[id]={nodeId:entry.nodeId,bots:entry.bots.filter(b=>b&&typeof b.id==="string"&&typeof b.name==="string").map(cleanBot)};
    }
  }catch{}
  function save(){try{localStorage.setItem(cacheKey,JSON.stringify(catalog));}catch{}}
  function prune(){
    for(const id of Object.keys(catalog)){
      const p=profiles.find(p=>p.id===id);
      if(!p||p.nodeId!==catalog[id]?.nodeId||p.status==="signed-out")delete catalog[id];
    }
    save();
  }
  async function listServers(){
    if(!api())return [];
    const epoch=connectionEpoch,serial=++listSerial;
    const result=await api().request({action:"list"});
    if(epoch!==connectionEpoch||serial!==listSerial)return profilesTrusted?profiles:[];
    if(!Array.isArray(result))throw new Error(t("服务器连接列表格式无效。","Invalid server connection list."));
    profiles=result;profilesTrusted=true;prune();render();return profiles;
  }
  async function refresh(){
    if(inflight?.epoch===connectionEpoch)return inflight.promise;
    if(!api())return;
    const job={epoch:connectionEpoch,promise:null};
    job.promise=(async()=>{
      await listServers();if(job.epoch!==connectionEpoch||!profilesTrusted)return;
      const targets=profiles.filter(p=>["online","reconnecting"].includes(p.status));
      await Promise.allSettled(targets.map(async p=>{
        const snapshot=await api().request({action:"snapshot",id:p.id});
        if(job.epoch!==connectionEpoch)return;
        // Independent lanes: a stalled server cannot hold another server's result.
        const latest=await listServers();if(job.epoch!==connectionEpoch||!profilesTrusted)return;
        const current=latest.find(item=>item.id===p.id&&item.nodeId===p.nodeId&&["online","reconnecting"].includes(item.status));
        if(current&&snapshot?.node?.id===p.nodeId&&Array.isArray(snapshot.bots)){
          catalog[p.id]={nodeId:p.nodeId,bots:snapshot.bots.filter(b=>b&&typeof b.id==="string"&&typeof b.name==="string").map(cleanBot)};
          save();render();
        }
      }));
      if(job.epoch===connectionEpoch)await listServers();
    })();
    inflight=job;
    try{await job.promise;}finally{if(inflight===job)inflight=null;}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>void refresh().catch(()=>{}),300);}
  function selected(value){
    active=value;
    if(document.body){if(value)document.body.dataset.beebotRemoteActive="true";else delete document.body.dataset.beebotRemoteActive;}
    render();
  }
  async function open(connectionId,bot){
    if(typeof window.__beebotNodeChat?.open!=="function")throw new Error(t("此版本的聊天入口不可用。","The conversation entry is unavailable in this build."));
    await window.__beebotNodeChat.open(connectionId,cleanBot(bot));
  }
  window.__beebotServerBots={
    listServers,refresh,open,
    async create({connectionId,name,description,avatarColor,avatarShape,key}){
      const servers=await listServers();
      if(!servers.some(p=>p.id===connectionId&&p.status==="online"))throw new Error(t("所选服务器未连接，请恢复连接后重试。","The selected server is not connected. Reconnect and try again."));
      const epoch=connectionEpoch;
      const payload={action:"createBot",id:connectionId,name,description:description||"",key};
      if(avatarColor!==undefined)payload.avatarColor=avatarColor;
      if(avatarShape!==undefined)payload.avatarShape=avatarShape;
      const result=await api().request(payload);
      if(!result?.bot?.id)throw new Error(t("服务器未返回新建的 Bot。","The server did not return the new Bot."));
      // Sign-out or removal may have happened while the server handled creation.
      // Do not restore metadata after that explicit local action.
      let latest=[];try{latest=await listServers();}catch{}
      const original=servers.find(p=>p.id===connectionId),p=latest.find(p=>p.id===connectionId&&p.nodeId===original.nodeId&&p.status!=="signed-out");
      if(!p||epoch!==connectionEpoch)throw new Error(t("Bot 已在服务器创建，但连接已改变。请重新连接后查看，或保留当前信息重试。","The Bot was created on the server, but the connection changed. Reconnect to view it, or retry with the same details."));
      const entry=catalog[connectionId]||{nodeId:p.nodeId,bots:[]};entry.bots=[...entry.bots.filter(b=>b.id!==result.bot.id),cleanBot(result.bot)];catalog[connectionId]=entry;save();render();
      schedule();
      return result;
    }
  };
  function render(){
    const list=document.querySelector(".sand-agents-list");
    const target=list?.querySelector(':scope > [data-native-scrollbar="none"] > div')||list?.querySelector(".sand-agents-list__rows")||list;
    if(!target)return;
    let section=document.getElementById("beebot-server-bot-list");
    if(!section){section=document.createElement("section");section.id="beebot-server-bot-list";}
    if(section.parentElement!==target)target.append(section);
    const entries=profilesTrusted?profiles.flatMap(p=>(catalog[p.id]?.bots||[]).map(b=>({p,b}))):[];
    const signature=JSON.stringify([entries,active,[...opening],[...openErrors],t("服务器 Bot","Server Bots")]);
    if(section.dataset.signature===signature)return;section.dataset.signature=signature;
    const wanted=new Set(entries.map(({p,b})=>rowKey(p,b)));
    for(const [key,item] of rows)if(!wanted.has(key)){item.row.remove();item.error.remove();rows.delete(key);openErrors.delete(key);}
    section.hidden=!entries.length;
    entries.forEach(({p,b},index)=>{
      const key=rowKey(p,b);let item=rows.get(key);
      if(!item){
        const row=document.createElement("button");row.type="button";row.className="sand-agent-item bb-server-bot";
        const avatar=document.createElement("span");avatar.className="sand-agent-item__avatar";
        const body=document.createElement("span");body.className="sand-agent-item__body";
        const name=document.createElement("strong");name.className="sand-agent-item__name";
        const preview=document.createElement("small");preview.className="sand-agent-item__preview";
        const error=document.createElement("p");error.className="bb-server-bot-error";error.setAttribute("role","status");
        error.id="bb-open-error-"+(++rowSerial);
        body.append(name,preview);row.append(avatar,body);
        item={row,avatar,name,preview,error,avatarSignature:null,p,b};rows.set(key,item);
        row.onclick=async()=>{
          if(opening.has(key))return;
          opening.add(key);openErrors.delete(key);render();
          try{await open(item.p.id,item.b);}
          catch(error){
            // A newer selection or a closed view is not a failed server operation.
            if(!["open_cancelled","open_superseded"].includes(error?.code))openErrors.set(key,error?.code||"open_failed");
          }finally{opening.delete(key);render();}
        };
      }
      item.p=p;item.b=b;
      item.row.dataset.nodeBotId=b.id;item.row.dataset.nodeConnectionId=p.id;
      item.row.setAttribute("aria-current",String(active?.connectionId===p.id&&active?.botId===b.id));
      item.row.setAttribute("aria-busy",String(opening.has(key)));
      const avatarSignature=JSON.stringify([b.avatarShape,b.avatarColor,typeof RBotSvg]);
      if(item.avatarSignature!==avatarSignature){
        item.avatarSignature=avatarSignature;item.avatar.replaceChildren();
        if(typeof RBotSvg==="function")item.avatar.append(RBotSvg(b.avatarShape||"blob",b.avatarColor||"green",36));else item.avatar.textContent="◉";
      }
      item.name.textContent=b.name;
      item.preview.textContent=opening.has(key)?t("正在核验会话…","Checking conversation…"):p.name+(p.status==="online"?"":t(" · 未连接"," · Offline"));
      item.row.title=`${b.name} · ${p.name}`;
      const errorCode=openErrors.get(key);item.error.hidden=!errorCode;
      item.error.textContent=errorCode?(errorCode==="connection_unavailable"||errorCode==="connection_changed"
        ?t("连接尚未就绪，请在设置 → 服务器中检查。原会话未改变。","Check this connection in Settings → Servers. Your previous conversation is unchanged.")
        :t("暂时无法打开，原会话未改变。再次点击此 Bot 重试。","Could not open this Bot. Your previous conversation is unchanged. Click the Bot to retry.")):"";
      if(errorCode)item.row.setAttribute("aria-describedby",item.error.id);else item.row.removeAttribute("aria-describedby");
      // Reuse row nodes; polling must not discard focus or the selected Bot's identity.
      const position=index*2;
      if(section.children[position]!==item.row)section.insertBefore(item.row,section.children[position]||null);
      if(section.children[position+1]!==item.error)section.insertBefore(item.error,section.children[position+1]||null);
    });
  }

  function mount(){
    if(!document.body)return;
    if(!document.getElementById("beebot-server-bots-style")){
      const style=document.createElement("style");style.id="beebot-server-bots-style";style.textContent=`
        #beebot-server-bot-list{margin-top:12px;padding:0 4px 12px}
        #beebot-server-bot-list .bb-server-bot-error{margin:0 10px 10px;font:12px/1.5 system-ui;color:var(--cursor-text-secondary,#777);overflow-wrap:anywhere}
        #beebot-server-bot-list [hidden]{display:none!important}
        .bb-server-bots-heading{padding:8px 12px;font:11px system-ui;color:var(--cursor-text-secondary,#999)}
        #beebot-server-bot-list .bb-server-bot{display:flex;align-items:center;gap:10px;width:100%;min-height:58px;padding:8px 10px;border:0;border-radius:8px;text-align:left;background:transparent;color:var(--cursor-text-primary,#eee);font:inherit;cursor:pointer;-webkit-app-region:no-drag}
        #beebot-server-bot-list .sand-agent-item__body{display:flex;flex:1;min-width:0;flex-direction:column;gap:3px}
        #beebot-server-bot-list .sand-agent-item__name,#beebot-server-bot-list .sand-agent-item__preview{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        #beebot-server-bot-list .sand-agent-item__name{font-size:13px;font-weight:500}
        #beebot-server-bot-list .sand-agent-item__preview{font-size:11px;color:var(--cursor-text-secondary,#999)}
        #beebot-server-bot-list .bb-server-bot:hover,#beebot-server-bot-list .bb-server-bot[aria-current=true]{background:var(--cursor-bg-secondary,#303030)}
        #beebot-server-bot-list .bb-server-bot:focus-visible{outline:2px solid var(--cursor-accent,#599ce7);outline-offset:-2px}
        body[data-beebot-remote-active] .sand-agent-item[data-agent-id][data-active=true],body[data-beebot-remote-active] .sand-agent-item[data-agent-id][aria-current=true],body[data-beebot-remote-active] .sand-agent-item[data-agent-id][aria-selected=true]{background:transparent!important}
      `;document.head.append(style);
    }
    render();
  }
  new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;mount();});}).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener("beebot-node-selection",event=>selected(event.detail));
  window.addEventListener("sand-ui-language-changed",render);
  document.addEventListener("click",event=>{if(event.target instanceof Element&&event.target.closest(".sand-agents-list [data-agent-id]")){window.__beebotNodeChat?.close();window.__beebotCloseNodeWorkbench?.();selected(null);}},true);
  // Delay until the pinned renderer has initialized avatar constants and its sidebar.
  queueMicrotask(()=>{mount();api()?.onChanged(event=>{
    connectionEpoch++;listSerial++;profilesTrusted=false;
    // No principal identifier is exposed by this bridge. A quick sign-out/sign-in
    // cannot be proved to be the same account: discard the affected private cache.
    if(typeof event?.id==="string")delete catalog[event.id];else catalog=Object.create(null);
    save();render();schedule();
  });void refresh().catch(()=>{});});
  setInterval(()=>void refresh().catch(()=>{}),15_000);
})();
