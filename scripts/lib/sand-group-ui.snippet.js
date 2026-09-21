function RGroupCopy(){
  const zh=(window.__sandUiLanguage||"en")==="zh";
  return zh?{
    badge:"群",bots:(n)=>n+" 个 Bot",direct:"单独交流",hint:"点击名字在群里 @ 同事；单独交流请点 ↗。"
  }:{
    badge:"Group",bots:(n)=>n===1?"1 bot":n+" bots",direct:"Open direct chat",hint:"Click a name to @ a colleague here. Use ↗ for a direct chat; others can still jump in."
  };
}
function REnsureGroupStyle(){
  if(document.getElementById("sand-beebot-group-style")) return;
  const s=document.createElement("style"); s.id="sand-beebot-group-style";
  s.textContent=`
    [data-sand-kind="group"]{position:relative}
    .sand-beebot-group-badge{display:inline-flex;align-items:center;margin-left:6px;padding:1px 6px;border-radius:999px;background:var(--cursor-text-primary,CanvasText);color:var(--cursor-bg-primary,Canvas);font-size:10px;font-weight:700;letter-spacing:.02em;vertical-align:middle}
    .sand-beebot-group-sub{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--cursor-text-tertiary,#888);font-size:11px;font-weight:400;margin-top:2px}
    .sand-beebot-group-stack{position:relative;width:34px;height:34px;flex:0 0 34px}
    .sand-beebot-group-stack svg{position:absolute;border-radius:8px;overflow:hidden;background:var(--cursor-bg-primary,Canvas)}
    #sand-beebot-group-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 16px;border-bottom:1px solid var(--cursor-stroke-tertiary,rgba(0,0,0,.08));background:var(--cursor-bg-chrome,Canvas);font-size:12px}
    #sand-beebot-group-bar .sand-group-person{display:inline-flex;align-items:center;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:8px;overflow:hidden;max-width:100%}
    #sand-beebot-group-bar button{border:0;background:transparent;padding:6px 10px;min-height:32px;cursor:pointer;font:inherit;color:var(--cursor-text-primary,CanvasText);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #sand-beebot-group-bar .sand-group-direct{border-left:1px solid var(--cursor-stroke-secondary,#8884);flex:none;color:var(--cursor-text-secondary,GrayText)}
    #sand-beebot-group-bar button:focus-visible,#sand-beebot-mention button:focus-visible{outline:2px solid var(--cursor-accent,Highlight);outline-offset:-2px}
    #sand-beebot-group-bar button:hover{background:color-mix(in srgb,currentColor 8%,transparent)}
    #sand-beebot-group-bar .sand-beebot-group-hint{color:var(--cursor-text-tertiary,#888);margin-left:4px}
    #sand-beebot-mention{position:fixed;z-index:99994;width:min(300px,calc(100vw - 24px));max-height:220px;overflow:auto;background:var(--cursor-bg-primary,Canvas);color:var(--cursor-text-primary,CanvasText);border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.16);padding:6px;font:13px system-ui}
    #sand-beebot-mention button{display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:8px 10px;min-height:36px;border-radius:8px;cursor:pointer;overflow-wrap:anywhere;white-space:normal;font:inherit}
    #sand-beebot-mention small{display:block;color:var(--cursor-text-secondary,GrayText);font-size:10px}
    #sand-beebot-mention .sand-mention-help{padding:5px 10px;font-size:11px;color:var(--cursor-text-secondary,GrayText)}
    #sand-beebot-mention button:hover,#sand-beebot-mention button[data-active="true"]{background:color-mix(in srgb,currentColor 8%,transparent)}
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
    svg.style.boxShadow="0 0 0 1px var(--cursor-bg-primary,Canvas)";
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
  const badge=el.querySelector(".sand-beebot-group-badge");
  if(badge&&badge.textContent!==copy.badge) badge.textContent=copy.badge;
  let sub=el.querySelector(":scope > .sand-beebot-group-sub, .sand-agent-item__body > .sand-beebot-group-sub");
  if(!sub){
    sub=document.createElement("span");
    sub.className="sand-beebot-group-sub";
    const body=el.querySelector(".sand-agent-item__body")||(nameEl===el?el:nameEl.parentElement)||el;
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
  if(window.__beebotNodeChat?.getSnapshot().active)return null;
  const id=document.querySelector("[data-agent-id][aria-current='true'], [data-agent-id][data-active='true'], [data-sand-kind='group'][aria-selected='true']")?.getAttribute("data-agent-id");
  if(!id||!RIsGroupId(id)) return null;
  return RRosterRows().find(r=>r&&r.id===id)||null;
}
function RPaintGroupBar(){
  const group=RActiveGroup();
  const header=document.querySelector(".sand-chat-header");
  const existing=document.getElementById("sand-beebot-group-bar");
  if(!group||!header){ existing?.remove(); RHideMention(); return; }
  if(RMentionSession&&RMentionSession.groupId!==group.id) RHideMention();
  const copy=RGroupCopy();
  const members=RGroupMembers(group);
  let bar=existing;
  if(!bar){
    bar=document.createElement("div");
    bar.id="sand-beebot-group-bar";
    header.insertAdjacentElement("afterend",bar);
  }
  const sig=JSON.stringify([group.id,window.__sandUiLanguage,members.map(m=>[m.id,m.name,m.shape,m.color])]);
  if(bar.getAttribute("data-sig")===sig) return;
  bar.setAttribute("data-sig",sig);
  bar.innerHTML="";
  const label=document.createElement("strong");
  label.textContent=copy.badge;
  label.style.cssText="color:var(--cursor-text-secondary,GrayText);font-size:11px;letter-spacing:.04em";
  bar.append(label);
  members.forEach(m=>{
    const b=document.createElement("button");
    b.type="button";
    b.textContent="@"+m.name;
    b.title=copy.hint;
    b.onpointerdown=event=>event.preventDefault(); // Keep the editor's caret.
    b.onclick=()=>{
      if(RActiveGroup()?.id!==group.id) return;
      const editor=RGroupEditor();
      if(!editor) return;
      let selection=RReadMentionSelection(editor);
      if(!selection){
        editor.focus();
        const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);
        const current=window.getSelection();current.removeAllRanges();current.addRange(range);
        selection=RReadMentionSelection(editor);
      }
      if(selection) RInsertGroupMention(selection,m,group.id,false);
    };
    const direct=document.createElement("button");
    direct.type="button";direct.className="sand-group-direct";direct.textContent="↗";
    direct.setAttribute("aria-label",copy.direct+": "+m.name);direct.title=copy.direct;
    direct.onclick=()=>{
      if(RActiveGroup()?.id!==group.id) return;
      RHideMention();
      const row=[...document.querySelectorAll("[data-agent-id]")].find(el=>el.getAttribute("data-agent-id")===m.id);
      row?.click();
    };
    const person=document.createElement("span");person.className="sand-group-person";
    person.append(b,direct);bar.append(person);
  });
  const hint=document.createElement("span");
  hint.className="sand-beebot-group-hint";
  hint.textContent=copy.hint;
  bar.append(hint);
}
// Scope the adapter to the existing composer, never a Settings text field.
let RMentionSession=null;
const RGroupEditorSelector='.sand-prompt-form textarea, .sand-prompt-form [contenteditable="true"], .sand-chat-input-dock textarea, .sand-chat-input-dock [contenteditable="true"]';
function RGroupEditor(){
  return [...document.querySelectorAll(RGroupEditorSelector)].find(el=>!el.disabled&&el.getAttribute("aria-disabled")!=="true"&&el.getClientRects().length)||null;
}
function RReadMentionSelection(editor){
  if(!editor?.matches(RGroupEditorSelector)||editor.disabled) return null;
  if(editor.tagName==="TEXTAREA") return {editor,value:editor.value,start:editor.selectionStart,end:editor.selectionEnd};
  const selection=window.getSelection();
  if(!selection?.rangeCount) return null;
  const range=selection.getRangeAt(0);
  if(!editor.contains(range.startContainer)||!editor.contains(range.endContainer)) return null;
  const before=range.cloneRange();before.selectNodeContents(editor);before.setEnd(range.startContainer,range.startOffset);
  return {editor,value:editor.textContent||"",start:before.toString().length,end:before.toString().length+range.toString().length,range:range.cloneRange()};
}
function RMentionQuery(value,caret){
  const prefix=value.slice(0,caret);
  const match=/(?:^|[\s(（])@([^@\s{}]*)$/u.exec(prefix);
  if(!match) return null;
  // A code/quoted example should not become a directed message by accident.
  const line=prefix.slice(prefix.lastIndexOf("\n")+1);
  if(/^\s*>/.test(line)||((prefix.match(/`/g)||[]).length%2)) return null;
  return {start:caret-match[1].length-1,query:match[1]};
}
function RMentionToken(member,members){
  const name=member.name.trim();
  const duplicate=members.some(other=>other.id!==member.id&&other.name.trim().normalize("NFC").toLowerCase()===name.normalize("NFC").toLowerCase());
  return duplicate||/[@`{}\n]/.test(name)||/^(all|everyone|所有人|全体)$/i.test(name)?"@{"+member.id+"}":"@"+name;
}
function RInsertGroupMention(state,member,groupId,replaceQuery=true){
  const group=RActiveGroup(),editor=state.editor;
  if(!group||group.id!==groupId||!editor.isConnected||editor.disabled) {RHideMention();return false;}
  const members=RGroupMembers(group),current=members.find(item=>item.id===member.id);
  if(!current||(editor.value??editor.textContent??"")!==state.value) {RHideMention();return false;}
  const query=replaceQuery?RMentionQuery(state.value,state.start):null;
  const start=query?query.start:state.start,end=state.end;
  const previous=state.value.slice(0,start);
  const separator=previous&&!/[\s(（]$/u.test(previous)?" ":"";
  const text=separator+RMentionToken(current,members)+" ";
  RHideMention();editor.focus();
  if(editor.tagName==="TEXTAREA"){
    const next=state.value.slice(0,start)+text+state.value.slice(end);
    // Native setter also notifies controlled React inputs on the input event.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(editor,next);
    editor.setSelectionRange(start+text.length,start+text.length);
    editor.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));
    return true;
  }
  // Keep the editor's DOM, formatting, undo and normal input pipeline. Never
  // replace textContent: it disconnects rich editors from their document state.
  if(!state.range) return false;
  const range=state.range.cloneRange();
  if(!editor.contains(range.startContainer)||!editor.contains(range.endContainer)) return false;
  if(query){
    if(range.startContainer.nodeType!==Node.TEXT_NODE||range.startOffset<state.start-start) return false;
    range.setStart(range.startContainer,range.startOffset-(state.start-start));
  }
  const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
  return document.execCommand("insertText",false,text);
}
function RHideMention(){
  const session=RMentionSession;RMentionSession=null;
  document.getElementById("sand-beebot-mention")?.remove();
  if(session) for(const [key,value] of session.aria){
    if(value===null) session.state.editor.removeAttribute(key);else session.state.editor.setAttribute(key,value);
  }
}
function RShowMention(state,members,query,groupId){
  RHideMention();
  const hits=members.filter(m=>!query||m.name.toLowerCase().includes(query.toLowerCase())||m.id.toLowerCase().includes(query.toLowerCase())).slice(0,8);
  if(!hits.length) return;
  const menu=document.createElement("div");menu.id="sand-beebot-mention";menu.setAttribute("role","listbox");
  menu.setAttribute("aria-label",RGroupCopy().badge+" @");
  const session={state,groupId,hits,index:0,aria:new Map()};RMentionSession=session;
  for(const key of ["aria-controls","aria-expanded","aria-activedescendant"]){session.aria.set(key,state.editor.getAttribute(key));}
  state.editor.setAttribute("aria-controls",menu.id);state.editor.setAttribute("aria-expanded","true");
  const bounds=state.editor.getBoundingClientRect();
  menu.style.left=Math.max(12,Math.min(bounds.left,window.innerWidth-312))+"px";
  menu.style.bottom=Math.max(12,Math.min(window.innerHeight-40,window.innerHeight-bounds.top+8))+"px";
  hits.forEach((member,index)=>{
    const option=document.createElement("button");option.type="button";option.tabIndex=-1;
    option.id="sand-mention-option-"+index;option.setAttribute("role","option");option.textContent="@"+member.name;
    if(RMentionToken(member,members).startsWith("@{")){const id=document.createElement("small");id.textContent=member.id;option.append(id);}
    option.onpointerdown=event=>event.preventDefault();
    option.onclick=()=>{if(RMentionSession===session) RInsertGroupMention(state,member,groupId);};menu.append(option);
  });
  const help=document.createElement("div");help.className="sand-mention-help";
  help.textContent=window.__sandUiLanguage==="zh"?"↑ ↓ 选择 · Enter 点名 · Esc 关闭":"↑ ↓ Choose · Enter Mention · Esc Close";
  menu.append(help);document.body.append(menu);RSelectMention(0);
}
function RSelectMention(index){
  const session=RMentionSession;if(!session) return;
  session.index=(index+session.hits.length)%session.hits.length;
  const options=document.querySelectorAll('#sand-beebot-mention [role="option"]');
  options.forEach((option,i)=>{option.dataset.active=String(i===session.index);option.setAttribute("aria-selected",String(i===session.index));});
  session.state.editor.setAttribute("aria-activedescendant",options[session.index].id);
  options[session.index].scrollIntoView?.({block:"nearest"});
}
function RBindMentions(){
  if(window.__sandGroupMentionBound) return;
  window.__sandGroupMentionBound=1;
  const composing=new WeakSet();
  document.addEventListener("input",event=>{
    if(event.isComposing||composing.has(event.target)) {RHideMention();return;}
    const editor=event.target?.closest?.(RGroupEditorSelector),group=RActiveGroup();
    const state=editor&&RReadMentionSelection(editor);
    if(!group||!state||state.start!==state.end) {RHideMention();return;}
    const query=RMentionQuery(state.value,state.start);
    if(!query) {RHideMention();return;}
    RShowMention(state,RGroupMembers(group),query.query,group.id);
  },true);
  document.addEventListener("compositionstart",event=>{composing.add(event.target);RHideMention();},true);
  document.addEventListener("compositionend",event=>composing.delete(event.target),true);
  document.addEventListener("keydown",event=>{
    const session=RMentionSession;
    if(!session||event.isComposing||composing.has(event.target)||event.keyCode===229) return;
    if(RActiveGroup()?.id!==session.groupId) {RHideMention();return;}
    if(event.target!==session.state.editor&&!session.state.editor.contains(event.target)) {RHideMention();return;}
    const current=RReadMentionSelection(session.state.editor);
    if(!current||current.start!==session.state.start||current.end!==session.state.end||current.value!==session.state.value) {RHideMention();return;}
    if(event.key==="Escape"){event.preventDefault();event.stopImmediatePropagation();RHideMention();}
    else if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();event.stopImmediatePropagation();RSelectMention(session.index+(event.key==="ArrowDown"?1:-1));}
    else if((event.key==="Enter"||event.key==="Tab")&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
      event.preventDefault();event.stopImmediatePropagation();RInsertGroupMention(session.state,session.hits[session.index],session.groupId);
    }else if(["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) RHideMention();
  },true);
  document.addEventListener("pointerdown",event=>{if(!event.target?.closest?.("#sand-beebot-mention")) RHideMention();},true);
  document.addEventListener("focusin",event=>{if(RMentionSession&&event.target!==RMentionSession.state.editor) RHideMention();},true);
  window.addEventListener("resize",RHideMention);
  window.addEventListener("beebot-node-selection",RHideMention);
  window.addEventListener("sand-ui-language-changed",()=>{RHideMention();RPaintGroupBar();});
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
