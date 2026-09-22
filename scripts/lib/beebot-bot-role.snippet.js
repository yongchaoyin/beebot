/* User-owned primary jobs. Chat never opens this editor automatically. */
(function(){
  if(window.__beebotRoleFields)return;
  const t=(cn,en)=>window.__sandUiLanguage==="zh"?cn:en;
  let sequence=0;
  const newRequestId=()=>{
    if(typeof crypto.randomUUID==="function")return crypto.randomUUID();
    // Secure randomness is still available in restricted/offline renderers.
    // Never fall back to Math.random or timestamps for deduplication identities.
    return "role-"+Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,"0")).join("");
  };
  const empty=()=>({primaryJob:"",responsibilities:[],outOfScope:[],deliverables:[],workingStyle:""});
  const labels={primaryJob:["这位同事主要负责什么？","What is this colleague's primary job?"],responsibilities:["负责范围","Responsibilities"],outOfScope:["不负责的工作","Outside this role"],deliverables:["通常交付什么","Expected deliverables"],workingStyle:["协作约定","Working agreements"]};
  function installStyle(){
    if(document.getElementById("bb-role-style"))return;
    const style=document.createElement("style");style.id="bb-role-style";
    style.textContent=`
      .bb-role{width:100%;min-width:0;font:inherit;font-size:13px;line-height:1.6;color:var(--cursor-text-primary,CanvasText);-webkit-app-region:no-drag}
      .bb-role *{box-sizing:border-box}.bb-role [hidden]{display:none!important}
      .bb-role-field{display:grid;gap:6px;margin:0 0 12px}.bb-role label{font-weight:550;font-size:12px}
      .bb-role :is(input,textarea){width:100%;min-width:0;border:1px solid var(--cursor-stroke-secondary,#8884);background:var(--cursor-bg-input,Canvas);color:inherit;border-radius:8px;padding:9px 11px;font:inherit;line-height:1.5;resize:vertical}
      .bb-role textarea{min-height:70px}.bb-role :is(input,textarea)[aria-invalid=true]{border-color:var(--cursor-text-red-primary,#b93446)}
      .bb-role :is(button,input,textarea,summary):focus-visible{outline:2px solid var(--cursor-accent,#3477c9);outline-offset:2px}
      .bb-role summary{cursor:pointer;min-height:32px;padding:4px 0;font-size:12px}.bb-role details{margin-bottom:10px}
      .bb-role-hint{color:var(--cursor-text-secondary,GrayText);font-size:12px;margin:6px 0 12px;overflow-wrap:anywhere}
      .bb-role-heading{display:flex;gap:10px;align-items:center;justify-content:space-between}.bb-role-heading h3{font-size:14px;margin:0}
      .bb-role-summary{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0 4px}.bb-role-summary p{margin:4px 0}
      .bb-role-actions{display:flex;flex-wrap:wrap;gap:8px}.bb-role button{border:1px solid var(--cursor-stroke-secondary,#8884);border-radius:8px;padding:7px 12px;min-height:34px;font:inherit;color:inherit;background:var(--cursor-bg-secondary,Canvas);cursor:pointer}
      .bb-role button:disabled{opacity:.5;cursor:default}.bb-role .bb-role-save{background:var(--cursor-text-primary,CanvasText);color:var(--cursor-bg-primary,Canvas)}
      .bb-role-status{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0}.bb-role-status[data-error=true]{color:var(--cursor-text-red-primary,#b93446)}
      .bb-role-settings{margin-top:18px;padding:18px 0;border-top:1px solid var(--cursor-stroke-secondary,#8884)}
      @media(prefers-reduced-motion:reduce){.bb-role *{transition:none!important}}
    `;document.head.append(style);
  }
  window.__beebotRoleFields=function({value=empty(),onChange=()=>{}}={}){
    installStyle();const root=document.createElement("div");root.className="bb-role";
    const id=++sequence,fields={},fieldLabels={};
    const details=document.createElement("details"),summary=document.createElement("summary");summary.dataset.createField="role-details";details.append(summary);
    const hint=document.createElement("p");hint.className="bb-role-hint";hint.id=`bb-role-help-${id}`;
    for(const key of Object.keys(labels)){
      const wrap=document.createElement("div");wrap.className="bb-role-field";
      const label=document.createElement("label"),input=document.createElement(key==="primaryJob"?"input":"textarea");
      input.id=`bb-role-${id}-${key}`;input.dataset.roleField=key;input.dataset.createField=`role-${key}`;label.htmlFor=input.id;
      if(key==="primaryJob"){input.type="text";input.maxLength=240;input.setAttribute("aria-required","true");input.setAttribute("aria-describedby",hint.id);}else input.maxLength=key==="workingStyle"?1200:7200;
      fields[key]=input;fieldLabels[key]=label;
      input.oninput=()=>{input.removeAttribute("aria-invalid");onChange(read());};
      wrap.append(label,input);(key==="primaryJob"?root:details).append(wrap);
    }
    root.append(hint,details);
    function read(){return Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,["primaryJob","workingStyle"].includes(key)?input.value.trim():input.value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean)]));}
    function write(next){for(const [key,input] of Object.entries(fields))input.value=Array.isArray(next?.[key])?next[key].join("\n"):next?.[key]||"";}
    function validate(){
      const data=read();let key="",message="";
      if(!data.primaryJob||data.primaryJob.length>240){key="primaryJob";message=t("请用 1–240 个字符写明主要职责。","Describe one primary job in 1–240 characters.");}
      else for(const part of ["responsibilities","outOfScope","deliverables"])if(data[part].length>12||data[part].some(line=>line.length>600)){key=part;message=t("每项最多 12 行，每行最多 600 个字符。","Use at most 12 lines per section and 600 characters per line.");break;}
      if(!key&&data.workingStyle.length>1200){key="workingStyle";message=t("协作约定最多 1200 个字符。","Working agreements allow up to 1200 characters.");}
      if(key){if(key!=="primaryJob")details.open=true;fields[key].setAttribute("aria-invalid","true");fields[key].focus({preventScroll:true});}
      return message;
    }
    function localize(){
      for(const key of Object.keys(labels)){fieldLabels[key].textContent=t(...labels[key]);fields[key].setAttribute("aria-label",t(...labels[key]));}
      fields.primaryJob.placeholder=t("例如：负责聊天界面的交互实现与前端自检","For example: implement chat interactions and frontend self-checks");
      summary.textContent=t("细化职责与边界（可选）","Refine scope and boundaries (optional)");
      hint.textContent=t("一个主要岗位，职责内独立负责。这里不授予工具权限。详细范围每行一项。","One primary job, owned end to end. This does not grant tool permissions. Use one item per line below.");
    }
    write(value);localize();window.addEventListener("sand-ui-language-changed",localize);
    return {root,fields,details,read,write,validate,setDisabled(disabled){for(const input of Object.values(fields))input.disabled=disabled;},dispose(){window.removeEventListener("sand-ui-language-changed",localize);}};
  };
  window.__beebotMountBotRole=function(host,{agentId,roster}={}){
    if(!host||!agentId)return()=>{};
    installStyle();let alive=true,serial=0,record=null,loaded=false,editing=false,busy=false,pending=null,uncertain=false;
    const root=document.createElement("section");root.className="bb-role bb-role-settings";root.dataset.roleOwner=agentId;
    const head=document.createElement("header");head.className="bb-role-heading";
    const title=document.createElement("h3"),edit=document.createElement("button");edit.type="button";edit.dataset.roleAction="edit";head.append(title,edit);
    const view=document.createElement("div");view.className="bb-role-summary";
    const boundary=document.createElement("p");boundary.className="bb-role-hint";
    const editor=window.__beebotRoleFields();editor.root.hidden=true;
    const actions=document.createElement("div");actions.className="bb-role-actions";
    const make=(action)=>{const button=document.createElement("button");button.type="button";button.dataset.roleAction=action;return button;};
    const save=make("save"),cancel=make("cancel"),reload=make("reload");save.className="bb-role-save";actions.append(save,cancel,reload);
    const status=document.createElement("p");status.className="bb-role-status";status.setAttribute("role","status");
    root.append(head,view,boundary,editor.root,actions,status);host.append(root);
    function say(cn,en,error=false){status.textContent=t(cn,en);status.dataset.error=String(error);}
    function draw(){
      if(!alive)return;title.textContent=t("主要职责","Primary job")+(record?` · v${record.revision}`:"");
      edit.textContent=record?t("修改岗位","Edit role"):t("确认岗位","Confirm role");edit.hidden=editing;edit.disabled=!loaded||busy;
      editor.root.hidden=!editing;save.hidden=cancel.hidden=!editing;
      save.textContent=busy?t("正在保存…","Saving…"):uncertain?t("重试同一次保存","Retry same save"):t("确认并保存","Confirm and save");
      cancel.textContent=t("取消修改","Cancel edit");reload.textContent=editing?t("读取当前岗位（替换草稿）","Load current role (replace draft)"):t("重新读取","Reload");
      reload.hidden=loaded&&!editing&&!uncertain;save.disabled=busy||!loaded;cancel.disabled=busy;reload.disabled=busy;editor.setDisabled(busy||uncertain);
      root.setAttribute("aria-busy",String(busy));view.hidden=editing;view.replaceChildren();
      const paragraph=text=>{const p=document.createElement("p");p.textContent=text;view.append(p);};
      if(record){paragraph(record.role.primaryJob);for(const key of ["responsibilities","outOfScope","deliverables","workingStyle"]){const value=record.role[key];if(value?.length)paragraph(t(...labels[key])+": "+(Array.isArray(value)?value.join("；"):value));}}
      else paragraph(loaded?t("岗位尚未确认。已有描述和工作保持不变。","Role not confirmed. Existing description and work stay unchanged."):t("正在读取岗位…","Loading role…"));
      boundary.textContent=t("由你确认，Bot 不能通过修改描述换岗。保存不取消当前工作、不扩大权限；后续处理读取新版本。","You confirm this role. Persona edits cannot replace it. Saving does not cancel current work or expand permissions; later processing reads the new version.");
    }
    const timers=new Set();
    function request(run){
      let timer;
      return Promise.race([Promise.resolve().then(run),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("role_request_timeout")),15000);timers.add(timer);})]).finally(()=>{clearTimeout(timer);timers.delete(timer);});
    }
    const validSnapshot=result=>{
      if(!result||result.agentId!==agentId||!(result.role===null||result.role?.botId===agentId&&result.role?.confirmedBy==="user"&&Number.isInteger(result.role?.revision)&&result.role.revision>0&&typeof result.role?.role?.primaryJob==="string"))throw new Error("invalid_role_response");return result.role;
    };
    async function load(replaceDraft=false){
      const token=++serial;busy=true;draw();
      try{
        if(typeof roster?.getBotRole!=="function")throw new Error("unsupported_role_protocol");
        const result=await request(()=>roster.getBotRole({agentId}));if(!alive||token!==serial)return;
        record=validSnapshot(result);loaded=true;
        if(replaceDraft){editor.write(record?.role||empty());pending=null;uncertain=false;}
        say(record?"岗位已读取。":"请确认主要职责；不会从旧描述自动推断。",record?"Role loaded.":"Confirm a primary job; old descriptions are not automatically converted.");
      }catch{if(alive&&token===serial){loaded=false;say("无法读取此 Bot 的岗位，请重试或检查当前版本。","Could not read this Bot's role. Retry or check the current version.",true);}}
      finally{if(alive&&token===serial){busy=false;draw();}}
    }
    edit.onclick=()=>{if(!loaded||busy)return;editing=true;editor.write(record?.role||empty());pending=null;uncertain=false;status.textContent="";draw();editor.fields.primaryJob.focus({preventScroll:true});};
    cancel.onclick=()=>{if(busy)return;editing=false;pending=null;uncertain=false;draw();edit.focus({preventScroll:true});};
    reload.onclick=()=>{if(!busy)void load(true);};
    save.onclick=async()=>{
      if(!alive||busy||!loaded||!editing)return;
      if(!pending){const error=editor.validate();if(error){status.textContent=error;status.dataset.error="true";return;}try{pending={agentId,role:editor.read(),expectedRevision:record?.revision||0,requestId:newRequestId()};}catch{say("无法创建安全的保存请求，岗位未修改。请检查客户端环境。","A secure save request could not be created. The role was not changed. Check the client environment.",true);return;}}
      const sent=pending,token=++serial;busy=true;draw();
      try{
        if(typeof roster?.updateBotRole!=="function")throw new Error("unsupported_role_protocol");
        const result=await request(()=>roster.updateBotRole(sent));if(!alive||token!==serial)return;
        if(!result?.saved||result.record?.botId!==agentId||result.record?.revision!==sent.expectedRevision+1||JSON.stringify(result.record.role)!==JSON.stringify(sent.role))throw new Error("invalid_role_ack");
        record=validSnapshot({agentId,role:result.record});pending=null;uncertain=false;editing=false;
        say("岗位已保存。后续处理读取新版本；当前工作和权限未改变。","Role saved. Later processing reads the new version; current work and permissions are unchanged.");
        // A replay can describe an earlier version: verify the current record before
        // offering the next edit. Never promote an old acknowledgement to latest.
        try{const latest=await request(()=>roster.getBotRole({agentId}));if(alive&&token===serial)record=validSnapshot(latest);}catch{if(alive&&token===serial){loaded=false;say("保存已确认，但最新岗位未读取，请重新读取。","Save confirmed, but the latest role could not be read. Reload before editing.",true);}}
      }catch(error){if(alive&&token===serial){
        if(String(error?.message||error).includes("bot_role_stale")){pending=null;uncertain=false;loaded=false;say("岗位已被修改。草稿保留，请读取当前版本后重新确认，不会自动覆盖。","The role changed. Your draft is preserved; load the current version and confirm again. No automatic overwrite.",true);}
        else{uncertain=true;say("保存结果尚未确认，输入已保留。请重试同一次保存，或读取当前岗位。","Save not confirmed. Input is preserved. Retry the same save or load the current role.",true);}
      }}finally{if(alive&&token===serial){busy=false;draw();}}
    };
    const localize=()=>draw();window.addEventListener("sand-ui-language-changed",localize);draw();void load();
    return()=>{alive=false;serial++;for(const timer of timers)clearTimeout(timer);timers.clear();editor.dispose();window.removeEventListener("sand-ui-language-changed",localize);root.remove();};
  };
})();
