/* A remote conversation uses server commands; it never sends through the local Host. */
(function(){
  if(window.__beebotNodeChat)return;
  const api=()=>window.desktop?.nodes;
  const t=(cn,en)=>window.__sandUiLanguage==="zh"?cn:en;
  const listeners=new Set(),drafts=new Map(),commands=new Map();
  let context=null,timer,poll,selectionSerial=0,connectionEpoch=0;
  let state={active:false,connectionId:"",bot:null,server:null,messages:[],draft:"",busy:false,error:null,loading:false,runningGoal:null,uncertainGoal:null};
  const publish=patch=>{state={...state,...patch};for(const fn of listeners)fn();};
  const readable=value=>typeof value==="string"?value:Array.isArray(value)?value.map(readable).filter(Boolean).join("\n\n"):value&&typeof value==="object"?readable(value.text??value.content??value.message??value.result):"";
  const request=(action,id,data={})=>api().request({action,id,...data});
  const scope=c=>`${c.id}:${c.nodeId||""}:${c.bot.id}`;
  const errorText=e=>String(e?.message||e);
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>void refresh(),100);}
  const failure=(code,cn,en)=>Object.assign(new Error(t(cn,en)),{code});
  const connectionChanged=()=>failure("connection_changed","服务器连接已改变，请重新选择 Bot。","The server connection changed. Select the Bot again.");
  function listedServer(profiles,id){
    if(!Array.isArray(profiles))throw failure("invalid_response","无法读取服务器连接，请刷新后重试。","Could not read server connections. Refresh and try again.");
    return profiles.find(p=>p&&p.id===id);
  }
  function readConversation(c,snapshot){
    if(snapshot?.node?.id!==c.nodeId)throw connectionChanged();
    if(!Array.isArray(snapshot.bots)||!Array.isArray(snapshot.goals))throw failure("invalid_response","服务器返回的会话数据不完整，请重试。","The server returned incomplete conversation data. Try again.");
    const bot=snapshot.bots.find(b=>b&&b.id===c.bot.id&&typeof b.name==="string");
    if(!bot)throw failure("bot_unavailable","此 Bot 已不可用，请刷新列表。","This Bot is unavailable. Refresh the list.");
    const goals=snapshot.goals.filter(g=>g&&g.botId===bot.id);
    if(goals.some(g=>typeof g.id!=="string"))throw failure("invalid_response","服务器返回的任务数据不完整，请重试。","The server returned incomplete task data. Try again.");
    goals.sort((a,b)=>Number(a.createdAt)-Number(b.createdAt)||a.id.localeCompare(b.id));
    const messages=goals.flatMap(g=>[
      {id:`${g.id}:user`,role:"user",text:g.prompt,createdAt:g.createdAt,goalId:g.id,status:g.status,version:g.version},
      {id:`${g.id}:assistant`,role:"assistant",text:readable(g.result),createdAt:g.updatedAt||g.createdAt,goalId:g.id,status:g.status,version:g.version,error:g.error},
    ]);
    const running=goals.find(g=>["running","cancelling"].includes(g.status))||goals.find(g=>g.status==="queued");
    const uncertain=goals.find(g=>g.status==="uncertain");
    return {bot,goals,messages,messageSignature:JSON.stringify(messages),
      runningGoal:running?{id:running.id,status:running.status}:null,
      uncertainGoal:uncertain?{id:uncertain.id,version:uncertain.version,error:uncertain.error}:null};
  }
  function applyConversation(c,data,server,extra={}){
    const messages=c.messageSignature===data.messageSignature&&state.messages.length===data.messages.length?state.messages:data.messages;
    c.available=true;c.bot=data.bot;c.goals=data.goals;c.messageSignature=data.messageSignature;
    publish({bot:data.bot,server,loading:false,error:c.error||null,messages,runningGoal:data.runningGoal,uncertainGoal:data.uncertainGoal,...extra});
  }
  function clearUnavailable(c,server){
    c.available=false;c.goals=[];
    publish({server:server||{...state.server,status:"unavailable"},loading:false,messages:[],runningGoal:null,uncertainGoal:null,
      error:t("连接已不可用，请在设置 → 服务器中检查登录与连接。","The connection is unavailable. Check sign-in and connectivity in Settings → Servers.")});
  }
  async function refresh(){
    const c=context;if(!c||c.pending)return;
    const epoch=connectionEpoch;c.pending=true;
    try{
      const profiles=await api().request({action:"list"});if(context!==c||epoch!==connectionEpoch)return;
      const server=listedServer(profiles,c.id);
      if(!server||server.nodeId!==c.nodeId){clearUnavailable(c,null);return;}
      if(!["online","reconnecting"].includes(server.status)){clearUnavailable(c,server);return;}
      const snapshot=await request("snapshot",c.id);if(context!==c||epoch!==connectionEpoch)return;
      // Read identity again: sign-out/removal can race an already authorized request.
      const latest=listedServer(await api().request({action:"list"}),c.id);
      if(context!==c||epoch!==connectionEpoch)return;
      if(!latest||latest.nodeId!==c.nodeId){clearUnavailable(c,null);return;}
      if(!["online","reconnecting"].includes(latest.status)){clearUnavailable(c,latest);return;}
      applyConversation(c,readConversation(c,snapshot),latest);
    }catch(error){if(context===c&&epoch===connectionEpoch){
      c.available=false;c.goals=[];
      if(["connection_changed","bot_unavailable"].includes(error?.code))clearUnavailable(c,null);
      // Cached messages are not reclassified as failed when a read fails.
      publish({loading:false,error:errorText(error)});
    }}finally{c.pending=false;if(context===c&&epoch!==connectionEpoch)schedule();}
  }
  async function openConversation(connectionId,bot,{signal}={}){
    if(typeof connectionId!=="string"||!connectionId||typeof bot?.id!=="string"||!bot.id)throw failure("invalid_target","请选择有效的 Bot。","Select a valid Bot.");
    const serial=++selectionSerial,epoch=connectionEpoch;let valid=true,timeout,abort;
    const check=()=>{
      if(!valid||signal?.aborted)throw failure("open_cancelled","已取消打开 Bot。","Opening the Bot was cancelled.");
      if(serial!==selectionSerial)throw failure("open_superseded","已选择其他会话。","Another conversation was selected.");
      if(epoch!==connectionEpoch)throw connectionChanged();
    };
    try{
      const prepared=await Promise.race([
        (async()=>{
          check();
          if(typeof api()?.request!=="function")throw failure("bridge_unavailable","此版本的服务器连接功能不可用。","Server connections are unavailable in this build.");
          const server=listedServer(await api().request({action:"list"}),connectionId);check();
          if(!server||server.status!=="online"||typeof server.nodeId!=="string"||!server.nodeId)throw failure("connection_unavailable","请先在设置 → 服务器中恢复连接或完成登录。","Restore the connection or finish sign-in in Settings → Servers first.");
          const c={id:connectionId,bot,nodeId:server.nodeId,pending:false,available:false,goals:[],error:null};
          const snapshot=await request("snapshot",connectionId);check();
          const data=readConversation(c,snapshot);
          const latest=listedServer(await api().request({action:"list"}),connectionId);check();
          if(!latest||latest.status!=="online"||latest.nodeId!==server.nodeId)throw connectionChanged();
          return {c,data,server:latest};
        })(),
        new Promise((_,reject)=>{
          timeout=setTimeout(()=>{valid=false;reject(failure("open_timeout","读取会话超时，原来的工作未改变。请重试。","Loading the conversation timed out. Your previous work is unchanged. Try again."));},15000);
          abort=()=>{valid=false;reject(failure("open_cancelled","已取消打开 Bot。","Opening the Bot was cancelled."));};
          signal?.addEventListener("abort",abort,{once:true});
        }),
      ]);
      check();
      // Commit selection only after read-only preflight. The caller owns its dialog.
      const same=context&&scope(context)===scope(prepared.c);
      const c=same?context:prepared.c;
      clearTimeout(timer);clearInterval(poll);context=c;
      document.getElementById("sand-beebot-mention")?.remove();
      applyConversation(c,prepared.data,prepared.server,{active:true,connectionId,draft:drafts.get(scope(c))||"",busy:same?state.busy:false});
      window.dispatchEvent(new CustomEvent("beebot-node-selection",{detail:{connectionId,botId:c.bot.id}}));
      poll=setInterval(()=>void refresh(),5000);
    }finally{valid=false;clearTimeout(timeout);signal?.removeEventListener("abort",abort);}
  }
  async function perform(c,action,data){
    const signature=JSON.stringify([scope(c),action,data]);
    if(!commands.has(signature))commands.set(signature,crypto.randomUUID());
    const result=await request(action,c.id,{...data,key:commands.get(signature)});
    commands.delete(signature);return result;
  }
  const controller={
    getSnapshot:()=>state,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    open:openConversation,
    close(){selectionSerial++;context=null;clearTimeout(timer);clearInterval(poll);publish({active:false,busy:false});window.dispatchEvent(new CustomEvent("beebot-node-selection",{detail:null}));},
    setDraft(text){if(!context)return;drafts.set(scope(context),text);publish({draft:text});},
    async send(text){
      const c=context;
      if(!c||state.busy||!text.trim())return;
      if(state.server?.status!=="online"||!c.available||state.uncertainGoal){publish({error:t("当前 Bot 暂不能接收消息，请先恢复连接或核查中断的执行。","This Bot cannot receive messages yet. Restore its connection or verify the interrupted execution first.")});return;}
      c.error=null;publish({busy:true,error:null});
      try{
        await perform(c,"submitGoal",{botId:c.bot.id,prompt:text});
        if(drafts.get(scope(c))===text)drafts.delete(scope(c));
        if(context===c)publish({draft:drafts.get(scope(c))||""});
      }catch(error){c.error=errorText(error);if(context===c)publish({error:c.error});}
      finally{if(context===c){publish({busy:false});await refresh();}}
    },
    async stop(goalId){return action("cancel",goalId);},
    async accept(goalId,version){return action("accept",goalId,{expectedVersion:version});},
    async reconcile(goalId,version,note){return action("reconcile",goalId,{expectedVersion:version,note});},
    async reconnect(){const c=context;if(!c||state.busy)return;publish({busy:true});try{await request("resume",c.id);c.error=null;}catch(e){c.error=errorText(e);}finally{if(context===c){publish({busy:false,error:c.error});await refresh();}}},
    refresh,
  };
  async function action(type,goalId,data={}){
    const c=context;if(!c||state.busy)return;
    if(state.server?.status!=="online"||!c.available||!c.goals.some(g=>g.id===goalId)){publish({error:t("此消息当前不可操作，请恢复连接后重试。","This message cannot be updated. Reconnect and try again.")});return;}
    publish({busy:true,error:null});c.error=null;
    try{await perform(c,type,{goalId,...data});}catch(e){c.error=errorText(e);if(context===c)publish({error:c.error});}
    finally{if(context===c){publish({busy:false});await refresh();}}
  }
  window.__beebotNodeChat=controller;
  queueMicrotask(()=>api()?.onChanged(()=>{
    connectionEpoch++;
    if(context){context.available=false;schedule();}
  }));
})();
