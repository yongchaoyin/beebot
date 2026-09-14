function RAccountCopy(){
  const zh=(window.__sandUiLanguage||"en")==="zh";
  return zh?{
    settings:"设置",configureAi:"配置 AI",about:"关于",documentation:"文档",feedback:"反馈",
    openFailed:"无法打开该链接。"
  }:{
    settings:"Settings",configureAi:"Configure AI",about:"About",documentation:"Documentation",feedback:"Feedback",
    openFailed:"Couldn't open that link."
  };
}
function RAccountDocs(){return (window.__sandUiLanguage||"en")==="zh"?"https://github.com/yongchaoyin/botfly/blob/main/README.zh.md":"https://github.com/yongchaoyin/botfly/blob/main/README.md"}
function RAccountFeedback(){return "https://github.com/yongchaoyin/botfly/issues/new"}
function ROpenExternal(url,failed){
  const open=window.desktop&&window.desktop.openExternal;
  if(typeof open!=="function") return;
  Promise.resolve(open(url)).catch(()=>{
    const n=document.createElement("div");
    n.textContent=failed;
    n.style.cssText="position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:8px 12px;border-radius:8px;z-index:99999;font:13px system-ui";
    document.body.append(n);
    setTimeout(()=>n.remove(),3000);
  });
}
function ROpenSettings(section){
  window.dispatchEvent(new CustomEvent("sand-open-settings",{detail:{section:section||"general"}}));
  const meta=/Mac|iPhone|iPod|iPad/.test(navigator.platform);
  window.dispatchEvent(new KeyboardEvent("keydown",{key:",",code:"Comma",metaKey:meta,ctrlKey:!meta,bubbles:!0}));
}
function RHideAccountMenu(){document.getElementById("sand-account-menu")?.remove()}
function RShowAccountMenu(anchor){
  RHideAccountMenu();
  const copy=RAccountCopy();
  const menu=document.createElement("div");
  menu.id="sand-account-menu";
  const r=anchor.getBoundingClientRect();
  menu.style.cssText="position:fixed;bottom:"+Math.max(12,window.innerHeight-r.top+8)+"px;left:"+Math.max(12,r.left)+"px;z-index:99993;background:#fff;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.16);padding:6px;min-width:220px;font-family:system-ui,-apple-system,sans-serif;color:#111";
  const row=(label,fn)=>{const b=document.createElement("button"); b.type="button"; b.textContent=label; b.style.cssText="display:block;width:100%;text-align:left;border:0;background:transparent;padding:10px 12px;border-radius:8px;cursor:pointer;font-size:14px"; b.onmouseenter=()=>b.style.background="#f4f4f2"; b.onmouseleave=()=>b.style.background="transparent"; b.onclick=()=>{RHideAccountMenu();fn()}; return b};
  menu.append(
    row(copy.settings,()=>ROpenSettings("general")),
    row(copy.configureAi,()=>ROpenSettings("router")),
    row(copy.about,()=>window.dispatchEvent(new Event("sand-open-about"))),
    row(copy.documentation,()=>ROpenExternal(RAccountDocs(),copy.openFailed)),
    row(copy.feedback,()=>ROpenExternal(RAccountFeedback(),copy.openFailed))
  );
  document.body.append(menu);
  const hide=e=>{if(!menu.contains(e.target)&&e.target!==anchor){RHideAccountMenu();document.removeEventListener("mousedown",hide)}};
  setTimeout(()=>document.addEventListener("mousedown",hide),0);
}
if(!window.__sandAccountMenuBound){
  window.__sandAccountMenuBound=!0;
  document.addEventListener("click",ev=>{
    const btn=ev.target&&ev.target.closest&&ev.target.closest(".sand-agents-sidebar__account [aria-haspopup='menu'], .sand-agents-sidebar__account button");
    if(!btn) return;
    ev.preventDefault(); ev.stopPropagation();
    RShowAccountMenu(btn);
  },true);
}
