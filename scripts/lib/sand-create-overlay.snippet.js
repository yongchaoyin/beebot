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
  const roster=RRosterRows();
  if(roster.length)return roster.filter(row=>row&&typeof row.id==="string"&&row.id&&row.isGroup!==true&&row.kind!=="group"&&!row.nodeConnectionId)
    .map(row=>({id:row.id,name:typeof row.name==="string"?row.name:row.id,description:row.description||"",avatarShape:row.avatarShape,avatarColor:row.avatarColor}));
  // Legacy shells without a roster snapshot retain their existing local-Bot list.
  const seen=new Set(); const out=[];
  for(const el of document.querySelectorAll("[data-agent-id]")){
    if(el.closest("[data-node-bot-id], [data-node-connection-id]"))continue;
    const id=el.getAttribute("data-agent-id"); if(!id||seen.has(id)||RIsGroupId(id)) continue; seen.add(id);
    const name=(el.querySelector("[class*='name']")||el).textContent.trim().split("\n")[0]||id;
    out.push({id,name});
  }
  return out;
}

// Explicit application management uses a centered dialog. Routine chat stays inline.
// Opening management never destroys the conversation DOM, drafts or running work.
let RCreateRequestSerial=0;
function RCreateText(cn,en){return window.__sandUiLanguage==="zh"?cn:en;}
function RCreateError(error){return String(error?.message||error||"")
  .replace(/(Bearer\s+)\S+/gi,"$1[redacted]")
  .replace(/((?:access_token|refresh_token|api_key|code|state)=)[^&\s]+/gi,"$1[redacted]").slice(0,400);}
function REnsureCreateStyle(){
  if(document.getElementById("beebot-create-style"))return;
  const style=document.createElement("style");style.id="beebot-create-style";
  style.textContent=`
    .bb-create-dialog{position:fixed;inset:0;margin:auto;width:min(720px,calc(100vw - 40px));max-height:calc(100dvh - 48px);padding:0;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:16px;background:var(--cursor-bg-primary,Canvas);color:var(--cursor-text-primary,CanvasText);box-shadow:0 18px 70px #0003;overflow:hidden;-webkit-app-region:no-drag}
    .bb-create-dialog[data-kind=bot]{width:min(500px,calc(100vw - 40px))}
    .bb-create-dialog::backdrop{background:#0005}
    .bb-create-panel{min-height:0;min-width:0;max-height:calc(100dvh - 50px);overflow:auto;overscroll-behavior:contain;box-sizing:border-box;padding:24px;background:inherit;color:inherit;font:14px/1.55 system-ui,-apple-system,sans-serif;scrollbar-gutter:stable;-webkit-app-region:no-drag}
    .bb-create-columns{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:24px;align-items:start}
    .bb-create-choice-column{min-width:0;padding-inline-end:24px;border-inline-end:1px solid var(--cursor-stroke-secondary,#8884)}
    .bb-create-selection-column{min-width:0}
    .bb-create-count{font-size:12px;color:var(--cursor-text-secondary,GrayText);margin:0 0 8px}
    .bb-create-member-copy{display:grid;min-width:0;gap:2px}
    .bb-create-member-copy strong{font-size:14px;font-weight:500;overflow-wrap:anywhere}
    .bb-create-member-copy small{font-size:12px;color:var(--cursor-text-secondary,GrayText);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:210px}
    @media(max-width:600px){.bb-create-dialog{width:calc(100vw - 24px);max-height:calc(100dvh - 24px)}.bb-create-panel{padding:18px;max-height:calc(100dvh - 26px)}.bb-create-columns{grid-template-columns:minmax(0,1fr);gap:12px}.bb-create-choice-column{padding:0;border:0}.bb-create-members{max-height:200px!important}}

    .bb-create-panel *{box-sizing:border-box}
    .bb-create-panel [hidden]{display:none!important}
    .bb-create-panel :is(input,textarea,select){width:100%;min-width:0;max-width:100%;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:8px;background:var(--cursor-bg-input,Canvas);color:inherit;padding:9px 10px;font:inherit;min-height:38px}
    .bb-create-panel button{font:inherit;color:inherit;cursor:pointer;-webkit-app-region:no-drag}
    .bb-create-panel :is(button,input,select,textarea,summary):focus-visible,#sand-plus-menu button:focus-visible{outline:2px solid var(--cursor-accent,Highlight);outline-offset:2px}
    .bb-create-panel button:disabled{cursor:default;opacity:.5}
    .bb-create-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
    .bb-create-head h2{font:600 19px/1.4 system-ui;margin:0;overflow-wrap:anywhere}
    .bb-create-close{border:0;border-radius:6px;background:transparent;min-width:32px;min-height:32px;font-size:20px!important}
    .bb-create-subtitle,.bb-create-help{font-size:12px;color:var(--cursor-text-secondary,GrayText);margin:0 0 12px;overflow-wrap:anywhere}
    .bb-create-field{display:grid;gap:6px;margin-bottom:12px}
    .bb-create-field label{font-size:12px;font-weight:500;color:var(--cursor-text-secondary,GrayText)}
    .bb-create-members{display:grid;gap:4px;max-height:320px;overflow:auto;overscroll-behavior:contain;margin:8px 0}
    .bb-create-member{display:flex;align-items:center;gap:8px;min-height:40px;width:100%;border:1px solid transparent;border-radius:8px;background:transparent;text-align:start;padding:6px 8px;overflow-wrap:anywhere}
    .bb-create-member[aria-pressed=true]{border-color:var(--cursor-stroke-secondary,#8884);background:var(--cursor-bg-secondary,Canvas)}
    .bb-create-member[aria-pressed=true]::after{content:'✓';margin-inline-start:auto;flex:none}
    .bb-create-member svg{flex:none}
    .bb-create-member:hover,.bb-create-close:hover{background:color-mix(in srgb,currentColor 6%,transparent)}
    .bb-create-selected{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
    .bb-create-selected button{padding:5px 8px;min-height:30px;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:6px;background:transparent;max-width:100%;overflow-wrap:anywhere}
    .bb-create-submit{width:100%;min-height:38px;border:0;border-radius:8px;padding:9px 12px;background:var(--cursor-text-primary,CanvasText)!important;color:var(--cursor-bg-primary,Canvas)!important;font-weight:600;margin-top:8px}
    .bb-create-status{font-size:12px;color:var(--cursor-text-red-primary,#ba3544);white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0}
    .bb-create-status:empty{display:none}
    .bb-create-appearance{width:100%;margin:0 0 12px}
    .bb-create-appearance summary{display:flex;gap:8px;align-items:center;cursor:pointer;min-height:38px;font-size:12px;color:var(--cursor-text-secondary,GrayText)}
    .bb-create-appearance summary::after{content:'⌄';margin-inline-start:auto}
    .bb-create-appearance[open] summary::after{content:'⌃'}
    .bb-create-appearance summary::-webkit-details-marker{display:none}
    #sand-plus-menu{position:static;flex:none;display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px;padding:0;font:12px/1.5 system-ui;color:var(--cursor-text-primary,CanvasText);background:transparent}
    #sand-plus-menu button{min-height:36px;min-width:0;padding:7px;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:8px;color:inherit;background:var(--cursor-bg-primary,Canvas);font:inherit;cursor:pointer;overflow-wrap:anywhere;-webkit-app-region:no-drag}
    #sand-plus-menu button:hover{background:color-mix(in srgb,currentColor 6%,transparent)}
    @media(prefers-reduced-motion:reduce){.bb-create-panel *,#sand-plus-menu *{scroll-behavior:auto;transition:none}}
    @media(forced-colors:active){.bb-create-panel button{border:1px solid ButtonText}.bb-create-submit{background:ButtonFace!important;color:ButtonText!important}}
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
// Only explicit application-management actions open this dialog. Chat replies,
// mentions, decisions and failure recovery stay in their current conversation.
function RMountCreateDialog(root,label){
  const previousFocus=document.activeElement;
  for(const id of ["sand-create-bot-sheet","sand-create-group-sheet"]){
    const previous=document.getElementById(id);
    if(previous&&previous!==root&&previous.__sandDismiss?.()===false)return false;
  }
  document.getElementById("sand-plus-menu")?.__sandDismiss?.();
  REnsureCreateStyle();root.classList.add("bb-create-panel");
  root.setAttribute("role","group");root.setAttribute("aria-label",label);
  const dialog=document.createElement("dialog");dialog.className="bb-create-dialog";
  dialog.dataset.kind=root.id.includes("group")?"group":"bot";
  dialog.setAttribute("aria-label",label);dialog.setAttribute("aria-modal","true");
  root.__sandCreateDialog=dialog;root.__sandPreviousFocus=previousFocus;
  let composing=false,backdropDown=false;
  root.addEventListener("compositionstart",()=>{composing=true});
  root.addEventListener("compositionend",()=>{composing=false});
  dialog.addEventListener("cancel",event=>{event.preventDefault();if(!composing)root.__sandDismiss?.();});
  dialog.addEventListener("keydown",event=>{
    if(event.key==="Escape"){
      event.preventDefault();event.stopPropagation();
      if(!composing&&!event.isComposing&&event.keyCode!==229)root.__sandDismiss?.();
    }
    if(event.key==="Tab"){
      const nodes=[...root.querySelectorAll("button,input,select,textarea,summary,[tabindex]")].filter(node=>!node.disabled&&!node.closest("[hidden]")&&node.tabIndex>=0&&!([...root.querySelectorAll("details:not([open])")].some(details=>details.contains(node)&&node!==details.querySelector("summary"))));
      const first=nodes[0],last=nodes.at(-1);
      if(nodes.length===0){event.preventDefault();return;}
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  dialog.addEventListener("pointerdown",event=>{backdropDown=event.target===dialog});
  dialog.addEventListener("click",event=>{if(backdropDown&&event.target===dialog)root.__sandDismiss?.();backdropDown=false;});
  dialog.append(root);document.body.append(dialog);
  // showModal provides native focus containment and inert background in Electron.
  if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","");
  return true;
}
function RCloseCreateDialog(root,restoreFocus){
  const dialog=root.__sandCreateDialog;
  const chosen=document.activeElement;
  const outside=chosen&&chosen!==document.body&&!dialog?.contains(chosen)?chosen:null;
  dialog?.close?.();dialog?.remove();root.remove();
  if(restoreFocus){
    const previous=root.__sandPreviousFocus;
    if(previous?.isConnected&&previous!==document.body)previous.focus({preventScroll:true});
    else document.querySelector(".sand-agents-sidebar__new")?.focus({preventScroll:true});
  }else if(outside?.isConnected)outside.focus({preventScroll:true});
  else document.querySelector('.sand-chat-input-dock textarea,.sand-chat-input-dock [contenteditable="true"]')?.focus({preventScroll:true});
}

window.__sandPickCreateBot=async function(preset,{onCreate}={}){
  const request=++RCreateRequestSerial;await RLang();if(request!==RCreateRequestSerial)return null;const copy=RUiCopy();
  return new Promise(resolve=>{
  const root=document.createElement("div"); root.id="sand-create-bot-sheet";
  root.style.cssText="display:flex;flex-direction:column;align-items:stretch";
  let appearanceOpen=false;
  let color=R_COLORS.some(c=>c.id===preset?.avatarColor)?preset.avatarColor:"green";
  let shape=R_SHAPES.includes(preset?.avatarShape)?preset.avatarShape:"blob";
  let name=typeof preset?.name==="string"?preset.name:"";
  let description=typeof preset?.description==="string"?preset.description:"";
  let deploymentServerId=typeof preset?.deploymentServerId==="string"?preset.deploymentServerId:"";
  let servers=[],busy=false,alive=true,refreshSerial=0,unsubscribe;
  const operationKeys=new Map();
  let vendors=[]; let vendorId=typeof preset?.inferenceVendorId==="string"?preset.inferenceVendorId:"";
  const finish=(v,restoreFocus=v===null)=>{if(!alive)return;alive=false;refreshSerial++;unsubscribe?.();window.removeEventListener("sand-ui-language-changed",localizeBot);RCloseCreateDialog(root,restoreFocus);resolve(v)};
  root.__sandDismiss=()=>{if(busy)return false;finish(null);return true};
  const status=document.createElement("div");status.setAttribute("role","status");status.style.cssText="width:min(420px,100%);font-size:13px;color:var(--cursor-text-red-primary,#ba3544);white-space:pre-wrap;margin-top:12px";
  const setError=error=>{status.textContent=error?RCreateError(error):""};
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
    const active=document.activeElement;
    const focused=root.contains(active)?{key:active.dataset.createField,label:active.getAttribute("aria-label"),title:active.getAttribute("title"),start:active.selectionStart,end:active.selectionEnd}:null;
    appearanceOpen=root.querySelector("details")?.open??appearanceOpen;
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
    root.append(bar,label,input,appearance,deploymentLabel,deployment);
    if(deploymentServerId)root.append(descriptionLabel,responsibilities,hint);else root.append(vendorLabel,vendorSelect);
    root.append(submit,status);renderServers();
    if(focused){
      const target=[...root.querySelectorAll("input,textarea,select,button,summary")].find(item=>focused.key?item.dataset.createField===focused.key:focused.label?item.getAttribute("aria-label")===focused.label:focused.title&&item.getAttribute("title")===focused.title);
      if(target){target.focus({preventScroll:true});if(typeof focused.start==="number"&&typeof target.setSelectionRange==="function")try{target.setSelectionRange(focused.start,focused.end)}catch{}}
    }
  };
  function localizeBot(){Object.assign(copy,RUiCopy());paint();root.setAttribute("aria-label",copy.title);root.__sandCreateDialog?.setAttribute("aria-label",copy.title);}
  if(!RMountCreateDialog(root,copy.title)){finish(null);return;}
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
    let alive=true,busy=false;const selected=new Set(),rows=new Map(),creationKeys=new Map();
    const finish=(value,restoreFocus=value===null)=>{if(!alive)return;alive=false;window.removeEventListener("sand-ui-language-changed",localize);RCloseCreateDialog(root,restoreFocus);resolve(value);};
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
    const selectionCount=document.createElement("p");selectionCount.className="bb-create-count";selectionCount.setAttribute("aria-live","polite");
    const list=document.createElement("div");list.className="bb-create-members";list.setAttribute("role","group");
    const empty=document.createElement("p");empty.className="bb-create-help";
    const status=document.createElement("p");status.className="bb-create-status";status.setAttribute("role","status");
    const submit=document.createElement("button");submit.type="button";submit.className="bb-create-submit";
    const applyReady=()=>{
      submit.disabled=busy||selected.size===0;
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
      selectionCount.textContent=RCreateText(`已选择 ${selected.size} / 6 位同事`,`Selected ${selected.size} / 6 colleagues`);
      empty.hidden=visible>0;
      empty.textContent=agents.length?RCreateText("没有找到这个 Bot，试试其他名字。","No matching Bot. Try another name."):RCreateText("先创建一个 Bot，再邀请它加入群聊。","Create a Bot first, then invite it to a group.");
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
      const memberCopy=document.createElement("span");memberCopy.className="bb-create-member-copy";
      const memberName=document.createElement("strong");memberName.textContent=agent.name;memberCopy.append(memberName);
      if(profile?.description){const role=document.createElement("small");role.textContent=profile.description;memberCopy.append(role);}
      row.append(memberCopy);row.setAttribute("aria-label",agent.name);
      row.onclick=()=>{if(busy)return;if(selected.has(agent.id))selected.delete(agent.id);
        else if(selected.size>=6){status.textContent=RCreateText("一个群最多选择 6 位 Bot，请先移除一位。","Choose up to 6 Bots. Remove one before adding another.");return;}
        else selected.add(agent.id);status.textContent="";renderMembers();};
      rows.set(agent.id,row);list.append(row);
    }
    name.input.oninput=applyReady;search.input.oninput=renderMembers;
    submit.onclick=async()=>{
      applyReady();if(submit.disabled||!alive)return;
      // Validate membership again; a deleted Bot must not be silently dropped.
      const current=new Set(RListAgents().map(agent=>agent.id));
      if([...selected].some(id=>!current.has(id))){status.textContent=RCreateText("有成员已不可用，请取消对应选择后再创建。","A selected Bot is no longer available. Remove it before creating the group.");return;}
      const groupName=name.input.value.trim()||[...selected].map(id=>agents.find(agent=>agent.id===id)?.name||id).join("、").slice(0,100);
      const memberAgentIds=[...selected],signature=JSON.stringify([groupName,[...memberAgentIds].sort()]);
      if(!creationKeys.has(signature))creationKeys.set(signature,crypto.randomUUID());
      const draft={name:groupName,memberAgentIds,clientNonce:creationKeys.get(signature)};
      if(typeof onCreate!=="function"){finish(draft);return;}
      busy=true;status.textContent="";applyReady();
      try{await onCreate(draft);finish(null,false);}
      catch(error){if(alive)status.textContent=RCreateError(error);}
      finally{busy=false;if(alive)applyReady();}
    };
    function localize(){
      const copy=RUiCopy();title.textContent=copy.groupTitle;root.setAttribute("aria-label",copy.groupTitle);root.__sandCreateDialog?.setAttribute("aria-label",copy.groupTitle);
      close.setAttribute("aria-label",copy.close);subtitle.textContent=RCreateText("邀请同事，一起讨论和完成工作。","Invite colleagues to discuss and work together.");
      name.label.textContent=copy.groupName+RCreateText("（选填）"," (optional)");name.input.placeholder=copy.groupName;name.input.setAttribute("aria-label",copy.groupName);
      search.label.textContent=copy.search;search.input.placeholder=copy.search;search.input.setAttribute("aria-label",copy.search);
      list.setAttribute("aria-label",copy.to);renderMembers();
    }
    const columns=document.createElement("div");columns.className="bb-create-columns";
    const choices=document.createElement("section");choices.className="bb-create-choice-column";choices.append(search.wrap,list,empty);
    const selection=document.createElement("section");selection.className="bb-create-selection-column";selection.append(selectionCount,chips,name.wrap,submit,status);
    columns.append(choices,selection);root.append(head,subtitle,columns);
    if(!RMountCreateDialog(root,copy.groupTitle)){finish(null);return;}
    window.addEventListener("sand-ui-language-changed",localize);localize();search.input.focus({preventScroll:true});
  });
};
if(!window.__sandPlusMenuBound){window.__sandPlusMenuBound=!0;document.addEventListener("click",ev=>{
  const btn=ev.target?.closest?.(".sand-agents-sidebar__new");if(!btn)return;
  ev.preventDefault();ev.stopPropagation();
  const existing=document.getElementById("sand-plus-menu");
  if(existing){existing.__sandDismiss();return;}
  REnsureCreateStyle();const menu=document.createElement("div");menu.id="sand-plus-menu";
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
  const created=await e.createAgent(local);window.__beebotNodeChat?.close();window.__beebotCloseNodeWorkbench?.();const id=created?.agent?.id||created?.id;if(id&&r&&typeof r.inferenceVendorId==="string"&&r.inferenceVendorId.length>0){window.__sandAgentVendors=window.__sandAgentVendors||{};window.__sandAgentVendors[id]=r.inferenceVendorId}return created
};window.__sandCreateGroup=async(r)=>{const created=await e.createGroup(r);window.__beebotNodeChat?.close();window.__beebotCloseNodeWorkbench?.();return created};window.__sandUpdateAgent=(id,profile)=>e.updateAgent({id,profile});const t=S.useCallback(async(r,i)=>{if(r&&typeof r.avatarShape==="string"&&r.avatarShape.length>0)return window.__sandCreateAgent(r,i);if(window.__sandSkipCreateSheet)return window.__sandCreateAgent(r,i);const o=await window.__sandPickCreateBot(r);if(o==null)return;return window.__sandCreateAgent({...r,...o},i)},[e]),s=lr(e.deleteAgents);
