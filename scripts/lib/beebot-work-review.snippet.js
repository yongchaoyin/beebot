/* Authenticated user review stays on the submitted message. No automatic model
 * decisions, modal dialogs, inferred success, or changes to the chat composer. */
function RBindWorkReview(runtime) {
  if(!runtime?.selection?.snapshots||!runtime?.transcript?.snapshotsFor)return;
  const t=(cn,en)=>window.__sandUiLanguage==="zh"?cn:en;
  const make=(tag,cls)=>{const n=document.createElement(tag);if(cls)n.className=cls;return n;};
  const cards=new Map();let room=null,epoch=0,store,offStore,disposed=false,scheduled=false;
  const down=()=>runtime.connection?.snapshots?.get?.()?.transport==="down";
  const remote=()=>document.body?.dataset.beebotRemoteActive==="true";
  const current=()=>runtime.selection.snapshots.get()?.currentAgentId??null;
  const valid=c=>!disposed&&!remote()&&current()===c.room&&epoch===c.epoch;
  if(!document.getElementById("beebot-work-review-style")){
    const style=make("style");style.id="beebot-work-review-style";style.textContent=`
      [data-bb-work-review]{max-width:660px;margin:10px 0 14px;padding:14px 16px;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:12px;font:13px/1.6 system-ui;color:var(--cursor-text-primary,CanvasText);background:var(--cursor-bg-secondary,Canvas);-webkit-app-region:no-drag;overflow-wrap:anywhere}
      [data-bb-work-review] [hidden]{display:none!important}[data-bb-work-review] h4{margin:0;font-size:13px;font-weight:600}[data-bb-work-review] p{margin:5px 0 10px;color:var(--cursor-text-secondary,GrayText);font-size:12px}
      [data-bb-work-review] button{font:inherit;min-height:34px;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:8px;padding:5px 11px;color:inherit;background:transparent;cursor:pointer}[data-bb-work-review] button:disabled{opacity:.5;cursor:default}
      [data-bb-work-review] :is(button,input,textarea):focus-visible{outline:2px solid var(--cursor-accent,Highlight);outline-offset:3px}[data-bb-work-review] fieldset{min-width:0;margin:12px 0;padding:0;border:0}[data-bb-work-review] legend{font-size:12px;font-weight:600;margin-bottom:6px}
      [data-bb-work-review] label{display:flex;align-items:flex-start;gap:8px;margin:8px 0}[data-bb-work-review] input[type=checkbox]{width:17px;height:17px;margin-top:3px;flex-shrink:0}[data-bb-work-review] pre{white-space:pre-wrap;margin:6px 0 10px;max-height:160px;overflow:auto;font:12px/1.6 system-ui;color:var(--cursor-text-secondary,GrayText)}
      [data-bb-work-review] textarea{display:block;box-sizing:border-box;width:100%;min-height:72px;resize:vertical;border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:8px;padding:9px 10px;font:inherit;color:inherit;background:var(--cursor-bg-input,Canvas)}
      .bb-review-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.bb-review-notice{margin-top:8px;font-size:12px;color:var(--cursor-text-secondary,GrayText)}.bb-review-notice:empty{display:none}
      @media(max-width:520px){[data-bb-work-review]{padding:12px;max-width:100%}.bb-review-actions button{flex:1;min-width:110px}}
    `;document.head.append(style);
  }
  function paint(c){
    for(const [node,cn,en] of c.strings||[])node.textContent=t(cn,en);
    const reviewedState=c.data?.task?.state;
    c.title.textContent=reviewedState==="accepted"?t("这份结果已验收","This result was accepted"):reviewedState==="changes_requested"?t("这份结果需要修改","Changes were requested"):reviewedState&&reviewedState!=="submitted"?t("此版本的验收记录","Review record for this version"):t("这份结果需要你验收","This result needs your review");
    c.description.textContent=c.event.title+t(` · 工作版本 ${c.data?.task?.version??c.event.version}`,` · Work version ${c.data?.task?.version??c.event.version}`);
    c.open.textContent=c.loading?t("读取最新版本…","Loading latest version…"):c.expanded?t("收起验收","Hide review"):t("查看成果并验收","Review this result");
    c.open.disabled=c.loading||c.pending||down()||typeof runtime.roster?.getWorkReview!=="function";c.open.setAttribute("aria-expanded",String(c.expanded));
    c.body.hidden=!c.expanded;
    c.accept.textContent=t("确认验收通过","Accept result");c.changes.textContent=t("要求修改","Request changes");
    c.reload.textContent=t("核对最新状态","Check latest status");c.reload.hidden=!(c.error||c.stale);c.reload.disabled=c.loading||c.pending||down();
    c.note.placeholder=t("说明检查结论，或需要修改的具体问题…","Describe your checks or the changes needed…");c.note.setAttribute("aria-label",t("验收意见","Review note"));
    if((store?.get?.()?.entries||[]).some(e=>e.workEvent?.taskId===c.event.taskId&&e.workEvent.version>(c.data?.task?.version??c.event.version)))c.stale=true;
    const task=c.data?.task,canReview=task?.state==="submitted"&&task.reviewerId===null&&task.submission?.id===c.entryId&&!c.stale;
    c.form.hidden=!canReview;
    const locked=c.pending||c.loading||c.uncertain||down()||!canReview;
    for(const check of [...c.criteria,...c.evidence])check.disabled=locked||check.dataset.unavailable==="true";
    c.note.disabled=locked;
    const evidence=c.evidence.filter(n=>n.checked).length,ready=!locked&&evidence>0&&evidence<=8;
    c.accept.disabled=!ready||c.criteria.some(n=>!n.checked);c.changes.disabled=!ready||!c.note.value.trim();
    const recorded=c.saved?t("验收意见已保存。","Review recorded."):"";
    const deliveryNote=c.saved&&c.needsReview?t("后续通知需要核查，不会自动重跑。"," Follow-up delivery needs inspection; work is not replayed automatically."):"";
    c.notice.textContent=c.error?t("尚未确认提交结果，请先核对最新状态；不会自动重试。","The result is unconfirmed. Check the latest status before retrying; nothing is retried automatically."):
      c.stale?t("已有较新的工作记录，请核对最新状态。","Newer work is recorded. Check the latest state."):
      task&&task.state!=="submitted"?recorded+t(`当前状态：${({accepted:"已验收",changes_requested:"待修改",claimed:"处理中",blocked:"受阻",offered:"待接单"})[task.state]||task.state}。`,` Current state: ${task.state}.`)+deliveryNote:
      task?.state==="submitted"&&task.submission?.id!==c.entryId?t("请查看较新版本的成果消息。","Review the newer result message instead."):
      c.saved?recorded+deliveryNote:"";
  }
  function fill(c,data){
    c.data=data;c.stale=false;
    if(!data?.task||!Array.isArray(data.task.requirements)||!Array.isArray(data.results))throw new Error("Invalid work review response");
    const signature=JSON.stringify([data.task.version,data.task.submission?.id,data.task.requirements,data.results]);
    if(c.signature!==signature){
      c.signature=signature;c.criteria=[];c.evidence=[];c.strings=[];c.form.replaceChildren();
      const copy=(node,cn,en)=>{c.strings.push([node,cn,en]);node.textContent=t(cn,en);};
      const info=make("p");copy(info,"先检查完整成果，再勾选通过的要求。这里记录你的判断，不代替实际测试，也不授权额外操作。","Inspect the complete results, then mark requirements that passed. This records your judgment, not automated testing or extra permission.");c.form.append(info);
      const results=make("fieldset"),legend=make("legend");copy(legend,"本次检查引用的成果（最多 8 项）","Evidence for this review (up to 8)");results.append(legend);
      for(const [i,result] of data.results.entries()){
        const label=make("label"),check=make("input"),name=make("span");check.type="checkbox";check.value=result.id;check.checked=i===0&&result.available;check.disabled=!result.available;check.dataset.unavailable=String(!result.available);
        if(result.fileName)name.textContent=result.fileName;else copy(name,`成果 ${i+1}`,`Result ${i+1}`);label.append(check,name);results.append(label);
        const preview=make("pre");if(result.available&&result.text)preview.textContent=result.text;else if(result.available)copy(preview,"请在原成果消息中打开并检查文件。","Open and inspect the file in its original message.");else copy(preview,"原成果暂不可用。","Original result unavailable.");results.append(preview);
        c.evidence.push(check);check.onchange=()=>{c.operation=null;paint(c);};
      }
      const criteria=make("fieldset"),heading=make("legend");copy(heading,"已核对通过的要求","Requirements verified as passed");criteria.append(heading);
      for(const requirement of data.task.requirements){const label=make("label"),check=make("input"),text=make("span");check.type="checkbox";text.textContent=requirement;label.append(check,text);criteria.append(label);c.criteria.push(check);check.onchange=()=>{c.operation=null;paint(c);};}
      const actions=make("div","bb-review-actions");actions.append(c.accept,c.changes);c.form.append(results,criteria,c.note,actions);
    }
    paint(c);
  }
  async function inspect(c){
    if(!valid(c)||c.loading||c.pending||down())return;
    c.expanded=true;c.loading=true;c.error=false;paint(c);
    try{const data=await runtime.roster.getWorkReview({agentId:c.room,taskId:c.event.taskId});if(!valid(c))return;fill(c,data);c.uncertain=false;}
    catch{if(valid(c))c.error=true;}
    finally{if(valid(c)){c.loading=false;paint(c);}}
  }
  async function submit(c,decision){
    if(!valid(c)||c.pending||c.uncertain||c.stale||down()||c.data?.task?.state!=="submitted")return;
    const ids=c.evidence.filter(n=>n.checked).map(n=>n.value);if(!ids.length||ids.length>8||(decision==="accept"&&c.criteria.some(n=>!n.checked))||(decision==="request_changes"&&!c.note.value.trim()))return;
    const note=c.note.value.trim()||t("已核对所列要求，验收此版本的成果。","Checked the listed requirements and accepted this result version.");
    const command={action:"review",task_id:c.event.taskId,expected_version:c.data.task.version,submission_id:c.entryId,decision,checks:c.criteria.map((n,i)=>({criterion:i+1,passed:n.checked,evidence_ids:ids}))};
    const signature=JSON.stringify({command,note});if(c.operation?.signature!==signature)c.operation={signature,id:crypto.randomUUID()};
    c.pending=true;c.error=false;paint(c);
    try{const result=await runtime.roster.submitWorkReview({agentId:c.room,taskId:c.event.taskId,contextId:c.data.contextId,controlEpoch:c.data.controlEpoch,note,command:{...command,operation_id:c.operation.id}});
      if(!valid(c))return;if(result?.recorded!==true)throw new Error("Review not confirmed");c.data.task=result.task;c.saved=true;c.needsReview=result.notification==="needs-review";
    }catch{if(valid(c)){c.error=true;c.uncertain=true;}}
    finally{if(valid(c)){c.pending=false;paint(c);}}
  }
  function create(entry){
    const root=make("section"),title=make("h4"),description=make("p"),open=make("button"),body=make("div"),form=make("div"),notice=make("div","bb-review-notice"),reload=make("button"),note=make("textarea"),accept=make("button"),changes=make("button");
    root.dataset.bbWorkReview=entry.id;notice.setAttribute("role","status");for(const b of [open,reload,accept,changes])b.type="button";
    body.append(form,notice,reload);root.append(title,description,open,body);
    const c={root,title,description,open,body,form,notice,reload,note,accept,changes,entryId:entry.id,event:entry.workEvent,room,epoch,criteria:[],evidence:[],expanded:false};
    open.onclick=()=>{if(!valid(c))return;if(c.expanded){c.expanded=false;paint(c);}else if(c.data){c.expanded=true;paint(c);}else void inspect(c);};
    reload.onclick=()=>void inspect(c);note.oninput=()=>{c.operation=null;paint(c);};accept.onclick=()=>void submit(c,"accept");changes.onclick=()=>void submit(c,"request_changes");paint(c);return c;
  }
  function render(){
    scheduled=false;if(disposed)return;
    if(current()!==room){room=current();epoch++;offStore?.();for(const c of cards.values())c.root.remove();cards.clear();store=room?runtime.transcript.snapshotsFor(room):null;offStore=store?.subscribe(schedule);}
    const entries=remote()?[]:store?.get?.()?.entries||[];
    const wanted=new Map(entries.filter(e=>e.kind==="send-message"&&e.workEvent?.schema===1&&e.workEvent?.action==="submit"&&e.workEvent.state==="submitted"&&e.workEvent.actorId===e.author?.id&&e.workEvent.reviewerId===null&&e.workEvent.ownerId===e.author?.id&&Number.isSafeInteger(e.workEvent.version)&&e.workEvent.version>0&&typeof e.workEvent.title==="string"&&e.workEvent.title.length<=160&&typeof e.workEvent.taskId==="string"&&e.workEvent.taskId.length>0&&e.workEvent.taskId.length<=256).map(e=>[e.id,e]));
    for(const [key,c] of cards)if(!wanted.has(key)){c.root.remove();cards.delete(key);}
    for(const row of document.querySelectorAll("[data-row-key]")){
      const entry=wanted.get(row.getAttribute("data-row-key"));if(!entry)continue;
      let c=cards.get(entry.id);if(!c){c=create(entry);cards.set(entry.id,c);}
      if(c.root.parentElement!==row)row.append(c.root);
      const newer=entries.some(e=>e.workEvent?.schema===1&&e.workEvent.taskId===entry.workEvent.taskId&&e.workEvent.version>entry.workEvent.version);
      c.stale=newer&&!c.saved;paint(c);
    }
  }
  function schedule(){if(!disposed&&!scheduled){scheduled=true;queueMicrotask(render);}}
  const offs=[runtime.selection.snapshots.subscribe(schedule)];if(runtime.connection?.snapshots)offs.push(runtime.connection.snapshots.subscribe(schedule));
  const observer=new MutationObserver(records=>{if(records.some(record=>!record.target.closest?.("[data-bb-work-review]")&&[...record.addedNodes,...record.removedNodes].some(n=>n.nodeType===1&&!n.matches?.("[data-bb-work-review]"))))schedule();});observer.observe(document.body,{subtree:true,childList:true});
  window.addEventListener("sand-ui-language-changed",schedule);window.addEventListener("beebot-node-selection",schedule);render();
  return {dispose(){disposed=true;epoch++;offStore?.();offs.forEach(off=>off?.());observer.disconnect();cards.forEach(c=>c.root.remove());cards.clear();window.removeEventListener("sand-ui-language-changed",schedule);window.removeEventListener("beebot-node-selection",schedule);}};
}
