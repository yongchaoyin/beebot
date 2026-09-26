/* Read-only UI projections from the real conversation stores. No DOM-derived
 * work state, fabricated read receipts, automatic retries, or popup approvals. */
function RBindConversationStatus(runtime) {
  if (typeof RBindCollaborationReview === "function") RBindCollaborationReview(runtime);
  if (!runtime?.selection?.snapshots || !runtime?.transcript?.snapshotsFor) return;
  if (window.__beebotConversationStatus?.runtime === runtime) return;
  window.__beebotConversationStatus?.dispose();
  const t=(cn,en)=>window.__sandUiLanguage==="zh"?cn:en;
  let disposed=false,scheduled=false,id=null,entryStore=null,offEntries,epoch=0,remoteActive=false;
  let intent=null,pending=false,feedback="";
  const disposers=[];
  const toolbar=document.createElement("section");toolbar.id="beebot-conversation-status";
  toolbar.setAttribute("aria-label",t("当前会话处理状态","Conversation status"));
  const summary=document.createElement("span");summary.className="bb-conversation-summary";
  const stop=document.createElement("button");stop.type="button";
  const confirm=document.createElement("div");confirm.className="bb-conversation-confirm";confirm.hidden=true;
  const explanation=document.createElement("span"),proceed=document.createElement("button"),cancel=document.createElement("button");
  proceed.type=cancel.type="button";
  confirm.append(explanation,proceed,cancel);
  const notice=document.createElement("span");notice.className="bb-conversation-feedback";notice.setAttribute("role","status");
  toolbar.append(summary,stop,confirm,notice);
  if(!document.getElementById("beebot-conversation-status-style")){
    const style=document.createElement("style");style.id="beebot-conversation-status-style";
    style.textContent=`
      #beebot-conversation-status{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;padding:8px 12px;font:12px/1.55 system-ui;color:var(--cursor-text-secondary,GrayText);-webkit-app-region:no-drag}
      #beebot-conversation-status[hidden],#beebot-conversation-status [hidden]{display:none!important}
      #beebot-conversation-status button{border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:7px;padding:5px 9px;min-height:30px;background:transparent;color:inherit;font:inherit;cursor:pointer}
      #beebot-conversation-status button:disabled{opacity:.5;cursor:default}
      #beebot-conversation-status button:focus-visible{outline:2px solid var(--cursor-accent,Highlight);outline-offset:2px}
      .bb-conversation-summary{flex:1;min-width:120px}.bb-conversation-confirm{display:flex;align-items:center;flex-wrap:wrap;gap:8px;flex-basis:100%;padding:8px 0;border-top:1px solid var(--cursor-stroke-secondary,#8884)}
      .bb-conversation-confirm>span{flex:1;min-width:180px}.bb-conversation-feedback{flex-basis:100%;overflow-wrap:anywhere}.bb-conversation-feedback:empty{display:none}
      [data-bb-delivery],[data-bb-publication]{display:block;width:fit-content;max-width:100%;margin:4px 0 6px;font:11px/1.5 system-ui;color:var(--cursor-text-secondary,GrayText);overflow-wrap:anywhere}
      [data-bb-delivery][data-state="failed"],[data-bb-delivery][data-state="needs-review"]{font-weight:550}
    `;document.head.append(style);
  }
  const isRemote=()=>document.body?.dataset.beebotRemoteActive==="true";
  const snapshot=()=>entryStore?.get?.();
  const transportDown=()=>runtime.connection?.snapshots?.get?.()?.transport==="down";
  // Routine delivery bookkeeping stays in the transcript store. Only an
  // interruption requiring context is added beside the actual conversation.
  const labels=()=>({failed:t("本次处理失败，消息已保留","Handling failed; message retained"),"needs-review":t("结果需要核查，工作没有重新执行","The result needs checking; work has not been repeated"),cancelled:t("后续处理已停止","Further handling stopped")});
  function render(){
    scheduled=false;if(disposed)return;
    const current=runtime.selection.snapshots.get()?.currentAgentId??null;
    const remote=isRemote();
    if(current!==id||remote!==remoteActive){
      id=current;remoteActive=remote;epoch++;intent=null;pending=false;feedback="";offEntries?.();offEntries=undefined;entryStore=null;
      if(id&&!remote){entryStore=runtime.transcript.snapshotsFor(id);offEntries=entryStore.subscribe(schedule);}
      for(const node of document.querySelectorAll("[data-bb-delivery],[data-bb-publication]"))node.remove();
    }
    const state=snapshot(),entries=!remote&&id&&Array.isArray(state?.entries)?state.entries:[];
    const byRow=new Map(entries.filter(e=>e?.delivery&&(labels()[e.delivery.state]||Object.values(e.delivery.recipients||{}).some(state=>labels()[state]))).map(e=>[e.kind==="message"&&e.clientNonce?`nonce:${e.clientNonce}`:e.id,e]));
    const names=new Map((runtime.roster?.snapshots?.get?.()?.agents?.rows||[]).map(bot=>[bot.id,bot.name]));
    const copy=labels();
    // Read statuses only from current authoritative transcript, not rendered text.
    for(const row of document.querySelectorAll("[data-row-key]")){
      const entry=byRow.get(row.getAttribute("data-row-key"));let badge=row.querySelector(":scope > [data-bb-delivery]");
      if(!entry){badge?.remove();continue;}
      if(!badge){badge=document.createElement("span");badge.dataset.bbDelivery=entry.id;row.append(badge);}
      const recipients=Object.entries(entry.delivery.recipients||{}).filter(([,value])=>copy[value]);
      const detail=Object.keys(entry.delivery.recipients||{}).length>1?recipients.map(([bot,status])=>`${names.get(bot)||t("成员","Member")} · ${copy[status]}`).join("；"):"";
      const attentionState=copy[entry.delivery.state]?entry.delivery.state:["needs-review","failed","cancelled"].find(state=>recipients.some(([,value])=>value===state));
      const value=detail||copy[attentionState];
      if(badge.textContent!==value)badge.textContent=value;
      badge.dataset.state=attentionState;
    }
    // Artifacts already have their own conversation cards. Their provenance
    // remains recorded internally; a hash banner adds no useful action here.
    const publications=new Map(entries.filter(e=>e?.decisionStatus==="stale").map(e=>[e.id,e]));
    for(const row of document.querySelectorAll("[data-row-key]")){
      const entry=publications.get(row.getAttribute("data-row-key"));let badge=row.querySelector(":scope > [data-bb-publication]");
      if(!entry){badge?.remove();continue;}
      if(!badge){badge=document.createElement("span");badge.dataset.bbPublication=entry.id;row.append(badge);}
      const value=t("要求已变化，这个旧问题已失效；请在会话中重新确认。","Requirements changed. This old question is inactive; clarify in this conversation.");
      if(badge.textContent!==value)badge.textContent=value;
      badge.removeAttribute("title");
    }
    const unresolved=entries.filter(entry=>["queued","processing","needs-review"].includes(entry?.delivery?.state));
    const processing=unresolved.filter(entry=>["queued","processing"].includes(entry.delivery.state)).length;
    const dock=document.querySelector(".sand-chat-input-dock");
    if(dock&&toolbar.parentElement!==dock)dock.prepend(toolbar);
    toolbar.hidden=remote||!id||(!unresolved.length&&!feedback&&!intent);
    const nextSummary=transportDown()?t("连接中断，保留最后确认的处理状态。","Disconnected. Showing the last confirmed state."):
      unresolved.some(entry=>entry.delivery.state==="needs-review")?t("有执行结果需要核查，工作没有重新执行。","Some results need checking. Work has not been repeated."):
      processing?t("同事正在工作","Colleagues are working"):"";
    if(summary.textContent!==nextSummary)summary.textContent=nextSummary;
    summary.hidden=!nextSummary;
    stop.textContent=t("停止此会话的工作","Stop this conversation’s work");
    stop.hidden=!processing||!!intent;stop.disabled=pending||transportDown()||typeof runtime.roster?.stopConversation!=="function";
    confirm.hidden=!intent;proceed.disabled=pending||transportDown();cancel.disabled=pending;
    explanation.textContent=t("停止后续执行，不会撤销已经发生的外部操作。","Stop further execution. External actions that already happened will not be undone.");
    proceed.textContent=pending?t("正在请求停止…","Requesting stop…"):t("确认停止","Confirm stop");cancel.textContent=t("继续工作","Keep working");
    if(notice.textContent!==feedback)notice.textContent=feedback;
  }
  function schedule(){if(disposed||scheduled)return;scheduled=true;queueMicrotask(render);}
  stop.onclick=()=>{if(!id||isRemote()||pending||transportDown())return;intent={id,epoch};render();cancel.focus({preventScroll:true});};
  cancel.onclick=()=>{intent=null;render();stop.focus({preventScroll:true});};
  proceed.onclick=async()=>{
    const captured=intent;if(!captured||isRemote()||captured.id!==id||runtime.selection.snapshots.get()?.currentAgentId!==captured.id||captured.epoch!==epoch||pending||transportDown())return;
    pending=true;feedback="";render();
    try{
      const result=await runtime.roster.stopConversation({agentId:captured.id});
      if(disposed||captured.epoch!==epoch)return;
      if(result?.accepted!==true)throw new Error("Stop was not confirmed");
      intent=null;feedback=t("停止请求已接收。已发生的操作没有被撤销；请核查受影响的结果。","Stop request accepted. Existing effects were not undone; review the affected results.");
    }catch{if(!disposed&&captured.epoch===epoch)feedback=t("暂未确认停止。工作可能仍在进行，请检查连接后重试。","Stopping was not confirmed. Work may still be running. Check the connection and try again.");}
    finally{if(!disposed&&captured.epoch===epoch){pending=false;render();}}
  };
  function navigationChanged(){epoch++;intent=null;pending=false;feedback="";schedule();}
  disposers.push(runtime.selection.snapshots.subscribe(navigationChanged));
  if(runtime.connection?.snapshots)disposers.push(runtime.connection.snapshots.subscribe(schedule));
  if(runtime.roster?.snapshots)disposers.push(runtime.roster.snapshots.subscribe(schedule));
  window.addEventListener("sand-ui-language-changed",schedule);window.addEventListener("beebot-node-selection",navigationChanged);
  // Virtualization mounts rows independently of data arrival. Child changes only
  // (not attributes/text) prevent our own badge updates from creating a loop.
  const observer=new MutationObserver(records=>{if(records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&!node.matches?.('[data-bb-delivery],[data-bb-publication]'))))schedule();});
  observer.observe(document.body,{subtree:true,childList:true});
  window.__beebotConversationStatus={runtime,dispose(){disposed=true;if(window.__beebotConversationStatus?.runtime===runtime)delete window.__beebotConversationStatus;epoch++;offEntries?.();for(const dispose of disposers)dispose?.();observer.disconnect();toolbar.remove();for(const node of document.querySelectorAll('[data-bb-delivery],[data-bb-publication]'))node.remove();window.removeEventListener("sand-ui-language-changed",schedule);window.removeEventListener("beebot-node-selection",navigationChanged);}};
  render();
}
