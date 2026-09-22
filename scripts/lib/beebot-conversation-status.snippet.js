/* Read-only UI projections from the real conversation stores. No DOM-derived
 * work state, fabricated read receipts, automatic retries, or popup approvals. */
function RBindConversationStatus(runtime) {
  if (!runtime?.selection?.snapshots || !runtime?.transcript?.snapshotsFor) return;
  if (window.__beebotConversationStatus?.runtime === runtime) return;
  window.__beebotConversationStatus?.dispose();
  const t=(cn,en)=>window.__sandUiLanguage==="zh"?cn:en;
  let disposed=false,scheduled=false,id=null,entryStore=null,offEntries,epoch=0;
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
      [data-bb-delivery],[data-bb-publication],[data-bb-work]{display:block;width:fit-content;max-width:100%;margin:4px 0 6px;font:11px/1.5 system-ui;color:var(--cursor-text-secondary,GrayText);overflow-wrap:anywhere}
      [data-bb-work]{display:block;width:100%;margin:6px 0;color:var(--cursor-text-secondary,GrayText);font:12px/1.6 system-ui;overflow-wrap:anywhere}
      [data-bb-work] summary{cursor:pointer;min-height:28px;padding:3px 0}
      [data-bb-work] summary:focus-visible{outline:2px solid var(--cursor-accent,Highlight);outline-offset:2px}
      [data-bb-work] p{margin:4px 0 8px;white-space:pre-wrap;padding:8px 12px;border-inline-start:2px solid var(--cursor-stroke-secondary,#8884)}
      [data-bb-delivery][data-state="failed"],[data-bb-delivery][data-state="needs-review"]{font-weight:550}
    `;document.head.append(style);
  }
  const snapshot=()=>entryStore?.get?.();
  const transportDown=()=>runtime.connection?.snapshots?.get?.()?.transport==="down";
  const labels=()=>({queued:t("等待处理","Waiting to be handled"),processing:t("正在处理","Being handled"),processed:t("本轮已处理，暂无关联回复","Handled; no linked reply"),replied:t("已有回应","Response available"),failed:t("本次处理失败，消息已保留","Handling failed; message retained"),"needs-review":t("结果待核查，未自动重做","Review needed; not replayed"),cancelled:t("后续处理已停止","Further handling stopped")});
  function render(){
    scheduled=false;if(disposed)return;
    const current=runtime.selection.snapshots.get()?.currentAgentId??null;
    if(current!==id){
      id=current;epoch++;intent=null;pending=false;feedback="";offEntries?.();offEntries=undefined;entryStore=null;
      if(id){entryStore=runtime.transcript.snapshotsFor(id);offEntries=entryStore.subscribe(schedule);}
      for(const node of document.querySelectorAll("[data-bb-delivery],[data-bb-publication],[data-bb-work]"))node.remove();
    }
    const remote=document.body?.dataset.beebotRemoteActive==="true";
    const state=snapshot(),entries=!remote&&id&&Array.isArray(state?.entries)?state.entries:[];
    const byRow=new Map(entries.filter(e=>e?.delivery&&labels()[e.delivery.state]).map(e=>[e.kind==="message"&&e.clientNonce?`nonce:${e.clientNonce}`:e.id,e]));
    const names=new Map((runtime.roster?.snapshots?.get?.()?.agents?.rows||[]).map(bot=>[bot.id,bot.name]));
    const copy=labels();
    // Read statuses only from current authoritative transcript, not rendered text.
    for(const row of document.querySelectorAll("[data-row-key]")){
      const entry=byRow.get(row.getAttribute("data-row-key"));let badge=row.querySelector(":scope > [data-bb-delivery]");
      if(!entry){badge?.remove();continue;}
      if(!badge){badge=document.createElement("span");badge.dataset.bbDelivery=entry.id;row.append(badge);}
      const recipients=Object.entries(entry.delivery.recipients||{}).filter(([,value])=>copy[value]);
      const detail=recipients.length>1?recipients.map(([bot,status])=>`${names.get(bot)||t("成员","Member")} · ${copy[status]}`).join("；"):"";
      const value=detail||copy[entry.delivery.state];
      if(badge.textContent!==value)badge.textContent=value;
      badge.dataset.state=entry.delivery.state;
    }
    const publications=new Map(entries.filter(e=>e?.message?.artifact||e?.decisionStatus==="stale"||e?.message?.images?.some(image=>image.artifact)).map(e=>[e.id,e]));
    for(const row of document.querySelectorAll("[data-row-key]")){
      const entry=publications.get(row.getAttribute("data-row-key"));let badge=row.querySelector(":scope > [data-bb-publication]");
      if(!entry){badge?.remove();continue;}
      if(!badge){badge=document.createElement("span");badge.dataset.bbPublication=entry.id;row.append(badge);}
      const files=entry.message?.artifact?[entry.message.artifact]:(entry.message?.images||[]).map(image=>image.artifact).filter(Boolean);
      const value=entry.decisionStatus==="stale"?t("要求已变化，这个旧问题已失效；请在会话中重新确认。","Requirements changed. This old question is inactive; clarify in this conversation."):
        files.map(file=>file.availability==="snapshot"&&/^[a-f0-9]{64}$/.test(file.sha256||"")
          ?t(`成果快照 · ${Number(file.bytes).toLocaleString()} 字节 · SHA-256 ${file.sha256.slice(0,12)}…（不代表验收通过）`,`Artifact snapshot · ${Number(file.bytes).toLocaleString()} bytes · SHA-256 ${file.sha256.slice(0,12)}… (not an acceptance result)`)
          :t("外部文件链接，未在本机验证。","External file link, not locally verified.")).join("；");
      if(badge.textContent!==value)badge.textContent=value;
      badge.title=files.map(file=>file.sha256||"").filter(Boolean).join("\n");
    }
    const workById=new Map();
    for(const entry of entries)if(entry.collaborationEvent?.schemaVersion===1&&entry.collaborationEvent.action!=="finalize"&&entry.collaborationEvent.task?.id)workById.set(entry.collaborationEvent.task.id,entry.collaborationEvent.task);
    function validDependencies(task,seen=new Set()){
      if(seen.has(task.id))return false;const next=new Set(seen).add(task.id);
      return (task.dependsOn||[]).every(id=>{const parent=workById.get(id);return parent?.state==="reviewed"&&parent.submission?.contractVersion===parent.contractVersion&&(!task.ownerId||task.dependencyVersions?.[id]===parent.contractVersion)&&validDependencies(parent,next);});
    }
    const sources=new Map(entries.filter(entry=>entry.collaborationEvent?.action==="assign").map(entry=>[entry.id,entry]));
    const workLabels={offered:t("待接手","Awaiting claim"),claimed:t("已接手","Claimed"),blocked:t("等待条件满足","Blocked"),submitted:t("等待复核","Awaiting review"),reviewed:t("复核记录已保存","Review recorded"),changes_requested:t("需要修改","Changes requested")};
    for(const row of document.querySelectorAll("[data-row-key]")){
      const source=sources.get(row.getAttribute("data-row-key")),task=source&&workById.get(source.id);let detail=row.querySelector(":scope > [data-bb-work]");
      if(!task||!workLabels[task.state]){detail?.remove();continue;}
      if(!detail){detail=document.createElement("details");detail.dataset.bbWork=task.id;detail.append(document.createElement("summary"),document.createElement("p"));row.append(detail);}
      const owner=names.get(task.ownerId??task.assigneeId)||t("待认领","Open assignment");
      const status=!validDependencies(task)?t("依赖待核查，非完成状态","Dependencies need review, not complete"):task.state==="reviewed"?(task.review?.kind==="self"?t("自检通过，非独立复核","Self-checked, not independent review"):t("同伴复核通过，非用户验收","Peer-reviewed, not user acceptance")):workLabels[task.state];
      const title=`${owner} · ${status} · ${task.title}`;
      if(detail.firstElementChild.textContent!==title)detail.firstElementChild.textContent=title;
      const body=`${t("交付","Deliverable")}: ${task.deliverable}\n${t("验收条件","Acceptance criteria")}:\n${(task.criteria||[]).map((c,i)=>`${i+1}. ${c}`).join("\n")}\n${t("约定版本","Contract version")}: ${task.contractVersion}${task.reason?`\n${task.reason}`:""}`;
      if(detail.lastElementChild.textContent!==body)detail.lastElementChild.textContent=body;
      detail.dataset.state=task.state;
    }
    const unresolved=entries.filter(entry=>["queued","processing","needs-review"].includes(entry?.delivery?.state));
    const processing=unresolved.filter(entry=>["queued","processing"].includes(entry.delivery.state)).length;
    const dock=document.querySelector(".sand-chat-input-dock");
    if(dock&&toolbar.parentElement!==dock)dock.prepend(toolbar);
    toolbar.hidden=remote||!id||(!unresolved.length&&!feedback&&!intent);
    const nextSummary=transportDown()?t("连接中断，保留最后确认的处理状态。","Disconnected. Showing the last confirmed state."):
      processing?t(`${processing} 条消息处理中或等待处理，你可以继续说话。`,`${processing} message(s) being handled or waiting. You can keep talking.`):
      unresolved.length?t("有执行结果需要核查，未自动重做。","Some results need review. Nothing was automatically replayed."):"";
    if(summary.textContent!==nextSummary)summary.textContent=nextSummary;
    stop.textContent=t("停止此会话的工作","Stop this conversation’s work");
    stop.hidden=!processing||!!intent;stop.disabled=pending||transportDown()||typeof runtime.roster?.stopConversation!=="function";
    confirm.hidden=!intent;proceed.disabled=pending||transportDown();cancel.disabled=pending;
    explanation.textContent=t("停止后续执行，不会撤销已经发生的外部操作。","Stop further execution. External actions that already happened will not be undone.");
    proceed.textContent=pending?t("正在请求停止…","Requesting stop…"):t("确认停止","Confirm stop");cancel.textContent=t("继续工作","Keep working");
    if(notice.textContent!==feedback)notice.textContent=feedback;
  }
  function schedule(){if(disposed||scheduled)return;scheduled=true;queueMicrotask(render);}
  stop.onclick=()=>{if(!id||pending||transportDown())return;intent={id,epoch};render();cancel.focus({preventScroll:true});};
  cancel.onclick=()=>{intent=null;render();stop.focus({preventScroll:true});};
  proceed.onclick=async()=>{
    const captured=intent;if(!captured||captured.id!==id||runtime.selection.snapshots.get()?.currentAgentId!==captured.id||captured.epoch!==epoch||pending||transportDown())return;
    pending=true;feedback="";render();
    try{
      const result=await runtime.roster.stopConversation({agentId:captured.id});
      if(disposed||captured.epoch!==epoch)return;
      if(result?.accepted!==true)throw new Error("Stop was not confirmed");
      intent=null;feedback=t("停止请求已接收。已发生的操作没有被撤销；请核查受影响的结果。","Stop request accepted. Existing effects were not undone; review the affected results.");
    }catch{if(!disposed&&captured.epoch===epoch)feedback=t("暂未确认停止。工作可能仍在进行，请检查连接后重试。","Stopping was not confirmed. Work may still be running. Check the connection and try again.");}
    finally{if(!disposed&&captured.epoch===epoch){pending=false;render();}}
  };
  disposers.push(runtime.selection.snapshots.subscribe(schedule));
  if(runtime.connection?.snapshots)disposers.push(runtime.connection.snapshots.subscribe(schedule));
  if(runtime.roster?.snapshots)disposers.push(runtime.roster.snapshots.subscribe(schedule));
  window.addEventListener("sand-ui-language-changed",schedule);window.addEventListener("beebot-node-selection",schedule);
  // Virtualization mounts rows independently of data arrival. Child changes only
  // (not attributes/text) prevent our own badge updates from creating a loop.
  const observer=new MutationObserver(records=>{if(records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&!node.matches?.('[data-bb-delivery],[data-bb-publication],[data-bb-work]'))))schedule();});
  observer.observe(document.body,{subtree:true,childList:true});
  window.__beebotConversationStatus={runtime,dispose(){disposed=true;if(window.__beebotConversationStatus?.runtime===runtime)delete window.__beebotConversationStatus;epoch++;offEntries?.();for(const dispose of disposers)dispose?.();observer.disconnect();toolbar.remove();for(const node of document.querySelectorAll('[data-bb-delivery],[data-bb-publication],[data-bb-work]'))node.remove();window.removeEventListener("sand-ui-language-changed",schedule);window.removeEventListener("beebot-node-selection",schedule);}};
  render();
}
