/* A remote conversation uses server commands; it never sends through the local Host. */
(function(){
  if(window.__beebotNodeChat)return;
  const api=()=>window.desktop?.nodes;
  const t=(cn,en)=>window.__sandUiLanguage==="zh"?cn:en;
  const listeners=new Set(),drafts=new Map(),commands=new Map();
  let context=null,timer,poll;
  let state={active:false,connectionId:"",bot:null,server:null,messages:[],draft:"",busy:false,error:null,loading:false,runningGoal:null,uncertainGoal:null};
  const publish=patch=>{state={...state,...patch};for(const fn of listeners)fn();};
  const readable=value=>typeof value==="string"?value:Array.isArray(value)?value.map(readable).filter(Boolean).join("\n\n"):value&&typeof value==="object"?readable(value.text??value.content??value.message??value.result):"";
  const request=(action,id,data={})=>api().request({action,id,...data});
  const scope=c=>`${c.id}:${c.nodeId||""}:${c.bot.id}`;
  const errorText=e=>String(e?.message||e);
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>void refresh(),100);}
  async function refresh(){
    const c=context;if(!c||c.pending)return;
    c.pending=true;
    try{
      const profiles=await api().request({action:"list"});if(context!==c)return;
      const server=profiles.find(p=>p.id===c.id);
      if(!server||c.nodeId&&c.nodeId!==server.nodeId){c.available=false;c.goals=[];publish({server:{...(server||state.server),status:"unavailable"},loading:false,error:t("服务器连接已改变，请从列表重新选择 Bot。","The server connection changed. Select the Bot again from the list."),messages:[],runningGoal:null,uncertainGoal:null});return;}
      if(!c.nodeId){c.nodeId=server.nodeId;publish({draft:drafts.get(scope(c))||""});}
      publish({server});
      if(!["online","reconnecting"].includes(server.status)){c.available=false;c.goals=[];publish({loading:false,messages:[],runningGoal:null,uncertainGoal:null,error:t("请先在设置 → 服务器中登录此服务器。","Sign in to this server in Settings → Servers first.")});return;}
      const snapshot=await request("snapshot",c.id);if(context!==c)return;
      if(snapshot.node?.id!==c.nodeId)throw new Error(t("服务器身份已改变。","The server identity changed."));
      const bot=snapshot.bots.find(b=>b.id===c.bot.id);
      if(!bot){c.available=false;c.goals=[];publish({loading:false,error:t("此 Bot 已不可用。","This Bot is unavailable."),messages:[],runningGoal:null,uncertainGoal:null});return;}
      c.available=true;c.bot=bot;
      const goals=snapshot.goals.filter(g=>g.botId===bot.id).sort((a,b)=>Number(a.createdAt)-Number(b.createdAt)||a.id.localeCompare(b.id));
      c.goals=goals;
      const messages=goals.flatMap(g=>[
        {id:`${g.id}:user`,role:"user",text:g.prompt,createdAt:g.createdAt,goalId:g.id,status:g.status,version:g.version},
        {id:`${g.id}:assistant`,role:"assistant",text:readable(g.result),createdAt:g.updatedAt||g.createdAt,goalId:g.id,status:g.status,version:g.version,error:g.error},
      ]);
      const running=goals.find(g=>["running","cancelling"].includes(g.status))||goals.find(g=>g.status==="queued");
      const uncertain=goals.find(g=>g.status==="uncertain");
      const messageSignature=JSON.stringify(messages),stableMessages=messageSignature===c.messageSignature&&state.messages.length===messages.length?state.messages:messages;c.messageSignature=messageSignature;
      publish({bot,loading:false,error:c.error||null,messages:stableMessages,runningGoal:running?{id:running.id,status:running.status}:null,uncertainGoal:uncertain?{id:uncertain.id,version:uncertain.version,error:uncertain.error}:null});
    }catch(error){if(context===c)publish({loading:false,error:errorText(error)});}
    finally{c.pending=false;}
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
    async open(connectionId,bot){
      window.__beebotCloseNodeWorkbench?.();
      document.getElementById("sand-beebot-mention")?.remove();
      clearTimeout(timer);clearInterval(poll);
      context={id:connectionId,bot,nodeId:null,pending:false,available:false,goals:[],error:null};
      publish({active:true,connectionId,bot,server:{name:"",baseUrl:"",status:"connecting"},messages:[],draft:"",busy:false,error:null,loading:true,runningGoal:null,uncertainGoal:null});
      window.dispatchEvent(new CustomEvent("beebot-node-selection",{detail:{connectionId,botId:bot.id}}));
      poll=setInterval(()=>void refresh(),5000);await refresh();
    },
    close(){context=null;clearTimeout(timer);clearInterval(poll);publish({active:false,busy:false});window.dispatchEvent(new CustomEvent("beebot-node-selection",{detail:null}));},
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
    if(state.server?.status!=="online"||!c.goals.some(g=>g.id===goalId)){publish({error:t("此消息当前不可操作，请恢复连接后重试。","This message cannot be updated. Reconnect and try again.")});return;}
    publish({busy:true,error:null});c.error=null;
    try{await perform(c,type,{goalId,...data});}catch(e){c.error=errorText(e);if(context===c)publish({error:c.error});}
    finally{if(context===c){publish({busy:false});await refresh();}}
  }
  window.__beebotNodeChat=controller;
  queueMicrotask(()=>api()?.onChanged(()=>{if(context)schedule();}));
})();
