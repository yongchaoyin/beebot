/* Read authoritative work receipts via the existing coordinator. Reviews remain
 * in chat; controls never infer completion from prose or grant tool authority. */
function RBindCollaborationReview(runtime) {
  if (!runtime?.selection?.snapshots || !runtime?.transcript?.snapshotsFor || typeof runtime.roster?.getCollaboration !== "function") return;
  if (window.__beebotCollaborationReview?.runtime === runtime) return;
  window.__beebotCollaborationReview?.dispose();
  const t = (cn,en) => window.__sandUiLanguage === "zh" ? cn : en;
  const node = (tag,cls) => {const e=document.createElement(tag);if(cls)e.className=cls;return e;};
  const root=node("section","bb-work"), toggle=node("button"), panel=node("div"), feedback=node("p"), completion=node("p");
  root.dataset.bbWork=""; root.id="beebot-collaboration-review";toggle.type="button";panel.id="bb-work-panel";
  toggle.setAttribute("aria-controls",panel.id);feedback.setAttribute("role","status");completion.className="bb-work-completion";root.append(toggle,completion,panel,feedback);
  let disposed=false,room=null,epoch=0,serial=0,offEntries,entryStore,signature="",timer,expanded=false,trusted=false;
  let data={tasks:[],completions:[]},error=""; const disposers=[],cards=new Map();
  const remote=()=>document.body?.dataset.beebotRemoteActive==="true";
  const down=()=>runtime.connection?.snapshots?.get?.()?.transport==="down";
  const selected=()=>runtime.selection.snapshots.get()?.currentAgentId??null;
  const labels=()=>({offered:t("等待接手","Offered"),claimed:t("已接手","Claimed"),waiting:t("等待依赖","Waiting"),blocked:t("需要协助","Blocked"),review:t("待验收","Awaiting review"),"changes-requested":t("需要修改","Changes requested"),accepted:t("此版本已验收","Version accepted")});
  if(!document.getElementById("bb-work-style")){
    const style=node("style");style.id="bb-work-style";style.textContent=`
      .bb-work{font:13px/1.6 system-ui;min-width:0;color:var(--bee-text-primary,var(--cursor-text-primary,CanvasText));-webkit-app-region:no-drag}
      .bb-work[hidden],.bb-work [hidden]{display:none!important}.bb-work>button{margin:4px 12px;color:var(--bee-text-secondary,var(--cursor-text-secondary,GrayText))}
      .bb-work button,.bb-work select,.bb-work textarea{font:inherit;color:inherit;border:1px solid var(--cursor-stroke-secondary,#8885);border-radius:8px;background:var(--bee-surface,var(--cursor-bg-primary,Canvas));min-height:34px;padding:5px 10px}
      .bb-work button{cursor:pointer}.bb-work button:disabled{opacity:.55;cursor:default}.bb-work :is(button,select,textarea):focus-visible{outline:2px solid var(--bee-accent,var(--cursor-accent,Highlight));outline-offset:2px}
      #bb-work-panel{max-height:min(42vh,420px);overflow:auto;overscroll-behavior:contain;margin:0 12px 8px;display:grid;gap:10px}
      .bb-work-card{border:1px solid var(--cursor-stroke-secondary,#8885);border-radius:12px;padding:14px;min-width:0}
      .bb-work-card h3,.bb-work-card p{margin:0 0 7px;overflow-wrap:anywhere}.bb-work-card h3{font-size:14px}.bb-work-card small{display:block;overflow-wrap:anywhere;color:var(--bee-text-secondary,var(--cursor-text-secondary,GrayText))}
      .bb-work-card details{margin:8px 0}.bb-work-card pre{white-space:pre-wrap;word-break:break-word;font:12px/1.6 system-ui;max-height:160px;overflow:auto}
      .bb-work-check{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;margin:12px 0}.bb-work-check textarea{grid-column:1/-1;width:100%;resize:vertical;min-height:48px;max-height:180px}.bb-work-check label{overflow-wrap:anywhere}
      .bb-work-actions{display:flex;gap:8px;flex-wrap:wrap}.bb-work>p{margin:0 12px;overflow-wrap:anywhere}.bb-work>p:empty{display:none}
      @media(max-width:500px){.bb-work-check{grid-template-columns:1fr}.bb-work-check textarea{grid-column:1}.bb-work-card{padding:12px}}
    `;document.head.append(style);
  }
  function isCurrent(at,id){return !disposed&&epoch===at&&selected()===id&&!remote();}
  function clear(){for(const c of cards.values())c.root.remove();cards.clear();data={tasks:[],completions:[]};}
  function sync(){
    if(disposed)return;
    const next=selected();
    if(next!==room){epoch++;serial++;room=next;offEntries?.();entryStore=null;signature="";trusted=false;expanded=false;error="";clear();
      if(room){entryStore=runtime.transcript.snapshotsFor(room);offEntries=entryStore.subscribe(sync);}}
    if(!room||remote()){trusted=false;serial++;signature="";root.hidden=true;return;}
    const entries=entryStore?.get?.()?.entries??[];
    const sig=JSON.stringify([room,down(),entries.filter(e=>e.collaborationEvent||e.completionEvent||e.code==="conversation_stop_requested").map(e=>[e.id,e.collaborationEvent?.task?.version]),runtime.roster.snapshots?.get?.()?.agents?.rows?.map(b=>[b.id,b.isGroup,b.memberIds])]);
    if(sig!==signature){signature=sig;trusted=false;serial++;clearTimeout(timer);timer=setTimeout(load,40);}
    render();
  }
  async function load(){
    if(disposed||!room||remote()||down()){trusted=false;render();return;}
    const at=epoch,id=room,request=++serial;
    try{
      const result=await runtime.roster.getCollaboration({agentId:id});
      if(!isCurrent(at,id)||request!==serial)return;
      if(result?.agentId!==id||!Array.isArray(result.tasks)||result.tasks.length>256||!Array.isArray(result.completions)
        ||result.completions.some(item=>typeof item?.current!=="boolean")
        ||result.tasks.some(task=>!task||typeof task.id!=="string"||typeof task.title!=="string"||!Number.isInteger(task.version)||!Array.isArray(task.criteria)||task.criteria.length>12||task.criteria.some(c=>typeof c!=="string")||!Array.isArray(task.evidence)
          ||task.evidence.some(e=>!e||!Array.isArray(e.files)||e.files.some(f=>typeof f.sha256!=="string"))
          ||(task.canReview&&(!task.submission||typeof task.submission.id!=="string"||!Array.isArray(task.submission.resultIds)||!Array.isArray(task.submission.manifest)||typeof task.reviewToken!=="string"))))throw new Error("invalid response");
      data=result;trusted=true;error="";render();
    }catch{if(isCurrent(at,id)&&request===serial){trusted=false;error=t("暂时无法核对工作状态，请刷新；没有自动重试操作。","Work status could not be verified. Refresh; no action was retried automatically.");render();}}
  }
  function card(task){
    const key=JSON.stringify([room,task.id,task.version,task.submission?.id]);let c=cards.get(key);
    if(c)return c;
    const box=node("article","bb-work-card"),title=node("h3"),state=node("small"),owner=node("small"),basis=node("details"),heading=node("summary"),body=node("div"),form=node("div"),actions=node("div","bb-work-actions"),accept=node("button"),changes=node("button"),status=node("p");
    accept.type=changes.type="button";status.setAttribute("role","status");basis.append(heading,body);actions.append(accept,changes);box.append(title,state,owner,basis,form,actions,status);
    c={key,root:box,title,state,owner,basis,heading,body,form,actions,accept,changes,status,fields:[],pending:false,task,at:epoch,id:room,intent:null};
    task.criteria.forEach((criterion,index)=>{
      const field=node("div","bb-work-check"),label=node("label"),select=node("select"),note=node("textarea");
      const selectId=`bb-criterion-${epoch}-${cards.size}-${index}`;select.id=selectId;label.htmlFor=selectId;label.textContent=`${index+1}. ${criterion}`;
      for(const value of ["","pass","fail"]){const opt=node("option");opt.value=value;select.append(opt);}
      note.maxLength=1000;note.rows=2;
      select.onchange=()=>{c.intent=null;render();};note.oninput=()=>{c.intent=null;};
      field.append(label,select,note);form.append(field);c.fields.push({select,note});
    });
    for(const item of task.evidence??[]){const text=node("pre");text.textContent=item.available?(item.text||t("已发布文件；请检查会话中的附件。","Published file; inspect its attachment in the conversation.")):t("原成果暂不可用","Original result unavailable");
      const version=node("small");version.textContent=(item.files??[]).map(f=>`SHA-256 ${f.sha256.slice(0,12)}… · ${f.bytes} B`).join("\n");body.append(text,version);}
    accept.onclick=()=>submit(c,"accept");changes.onclick=()=>submit(c,"changes");cards.set(key,c);return c;
  }
  async function submit(c,verdict){
    if(!isCurrent(c.at,c.id)||!trusted||down()||c.pending||!c.task.canReview)return;
    const values=c.fields.map(({select,note})=>({value:select.value,note:note.value.trim()}));
    if(values.some(v=>!v.value)||(verdict==="accept"&&values.some(v=>v.value!=="pass"))||(verdict==="changes"&&!values.some(v=>v.value==="fail"))){c.status.textContent=t("请逐项检查并选择结果。","Check and choose an outcome for every criterion.");return;}
    if(values.some(v=>v.value==="fail"&&!v.note)){c.status.textContent=t("请说明需要修改的项目。","Explain each criterion that needs changes.");c.fields[values.findIndex(v=>v.value==="fail"&&!v.note)].note.focus();return;}
    const review={action:"review",task_id:c.task.id,expected_version:c.task.version,submission_id:c.task.submission.id,verdict,
      checks:values.map((v,index)=>({criterion:index,passed:v.value==="pass",note:v.note||t("用户确认此项通过。","User confirmed this criterion passes."),evidence_ids:[c.task.submission.id]}))};
    const signature=JSON.stringify(review);
    if(!c.intent||c.intent.signature!==signature){
      try{
        // getRandomValues also works in isolated renderer documents that lack
        // randomUUID. Never fall back to Math.random or a reused constant key.
        const key=typeof crypto.randomUUID==="function"?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,"0")).join("");
        c.intent={signature,key};
      }catch{c.status.textContent=t("无法安全创建验收请求，请刷新应用后重试。","Could not securely create a review request. Reload the app and retry.");return;}
    }
    const request={agentId:c.id,reviewToken:c.task.reviewToken,review:{...review,request_id:c.intent.key}};
    c.pending=true;c.status.textContent=t("正在保存验收…","Saving review…");render();
    try{
      const result=await runtime.roster.reviewCollaboration(request);
      if(!isCurrent(c.at,c.id))return;
      if(result?.saved!==true)throw new Error("not confirmed");
      error=result.notified===false?t("验收已保存，后续通知未确认；请检查会话。","Review saved; follow-up notification needs inspection."):t("验收已保存到会话。","Review saved in this conversation.");
      trusted=false;c.status.textContent=error;
      await load();
    }catch{if(isCurrent(c.at,c.id))c.status.textContent=t("尚未确认保存。请刷新核对当前版本；原输入已保留，不会自动重复操作。","Saving is unconfirmed. Refresh and inspect this version; input is retained and no action is automatically repeated.");}
    finally{if(isCurrent(c.at,c.id)){c.pending=false;render();}}
  }
  function render(){
    if(disposed)return;
    const dock=document.querySelector(".sand-chat-input-dock");if(dock&&root.parentElement!==dock)dock.prepend(root);
    root.hidden=remote()||!room||(!data.tasks.length&&!error);
    const waiting=data.tasks.filter(task=>task.canReview).length;
    toggle.textContent=waiting?t(`协作 · ${waiting} 项待你验收`,`Collaboration · ${waiting} awaiting your review`):t(`协作 · ${data.tasks.length} 项工作`,`Collaboration · ${data.tasks.length} work items`);
    toggle.setAttribute("aria-expanded",String(expanded));panel.hidden=!expanded;
    const receipts=data.completions??[], valid=receipts.filter(item=>item.current).length;
    completion.hidden=!receipts.length;
    completion.textContent=valid?t(`${valid} 项交付已核对当前已记录工作。`,`Closed against the recorded work set: ${valid}.`):t("此前交付的工作范围或版本已变化，需要重新核对。","Previously closed work has changed; recheck the updated scope or versions.");
    const name=id=>id==="user"?t("你","You"):(runtime.roster.snapshots?.get?.()?.agents?.rows??[]).find(b=>b.id===id)?.name??t("Bot 同事","Bot colleague");
    feedback.textContent=down()?t("连接中断，暂不能验收。","Disconnected. Reviews are unavailable."):error;
    const wanted=new Set();
    for(const task of data.tasks){const c=card(task);wanted.add(c.key);c.task=task;
      c.owner.textContent=t(`${name(task.assignee)} 负责 · ${name(task.reviewer)} 验收`,`${name(task.assignee)} owns · ${name(task.reviewer)} reviews`);
      c.title.textContent=task.title;c.state.textContent=`${task.state==="accepted"&&!task.acceptedForCurrentInputs?t("需要重新核对","Re-verification required"):(labels()[task.state]||task.state)} · v${task.version}`+(task.state==="accepted"&&!task.acceptedForCurrentInputs?(task.reviewNeedsRefresh?t(" · 历史验收缺少版本依据，请重新核对"," · Historical review needs evidence verification"):t(" · 依赖已变化，需要重查"," · Changed dependencies; recheck needed")):"");
      c.heading.textContent=t("查看已提交的成果与依据","Inspect submitted results and evidence");c.basis.hidden=!task.submission;
      c.form.hidden=c.actions.hidden=!task.canReview;c.accept.textContent=t("确认此版本通过","Accept this version");c.changes.textContent=t("提出修改","Request changes");
      c.accept.disabled=c.changes.disabled=!trusted||down()||c.pending;
      c.fields.forEach(({select,note},i)=>{select.disabled=note.disabled=c.pending;[...select.options].forEach((o,j)=>o.textContent=[t("请选择","Choose outcome"),t("通过","Pass"),t("需要修改","Needs changes")][j]);note.setAttribute("aria-label",t(`第 ${i+1} 项验收说明`,`Review note for criterion ${i+1}`));note.placeholder=t("补充说明；需要修改时必填","Optional note; required for changes");});
      if(c.root.parentElement!==panel)panel.append(c.root);
    }
    for(const [key,c] of cards)if(!wanted.has(key)){c.root.remove();cards.delete(key);}
  }
  toggle.onclick=()=>{expanded=!expanded;render();};
  const refresh=node("button");refresh.type="button";refresh.textContent=t("刷新状态","Refresh status");refresh.onclick=()=>{trusted=false;load();};root.append(refresh);
  disposers.push(runtime.selection.snapshots.subscribe(sync));
  if(runtime.connection?.snapshots)disposers.push(runtime.connection.snapshots.subscribe(sync));
  if(runtime.roster?.snapshots)disposers.push(runtime.roster.snapshots.subscribe(sync));
  const language=()=>{refresh.textContent=t("刷新状态","Refresh status");render();};
  window.addEventListener("sand-ui-language-changed",language);window.addEventListener("beebot-node-selection",sync);
  const observer=new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&!n.closest?.("[data-bb-work]"))))render();});observer.observe(document.body,{subtree:true,childList:true});
  window.__beebotCollaborationReview={runtime,dispose(){disposed=true;epoch++;serial++;clearTimeout(timer);offEntries?.();disposers.forEach(fn=>fn?.());observer.disconnect();root.remove();clear();window.removeEventListener("sand-ui-language-changed",language);window.removeEventListener("beebot-node-selection",sync);if(window.__beebotCollaborationReview?.runtime===runtime)delete window.__beebotCollaborationReview;}};
  sync();
}
