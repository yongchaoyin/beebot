function RGroupCopy(){
  const zh=(window.__sandUiLanguage||"en")==="zh";
  return zh?{
    badge:"群",bots:(n)=>n+" 个 Bot",direct:"指定谁回复",hint:"输入 @ 指定 Bot；不 @ 则成员轮流发言。"
  }:{
    badge:"Group",bots:(n)=>n===1?"1 bot":n+" bots",direct:"Direct a Bot",hint:"Type @ to pick a Bot. Otherwise they take turns."
  };
}
function REnsureGroupStyle(){
  if(document.getElementById("sand-beebot-group-style")) return;
  const s=document.createElement("style"); s.id="sand-beebot-group-style";
  s.textContent=`
    [data-sand-kind="group"]{position:relative}
    .sand-beebot-group-badge{display:inline-flex;align-items:center;margin-left:6px;padding:1px 6px;border-radius:999px;background:#07C160;color:#fff;font-size:10px;font-weight:700;letter-spacing:.02em;vertical-align:middle}
    .sand-beebot-group-sub{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--cursor-text-tertiary,#888);font-size:11px;font-weight:400;margin-top:2px}
    .sand-beebot-group-stack{position:relative;width:34px;height:34px;flex:0 0 34px}
    .sand-beebot-group-stack svg{position:absolute;border-radius:8px;overflow:hidden;background:#fff}
    #sand-beebot-group-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 16px;border-bottom:1px solid var(--cursor-stroke-tertiary,rgba(0,0,0,.08));background:var(--cursor-bg-chrome,#fafafa);font-size:12px}
    #sand-beebot-group-bar button{border:0;border-radius:999px;background:#ecece8;padding:4px 10px;cursor:pointer;font-size:12px;color:#111}
    #sand-beebot-group-bar button:hover{background:#e0e0dc}
    #sand-beebot-group-bar .sand-beebot-group-hint{color:var(--cursor-text-tertiary,#888);margin-left:4px}
    #sand-beebot-mention{position:fixed;z-index:99994;min-width:200px;max-height:220px;overflow:auto;background:#fff;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.16);padding:6px;font:13px system-ui}
    #sand-beebot-mention button{display:block;width:100%;text-align:left;border:0;background:transparent;padding:8px 10px;border-radius:8px;cursor:pointer}
    #sand-beebot-mention button:hover,#sand-beebot-mention button[data-active="true"]{background:#f4f4f2}
  `;
  document.head.append(s);
}
function RGroupMembers(group){
  const ids=Array.isArray(group?.memberIds)?group.memberIds:[];
  const rows=RRosterRows();
  const byId=new Map(rows.map(r=>[r.id,r]));
  return ids.map(id=>{
    const row=byId.get(id);
    const name=(row&&typeof row.name==="string"&&row.name.trim())?row.name:id;
    const shape=(row&&typeof row.avatarShape==="string"&&row.avatarShape)||R_SHAPES[Math.abs(id.length)%R_SHAPES.length];
    const color=(row&&typeof row.avatarColor==="string"&&row.avatarColor)||R_COLORS[Math.abs(id.charCodeAt(0))%R_COLORS.length].id;
    return {id,name,shape,color};
  }).filter(m=>!RIsGroupId(m.id));
}
function RPaintStack(host,members){
  const shown=members.slice(0,3);
  const extra=members.length-shown.length;
  host.innerHTML="";
  const n=Math.max(shown.length,1);
  const size=n===1?34:n===2?22:18;
  shown.forEach((m,i)=>{
    const svg=typeof RBotSvg==="function"?RBotSvg(m.shape,m.color,size):null;
    if(!svg) return;
    svg.style.left=(i*8)+"px";
    svg.style.top=(i*6)+"px";
    svg.style.zIndex=String(i+1);
    svg.style.boxShadow="0 0 0 1px #fff";
    host.append(svg);
  });
  if(extra>0){
    const more=document.createElement("span");
    more.textContent="+"+extra;
    more.style.cssText="position:absolute;right:0;bottom:0;z-index:9;background:#111;color:#fff;border-radius:999px;font-size:9px;padding:1px 4px";
    host.append(more);
  }
}
function RDecorateGroupRow(el,group){
  const copy=RGroupCopy();
  const members=RGroupMembers(group);
  el.setAttribute("data-sand-kind","group");
  const nameEl=el.querySelector(".sand-agent-item__name, [class*='__name'], strong")||el;
  if(!el.querySelector(".sand-beebot-group-badge")&&nameEl){
    const badge=document.createElement("span");
    badge.className="sand-beebot-group-badge";
    badge.textContent=copy.badge;
    nameEl.append(" ",badge);
  }
  let sub=el.querySelector(":scope > .sand-beebot-group-sub, .sand-agent-item__body > .sand-beebot-group-sub");
  if(!sub){
    sub=document.createElement("span");
    sub.className="sand-beebot-group-sub";
    const body=el.querySelector(".sand-agent-item__body")||nameEl.parentElement||el;
    body.append(sub);
  }
  const names=members.map(m=>m.name).join(" · ");
  const label=copy.bots(members.length)+(names?(" · "+names):"");
  if(sub.textContent!==label) sub.textContent=label;
  if(el.querySelector(".sand-group-avatar")) return;
  const sig=members.map(m=>m.id+":"+m.shape+":"+m.color).join(",");
  let stack=el.querySelector(".sand-beebot-group-stack");
  const avatar=el.querySelector(".sand-agent-item__avatar");
  if(!stack){
    stack=document.createElement("span");
    stack.className="sand-beebot-group-stack";
    if(avatar){ avatar.innerHTML=""; avatar.append(stack); }
    else el.prepend(stack);
  }
  if(members.length&&stack.getAttribute("data-sig")!==sig){
    stack.setAttribute("data-sig",sig);
    RPaintStack(stack,members);
  }
}
function RActiveGroup(){
  const id=document.querySelector("[data-agent-id][aria-current='true'], [data-agent-id][data-active='true'], [data-sand-kind='group'][aria-selected='true']")?.getAttribute("data-agent-id");
  if(!id||!RIsGroupId(id)) return null;
  return RRosterRows().find(r=>r&&r.id===id)||null;
}
function RPaintGroupBar(){
  const group=RActiveGroup();
  const header=document.querySelector(".sand-chat-header");
  const existing=document.getElementById("sand-beebot-group-bar");
  if(!group||!header){ existing?.remove(); return; }
  const copy=RGroupCopy();
  const members=RGroupMembers(group);
  let bar=existing;
  if(!bar){
    bar=document.createElement("div");
    bar.id="sand-beebot-group-bar";
    header.insertAdjacentElement("afterend",bar);
  }
  const sig=group.id+"|"+members.map(m=>m.id).join(",");
  if(bar.getAttribute("data-sig")===sig) return;
  bar.setAttribute("data-sig",sig);
  bar.innerHTML="";
  const label=document.createElement("strong");
  label.textContent=copy.badge;
  label.style.cssText="color:#07C160;font-size:11px;letter-spacing:.04em";
  bar.append(label);
  members.forEach(m=>{
    const b=document.createElement("button");
    b.type="button";
    b.textContent=m.name;
    b.onclick=()=>{
      const row=document.querySelector(`[data-agent-id="${m.id}"]`);
      row?.click();
    };
    bar.append(b);
  });
  const hint=document.createElement("span");
  hint.className="sand-beebot-group-hint";
  hint.textContent=copy.hint;
  bar.append(hint);
}
function RHideMention(){document.getElementById("sand-beebot-mention")?.remove()}
function RShowMention(anchor,members,query,insert){
  RHideMention();
  const q=query.toLowerCase();
  const hits=members.filter(m=>!q||m.name.toLowerCase().includes(q)||m.id.toLowerCase().includes(q));
  if(!hits.length) return;
  const menu=document.createElement("div");
  menu.id="sand-beebot-mention";
  const r=anchor.getBoundingClientRect();
  menu.style.left=Math.max(12,r.left)+"px";
  menu.style.bottom=Math.max(12,window.innerHeight-r.top+8)+"px";
  hits.slice(0,8).forEach((m,i)=>{
    const b=document.createElement("button");
    b.type="button";
    b.textContent="@"+m.name;
    if(i===0) b.setAttribute("data-active","true");
    b.onclick=()=>insert(m);
    menu.append(b);
  });
  document.body.append(menu);
}
function RBindMentions(){
  if(window.__sandGroupMentionBound) return;
  window.__sandGroupMentionBound=1;
  const onInput=ev=>{
    const el=ev.target;
    if(!el||(el.tagName!=="TEXTAREA"&&el.getAttribute?.("contenteditable")!=="true")) { RHideMention(); return; }
    const group=RActiveGroup();
    if(!group){ RHideMention(); return; }
    const members=RGroupMembers(group);
    const value=el.value??el.textContent??"";
    const at=value.lastIndexOf("@");
    if(at<0){ RHideMention(); return; }
    const q=value.slice(at+1);
    if(/\s/.test(q)){ RHideMention(); return; }
    RShowMention(el,members,q,m=>{
      const next=value.slice(0,at)+"@"+m.name+" ";
      if("value" in el){ el.value=next; el.dispatchEvent(new Event("input",{bubbles:!0})); }
      else { el.textContent=next; }
      RHideMention();
      el.focus();
    });
  };
  document.addEventListener("input",onInput,true);
  document.addEventListener("keydown",ev=>{ if(ev.key==="Escape") RHideMention(); },true);
}
function RRefreshGroups(){
  REnsureGroupStyle();
  const rows=RRosterRows();
  const groups=new Map(rows.filter(r=>r&&RIsGroupId(r.id)).map(r=>[r.id,r]));
  for(const el of document.querySelectorAll("[data-agent-id]")){
    const id=el.getAttribute("data-agent-id");
    const group=id?groups.get(id):null;
    if(!group){
      if(el.getAttribute("data-sand-kind")==="group") el.removeAttribute("data-sand-kind");
      continue;
    }
    RDecorateGroupRow(el,group);
  }
  RPaintGroupBar();
  RBindMentions();
}
if(!window.__sandGroupUiBound){
  window.__sandGroupUiBound=1;
  const tick=()=>{ try{ RRefreshGroups(); }catch{} };
  if(!window.__sandGroupUiTest){
    let debounce;
    const schedule=()=>{ clearTimeout(debounce); debounce=setTimeout(tick,120); };
    setInterval(tick,2500);
    const obs=new MutationObserver(schedule);
    const start=()=>{ if(document.body) obs.observe(document.body,{childList:!0,subtree:!0}); tick(); };
    if(document.body) start(); else document.addEventListener("DOMContentLoaded",start);
  }
}
