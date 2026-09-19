/* Connection management inside Settings. Bot conversations keep their current route. */
(function(){
  if(window.__beebotNodeWorkbenchBound)return;window.__beebotNodeWorkbenchBound=true;
  const t=(cn,en)=>window.__sandUiLanguage==="zh"?cn:en,api=()=>window.desktop?.nodes;
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  const button=(text,action)=>{const node=el("button",text);node.type="button";node.onclick=action;return node;};
  const request=(action,data={})=>api().request({action,...data});
  function style(){
    if(document.getElementById("beebot-node-style"))return;
    const css=el("style");css.id="beebot-node-style";css.textContent=`
      #beebot-node-workbench{color:inherit;font:inherit;line-height:1.5;min-width:0;box-sizing:border-box;-webkit-app-region:no-drag}
      #beebot-node-workbench *{box-sizing:border-box}#beebot-node-workbench [hidden]{display:none!important}
      #beebot-node-workbench h2{font-size:14px;font-weight:600;margin:0 0 12px}
      #beebot-node-workbench button{font:inherit;color:inherit;background:var(--cursor-bg-secondary,transparent);border:1px solid var(--cursor-stroke-secondary,#8885);border-radius:8px;padding:6px 10px;min-height:32px;cursor:pointer;-webkit-app-region:no-drag}
      #beebot-node-workbench :is(button,input,select):focus-visible{outline:2px solid var(--cursor-accent,#599ce7);outline-offset:3px}#beebot-node-workbench button:disabled{opacity:.45;cursor:default}
      #beebot-node-workbench input,#beebot-node-workbench select{font:inherit;color:inherit;background:var(--cursor-bg-input,transparent);border:1px solid var(--cursor-stroke-primary,#8885);border-radius:8px;padding:8px;min-width:0;max-width:100%;-webkit-app-region:no-drag}
      #beebot-node-workbench select{width:100%}
      #beebot-node-workbench .bb-node-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
      #beebot-node-workbench .bb-node-section+.bb-node-section{margin-top:24px;padding-top:20px;border-top:1px solid var(--cursor-stroke-secondary,#8885)}
      #beebot-node-workbench .bb-node-muted{font-size:12px;color:var(--cursor-text-secondary,inherit);opacity:.8;overflow-wrap:anywhere}
      #beebot-node-workbench .bb-node-error{color:var(--cursor-text-red-primary,#fc6b83);white-space:pre-wrap}#beebot-node-workbench .bb-node-error:empty{display:none}
      #beebot-node-workbench .bb-node-bot{display:block;width:100%;text-align:left;margin-top:8px}
    `;document.head.append(css);
  }
  window.__beebotMountServersSettings=function(host,{onOpenBot}={}){
    if(!api()||!host)return;window.__beebotCloseNodeWorkbench?.();style();
    const root=el("section");root.id="beebot-node-workbench";root.setAttribute("aria-label",t("服务器管理","Servers"));
    let alive=true,selected="",profiles=[],snapshot=null,busy=false,pending=false,timer,poll,unsubscribe;
    const close=()=>{if(!alive)return;alive=false;clearTimeout(timer);clearInterval(poll);unsubscribe?.();root.remove();if(window.__beebotCloseNodeWorkbench===close)delete window.__beebotCloseNodeWorkbench;};
    window.__beebotCloseNodeWorkbench=close;
    const connections=el("div",undefined,"bb-node-section"),row=el("div",undefined,"bb-node-row"),addRow=el("div",undefined,"bb-node-row");
    const picker=el("select");picker.setAttribute("aria-label",t("选择服务器","Select server"));
    const address=el("input");address.type="url";address.placeholder="https://bot.example.com";address.setAttribute("aria-label",t("服务器地址","Server address"));address.style.flex="1";
    const status=el("p",undefined,"bb-node-muted"),error=el("p",undefined,"bb-node-error");error.setAttribute("role","status");
    const auth=button(t("登录","Sign in"),()=>run(()=>request("login",{id:selected})));
    const reconnect=button(t("重新连接","Reconnect"),()=>run(()=>request("resume",{id:selected})));
    const logout=button(t("退出登录","Sign out"),()=>run(()=>request("logout",{id:selected})));
    const remove=button(t("移除连接","Remove"),()=>run(async()=>{const result=await request("remove",{id:selected});selected="";snapshot=null;if(result?.remoteRevoked===false)error.textContent=t("本机连接已移除，服务器设备会话未能撤销。","Local connection removed; its server session could not be revoked.");}));
    const add=button(t("添加服务器","Add server"),()=>run(async()=>{const profile=await request("add",{address:address.value});selected=profile.id;address.value="";snapshot=null;}));
    row.append(picker,auth,reconnect,logout,remove);addRow.append(address,add);
    connections.append(el("h2",t("服务器连接","Server connections")),row,status,addRow,error);
    const bots=el("div",undefined,"bb-node-section");root.append(connections,bots);host.append(root);
    const current=()=>profiles.find(p=>p.id===selected);
    function update(){
      const p=current(),signed=!!p&&p.status!=="signed-out";row.hidden=!p;
      picker.disabled=busy;add.disabled=busy;auth.disabled=busy||!p;auth.hidden=signed;reconnect.disabled=busy||!signed;logout.disabled=busy||!signed;remove.disabled=busy||!p;
      status.textContent=p?`${p.name} · ${p.baseUrl} · ${p.status==="online"?t("已连接","Connected"):p.status==="signed-out"?t("未登录","Signed out"):t("正在连接","Connecting")}`:t("添加本机或云端服务器。","Add a local or cloud server.");
    }
    async function run(fn){if(busy)return;busy=true;error.textContent="";update();try{await fn();}catch(e){error.textContent=String(e.message||e);}finally{busy=false;if(alive)await refresh();}}
    function render(){
      bots.replaceChildren(el("h2",t("此服务器上的 Bot","Bots on this server")),el("p",t("在左侧列表上方 + → 新建 Bot 中选择部署服务器。","Choose a deployment server from + → New bot above the Bot list."),"bb-node-muted"));
      for(const bot of snapshot?.bots||[]){const item=button(bot.name,()=>{onOpenBot?.();close();void window.__beebotNodeChat?.open(selected,bot);});item.className="bb-node-bot";bots.append(item);}
      if(!snapshot?.bots?.length)bots.append(el("p",current()?.status==="online"?t("这台服务器还没有 Bot。","This server has no Bots yet."):t("连接后显示这台服务器上的 Bot。","Connect to see this server's Bots."),"bb-node-muted"));
    }
    async function refresh(){
      if(!alive||pending)return;pending=true;
      try{
        profiles=await request("list");if(!alive)return;
        if(!profiles.some(p=>p.id===selected))selected=profiles.find(p=>p.status==="online")?.id||profiles[0]?.id||"";
        picker.replaceChildren();for(const p of profiles){const option=el("option",p.name);option.value=p.id;picker.append(option);}picker.value=selected;update();
        const selectedAt=selected,p=current();const next=p&&["online","reconnecting"].includes(p.status)?await request("snapshot",{id:selectedAt}):null;
        if(!alive)return;if(selectedAt!==selected){schedule();return;}snapshot=next;render();
      }catch(e){if(alive)error.textContent=String(e.message||e);}finally{pending=false;if(alive)update();}
    }
    function schedule(){clearTimeout(timer);timer=setTimeout(()=>void refresh(),250);}
    picker.onchange=()=>{selected=picker.value;snapshot=null;render();void refresh();};
    unsubscribe=api().onChanged(schedule);poll=setInterval(()=>void refresh(),10000);void refresh();return close;
  };
  window.__beebotOpenNodeWorkbench=function(){if(api())ROpenSettings("servers");};
})();
