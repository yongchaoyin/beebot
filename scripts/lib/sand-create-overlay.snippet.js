function RUiCopy(){
  const zh=(window.__sandUiLanguage||"en")==="zh";
  return zh?{
    title:"新建 Bot",nameLabel:"名称",ph:"New Bot",start:"开始使用",close:"关闭",vendor:"使用的 API",
    newBot:"新建 Bot",newGroup:"新建群聊",groupTitle:"新建群聊",groupName:"群名称",
    to:"收件人：",search:"搜索 Bot",create:"创建",deployment:"部署服务器",local:"本机",responsibilities:"职责",
    serverHint:"这个 Bot 使用所选服务器的模型和工作环境。",offline:"未连接",creating:"正在创建…",
    unavailable:"请选择已连接的服务器，或等待所选服务器恢复连接。",missing:"服务器连接功能暂不可用。",invalid:"服务器未返回新建的 Bot。"
  }:{
    title:"New Bot",nameLabel:"Name",ph:"New Bot",start:"Get started",close:"Close",vendor:"API",
    newBot:"New Bot",newGroup:"New group chat",groupTitle:"New group chat",groupName:"Group name",
    to:"To:",search:"Search Bot",create:"Create",deployment:"Deployment server",local:"This Mac",responsibilities:"Responsibilities",
    serverHint:"This Bot uses the selected server's model and working environment.",offline:"Not connected",creating:"Creating…",
    unavailable:"Choose a connected server, or wait for the selected server to reconnect.",missing:"Server connections are unavailable.",invalid:"The server did not return the new Bot."
  };
}
const R_COLORS=[{id:"black",hex:"#000"},{id:"brown",hex:"#936439"},{id:"red",hex:"#FF263C"},{id:"orange",hex:"#FF6700"},{id:"yellow",hex:"#FF9800"},{id:"green",hex:"#00C972"},{id:"cyan",hex:"#00BCA6"},{id:"blue",hex:"#1084FE"},{id:"violet",hex:"#9159FE"},{id:"magenta",hex:"#FF309B"},{id:"gray",hex:"#777"}];
const R_INK={black:{light:"#000000",dark:"#FFFFFF"},brown:{light:"#A27952",dark:"#855C36"},red:{light:"#FF3E51",dark:"#E02135"},orange:{light:"#FF781C",dark:"#FF6700"},yellow:{light:"#FFAF38",dark:"#FF9800"},green:{light:"#00C972",dark:"#009957"},cyan:{light:"#1CC3B0",dark:"#00A592"},blue:{light:"#2A92FE",dark:"#0E74E0"},violet:{light:"#A97EFE",dark:"#804EE0"},magenta:{light:"#FF5EB1",dark:"#E02A88"},gray:{light:"#959595",dark:"#777777"}};
const R_SHAPES=["blob","pebble","squircle","tablet","wedge","hex","cloud","teardrop"];
function RBotSvg(shape,colorId,size){
  const ink=R_INK[colorId]||R_INK.green;
  const d=(typeof R_PATHS==="object"&&R_PATHS[shape])||(R_PATHS&&R_PATHS.blob)||"";
  const id="b"+Math.random().toString(36).slice(2,8);
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","-15 -15 259 259");
  svg.setAttribute("width",String(size));
  svg.setAttribute("height",String(size));
  svg.setAttribute("aria-hidden","true");
  svg.style.display="block";
  svg.innerHTML=`<defs><linearGradient id="${id}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${ink.light}"/><stop offset="1" stop-color="${ink.dark}"/></linearGradient></defs><path d="${d}" fill="url(#${id})"/><g fill="#fff"><ellipse cx="85.27" cy="106.27" rx="10" ry="7"/><ellipse cx="143.27" cy="106.27" rx="10" ry="7"/></g>`;
  return svg;
}
async function RLang(){try{const st=await window.desktop.agent.getUiLanguage();window.__sandUiLanguage=st?.language==="zh"?"zh":"en"}catch{}}
function RSidebarLeft(){const el=document.querySelector(".sand-agents-sidebar, [class*='sand-agents-sidebar']");return el?Math.round(el.getBoundingClientRect().width):260}
function RAgentVendorId(agentId){
  window.__sandAgentVendors=window.__sandAgentVendors||{};
  if(window.__sandAgentVendors[agentId]) return window.__sandAgentVendors[agentId];
  const roster=window.__sandRoster;
  const pools=[];
  try{pools.push(roster?.snapshots?.get?.()?.agents?.rows)}catch{}
  try{pools.push(roster?.snapshots?.get?.()?.rows)}catch{}
  try{pools.push(roster?.snapshots?.view?.()?.value?.rows)}catch{}
  try{pools.push(roster?.snapshots?.view?.()?.value?.agents?.rows)}catch{}
  for(const rows of pools){
    if(!Array.isArray(rows)) continue;
    const row=rows.find(a=>a&&a.id===agentId);
    if(row&&typeof row.inferenceVendorId==="string"&&row.inferenceVendorId.length>0) return row.inferenceVendorId;
  }
  return "";
}
function RRosterRows(){
  const roster=window.__sandRoster; const pools=[];
  try{pools.push(roster?.snapshots?.get?.()?.agents?.rows)}catch{}
  try{pools.push(roster?.snapshots?.get?.()?.rows)}catch{}
  try{pools.push(roster?.snapshots?.view?.()?.value?.rows)}catch{}
  try{pools.push(roster?.snapshots?.view?.()?.value?.agents?.rows)}catch{}
  try{pools.push(roster?.getSnapshot?.()?.agents)}catch{}
  for(const rows of pools){ if(Array.isArray(rows)&&rows.length) return rows; }
  return [];
}
function RIsGroupId(id){
  const row=RRosterRows().find(r=>r&&r.id===id);
  return !!(row&&(row.isGroup===true||row.kind==="group"));
}
function RListAgents(){
  const seen=new Set(); const out=[];
  for(const el of document.querySelectorAll("[data-agent-id]")){
    if(el.closest("[data-node-bot-id], [data-node-connection-id]"))continue;
    const id=el.getAttribute("data-agent-id"); if(!id||seen.has(id)||RIsGroupId(id)) continue; seen.add(id);
    const name=(el.querySelector("[class*='name']")||el).textContent.trim().split("\n")[0]||id;
    out.push({id,name});
  }
  return out;
}

window.__sandPickCreateBot=async function(preset){
  await RLang(); const copy=RUiCopy(); const previous=document.getElementById("sand-create-bot-sheet");
  if(previous?.__sandDismiss){if(previous.__sandDismiss()===false)return null}else previous?.remove();
  return new Promise(resolve=>{
  const root=document.createElement("div"); root.id="sand-create-bot-sheet";
  const left=RSidebarLeft();
  root.style.cssText="position:fixed;top:0;right:0;bottom:0;left:"+left+"px;z-index:99990;background:#fff;display:flex;flex-direction:column;align-items:center;padding:28px 24px;font-family:system-ui,-apple-system,sans-serif;color:#111;overflow:auto";
  let color=R_COLORS.some(c=>c.id===preset?.avatarColor)?preset.avatarColor:"green";
  let shape=R_SHAPES.includes(preset?.avatarShape)?preset.avatarShape:"blob";
  let name=typeof preset?.name==="string"?preset.name:"";
  let description=typeof preset?.description==="string"?preset.description:"";
  let deploymentServerId=typeof preset?.deploymentServerId==="string"?preset.deploymentServerId:"";
  let servers=[],busy=false,alive=true,refreshSerial=0,unsubscribe;
  const operationKeys=new Map();
  let vendors=[]; let vendorId=typeof preset?.inferenceVendorId==="string"?preset.inferenceVendorId:"";
  const finish=v=>{if(!alive)return;alive=false;refreshSerial++;unsubscribe?.();root.remove();resolve(v)};
  root.__sandDismiss=()=>{if(busy)return false;finish(null);return true};
  const status=document.createElement("div");status.setAttribute("role","status");status.style.cssText="width:min(420px,100%);font-size:13px;color:#b3261e;white-space:pre-wrap;margin-top:12px";
  const setError=error=>{status.textContent=error?String(error.message||error):""};
  let deployment,submit,input,responsibilities,close,vendorSelect;
  const online=()=>servers.some(server=>server.id===deploymentServerId&&server.status==="online");
  const updateReady=()=>{
    if(!submit)return;
    submit.disabled=busy||!!deploymentServerId&&!online();submit.textContent=busy?copy.creating:copy.start;submit.style.opacity=submit.disabled?".5":"1";
    for(const field of root.querySelectorAll("input,textarea,select,button"))field.disabled=busy;
    submit.disabled=busy||!!deploymentServerId&&!online();
  };
  const renderServers=()=>{
    if(!deployment)return;
    deployment.replaceChildren();
    const local=document.createElement("option");local.value="";local.textContent=copy.local;deployment.append(local);
    for(const server of servers){const option=document.createElement("option");option.value=server.id;option.textContent=[server.name||server.baseUrl,server.baseUrl,server.status==="online"?"":copy.offline].filter(Boolean).join(" · ");deployment.append(option)}
    if(deploymentServerId&&!servers.some(server=>server.id===deploymentServerId)){const missing=document.createElement("option");missing.value=deploymentServerId;missing.textContent=copy.offline;deployment.append(missing)}
    deployment.value=deploymentServerId;updateReady();
  };
  const refreshServers=async()=>{
    const serial=++refreshSerial;
    try{const listed=await window.__beebotServerBots?.listServers?.();if(!alive||serial!==refreshSerial)return;servers=Array.isArray(listed)?listed:[];renderServers()}
    catch(error){if(!alive||serial!==refreshSerial)return;servers=[];renderServers();if(deploymentServerId)setError(error)}
  };
  const paint=()=>{
    const hex=R_COLORS.find(c=>c.id===color)?.hex||"#00C972";
    root.innerHTML="";
    const bar=document.createElement("div"); bar.style.cssText="width:min(420px,100%);display:flex;align-items:center;gap:12px;margin-bottom:20px";
    close=document.createElement("button"); close.type="button"; close.textContent="×";close.setAttribute("aria-label",copy.close); close.style.cssText="width:36px;height:36px;border:0;border-radius:18px;background:#f2f2f0;font-size:22px;cursor:pointer"; close.onclick=()=>{if(!busy)finish(null)};
    const title=document.createElement("div"); title.textContent=copy.title; title.style.cssText="font-size:18px;font-weight:600";
    bar.append(close,title);
    const preview=document.createElement("div"); preview.style.cssText="width:120px;height:120px;margin:12px 0 24px"; preview.append(RBotSvg(shape,color,120));
    const colors=document.createElement("div"); colors.style.cssText="width:min(420px,100%);display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:12px";
    for(const item of R_COLORS){const b=document.createElement("button"); b.type="button";b.setAttribute("aria-label",item.id); b.style.cssText="width:26px;height:26px;border-radius:13px;border:"+(item.id===color?"2px solid #111":"2px solid transparent")+";background:"+item.hex+";cursor:pointer"; b.onclick=()=>{if(!busy){color=item.id;paint()}}; colors.append(b)}
    const shapes=document.createElement("div"); shapes.style.cssText="width:min(420px,100%);display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-bottom:20px";
    for(const item of R_SHAPES){const b=document.createElement("button"); b.type="button"; b.title=item; b.style.cssText="width:36px;height:36px;border:0;padding:0;background:transparent;cursor:pointer;border-radius:8px;outline:"+(item===shape?"2px solid #111":"none")+";outline-offset:2px"; b.append(RBotSvg(item,item===shape?color:"gray",32)); b.onclick=()=>{if(!busy){shape=item;paint()}}; shapes.append(b)}
    const deploymentLabel=document.createElement("label");deploymentLabel.textContent=copy.deployment;deploymentLabel.style.cssText="width:min(420px,100%);font-size:13px;color:#666;margin-bottom:6px";
    deployment=document.createElement("select");deployment.setAttribute("aria-label",copy.deployment);deployment.style.cssText="width:min(420px,100%);height:44px;border:0;border-radius:12px;background:#f4f4f2;padding:0 14px;font-size:15px;margin-bottom:12px";
    deployment.onchange=()=>{if(!busy){deploymentServerId=deployment.value;setError(null);paint();if(deploymentServerId&&!online())setError(copy.unavailable)}};
    const label=document.createElement("label"); label.textContent=copy.nameLabel; label.style.cssText="width:min(420px,100%);font-size:13px;color:#666;margin-bottom:6px";
    input=document.createElement("input"); input.type="text";input.maxLength=100;input.setAttribute("aria-label",copy.nameLabel); input.placeholder=copy.ph; input.value=name; input.style.cssText="width:min(420px,100%);height:44px;border:0;border-radius:12px;background:#f4f4f2;padding:0 14px;font-size:15px;margin-bottom:12px";
    input.oninput=()=>{name=input.value};
    const vendorLabel=document.createElement("label"); vendorLabel.textContent=copy.vendor; vendorLabel.style.cssText="width:min(420px,100%);font-size:13px;color:#666;margin:8px 0 6px";
    vendorSelect=document.createElement("select");vendorSelect.setAttribute("aria-label",copy.vendor); vendorSelect.style.cssText="width:min(420px,100%);height:44px;border:0;border-radius:12px;background:#f4f4f2;padding:0 14px;font-size:15px;margin-bottom:20px;appearance:none;-webkit-appearance:none;box-sizing:border-box";
    if(vendors.length===0){const opt=document.createElement("option"); opt.textContent=copy.vendor; opt.value=""; vendorSelect.append(opt)}
    for(const item of vendors){const opt=document.createElement("option"); opt.value=item.id; opt.textContent=item.label+(item.modelId?" · "+item.modelId:""); if(item.id===vendorId) opt.selected=true; vendorSelect.append(opt)}
    vendorSelect.onchange=()=>{vendorId=vendorSelect.value};
    const descriptionLabel=document.createElement("label");descriptionLabel.textContent=copy.responsibilities;descriptionLabel.style.cssText=vendorLabel.style.cssText;
    responsibilities=document.createElement("textarea");responsibilities.value=description;responsibilities.maxLength=8000;responsibilities.setAttribute("aria-label",copy.responsibilities);responsibilities.style.cssText="width:min(420px,100%);min-height:80px;border:0;border-radius:12px;background:#f4f4f2;padding:12px 14px;font:15px system-ui;margin-bottom:12px;box-sizing:border-box;resize:vertical";responsibilities.oninput=()=>{description=responsibilities.value};
    const hint=document.createElement("p");hint.textContent=copy.serverHint;hint.style.cssText="width:min(420px,100%);font-size:13px;color:#666;margin:0 0 16px";
    submit=document.createElement("button"); submit.type="button"; submit.textContent=copy.start; submit.style.cssText="width:min(420px,100%);height:44px;border:0;border-radius:22px;font-size:15px;font-weight:600;color:#fff;background:"+hex+";cursor:pointer";
    submit.onclick=async()=>{
      if(busy||!alive)return;
      const draft={name:name.trim()||copy.ph,avatarColor:color,avatarShape:shape,inferenceVendorId:vendorId||vendorSelect.value,isKickstartRequested:!0,deploymentServerId:""};
      if(!deploymentServerId){finish(draft);return}
      if(!online()){setError(copy.unavailable);return}
      const remote={deploymentServerId,name:draft.name,description,avatarColor:color,avatarShape:shape};
      const signature=JSON.stringify(remote);if(!operationKeys.has(signature))operationKeys.set(signature,crypto.randomUUID());
      busy=true;setError(null);updateReady();
      try{
        if(typeof window.__sandCreateAgent!=="function")throw new Error(copy.missing);
        await window.__sandCreateAgent({...remote,key:operationKeys.get(signature)});
        finish(null);
      }catch(error){if(alive)setError(error)}finally{busy=false;if(alive)updateReady()}
    };
    input.addEventListener("keydown",ev=>{if(ev.key==="Enter")submit.click()});
    root.append(bar,preview,colors,shapes,deploymentLabel,deployment,label,input);
    if(deploymentServerId)root.append(descriptionLabel,responsibilities,hint);else root.append(vendorLabel,vendorSelect);
    root.append(submit,status);renderServers();input.focus();
  };
  document.body.append(root);paint();void refreshServers();
  try{unsubscribe=window.desktop?.nodes?.onChanged?.(()=>void refreshServers())}catch{}
  Promise.resolve().then(()=>window.desktop.agent.getInferenceVendors()).then(listed=>{if(!alive)return;vendors=Array.isArray(listed?.vendors)?listed.vendors:[];if(!vendorId)vendorId=listed?.defaultVendorId||vendors[0]?.id||"";paint()}).catch(()=>{});
  });
};
window.__sandPickCreateGroup=function(){return new Promise(async resolve=>{
  await RLang(); const copy=RUiCopy(); document.getElementById("sand-create-group-sheet")?.remove();
  const agents=RListAgents();
  const root=document.createElement("div"); root.id="sand-create-group-sheet";
  root.style.cssText="position:fixed;inset:0;z-index:99991;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif";
  const card=document.createElement("div"); card.style.cssText="width:min(520px,92vw);max-height:86vh;overflow:auto;background:#fff;border-radius:16px;padding:20px;color:#111";
  let name=""; let query=""; const selected=[];
  const finish=v=>{root.remove();resolve(v)};
  const paint=()=>{
    const q=query.trim().toLowerCase();
    const filtered=agents.filter(a=>!q||a.name.toLowerCase().includes(q));
    card.innerHTML="";
    const head=document.createElement("div"); head.style.cssText="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px";
    const title=document.createElement("div"); title.textContent=copy.groupTitle; title.style.cssText="font-size:18px;font-weight:600";
    const close=document.createElement("button"); close.type="button"; close.textContent="×"; close.style.cssText="width:32px;height:32px;border:0;border-radius:16px;background:#f2f2f0;font-size:20px;cursor:pointer"; close.onclick=()=>finish(null);
    head.append(title,close);
    const nameLabel=document.createElement("label"); nameLabel.textContent=copy.groupName; nameLabel.style.cssText="display:block;font-size:13px;color:#666;margin-bottom:6px";
    const nameInput=document.createElement("input"); nameInput.type="text"; nameInput.value=name; nameInput.placeholder=copy.groupName; nameInput.style.cssText="width:100%;height:40px;border:0;border-radius:10px;background:#f4f4f2;padding:0 12px;font-size:14px;margin-bottom:14px;box-sizing:border-box";
    const to=document.createElement("div"); to.style.cssText="min-height:44px;border-radius:12px;background:#f7f7f5;padding:8px 10px;margin-bottom:10px;display:flex;flex-wrap:wrap;gap:6px;align-items:center";
    const toLabel=document.createElement("span"); toLabel.textContent=copy.to; toLabel.style.cssText="color:#888;font-size:13px"; to.append(toLabel);
    for(const id of selected){const a=agents.find(x=>x.id===id); const chip=document.createElement("button"); chip.type="button"; chip.textContent=(a?.name||id)+" ×"; chip.style.cssText="border:0;border-radius:14px;background:#ecece8;padding:4px 10px;cursor:pointer;font-size:13px"; chip.onclick=()=>{const i=selected.indexOf(id); if(i>=0)selected.splice(i,1); name=nameInput.value; paint()}; to.append(chip)}
    const search=document.createElement("input"); search.type="text"; search.value=query; search.placeholder=copy.search; search.style.cssText="width:100%;height:36px;border:0;margin-bottom:10px;font-size:14px;box-sizing:border-box";
    search.oninput=()=>{query=search.value; name=nameInput.value; paint(); const n=card.querySelector("input[placeholder='"+copy.search+"']"); n?.focus()};
    const list=document.createElement("div");
    for(const a of filtered){if(selected.includes(a.id)) continue; const row=document.createElement("button"); row.type="button"; row.textContent=a.name; row.style.cssText="display:block;width:100%;text-align:left;border:0;background:transparent;padding:10px 8px;border-radius:8px;cursor:pointer;font-size:14px"; row.onclick=()=>{selected.push(a.id); name=nameInput.value; query=""; paint()}; list.append(row)}
    const submit=document.createElement("button"); submit.type="button"; submit.textContent=copy.create;
    const applyReady=()=>{name=nameInput.value; const ready=name.trim().length>0&&selected.length>0; submit.disabled=!ready; submit.style.cssText="margin-top:14px;width:100%;height:44px;border:0;border-radius:22px;font-size:15px;font-weight:600;color:#fff;background:"+(ready?"#111":"#bbb")+";cursor:"+(ready?"pointer":"default"); return ready};
    nameInput.oninput=()=>{applyReady()};
    applyReady();
    submit.onclick=()=>{if(applyReady())finish({name:name.trim(),memberAgentIds:[...selected]})};
    card.append(head,nameLabel,nameInput,to,search,list,submit);
    nameInput.focus();
  };
  root.append(card); root.addEventListener("click",ev=>{if(ev.target===root)finish(null)}); document.body.append(root); paint();
})};
if(!window.__sandPlusMenuBound){window.__sandPlusMenuBound=!0;document.addEventListener("click",ev=>{
  const btn=ev.target&&ev.target.closest&&ev.target.closest(".sand-agents-sidebar__new");
  if(!btn) return;
  ev.preventDefault(); ev.stopPropagation();
  document.getElementById("sand-plus-menu")?.remove();
  const copy=RUiCopy();
  const menu=document.createElement("div"); menu.id="sand-plus-menu";
  const r=btn.getBoundingClientRect();
  menu.style.cssText="position:fixed;top:"+(r.bottom+8)+"px;left:"+Math.max(12,r.right-180)+"px;z-index:99992;background:#fff;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.16);padding:6px;min-width:168px;font-family:system-ui,-apple-system,sans-serif";
  const mk=(label,fn)=>{const b=document.createElement("button"); b.type="button"; b.textContent=label; b.style.cssText="display:block;width:100%;text-align:left;border:0;background:transparent;padding:10px 12px;border-radius:8px;cursor:pointer;font-size:14px"; b.onmouseenter=()=>b.style.background="#f4f4f2"; b.onmouseleave=()=>b.style.background="transparent"; b.onclick=()=>{menu.remove();fn()}; return b};
  menu.append(mk(copy.newBot,async()=>{const o=await window.__sandPickCreateBot(); if(o&&window.__sandCreateAgent) window.__sandCreateAgent(o)}), mk(copy.newGroup,async()=>{const o=await window.__sandPickCreateGroup(); if(o&&window.__sandCreateGroup) window.__sandCreateGroup(o)}));
  document.body.append(menu);
  const hide=e=>{if(!menu.contains(e.target)&&e.target!==btn){menu.remove();document.removeEventListener("mousedown",hide)}};
  setTimeout(()=>document.addEventListener("mousedown",hide),0);
},true)}
if(!window.__sandVendorPaneBound){window.__sandVendorPaneBound=!0;setInterval(async()=>{
  const pane=document.querySelector(".sand-agent-settings");
  if(!pane) return;
  const agentId=document.querySelector("[data-agent-id][data-active='true'], [data-agent-id][aria-current='true']")?.getAttribute("data-agent-id");
  if(!agentId) return;
  let listed; try{listed=await window.desktop.agent.getInferenceVendors()}catch{return}
  const vendors=Array.isArray(listed?.vendors)?listed.vendors:[];
  if(vendors.length===0) return;
  const current=RAgentVendorId(agentId)||listed?.defaultVendorId||vendors[0]?.id||"";
  const existing=pane.querySelector("#sand-agent-vendor");
  if(existing&&existing.getAttribute("data-agent-id")!==agentId) existing.remove();
  const present=pane.querySelector("#sand-agent-vendor");
  if(present){
    const sel=present.querySelector("select");
    if(sel&&current&&sel.value!==current) sel.value=current;
    return;
  }
  const wrap=document.createElement("label"); wrap.id="sand-agent-vendor"; wrap.setAttribute("data-agent-id",agentId);
  wrap.style.cssText="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:16px 0 0;padding:13px;border:1px solid var(--cursor-border-secondary,#393939);border-radius:9px;background:var(--cursor-bg-secondary,#292929)";
  const copy=(window.__sandUiLanguage||"en")==="zh"?{title:"这个 Bot 使用的 API",hint:"每个 Bot 可以走不同的厂商和模型。"}:{title:"API for this Bot",hint:"Each bot can use a different vendor and model."};
  const text=document.createElement("span"); text.style.cssText="display:grid;gap:4px;min-width:0";
  const title=document.createElement("strong"); title.textContent=copy.title; title.style.cssText="font-size:13px;color:var(--cursor-text-primary,#ececec);font-weight:500";
  const hint=document.createElement("small"); hint.textContent=copy.hint; hint.style.cssText="color:var(--cursor-text-secondary,#aaa);font-size:11px";
  text.append(title,hint);
  const sel=document.createElement("select"); sel.style.cssText="height:34px;min-width:160px;border-radius:6px;border:1px solid var(--cursor-stroke-tertiary,#494949);background:var(--cursor-button-secondary-background,#292929);color:var(--cursor-text-primary,#ececec);padding:0 10px;font:inherit;appearance:none";
  for(const v of vendors){const o=document.createElement("option"); o.value=v.id; o.textContent=v.label+(v.modelId?" · "+v.modelId:""); if(v.id===current) o.selected=true; sel.append(o)}
  sel.onchange=()=>{
    window.__sandAgentVendors=window.__sandAgentVendors||{};
    window.__sandAgentVendors[agentId]=sel.value;
    const name=(pane.querySelector("input")?.value||document.querySelector("[data-agent-id][data-active='true']")?.textContent||"Bot").trim().split("\n")[0];
    window.__sandUpdateAgent?.(agentId,{name,inferenceVendorId:sel.value});
  };
  wrap.append(text,sel); pane.append(wrap);
},1200)}
function MOn(n){const e=n.roster;window.__sandRoster=e;window.__sandCreateAgent=async(r,i)=>{
  const {deploymentServerId,connectionId,key,...local}={...r,origin:"user",...i};
  if(deploymentServerId!==undefined&&deploymentServerId!==""){
    const copy=RUiCopy(),api=window.__beebotServerBots;
    if(typeof deploymentServerId!=="string"||!api||typeof api.listServers!=="function"||typeof api.create!=="function"||typeof api.open!=="function")throw new Error(copy.missing);
    const servers=await api.listServers();
    if(!Array.isArray(servers)||!servers.some(server=>server.id===deploymentServerId&&server.status==="online"))throw new Error(copy.unavailable);
    const created=await api.create({connectionId:deploymentServerId,name:local.name,description:typeof local.description==="string"?local.description:"",avatarColor:local.avatarColor,avatarShape:local.avatarShape,key:key||crypto.randomUUID()});
    if(!created?.bot||typeof created.bot.id!=="string")throw new Error(copy.invalid);
    await api.open(deploymentServerId,created.bot);
    return;
  }
  window.__beebotNodeChat?.close();window.__beebotCloseNodeWorkbench?.();
  const created=await e.createAgent(local);const id=created?.agent?.id||created?.id;if(id&&r&&typeof r.inferenceVendorId==="string"&&r.inferenceVendorId.length>0){window.__sandAgentVendors=window.__sandAgentVendors||{};window.__sandAgentVendors[id]=r.inferenceVendorId}return created
};window.__sandCreateGroup=(r)=>{window.__beebotNodeChat?.close();window.__beebotCloseNodeWorkbench?.();return e.createGroup(r)};window.__sandUpdateAgent=(id,profile)=>e.updateAgent({id,profile});const t=S.useCallback(async(r,i)=>{if(r&&typeof r.avatarShape==="string"&&r.avatarShape.length>0)return window.__sandCreateAgent(r,i);if(window.__sandSkipCreateSheet)return window.__sandCreateAgent(r,i);const o=await window.__sandPickCreateBot(r);if(o==null)return;return window.__sandCreateAgent({...r,...o},i)},[e]),s=lr(e.deleteAgents);
