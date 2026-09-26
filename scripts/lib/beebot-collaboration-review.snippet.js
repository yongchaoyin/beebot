/* A read-only view of colleagues' recorded work. The conversation owns requests,
 * corrections and delivery; opening this panel never reviews or resumes work. */
function RBindCollaborationReview(runtime) {
  if (!runtime?.selection?.snapshots || !runtime?.transcript?.snapshotsFor || typeof runtime.roster?.getCollaboration !== "function") return;
  if (window.__beebotCollaborationReview?.runtime === runtime) return;
  window.__beebotCollaborationReview?.dispose();
  const t=(cn,en)=>window.__sandUiLanguage==="zh"?cn:en;
  const node=(tag,cls)=>{const el=document.createElement(tag);if(cls)el.className=cls;return el;};
  const root=node("section","bb-work"),toggle=node("button","bb-work-toggle"),faces=node("span","bb-work-faces"),label=node("span","bb-work-label"),count=node("span","bb-work-count"),chevron=node("span","bb-work-chevron");
  const panel=node("div","bb-work-panel"),intro=node("p","bb-work-intro"),feedback=node("p","bb-work-feedback"),active=node("div","bb-work-list"),finished=node("details","bb-work-finished"),finishedLabel=node("summary"),finishedList=node("div","bb-work-list");
  root.id="beebot-collaboration-review";root.dataset.bbWork="";toggle.type="button";panel.id="bb-work-panel";
  toggle.setAttribute("aria-controls",panel.id);faces.setAttribute("aria-hidden","true");chevron.setAttribute("aria-hidden","true");chevron.textContent="⌄";
  feedback.setAttribute("role","status");toggle.append(faces,label,count,chevron);finished.append(finishedLabel,finishedList);panel.append(intro,feedback,active,finished);root.append(toggle,panel);
  let disposed=false,room=null,remoteActive=false,epoch=0,serial=0,offEntries,entryStore,signature="",timer,poll,expanded=false,trusted=false,failures=0;
  let data={tasks:[]},error="";const disposers=[],cards=new Map();
  const remote=()=>document.body?.dataset.beebotRemoteActive==="true";
  const down=()=>runtime.connection?.snapshots?.get?.()?.transport==="down";
  const selected=()=>runtime.selection.snapshots.get()?.currentAgentId??null;
  const rows=()=>runtime.roster?.snapshots?.get?.()?.agents?.rows??[];
  const name=id=>id==="user"?t("你","You"):rows().find(bot=>bot.id===id)?.name||t("Bot 同事","Colleague");
  const done=task=>!task.evidence.some(item=>!item.available)&&(task.state==="completed"?task.completedForCurrentInputs===true:task.state==="accepted"&&task.acceptedForCurrentInputs===true);
  const labels=()=>({offered:t("待接手","Ready to start"),declined:t("等待重新分工","Needs a new owner"),claimed:t("进行中","In progress"),waiting:t("等待协作","Waiting on others"),blocked:t("遇到阻碍","Blocked"),review:t("成果待核对","Checking needed"),"changes-requested":t("需要完善","Needs changes"),accepted:t("已完成","Done"),completed:t("已完成","Done")});
  if(!document.getElementById("bb-work-style")){
    const style=node("style");style.id="bb-work-style";style.textContent=`
      .bb-work{font:13px/1.5 system-ui;min-width:0;color:var(--bee-text-primary,var(--cursor-text-primary,CanvasText));-webkit-app-region:no-drag;margin:0 4px 8px}
      .bb-work[hidden],.bb-work [hidden]{display:none!important}
      .bb-work-toggle{display:flex;align-items:center;gap:9px;width:100%;min-height:38px;padding:7px 10px;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
      .bb-work-toggle:hover{background:color-mix(in srgb,currentColor 5%,transparent)}.bb-work-label{font-weight:600;flex:none}.bb-work-count{flex:1;min-width:0;color:var(--bee-text-secondary,var(--cursor-text-secondary,GrayText));font-size:12px;overflow-wrap:anywhere}
      .bb-work-faces{display:flex;flex:none}.bb-work-faces>*+*{margin-left:-7px}.bb-work-faces>*{box-shadow:0 0 0 2px var(--bee-surface,var(--cursor-bg-primary,Canvas));border-radius:50%}
      .bb-work-chevron{font-size:16px}.bb-work-toggle[aria-expanded="true"] .bb-work-chevron{transform:rotate(180deg)}
      .bb-work :is(button,summary):focus-visible{outline:2px solid var(--bee-accent,var(--cursor-accent,Highlight));outline-offset:2px}
      .bb-work-panel{max-height:min(48vh,440px);overflow:auto;overscroll-behavior:contain;padding:0 10px 10px;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:12px;background:var(--bee-surface,var(--cursor-bg-primary,Canvas))}
      .bb-work-intro,.bb-work-feedback{font-size:12px;color:var(--bee-text-secondary,var(--cursor-text-secondary,GrayText));margin:10px 2px;overflow-wrap:anywhere}.bb-work-feedback:empty{display:none}
      .bb-work-list{display:grid;gap:0}.bb-work-card{padding:12px 2px;min-width:0;border-top:1px solid var(--cursor-stroke-secondary,#8883)}.bb-work-card:first-child{border-top:0}
      .bb-work-card-head{display:flex;align-items:center;gap:8px;min-width:0}.bb-work-owner{flex:1;min-width:0;font-size:12px;color:var(--bee-text-secondary,var(--cursor-text-secondary,GrayText));overflow-wrap:anywhere}.bb-work-avatar{display:inline-flex;flex:none;width:26px;height:26px;align-items:center;justify-content:center;border-radius:50%;background:color-mix(in srgb,currentColor 7%,transparent);font-size:12px}
      .bb-work-card h3{font-size:13px;line-height:1.6;font-weight:550;margin:7px 0 3px;overflow-wrap:anywhere}.bb-work-state{flex:none;font-size:11px;line-height:1.5;border-radius:6px;padding:2px 6px;background:color-mix(in srgb,currentColor 7%,transparent)}
      .bb-work-card[data-state="blocked"] .bb-work-state,.bb-work-card[data-state="changes-requested"] .bb-work-state{color:var(--bee-text-primary,var(--cursor-text-primary,CanvasText));border:1px solid var(--cursor-stroke-secondary,#8884)}
      .bb-work-card p{font-size:12px;margin:4px 0;color:var(--bee-text-secondary,var(--cursor-text-secondary,GrayText));overflow-wrap:anywhere}.bb-work-card details{margin-top:7px}.bb-work-card summary,.bb-work-finished>summary{font-size:12px;color:var(--bee-text-secondary,var(--cursor-text-secondary,GrayText));cursor:pointer;padding:4px 0}
      .bb-work-detail{font-size:12px;padding:4px 0}.bb-work-detail h4{font:inherit;font-weight:550;margin:8px 0 4px}.bb-work-detail ul{margin:0;padding-left:18px}.bb-work-detail li{margin:3px 0;overflow-wrap:anywhere}.bb-work-evidence{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;padding:8px;border-radius:8px;background:color-mix(in srgb,currentColor 4%,transparent)}
      .bb-work-finished{border-top:1px solid var(--cursor-stroke-secondary,#8883);padding-top:7px;margin-top:3px}.bb-work-finished .bb-work-card{opacity:.9}
      @media(max-width:500px){.bb-work{margin-left:0;margin-right:0}.bb-work-toggle{gap:7px;padding:7px}.bb-work-faces>*{width:20px;height:20px}.bb-work-card-head{flex-wrap:wrap}.bb-work-state{max-width:100%;overflow-wrap:anywhere}.bb-work-panel{max-height:42vh}}
    `;document.head.append(style);
  }
  const current=(at,id)=>!disposed&&epoch===at&&selected()===id&&!remote()&&!down();
  function clear(){for(const card of cards.values())card.root.remove();cards.clear();data={tasks:[]};finished.open=false;}
  function scheduleLoad(delay=40){clearTimeout(timer);clearTimeout(poll);if(!disposed&&room&&!remote()&&!down()&&document.visibilityState!=="hidden")timer=setTimeout(load,delay);}
  function sync(){
    if(disposed)return;
    const next=selected(),isRemote=remote();
    if(next!==room||isRemote!==remoteActive){epoch++;serial++;room=next;remoteActive=isRemote;offEntries?.();offEntries=null;entryStore=null;signature="";trusted=false;expanded=false;error="";failures=0;clear();
      if(room&&!isRemote){entryStore=runtime.transcript.snapshotsFor(room);offEntries=entryStore.subscribe(sync);}}
    if(!room||isRemote){serial++;clearTimeout(timer);clearTimeout(poll);root.hidden=true;return;}
    const entries=entryStore?.get?.()?.entries??[];
    const sig=JSON.stringify([room,down(),entries.filter(e=>e.collaborationEvent||e.completionEvent||e.code==="conversation_stop_requested").map(e=>[e.id,e.collaborationEvent?.task?.version]),rows().map(bot=>[bot.id,bot.name,bot.avatarShape,bot.avatarColor,bot.memberIds])]);
    if(sig!==signature){signature=sig;trusted=false;serial++;scheduleLoad();}
    render();
  }
  async function load(){
    clearTimeout(timer);clearTimeout(poll);
    if(disposed||!room||remote()||down()||document.visibilityState==="hidden")return;
    const at=epoch,id=room,request=++serial;
    try{
      const result=await runtime.roster.getCollaboration({agentId:id});
      if(!current(at,id)||request!==serial)return;
      if(result?.agentId!==id||!Array.isArray(result.tasks)||result.tasks.length>256||new Set(result.tasks.map(task=>task?.id)).size!==result.tasks.length
        ||result.tasks.some(task=>!task||typeof task.id!=="string"||typeof task.title!=="string"||typeof task.assignee!=="string"||typeof task.state!=="string"||!Number.isInteger(task.version)||!Array.isArray(task.criteria)||task.criteria.length>12||task.criteria.some(c=>typeof c!=="string")||!Array.isArray(task.evidence)
          ||task.evidence.some(e=>!e||typeof e.available!=="boolean"||!Array.isArray(e.files))))throw new Error("invalid response");
      data=result;trusted=true;error="";failures=0;
    }catch{if(!current(at,id)||request!==serial)return;trusted=false;failures++;error=t("暂时无法更新进展，恢复连接后会自动更新。","Progress is temporarily unavailable. Updates resume automatically.");}
    render();
    if(current(at,id)&&request===serial&&(data.tasks.length||failures))poll=setTimeout(load,failures?Math.min(3000*2**Math.min(failures-1,5),60000):15000);
  }
  function avatar(id,size){
    const bot=rows().find(row=>row.id===id),el=node("span","bb-work-avatar");el.setAttribute("aria-hidden","true");
    if(bot&&typeof RBotSvg==="function")el.append(RBotSvg(bot.avatarShape||"blob",bot.avatarColor||"gray",size));
    else el.textContent=name(id).slice(0,1);
    return el;
  }
  function card(task){
    let c=cards.get(task.id);if(c)return c;
    const box=node("article","bb-work-card"),head=node("div","bb-work-card-head"),owner=node("span","bb-work-owner"),state=node("span","bb-work-state"),title=node("h3"),context=node("p"),details=node("details"),summary=node("summary"),body=node("div","bb-work-detail");
    head.append(owner,state);details.append(summary,body);box.append(head,title,context,details);
    c={root:box,head,owner,state,title,context,details,summary,body,face:null,signature:""};cards.set(task.id,c);return c;
  }
  function render(){
    if(disposed)return;
    const focused=root.contains(document.activeElement)?document.activeElement:null;
    const dock=document.querySelector(".sand-chat-input-dock");if(dock&&root.parentElement!==dock)dock.prepend(root);
    root.hidden=remote()||!room||(!data.tasks.length&&!error);toggle.setAttribute("aria-expanded",String(expanded));panel.hidden=!expanded;
    label.textContent=t("协作","Collaboration");root.setAttribute("aria-label",t("协作进展","Collaboration progress"));
    const settled=data.tasks.filter(done),ongoing=data.tasks.filter(task=>!done(task));
    count.textContent=down()?t("连接已断开","Disconnected"):error?t("进展暂不可用","Updates unavailable"):[ongoing.length?t(`${ongoing.length} 项进行中`,`${ongoing.length} in progress`):"",settled.length?t(`${settled.length} 项已完成`,`${settled.length} done`):""].filter(Boolean).join(" · ");
    const ids=[...new Set(ongoing.concat(settled).map(task=>task.assignee))].slice(0,3),faceSig=JSON.stringify([ids,rows().map(bot=>[bot.id,bot.name,bot.avatarShape,bot.avatarColor])]);
    if(faces.dataset.signature!==faceSig){faces.dataset.signature=faceSig;faces.replaceChildren(...ids.map(id=>avatar(id,22)));}
    intro.textContent=t("同事们的分工与进展。需要调整，直接在聊天里说。","Who is doing what. Share changes directly in the conversation.");
    feedback.textContent=down()?t("连接中断，以下是上次确认的进展。","Disconnected. Showing the last confirmed progress."):error||(!trusted&&data.tasks.length?t("正在更新进展…","Updating progress…"):"");
    finished.hidden=!settled.length;finishedLabel.textContent=t(`已完成 · ${settled.length}`,`Completed · ${settled.length}`);
    const wanted=new Set(),copy=labels(),rank={blocked:0,"changes-requested":1,claimed:2,review:3,waiting:4,offered:5,declined:6};
    const ordered=[...ongoing].sort((a,b)=>(rank[a.state]??3)-(rank[b.state]??3)).concat(settled);
    const activeCards=[],finishedCards=[];
    for(const task of ordered){
      const c=card(task);wanted.add(task.id);
      const dependencies=(task.dependencies??[]).map(id=>data.tasks.find(other=>other.id===id)).filter(other=>other&&!done(other));
      const sig=JSON.stringify([task,dependencies.map(dep=>[dep.id,dep.title,dep.version]),window.__sandUiLanguage,name(task.assignee),name(task.reviewer),rows().find(bot=>bot.id===task.assignee)]);
      if(c.signature!==sig){c.signature=sig;c.root.dataset.state=task.state;
        c.face?.remove();c.face=avatar(task.assignee,26);c.head.prepend(c.face);
        c.owner.textContent=name(task.assignee);c.title.textContent=task.title;
        const needsRecheck=["completed","accepted"].includes(task.state)&&!done(task);
        c.state.textContent=needsRecheck?t("需要重新核对","Needs another check"):copy[task.state]||t("状态待确认","Status unconfirmed");
        const check=task.state==="completed"?t("负责人已自查成果。","The owner checked the result."):task.state==="accepted"?(task.review?.reviewer==="user"?t("已保留此前的用户确认。","Earlier user confirmation is retained."):t(`${name(task.review?.reviewer||task.reviewer)} 已核对成果。`,`${name(task.review?.reviewer||task.reviewer)} checked the result.`)):"";
        c.context.textContent=task.reason|| (needsRecheck?t("要求或依据有变化，需要同事重新检查。","Requirements or evidence changed; colleagues need to recheck."):dependencies.length?t(`等待：${dependencies.map(dep=>dep.title).join("、")}`,`Waiting for: ${dependencies.map(dep=>dep.title).join(", ")}`):done(task)?check:task.state==="review"?t("成果已提交，正在等待核对。","Results submitted, awaiting a check."):"");
        c.context.hidden=!c.context.textContent;
        c.summary.textContent=task.evidence.length?t("查看成果与完成标准","Results and completion criteria"):t("查看完成标准","Completion criteria");
        const criteriaTitle=node("h4"),criteria=node("ul");criteriaTitle.textContent=t("完成标准","Completion criteria");
        for(const value of task.criteria){const li=node("li");li.textContent=value;criteria.append(li);}
        const content=[criteriaTitle,criteria];
        for(const evidence of task.evidence){const result=node("p","bb-work-evidence");result.textContent=!evidence.available?t("这份成果目前不可用，需由同事核对。","This result is unavailable and needs checking."):evidence.text||t("成果文件已在聊天中交付。","Result files were delivered in the conversation.");content.push(result);}
        c.body.replaceChildren(...content);
      }
      (done(task)?finishedCards:activeCards).push(c.root);
    }
    for(const [id,c] of cards)if(!wanted.has(id)){c.root.remove();cards.delete(id);}
    for(const [host,children] of [[active,activeCards],[finishedList,finishedCards]])children.forEach((child,index)=>{if(host.children[index]!==child)host.insertBefore(child,host.children[index]||null);});
    if(focused?.isConnected&&document.activeElement!==focused)focused.focus({preventScroll:true});
  }
  toggle.onclick=()=>{expanded=!expanded;render();if(expanded&&!trusted)scheduleLoad(0);};
  // The pinned renderer's type-anywhere listener treats Space on a summary as
  // text input. Keep disclosure activation local, preserving its native default
  // action and leaving Tab, shortcuts and the conversation editor unchanged.
  root.addEventListener("keydown",event=>{
    if(!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey&&(event.key===" "||event.key==="Enter")
      &&event.target instanceof Element&&event.target.closest("summary"))event.stopPropagation();
  });
  const visibility=()=>{if(document.visibilityState==="hidden"){serial++;clearTimeout(timer);clearTimeout(poll);}else scheduleLoad(0);};
  disposers.push(runtime.selection.snapshots.subscribe(sync));
  if(runtime.connection?.snapshots)disposers.push(runtime.connection.snapshots.subscribe(sync));
  if(runtime.roster?.snapshots)disposers.push(runtime.roster.snapshots.subscribe(sync));
  window.addEventListener("sand-ui-language-changed",render);window.addEventListener("beebot-node-selection",sync);document.addEventListener("visibilitychange",visibility);
  const observer=new MutationObserver(records=>{if(records.some(record=>[...record.addedNodes].some(el=>el.nodeType===1&&!el.closest?.("[data-bb-work]"))))render();});observer.observe(document.body,{subtree:true,childList:true});
  window.__beebotCollaborationReview={runtime,dispose(){disposed=true;epoch++;serial++;clearTimeout(timer);clearTimeout(poll);offEntries?.();disposers.forEach(off=>off?.());observer.disconnect();root.remove();clear();window.removeEventListener("sand-ui-language-changed",render);window.removeEventListener("beebot-node-selection",sync);document.removeEventListener("visibilitychange",visibility);if(window.__beebotCollaborationReview?.runtime===runtime)delete window.__beebotCollaborationReview;}};
  sync();
}
