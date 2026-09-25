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
  const roster=window.__sandRoster;
  const pools=[];
  try{pools.push(roster?.snapshots?.get?.()?.agents?.rows)}catch{}
  try{pools.push(roster?.snapshots?.get?.()?.rows)}catch{}
  try{pools.push(roster?.snapshots?.view?.()?.value?.rows)}catch{}
  try{pools.push(roster?.snapshots?.view?.()?.value?.agents?.rows)}catch{}
  for(const rows of pools){
    if(!Array.isArray(rows)) continue;
    const row=rows.find(a=>a&&a.id===agentId);
    if(row) return typeof row.inferenceVendorId==="string"?row.inferenceVendorId:"";
  }
  return window.__sandAgentVendors[agentId]||"";
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

// User-initiated management uses a centered dialog. Ordinary conversation
// interactions remain inline; opening management never cancels running work.
let RCreateRequestSerial=0;
function RCreateText(cn,en){return window.__sandUiLanguage==="zh"?cn:en;}
function RCreateError(error){return String(error?.message||error||"")
  .replace(/(Bearer\s+)\S+/gi,"$1[redacted]")
  .replace(/((?:access_token|refresh_token|api_key|code|state)=)[^&\s]+/gi,"$1[redacted]").slice(0,400);}
function REnsureInlineCreateStyle(){
  if(document.getElementById("beebot-inline-create-style"))return;
  const style=document.createElement("style");style.id="beebot-inline-create-style";
  style.textContent=`
    .bb-create-layer{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:24px;background:rgb(0 0 0 / .24);-webkit-app-region:no-drag}
    .bb-inline-create{position:relative;min-height:0;min-width:0;width:min(620px,100%);max-height:calc(100dvh - 48px);overflow:auto;overscroll-behavior:contain;box-sizing:border-box;margin:0;padding:24px;box-shadow:0 20px 64px rgb(0 0 0 / .18);border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:10px;background:var(--cursor-bg-primary,Canvas);color:var(--cursor-text-primary,CanvasText);font:13px/1.5 system-ui,-apple-system,sans-serif;scrollbar-gutter:stable;-webkit-app-region:no-drag}
    .bb-inline-create *{box-sizing:border-box}
    .bb-inline-create [hidden]{display:none!important}
    .bb-inline-create :is(input,textarea,select){width:100%;min-width:0;max-width:100%;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:8px;background:var(--cursor-bg-input,Canvas);color:inherit;padding:9px 10px;font:inherit;min-height:38px}
    .bb-inline-create button{font:inherit;color:inherit;cursor:pointer;-webkit-app-region:no-drag}
    .bb-inline-create :is(button,input,select,textarea,summary):focus-visible,#sand-plus-menu button:focus-visible{outline:2px solid var(--cursor-accent,Highlight);outline-offset:2px}
    .bb-inline-create button:disabled{cursor:default;opacity:.5}
    .bb-create-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
    .bb-create-head h2{font:600 19px/1.4 system-ui;margin:0;overflow-wrap:anywhere}
    .bb-create-close{border:0;border-radius:6px;background:transparent;min-width:32px;min-height:32px;font-size:20px!important}
    .bb-create-subtitle,.bb-create-help{font-size:12px;color:var(--cursor-text-secondary,GrayText);margin:0 0 12px;overflow-wrap:anywhere}
    .bb-create-field{display:grid;gap:6px;margin-bottom:12px}
    .bb-create-field label{font-size:12px;font-weight:500;color:var(--cursor-text-secondary,GrayText)}
    .bb-create-members{display:grid;gap:4px;min-height:104px;max-height:288px;overflow:auto;overscroll-behavior:contain;margin:8px 0}
    .bb-create-member{display:flex;align-items:center;gap:8px;min-height:40px;width:100%;border:1px solid transparent;border-radius:8px;background:transparent;text-align:start;padding:6px 8px;overflow-wrap:anywhere}
    .bb-create-member[aria-pressed=true]{border-color:var(--cursor-stroke-secondary,#8884);background:var(--cursor-bg-secondary,Canvas)}
    .bb-create-member[aria-pressed=true]::after{content:'✓';margin-inline-start:auto;flex:none}
    .bb-create-member svg{flex:none}
    .bb-create-member:hover,.bb-create-close:hover{background:color-mix(in srgb,currentColor 6%,transparent)}
    .bb-create-selected{display:flex;align-content:start;flex-wrap:wrap;gap:6px;margin:8px 0}
    .bb-create-selected button{padding:5px 8px;min-height:30px;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:6px;background:transparent;max-width:100%;overflow-wrap:anywhere}
    .bb-create-submit{width:100%;min-height:38px;border:0;border-radius:8px;padding:9px 12px;background:var(--cursor-text-primary,CanvasText)!important;color:var(--cursor-bg-primary,Canvas)!important;font-weight:600;margin-top:8px}
    .bb-create-status{font-size:12px;color:var(--cursor-text-red-primary,#ba3544);white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0}
    .bb-create-status:empty{display:none}
    .bb-create-appearance{width:100%;margin:0 0 12px}
    .bb-create-appearance summary{display:flex;gap:8px;align-items:center;cursor:pointer;min-height:38px;font-size:12px;color:var(--cursor-text-secondary,GrayText)}
    .bb-create-appearance summary::after{content:'⌄';margin-inline-start:auto}
    .bb-create-appearance[open] summary::after{content:'⌃'}
    .bb-create-appearance summary::-webkit-details-marker{display:none}
    #sand-create-bot-sheet{width:min(480px,100%)}
    .bb-create-colleagues{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(150px,1fr);gap:20px;margin:4px 0 12px}
    .bb-create-colleagues>section{min-width:0}
    .bb-create-selection{padding-left:20px;border-left:1px solid var(--cursor-stroke-secondary,#8884)}
    .bb-create-selection h3{font-size:12px;font-weight:500;color:var(--cursor-text-secondary,GrayText);margin:0 0 12px}
    .bb-create-selection .bb-create-selected{margin:0;display:grid;gap:8px}
    .bb-create-selection .bb-create-selected button{text-align:start;min-height:36px}
    .bb-create-selection:has(.bb-create-selected:empty)::after{content:attr(data-empty-label);font-size:12px;line-height:1.6;color:var(--cursor-text-secondary,GrayText)}
    @media(max-width:520px){.bb-create-layer{padding:12px}.bb-inline-create{padding:18px;max-height:calc(100dvh - 24px)}.bb-create-colleagues{grid-template-columns:1fr;gap:12px}.bb-create-selection{border-left:0;border-top:1px solid var(--cursor-stroke-secondary,#8884);padding:12px 0 0}.bb-create-selection .bb-create-selected{display:flex}.bb-create-members{max-height:200px}}
    #sand-plus-menu{position:static;flex:none;display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px;padding:0;font:12px/1.5 system-ui;color:var(--cursor-text-primary,CanvasText);background:transparent}
    #sand-plus-menu button{min-height:36px;min-width:0;padding:7px;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:8px;color:inherit;background:var(--cursor-bg-primary,Canvas);font:inherit;cursor:pointer;overflow-wrap:anywhere;-webkit-app-region:no-drag}
    #sand-plus-menu button:hover{background:color-mix(in srgb,currentColor 6%,transparent)}
    @media(prefers-reduced-motion:reduce){.bb-inline-create *,#sand-plus-menu *{scroll-behavior:auto;transition:none}}
    @media(forced-colors:active){.bb-inline-create button{border:1px solid ButtonText}.bb-create-submit{background:ButtonFace!important;color:ButtonText!important}}
  `;document.head.append(style);
}
function RInsertSidebarSection(section){
  const sidebar=document.querySelector(".sand-agents-sidebar");
  const plus=sidebar?.querySelector(".sand-agents-sidebar__new");
  if(sidebar){
    let anchor=plus;
    while(anchor?.parentElement&&anchor.parentElement!==sidebar)anchor=anchor.parentElement;
    if(anchor?.parentElement===sidebar)anchor.insertAdjacentElement("afterend",section);else sidebar.prepend(section);
  }else{
    // Empty/legacy shells still get an ordinary document section, never a scrim.
    const header=document.querySelector(".sand-chat-header");
    if(header)header.insertAdjacentElement("afterend",section);else document.body.prepend(section);
  }
}
function RMountInlineCreate(root,label){
  for(const id of ["sand-create-bot-sheet","sand-create-group-sheet"]){
    const previous=document.getElementById(id);
    if(previous&&previous!==root){
      if(previous.__sandDismiss?.()===false)return false;
      if(previous.isConnected)RCloseInlineCreate(previous,false);
    }
  }
  const trigger=document.activeElement;
  document.getElementById("sand-plus-menu")?.__sandDismiss?.();
  REnsureInlineCreateStyle();root.classList.add("bb-inline-create");
  root.setAttribute("role","dialog");root.setAttribute("aria-modal","true");root.setAttribute("aria-label",label);root.tabIndex=-1;
  const layer=document.createElement("div");layer.className="bb-create-layer";
  layer.append(root);root.__sandCreateLayer=layer;root.__sandCreateTrigger=trigger;
  // Deliberate close only: a background click must not lose a half-composed form.
  layer.addEventListener("mousedown",event=>{if(event.target===layer){event.preventDefault();root.focus({preventScroll:true});}});
  root.addEventListener("keydown",event=>{
    if(event.isComposing||event.keyCode===229)return;
    if(event.key==="Escape"){
      event.preventDefault();event.stopPropagation();root.__sandDismiss?.();return;
    }
    if(event.key!=="Tab")return;
    const fields=[...root.querySelectorAll('button,input,textarea,select,summary,[tabindex="0"]')].filter(el=>!el.disabled&&!el.closest("[hidden]")&&!(el.closest("details:not([open])")&&!el.matches("summary")));
    const first=fields[0],last=fields.at(-1);
    if(!first){event.preventDefault();root.focus();return;}
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===root)){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===root)){event.preventDefault();first.focus();}
  });
  document.body.append(layer);return true;
}
function RCloseInlineCreate(root,restoreFocus){
  const hadFocus=root.contains(document.activeElement),trigger=root.__sandCreateTrigger;
  root.__sandCreateLayer?.remove();root.remove();
  if(restoreFocus&&hadFocus)(trigger?.isConnected?trigger:document.querySelector(".sand-agents-sidebar__new"))?.focus({preventScroll:true});
}

window.__sandPickCreateBot=async function(preset,{onCreate}={}){
  const request=++RCreateRequestSerial;await RLang();if(request!==RCreateRequestSerial)return null;const copy=RUiCopy();
  return new Promise(resolve=>{
  const root=document.createElement("div"); root.id="sand-create-bot-sheet";
  root.style.cssText="display:flex;flex-direction:column;align-items:stretch";
  let appearanceOpen=false,roleDetailsOpen=false,roleForm,composingField=false,repaintAfterComposition=false;
  root.addEventListener("compositionstart",()=>{composingField=true;});
  root.addEventListener("compositionend",()=>{composingField=false;if(repaintAfterComposition){repaintAfterComposition=false;paint();}});
  let role=preset?.role||{primaryJob:"",responsibilities:[],outOfScope:[],deliverables:[],workingStyle:""};
  let color=R_COLORS.some(c=>c.id===preset?.avatarColor)?preset.avatarColor:"green";
  let shape=R_SHAPES.includes(preset?.avatarShape)?preset.avatarShape:"blob";
  let name=typeof preset?.name==="string"?preset.name:"";
  let description=typeof preset?.description==="string"?preset.description:"";
  let deploymentServerId=typeof preset?.deploymentServerId==="string"?preset.deploymentServerId:"";
  let servers=[],busy=false,alive=true,refreshSerial=0,unsubscribe;
  const operationKeys=new Map();
  let vendors=[]; let vendorId=typeof preset?.inferenceVendorId==="string"?preset.inferenceVendorId:"";
  const finish=(v,restoreFocus=v===null)=>{if(!alive)return;alive=false;roleForm?.dispose();refreshSerial++;unsubscribe?.();window.removeEventListener("sand-ui-language-changed",localizeBot);RCloseInlineCreate(root,restoreFocus);resolve(v)};
  root.__sandDismiss=()=>{if(busy)return false;finish(null);return true};
  const status=document.createElement("div");status.setAttribute("role","status");status.style.cssText="width:min(420px,100%);font-size:13px;color:var(--cursor-text-red-primary,#ba3544);white-space:pre-wrap;margin-top:12px";
  const setError=error=>{status.textContent=error?RCreateError(error):""};
  let deployment,submit,input,responsibilities,close,vendorSelect;
  const online=()=>servers.some(server=>server.id===deploymentServerId&&server.status==="online");
  const updateReady=()=>{
    if(!submit)return;
    if(busy&&root.contains(document.activeElement))root.focus({preventScroll:true});
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
    if(composingField){repaintAfterComposition=true;return;}
    const hex=R_COLORS.find(c=>c.id===color)?.hex||"#00C972";
    const active=document.activeElement;
    const focused=root.contains(active)?{key:active.dataset.createField,label:active.getAttribute("aria-label"),title:active.getAttribute("title"),start:active.selectionStart,end:active.selectionEnd}:null;
    appearanceOpen=root.querySelector(".bb-create-appearance")?.open??appearanceOpen;
    if(roleForm){role=roleForm.read();roleDetailsOpen=roleForm.details.open;roleForm.dispose();roleForm=null;}
    root.innerHTML="";
    const bar=document.createElement("div"); bar.style.cssText="width:min(420px,100%);display:flex;align-items:center;gap:12px;margin-bottom:20px";
    close=document.createElement("button"); close.type="button";close.dataset.createField="close"; close.textContent="×";close.setAttribute("aria-label",copy.close); close.style.cssText="width:36px;height:36px;border:0;border-radius:18px;background:var(--cursor-bg-secondary,Canvas);font-size:22px;cursor:pointer"; close.onclick=()=>{if(!busy)finish(null)};
    const title=document.createElement("div"); title.textContent=copy.title; title.style.cssText="font-size:18px;font-weight:600";
    bar.append(close,title);
    const preview=document.createElement("div"); preview.style.cssText="width:32px;height:32px;margin:0"; preview.append(RBotSvg(shape,color,32));
    const colors=document.createElement("div"); colors.style.cssText="width:min(420px,100%);display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:12px";
    for(const item of R_COLORS){const b=document.createElement("button"); b.type="button";b.setAttribute("aria-label",item.id); b.style.cssText="width:26px;height:26px;border-radius:13px;border:"+(item.id===color?"2px solid var(--cursor-text-primary,CanvasText)":"2px solid transparent")+";background:"+item.hex+";cursor:pointer"; b.onclick=()=>{if(!busy){color=item.id;paint()}}; colors.append(b)}
    const shapes=document.createElement("div"); shapes.style.cssText="width:min(420px,100%);display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-bottom:20px";
    for(const item of R_SHAPES){const b=document.createElement("button"); b.type="button"; b.title=item; b.style.cssText="width:36px;height:36px;border:0;padding:0;background:transparent;cursor:pointer;border-radius:8px;outline:"+(item===shape?"2px solid var(--cursor-text-primary,CanvasText)":"none")+";outline-offset:2px"; b.append(RBotSvg(item,item===shape?color:"gray",32)); b.onclick=()=>{if(!busy){shape=item;paint()}}; shapes.append(b)}
    const deploymentLabel=document.createElement("label");deploymentLabel.textContent=copy.deployment;deploymentLabel.style.cssText="width:min(420px,100%);font-size:13px;color:var(--cursor-text-secondary,GrayText);margin-bottom:6px";
    deployment=document.createElement("select");deployment.dataset.createField="deployment";deployment.setAttribute("aria-label",copy.deployment);deployment.style.cssText="width:min(420px,100%);height:38px;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:8px;background:var(--cursor-bg-input,Canvas);padding:0 10px;font-size:13px;color:var(--cursor-text-primary,CanvasText);margin-bottom:12px";
    deployment.onchange=()=>{if(!busy){deploymentServerId=deployment.value;setError(null);paint();if(deploymentServerId&&!online())setError(copy.unavailable)}};
    const label=document.createElement("label"); label.textContent=copy.nameLabel; label.style.cssText="width:min(420px,100%);font-size:13px;color:var(--cursor-text-secondary,GrayText);margin-bottom:6px";
    input=document.createElement("input");input.dataset.createField="name"; input.type="text";input.maxLength=100;input.setAttribute("aria-label",copy.nameLabel); input.placeholder=copy.ph; input.value=name; input.style.cssText="width:min(420px,100%);height:38px;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:8px;background:var(--cursor-bg-input,Canvas);padding:0 10px;font-size:13px;color:var(--cursor-text-primary,CanvasText);margin-bottom:12px";
    input.oninput=()=>{name=input.value};
    const vendorLabel=document.createElement("label"); vendorLabel.textContent=copy.vendor; vendorLabel.style.cssText="width:min(420px,100%);font-size:13px;color:var(--cursor-text-secondary,GrayText);margin:8px 0 6px";
    vendorSelect=document.createElement("select");vendorSelect.dataset.createField="vendor";vendorSelect.setAttribute("aria-label",copy.vendor); vendorSelect.style.cssText="width:min(420px,100%);height:38px;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:8px;background:var(--cursor-bg-input,Canvas);padding:0 10px;font-size:13px;color:var(--cursor-text-primary,CanvasText);margin-bottom:20px;appearance:none;-webkit-appearance:none;box-sizing:border-box";
    if(vendors.length===0){const opt=document.createElement("option"); opt.textContent=copy.vendor; opt.value=""; vendorSelect.append(opt)}
    for(const item of vendors){const opt=document.createElement("option"); opt.value=item.id; opt.textContent=item.label+(item.modelId?" · "+item.modelId:""); if(item.id===vendorId) opt.selected=true; vendorSelect.append(opt)}
    vendorSelect.onchange=()=>{vendorId=vendorSelect.value};
    const descriptionLabel=document.createElement("label");descriptionLabel.textContent=copy.responsibilities;descriptionLabel.style.cssText=vendorLabel.style.cssText;
    responsibilities=document.createElement("textarea");responsibilities.dataset.createField="responsibilities";responsibilities.value=description;responsibilities.maxLength=8000;responsibilities.setAttribute("aria-label",copy.responsibilities);responsibilities.style.cssText="width:min(420px,100%);min-height:80px;border:0;border-radius:12px;background:var(--cursor-bg-input,Canvas);padding:12px 14px;font:15px system-ui;margin-bottom:12px;box-sizing:border-box;resize:vertical";responsibilities.oninput=()=>{description=responsibilities.value};
    const hint=document.createElement("p");hint.textContent=copy.serverHint;hint.style.cssText="width:min(420px,100%);font-size:13px;color:var(--cursor-text-secondary,GrayText);margin:0 0 16px";
    submit=document.createElement("button"); submit.type="button"; submit.textContent=copy.start; submit.style.cssText="width:min(420px,100%);height:44px;border:0;border-radius:22px;font-size:15px;font-weight:600;color:#fff;background:"+hex+";cursor:pointer";
    submit.onclick=async()=>{
      if(busy||!alive)return;
      const draft={name:name.trim()||copy.ph,avatarColor:color,avatarShape:shape,inferenceVendorId:vendorId||vendorSelect.value,isKickstartRequested:!0,deploymentServerId:""};
      if(!deploymentServerId){
        if(!roleForm){setError(RCreateText("此版本未加载岗位编辑器，请更新客户端。","The role editor is unavailable in this build. Update the client."));return;}
        const error=roleForm.validate();if(error){status.textContent=error;return;}
        draft.role=roleForm.read();
        if(typeof onCreate!=="function"){finish(draft);return;}
        busy=true;setError(null);updateReady();
        try{await onCreate(draft);finish(null,false);}catch(error){if(alive)setError(error);}finally{busy=false;if(alive)updateReady();}
        return;
      }
      if(!online()){setError(copy.unavailable);return}
      const remote={deploymentServerId,name:draft.name,description,avatarColor:color,avatarShape:shape};
      const signature=JSON.stringify(remote);if(!operationKeys.has(signature))operationKeys.set(signature,crypto.randomUUID());
      busy=true;setError(null);updateReady();
      try{
        if(typeof window.__sandCreateAgent!=="function")throw new Error(copy.missing);
        await window.__sandCreateAgent({...remote,key:operationKeys.get(signature)});
        finish(null,false);
      }catch(error){if(alive)setError(error)}finally{busy=false;if(alive)updateReady()}
    };
    let composingName=false;input.addEventListener("compositionstart",()=>{composingName=true});input.addEventListener("compositionend",()=>{composingName=false});
    input.addEventListener("keydown",ev=>{if(ev.key==="Enter"&&!composingName&&!ev.isComposing&&ev.keyCode!==229){ev.preventDefault();submit.click()}});
    const appearance=document.createElement("details");appearance.className="bb-create-appearance";appearance.open=appearanceOpen;
    const summary=document.createElement("summary");summary.dataset.createField="appearance";summary.append(preview,document.createTextNode(RCreateText("头像与颜色","Appearance")));
    appearance.append(summary,colors,shapes);
    submit.dataset.createField="submit";submit.className="bb-create-submit";status.className="bb-create-status";
    root.append(bar,label,input);
    if(!deploymentServerId&&typeof window.__beebotRoleFields==="function"){
      roleForm=window.__beebotRoleFields({value:role,onChange:next=>{role=next;setError(null);}});
      roleForm.root.style.width="min(420px,100%)";roleForm.details.open=roleDetailsOpen;root.append(roleForm.root);
    }
    root.append(appearance,deploymentLabel,deployment);
    if(deploymentServerId){
      hint.textContent+=RCreateText(" 当前服务器仅保存职责描述，不支持本机的版本化岗位约定。"," This server currently saves a description only, not a versioned local role contract.");
      root.append(descriptionLabel,responsibilities,hint);
    }else root.append(vendorLabel,vendorSelect);
    root.append(submit,status);renderServers();
    if(focused){
      const target=[...root.querySelectorAll("input,textarea,select,button,summary")].find(item=>focused.key?item.dataset.createField===focused.key:focused.label?item.getAttribute("aria-label")===focused.label:focused.title&&item.getAttribute("title")===focused.title);
      if(target){target.focus({preventScroll:true});if(typeof focused.start==="number"&&typeof target.setSelectionRange==="function")try{target.setSelectionRange(focused.start,focused.end)}catch{}}
    }
  };
  function localizeBot(){Object.assign(copy,RUiCopy());paint();root.setAttribute("aria-label",copy.title);}
  if(!RMountInlineCreate(root,copy.title)){finish(null);return;}
  window.addEventListener("sand-ui-language-changed",localizeBot);paint();input.focus({preventScroll:true});void refreshServers();
  try{unsubscribe=window.desktop?.nodes?.onChanged?.(()=>void refreshServers())}catch{}
  Promise.resolve().then(()=>window.desktop.agent.getInferenceVendors()).then(listed=>{if(!alive)return;vendors=Array.isArray(listed?.vendors)?listed.vendors:[];if(!vendorId)vendorId=listed?.defaultVendorId||vendors[0]?.id||"";
    if(vendorSelect){vendorSelect.replaceChildren();for(const item of vendors){const option=document.createElement("option");option.value=item.id;option.textContent=item.label+(item.modelId?" · "+item.modelId:"");vendorSelect.append(option)}vendorSelect.value=vendorId;}}).catch(()=>{});
  });
};
window.__sandPickCreateGroup=async function({onCreate}={}){
  const request=++RCreateRequestSerial;await RLang();if(request!==RCreateRequestSerial)return null;
  const copy=RUiCopy(),agents=RListAgents();
  return new Promise(resolve=>{
    const root=document.createElement("section");root.id="sand-create-group-sheet";
    let alive=true,busy=false;const selected=new Set(),rows=new Map();
    const finish=(value,restoreFocus=value===null)=>{if(!alive)return;alive=false;window.removeEventListener("sand-ui-language-changed",localize);RCloseInlineCreate(root,restoreFocus);resolve(value);};
    root.__sandDismiss=()=>{if(busy)return false;finish(null);return true;};
    const head=document.createElement("header");head.className="bb-create-head";
    const title=document.createElement("h2");
    const close=document.createElement("button");close.type="button";close.className="bb-create-close";close.textContent="×";close.onclick=()=>root.__sandDismiss();
    head.append(title,close);
    const subtitle=document.createElement("p");subtitle.className="bb-create-subtitle";
    const field=(id)=>{
      const wrap=document.createElement("div");wrap.className="bb-create-field";
      const label=document.createElement("label");label.htmlFor=id;
      const input=document.createElement("input");input.id=id;input.type="text";
      wrap.append(label,input);return{wrap,label,input};
    };
    const name=field("bb-group-name"),search=field("bb-group-search");name.input.maxLength=100;
    const chips=document.createElement("div");chips.className="bb-create-selected";
    const colleagues=document.createElement("div");colleagues.className="bb-create-colleagues";
    const candidates=document.createElement("section"),selection=document.createElement("section");selection.className="bb-create-selection";
    const selectionTitle=document.createElement("h3");selectionTitle.id="bb-group-selection-title";selection.setAttribute("aria-labelledby",selectionTitle.id);selection.append(selectionTitle,chips);
    const list=document.createElement("div");list.className="bb-create-members";list.setAttribute("role","group");
    const empty=document.createElement("p");empty.className="bb-create-help";
    const status=document.createElement("p");status.className="bb-create-status";status.setAttribute("role","status");
    const submit=document.createElement("button");submit.type="button";submit.className="bb-create-submit";
    const applyReady=()=>{
      if(busy&&root.contains(document.activeElement))root.focus({preventScroll:true});
      submit.disabled=busy||!name.input.value.trim()||selected.size===0;
      submit.textContent=busy?RUiCopy().creating:RUiCopy().create;
      root.setAttribute("aria-busy",String(busy));
      for(const input of root.querySelectorAll("input"))input.disabled=busy;
      for(const button of root.querySelectorAll("button"))if(button!==submit)button.disabled=busy;
    };
    const renderMembers=()=>{
      const query=search.input.value.trim().normalize("NFC").toLowerCase();let visible=0;
      for(const agent of agents){
        const row=rows.get(agent.id);row.hidden=!!query&&!agent.name.normalize("NFC").toLowerCase().includes(query);
        row.setAttribute("aria-pressed",String(selected.has(agent.id)));if(!row.hidden)visible++;
      }
      empty.hidden=visible>0;
      empty.textContent=agents.length?RCreateText("没有找到这个 Bot，试试其他名字。","No matching Bot. Try another name."):RCreateText("先创建一个 Bot，再邀请它加入群聊。","Create a Bot first, then invite it to a group.");
      selectionTitle.textContent=RCreateText("已选同事","Selected colleagues")+` (${selected.size}/6)`;
      chips.replaceChildren();
      for(const id of selected){
        const agent=agents.find(item=>item.id===id),chip=document.createElement("button");chip.type="button";
        chip.textContent=agent.name+" ×";chip.setAttribute("aria-label",RCreateText("移除选择：","Remove selection: ")+agent.name);
        chip.onclick=()=>{if(busy)return;selected.delete(id);renderMembers();rows.get(id)?.focus({preventScroll:true});};chips.append(chip);
      }
      applyReady();
    };
    for(const agent of agents){
      const row=document.createElement("button");row.type="button";row.className="bb-create-member";row.dataset.memberId=agent.id;
      const profile=RRosterRows().find(item=>item.id===agent.id);
      if(typeof R_PATHS==="object")row.append(RBotSvg(profile?.avatarShape||"blob",profile?.avatarColor||"green",26));
      row.append(document.createTextNode(agent.name));
      row.onclick=()=>{if(busy)return;if(selected.has(agent.id))selected.delete(agent.id);else{
        if(selected.size>=6){status.textContent=RCreateText("每个群最多选择 6 位 Bot。请先移除一位同事。","A group supports up to 6 Bots. Remove a colleague before adding another.");return;}
        selected.add(agent.id);
      }status.textContent="";renderMembers();};
      rows.set(agent.id,row);list.append(row);
    }
    name.input.oninput=applyReady;search.input.oninput=renderMembers;
    submit.onclick=async()=>{
      applyReady();if(submit.disabled||!alive)return;
      // Validate membership again; a deleted Bot must not be silently dropped.
      const current=new Set(RListAgents().map(agent=>agent.id));
      if([...selected].some(id=>!current.has(id))){status.textContent=RCreateText("有成员已不可用，请取消对应选择后再创建。","A selected Bot is no longer available. Remove it before creating the group.");return;}
      const draft={name:name.input.value.trim(),memberAgentIds:[...selected]};
      if(typeof onCreate!=="function"){finish(draft);return;}
      busy=true;status.textContent="";applyReady();
      try{await onCreate(draft);finish(null,false);}
      catch(error){if(alive)status.textContent=RCreateError(error);}
      finally{busy=false;if(alive)applyReady();}
    };
    function localize(){
      const copy=RUiCopy();title.textContent=copy.groupTitle;root.setAttribute("aria-label",copy.groupTitle);
      close.setAttribute("aria-label",copy.close);subtitle.textContent=RCreateText("邀请同事，一起讨论和完成工作。","Invite colleagues to discuss and work together.");
      name.label.textContent=copy.groupName;name.input.placeholder=copy.groupName;name.input.setAttribute("aria-label",copy.groupName);
      search.label.textContent=copy.search;search.input.placeholder=copy.search;search.input.setAttribute("aria-label",copy.search);
      list.setAttribute("aria-label",copy.to);selection.dataset.emptyLabel=RCreateText("从左侧选择一起工作的同事。","Choose colleagues to work with.");renderMembers();
    }
    candidates.append(search.wrap,list,empty);colleagues.append(candidates,selection);
    root.append(head,subtitle,name.wrap,colleagues,submit,status);
    if(!RMountInlineCreate(root,copy.groupTitle)){finish(null);return;}
    window.addEventListener("sand-ui-language-changed",localize);localize();name.input.focus({preventScroll:true});
  });
};
if(!window.__sandPlusMenuBound){window.__sandPlusMenuBound=!0;document.addEventListener("click",ev=>{
  const btn=ev.target?.closest?.(".sand-agents-sidebar__new");if(!btn)return;
  ev.preventDefault();ev.stopPropagation();
  const existing=document.getElementById("sand-plus-menu");
  if(existing){existing.__sandDismiss();return;}
  REnsureInlineCreateStyle();const menu=document.createElement("div");menu.id="sand-plus-menu";
  menu.setAttribute("role","group");menu.setAttribute("aria-label",RCreateText("新建","Create"));
  btn.setAttribute("aria-expanded","true");btn.setAttribute("aria-controls",menu.id);
  const hide=()=>{menu.remove();btn.setAttribute("aria-expanded","false");btn.removeAttribute("aria-controls");window.removeEventListener("sand-ui-language-changed",localize);};
  menu.__sandDismiss=hide;
  const mk=(kind,fn)=>{const b=document.createElement("button");b.type="button";b.dataset.kind=kind;b.onclick=()=>{hide();void fn();};return b;};
  const bot=mk("bot",()=>window.__sandPickCreateBot(undefined,{onCreate:draft=>{
    if(typeof window.__sandCreateAgent!=="function")throw new Error(RUiCopy().missing);return window.__sandCreateAgent(draft);
  }}));
  const group=mk("group",()=>window.__sandPickCreateGroup({onCreate:draft=>{
    if(typeof window.__sandCreateGroup!=="function")throw new Error(RUiCopy().missing);return window.__sandCreateGroup(draft);
  }}));
  function localize(){const copy=RUiCopy();bot.textContent=copy.newBot;group.textContent=copy.newGroup;}
  menu.addEventListener("keydown",event=>{if(event.key==="Escape"&&!event.isComposing){event.preventDefault();event.stopPropagation();hide();btn.focus({preventScroll:true});}});
  menu.append(bot,group);localize();window.addEventListener("sand-ui-language-changed",localize);
  RInsertSidebarSection(menu);
},true)}
function RSyncVendorChoices(sel,vendors,current){
  if(sel.dataset.pending==="true") return;
  const signature=JSON.stringify(vendors.map(v=>[v.id,v.label,v.modelId]));
  if(sel.dataset.catalog!==signature||!Array.from(sel.options).some(o=>o.value===current)){
    sel.replaceChildren();
    if(!vendors.some(v=>v.id===current)){
      const missing=document.createElement("option");missing.value=current;missing.disabled=true;
      missing.textContent=RCreateText("原模型不可用，请选择现有 API","Original model unavailable — choose an API");sel.append(missing);
    }
    for(const v of vendors){const o=document.createElement("option");o.value=v.id;o.textContent=v.label+(v.modelId?" · "+v.modelId:"");sel.append(o)}
    sel.dataset.catalog=signature;
  }
  sel.value=current;sel.disabled=vendors.length===0;
}
if(!window.__sandVendorPaneBound){window.__sandVendorPaneBound=!0;setInterval(async()=>{
  const pane=document.querySelector(".sand-agent-settings");
  const owner=pane?.closest("[data-beebot-settings-owner]");
  const agentId=owner?.getAttribute("data-beebot-settings-owner");
  if(!pane||!agentId) return;
  const roster=window.__sandRoster;
  const isCurrent=()=>pane.isConnected&&owner.getAttribute("data-beebot-settings-owner")===agentId&&window.__sandRoster===roster;
  let listed;try{listed=await window.desktop.agent.getInferenceVendors()}catch{return}
  if(!isCurrent())return;
  const vendors=Array.isArray(listed?.vendors)?listed.vendors:[];
  const current=RAgentVendorId(agentId)||listed?.defaultVendorId||vendors[0]?.id||"";
  const present=pane.querySelector("#sand-agent-vendor");
  if(present&&present.dataset.agentId===agentId&&present.__sandModelRoster===roster){RSyncVendorChoices(present.querySelector("select"),vendors,current);return}
  present?.remove();
  const wrap=document.createElement("label");wrap.id="sand-agent-vendor";wrap.setAttribute("data-agent-id",agentId);wrap.__sandModelRoster=roster;
  wrap.style.cssText="display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px;margin:16px 0 0;padding:13px;border:1px solid var(--cursor-border-secondary);border-radius:9px;background:var(--cursor-bg-secondary)";
  const text=document.createElement("span");text.style.cssText="display:grid;gap:4px;min-width:0";
  const title=document.createElement("strong");title.textContent=RCreateText("这个 Bot 使用的 API","API for this Bot");title.style.cssText="font-size:13px;color:var(--cursor-text-primary);font-weight:500";
  const hint=document.createElement("small");hint.textContent=RCreateText("使用已配置的模型，不会自动切换到其他 API。","Uses the selected model. No automatic fallback to another API.");hint.setAttribute("role","status");hint.style.cssText="color:var(--cursor-text-secondary);font-size:12px";text.append(title,hint);
  const sel=document.createElement("select");sel.setAttribute("aria-label",title.textContent);sel.style.cssText="height:34px;min-width:160px;max-width:100%;border-radius:6px;border:1px solid var(--cursor-stroke-tertiary);background:var(--cursor-button-secondary-background);color:var(--cursor-text-primary);padding:0 10px;font:inherit";
  RSyncVendorChoices(sel,vendors,current);
  sel.onchange=()=>{
    const choice=sel.value,previous=RAgentVendorId(agentId)||current;
    if(sel.dataset.pending==="true")return;
    sel.dataset.pending="true";sel.disabled=true;
    hint.textContent=RCreateText("正在保存模型选择…","Saving model selection…");
    const name=(pane.querySelector("input")?.value||"Bot").trim().split("\n")[0];
    Promise.resolve().then(()=>{
      if(typeof window.__sandUpdateAgent!=="function")throw new Error("Bot settings unavailable");
      if(!isCurrent())throw new Error("Bot settings changed");
      return window.__sandUpdateAgent(agentId,{name,inferenceVendorId:choice});
    }).then(saved=>{
      if(!isCurrent())return;
      if(saved?.id!==agentId||saved.inferenceVendorId!==choice)throw new Error("Model save was not confirmed");
      window.__sandAgentVendors=window.__sandAgentVendors||{};window.__sandAgentVendors[agentId]=choice;
      hint.textContent=RCreateText("已保存，下次发送时使用该模型。","Saved. The next message will use this model.");
    }).catch(()=>{
      if(!isCurrent())return;
      sel.value=previous;hint.textContent=RCreateText("未确认模型保存结果，请检查连接并重新打开 Bot 设置核对。","Save not confirmed. Check the connection and reopen Bot settings to verify.");
    }).finally(()=>{if(isCurrent()){delete sel.dataset.pending;sel.disabled=vendors.length===0;}});
  };
  wrap.append(text,sel);pane.append(wrap);
},1200)}
function MOn(n){if(typeof RBindConversationStatus==="function")RBindConversationStatus(n);const e=n.roster;if(window.__sandRoster!==e)window.__sandAgentVendors=Object.create(null);window.__sandRoster=e;window.__sandCreateAgent=async(r,i)=>{
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
};window.__sandCreateGroup=(r)=>{window.__beebotNodeChat?.close();window.__beebotCloseNodeWorkbench?.();return e.createGroup(r)};window.__sandUpdateAgent=(id,profile)=>e.updateAgent(id,profile);const t=S.useCallback(async(r,i)=>{if(r&&typeof r.avatarShape==="string"&&r.avatarShape.length>0)return window.__sandCreateAgent(r,i);if(window.__sandSkipCreateSheet)return window.__sandCreateAgent(r,i);const o=await window.__sandPickCreateBot(r);if(o==null)return;return window.__sandCreateAgent({...r,...o},i)},[e]),s=lr(e.deleteAgents);
