/* Remote Bots belong in the main Bot list, but never enter the local Host roster. */
(function(){
  if(window.__beebotServerBots)return;
  const api=()=>window.desktop?.nodes;
  const t=(cn,en)=>window.__sandUiLanguage==="zh"?cn:en;
  const cacheKey="beebot.server-bot-catalog.v1";
  const cleanBot=b=>({id:b.id,name:b.name,description:b.description||"",avatarColor:b.avatarColor,avatarShape:b.avatarShape});
  let profiles=[],catalog=Object.create(null),active=null,inflight=null,timer,queued=false;
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
    profiles=await api().request({action:"list"});prune();render();return profiles;
  }
  async function refresh(){
    if(inflight)return inflight;
    if(!api())return;
    inflight=(async()=>{
      await listServers();
      const targets=profiles.filter(p=>["online","reconnecting"].includes(p.status));
      await Promise.allSettled(targets.map(async p=>{
        const snapshot=await api().request({action:"snapshot",id:p.id});
        const current=profiles.find(item=>item.id===p.id&&item.nodeId===p.nodeId&&item.status!=="signed-out");
        if(current&&snapshot.node?.id===p.nodeId&&Array.isArray(snapshot.bots)){
          catalog[p.id]={nodeId:p.nodeId,bots:snapshot.bots.filter(b=>b&&typeof b.id==="string"&&typeof b.name==="string").map(cleanBot)};
          save();render();
        }
      }));
      // Refresh status after connection recovery, and discard a removed or signed-out target.
      profiles=await api().request({action:"list"});prune();render();
    })();
    try{await inflight;}finally{inflight=null;}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>void refresh().catch(()=>{}),300);}
  function selected(value){
    active=value;
    if(document.body){if(value)document.body.dataset.beebotRemoteActive="true";else delete document.body.dataset.beebotRemoteActive;}
    render();
  }
  async function open(connectionId,bot){
    await window.__beebotNodeChat?.open(connectionId,cleanBot(bot));
  }
  window.__beebotServerBots={
    listServers,refresh,open,
    async create({connectionId,name,description,avatarColor,avatarShape,key}){
      const servers=await listServers();
      if(!servers.some(p=>p.id===connectionId&&p.status==="online"))throw new Error(t("所选服务器未连接，请恢复连接后重试。","The selected server is not connected. Reconnect and try again."));
      const payload={action:"createBot",id:connectionId,name,description:description||"",key};
      if(avatarColor!==undefined)payload.avatarColor=avatarColor;
      if(avatarShape!==undefined)payload.avatarShape=avatarShape;
      const result=await api().request(payload);
      if(!result?.bot?.id)throw new Error(t("服务器未返回新建的 Bot。","The server did not return the new Bot."));
      // Sign-out or removal may have happened while the server handled creation.
      // Do not restore metadata after that explicit local action.
      let latest=[];try{latest=await listServers();}catch{}
      const original=servers.find(p=>p.id===connectionId),p=latest.find(p=>p.id===connectionId&&p.nodeId===original.nodeId&&p.status!=="signed-out");
      if(!p)throw new Error(t("Bot 已在服务器创建，但连接已改变。请重新连接后查看，或保留当前信息重试。","The Bot was created on the server, but the connection changed. Reconnect to view it, or retry with the same details."));
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
    const entries=profiles.flatMap(p=>(catalog[p.id]?.bots||[]).map(b=>({p,b})));
    const signature=JSON.stringify([entries,active,t("服务器 Bot","Server Bots")]);
    if(section.dataset.signature===signature)return;section.dataset.signature=signature;
    section.replaceChildren();section.hidden=!entries.length;

    for(const {p,b} of entries){
      const row=document.createElement("button");row.type="button";row.className="sand-agent-item bb-server-bot";
      row.dataset.nodeBotId=b.id;row.dataset.nodeConnectionId=p.id;
      row.setAttribute("aria-current",String(active?.connectionId===p.id&&active?.botId===b.id));
      const avatar=document.createElement("span");avatar.className="sand-agent-item__avatar";
      if(typeof RBotSvg==="function")avatar.append(RBotSvg(b.avatarShape||"blob",b.avatarColor||"green",36));else avatar.textContent="◉";
      const body=document.createElement("span");body.className="sand-agent-item__body";
      const name=document.createElement("strong");name.className="sand-agent-item__name";name.textContent=b.name;
      const preview=document.createElement("small");preview.className="sand-agent-item__preview";
      preview.textContent=p.name+(p.status==="online"?"":t(" · 未连接"," · Offline"));body.append(name,preview);row.append(avatar,body);
      row.title=`${b.name} · ${p.name}`;row.onclick=()=>void open(p.id,b);section.append(row);
    }
  }
  function mount(){
    if(!document.body)return;
    if(!document.getElementById("beebot-server-bots-style")){
      const style=document.createElement("style");style.id="beebot-server-bots-style";style.textContent=`
        #beebot-server-bot-list{margin-top:12px;padding:0 4px 12px}
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
  queueMicrotask(()=>{mount();api()?.onChanged(schedule);void refresh().catch(()=>{});});
  setInterval(()=>void refresh().catch(()=>{}),15_000);
})();
