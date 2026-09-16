import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY_BEFORE = 'const wDn=[{id:"general",label:"General",icon:"settings-gear"},{id:"usage",label:"Usage & Billing",icon:"chart-bars"},{id:"beta",label:"Updates",icon:"cloud-download"}]';
const REGISTRY_AFTER = 'const wDn=[{id:"general",label:"General",icon:"settings-gear"},{id:"router",label:"Router",icon:"git-branch"},{id:"usage",label:"Usage & Billing",icon:"chart-bars"},{id:"beta",label:"Updates",icon:"cloud-download"}]';
const APPEARANCE_BEFORE = 'l=a.jsx(re,{title:"Appearance",children:a.jsx(ie,{label:"Theme",variant:"card",children:a.jsx(ye,{"aria-label":"Theme",disabled:n,onValueChange:d,options:ba,placement:"bottom-end",size:"lg",value:e,variant:"filled"})})})';
const APPEARANCE_AFTER = 'l=a.jsx(re,{title:"Appearance",children:a.jsxs(a.Fragment,{children:[a.jsx(ie,{label:"Theme",variant:"card",children:a.jsx(ye,{"aria-label":"Theme",disabled:n,onValueChange:d,options:ba,placement:"bottom-end",size:"lg",value:e,variant:"filled"})}),a.jsx(RLanguageRow,{})]})})';
const GENERAL_BEFORE = 'Q=x==="general"?a.jsx(Te,{children:a.jsx(Sa,{auth:t})}):null';
const GENERAL_AFTER = 'Q=x==="general"?a.jsx(Te,{children:a.jsx(Sa,{auth:t})}):x==="router"?a.jsx(RRouterPanel,{}):null';
const USAGE_BEFORE = 'Z=x==="usage"?a.jsx(Te,{children:a.jsx(Na,{})}):null';
const USAGE_AFTER = 'Z=x==="usage"?a.jsx(Te,{children:a.jsx(RRouterUsage,{})}):null';
const COMPONENT_ANCHOR = 'function Sa(s){';
const VENDOR_ACCOUNTS_SNIPPET = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "sand-vendor-accounts.snippet.js"), "utf8");
const COMPONENT_HEAD = String.raw`
if(!window.__sandOpenSettingsBound){
  window.__sandOpenSettingsBound=!0;
  window.addEventListener("sand-open-settings",ev=>{
    const section=ev&&ev.detail&&ev.detail.section==="router"?"router":"general";
    const clickNav=()=>{
      const labels=section==="router"?["Router","路由"]:["General","通用"];
      const nodes=[...document.querySelectorAll('.sand-settings-nav__item, nav[aria-label="Settings sections"] button')];
      const hit=nodes.find(el=>labels.some(label=>(el.textContent||"").includes(label)));
      if(hit) hit.click();
      return!!hit;
    };
    const start=Date.now();
    const tick=()=>{
      if(clickNav()) return;
      if(Date.now()-start>8000) return;
      setTimeout(tick,80);
    };
    tick();
  });
  window.addEventListener("sand-open-about",()=>{
    const open=window.__sandOpenAboutOverlay;
    if(typeof open==="function") open();
  });
}
const RRouterProviders=[
  {value:"claude-code",label:"Claude Code",description:"Use your existing Claude Code sign-in and Grok Bot's connected plugins.",kind:"local",localKey:"claude-code"},
  {value:"codex",label:"Codex",description:"Use your existing ChatGPT sign-in from Codex with Grok Bot's connected plugins.",kind:"local",localKey:"codex"},
  {value:"openrouter",label:"OpenRouter",description:"Route through your OpenRouter account and selected model.",kind:"http",secret:"OPENROUTER_API_KEY",base:"https://openrouter.ai/api/v1",model:"openai/gpt-4.1-mini"},
  {value:"openai",label:"OpenAI",description:"Use the OpenAI API with your own key.",kind:"http",secret:"OPENAI_API_KEY",base:"https://api.openai.com/v1",model:"gpt-4.1-mini"},
  {value:"deepseek",label:"DeepSeek",description:"Use DeepSeek's OpenAI-compatible API.",kind:"http",secret:"DEEPSEEK_API_KEY",base:"https://api.deepseek.com",model:"deepseek-chat"},
  {value:"custom",label:"Custom",description:"Any OpenAI-compatible endpoint.",kind:"http",secret:"CUSTOM_API_KEY",base:"",model:""}
],RRouterOptions=RRouterProviders.map(s=>({value:s.value,label:s.label})),RRouterEmptyUsage={requests:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,lastUsedAt:null},RRouterInputClass="sand-9f619 sand-h8yej3 sand-5f5z56 sand-u97haq sand-lrnmfh sand-uve7l6 sand-16b7oty sand-1rgtt3y sand-o7x2bt sand-mkeg23 sand-1y0btm7 sand-qz0629 sand-1043rbw sand-13l7odt sand-1wd3ewq sand-jb2p0i sand-4z9k3i sand-frs9s4 sand-tt52l0 sand-1odjw0f sand-1t137rt sand-ltfok3";
function RRouterState(){
  const[s,e]=de.useState({provider:"openrouter",usage:null,local:null,http:null,error:null});
  de.useEffect(()=>{let t=!0;const n=r=>{t&&e(r.detail)};window.addEventListener("sand-router-provider-changed",n);window.desktop.agent.getInferenceRouter().then(r=>{t&&e({...r,error:null})}).catch(r=>{t&&e(i=>({...i,error:String(r?.message??r)}))});return()=>{t=!1;window.removeEventListener("sand-router-provider-changed",n)}},[]);
  const t=async n=>{const r=s;e(i=>({...i,provider:n,error:null}));try{const i=await window.desktop.agent.setInferenceRouter(n),o={...i,error:null};e(o);window.dispatchEvent(new CustomEvent("sand-router-provider-changed",{detail:o}))}catch(i){e({...r,error:String(i?.message??i)})}};
  return[s,t]
}
function RRouterSecrets(){const[s,e]=de.useState([]),[t,n]=de.useState(0);de.useEffect(()=>{let r=!0;window.desktop.secrets.list().then(i=>{r&&e(Array.isArray(i?.keys)?i.keys:[])});return()=>{r=!1}},[t]);return[s,()=>n(r=>r+1)]}
function RRouterNumber(s){return new Intl.NumberFormat().format(s)}
function RRouterCredential({provider:s,state:e,keys:t,onSaved:n}){const[r,i]=de.useState(""),[o,l]=de.useState(!1),[c,d]=de.useState(e.http?.baseUrl||s.base||""),[m,f]=de.useState(e.http?.modelId||s.model||"");if(s.kind==="account")return a.jsx(se,{as:"span",color:"secondary",size:"sm",children:"Signed in"});if(s.kind==="local"){const g=e.local?.[s.localKey],h=g?.installed&&g?.authenticated;return a.jsx(se,{as:"span",color:h?"primary":"secondary",size:"sm",children:h?"Ready":g?.installed?"Sign in with "+(s.value==="codex"?"codex login":"claude"):"Not installed"})}const g=t.includes(s.secret),h=async()=>{if(s.kind==="http"&&r.trim().length===0&&!(e.http?.baseUrl||s.base||c.trim()))return;l(!0);try{if(s.kind==="http"&&window.desktop.agent.upsertInferenceVendor&&r.trim().length>0){await window.desktop.agent.upsertInferenceVendor({provider:s.value,apiKey:r.trim(),baseUrl:c.trim(),modelId:m.trim(),label:s.label,makeDefault:!0});await window.desktop.agent.setInferenceRouter({provider:s.value})}else await window.desktop.agent.setInferenceRouter({provider:s.value,apiKey:r.trim(),baseUrl:c.trim(),modelId:m.trim()});i("");n();window.dispatchEvent(new Event("sand-inference-vendors-changed"))}finally{l(!1)}};return a.jsxs("div",{className:"sand-9f619 sand-78zum5 sand-dt5ytf sand-h8yej3",style:{width:360,gap:8},children:[a.jsx("input",{"aria-label":s.secret,className:RRouterInputClass,disabled:o,onChange:u=>i(u.currentTarget.value),placeholder:g?"Replace saved key":"Paste API key",style:{fontSize:13,height:34,minWidth:0,padding:"0 10px",width:270},type:"password",value:r}),a.jsx("input",{"aria-label":"Base URL",className:RRouterInputClass,disabled:o,onChange:u=>d(u.currentTarget.value),placeholder:"Base URL",style:{fontSize:13,height:34,minWidth:0,padding:"0 10px",width:270},value:c}),a.jsx("input",{"aria-label":"Model ID",className:RRouterInputClass,disabled:o,onChange:u=>f(u.currentTarget.value),placeholder:"Model ID",style:{fontSize:13,height:34,minWidth:0,padding:"0 10px",width:270},value:m}),a.jsx(oe,{disabled:o,onClick:h,shape:"rectangular",size:"sm",variant:"secondary",children:o?"Saving…":"Save"})]})}
function RRouterUsageRows({usage:s}){return a.jsxs("div",{children:[a.jsx(ie,{label:"Requests",variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:RRouterNumber(s.requests)})}),a.jsx(ie,{divided:!0,label:"Input tokens",variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:RRouterNumber(s.inputTokens)})}),a.jsx(ie,{divided:!0,label:"Output tokens",variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:RRouterNumber(s.outputTokens)})}),a.jsx(ie,{divided:!0,label:"Cache tokens",variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:RRouterNumber(s.cacheReadTokens+s.cacheWriteTokens)})}),a.jsx(ie,{divided:!0,label:"Last used",variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:s.lastUsedAt?new Date(s.lastUsedAt).toLocaleString():"Not used yet"})})]})}
function RBoxRuntime(){const[s,e]=de.useState({mode:"remote",status:null,error:null,busy:!0});de.useEffect(()=>{let t=!0;window.desktop.agent.getBoxRuntime().then(n=>{t&&e({...n,error:null,busy:!1})}).catch(n=>{t&&e(r=>({...r,error:String(n?.message??n),busy:!1}))});return()=>{t=!1}},[]);const t=s.mode==="local-docker",n=async()=>{const r=t?"remote":"local-docker";e(i=>({...i,mode:r,busy:!0,error:null}));try{const i=await window.desktop.agent.setBoxRuntime(r);e({...i,error:null,busy:!1})}catch(i){e(o=>({...o,mode:t?"local-docker":"remote",error:String(i?.message??i),busy:!1}))}};return a.jsxs("div",{children:[a.jsx(ie,{description:t?(s.status?.detail??"Shell, files and computer use run in a Docker container on this Mac."):"Shell, files and computer use run on Grok Bot's remote computer.",label:"Use local Docker VM",variant:"card",children:a.jsx("button",{"aria-checked":t,"aria-label":"Use local Docker VM",disabled:s.busy,onClick:n,role:"switch",style:{appearance:"none",background:t?"var(--color-accent-primary, #4f8cff)":"rgba(255,255,255,.14)",border:0,borderRadius:999,cursor:s.busy?"wait":"pointer",height:22,opacity:s.busy?0.65:1,padding:2,position:"relative",transition:"background .15s ease",width:38},type:"button",children:a.jsx("span",{style:{background:"white",borderRadius:"50%",boxShadow:"0 1px 3px rgba(0,0,0,.35)",display:"block",height:18,transform:"translateX("+(t?16:0)+"px)",transition:"transform .15s ease",width:18}})})}),s.error?a.jsx(se,{as:"p",color:"red",size:"sm",children:s.error}):null]})}
function RLanguageRow(){const[s,e]=de.useState("en");de.useEffect(()=>{window.desktop.agent.getUiLanguage().then(n=>{const r=n?.language==="zh"?"zh":"en";e(r);window.__sandUiLanguage=r}).catch(()=>{});return()=>{}},[]);const t=async n=>{e(n);window.__sandUiLanguage=n;try{await window.desktop.agent.setUiLanguage(n)}catch{}window.dispatchEvent(new Event("sand-ui-language-changed"))};const n=s==="zh"?"语言":"Language";return a.jsx(ie,{divided:!0,label:n,variant:"card",children:a.jsx(ye,{"aria-label":n,onValueChange:d=>{if(d!==null)void t(d)},options:[{value:"en",label:"English"},{value:"zh",label:"中文"}],placement:"bottom-end",size:"lg",value:s,variant:"filled"})})}
`;
const COMPONENT_TAIL = String.raw`
function RRouterPanel(){const[s,e]=RRouterState(),[t,n]=RRouterSecrets(),r=RRouterProviders.find(i=>i.value===s.provider)??RRouterProviders[0],i=s.usage?.providers?.[s.provider]??RRouterEmptyUsage,o=r.value==="codex"?"Uses the private ChatGPT login already stored by Codex on this Mac. Requests are made by Grok Bot directly.":r.kind==="local"?"Uses Claude Code's existing login on this Mac.":"Stored on this Mac and used for OpenAI-compatible requests.";return a.jsx(Te,{children:a.jsxs("div",{className:k("sand-settings-general","sand-9f619 sand-78zum5 sand-dt5ytf sand-3qzy4x"),children:[a.jsx(re,{title:"Routing",children:a.jsx(ie,{description:r.description,label:"Provider",variant:"card",children:a.jsx(ye,{"aria-label":"Routing provider",onValueChange:l=>{if(l!==null)void e(l)},options:RRouterOptions,placement:"bottom-end",size:"lg",value:s.provider,variant:"filled"})})}),a.jsx(re,{title:"Computer",children:a.jsx(RBoxRuntime,{})}),a.jsx(re,{title:(window.__sandUiLanguage||"en")==="zh"?"模型 API":"Model APIs",children:a.jsx(RVendorAccounts,{})}),r.kind==="http"?null:a.jsx(re,{title:"Account",children:a.jsx(ie,{description:o,label:"Status",variant:"card",children:a.jsx(RRouterCredential,{provider:r,state:s,keys:t,onSaved:n})})}),s.error?a.jsx(se,{as:"p",color:"red",size:"sm",children:s.error}):null,a.jsx(re,{title:"Usage for "+r.label,children:a.jsx(RRouterUsageRows,{usage:i})})]})})}
function RRouterUsageSummary({provider:s,usage:e,current:t,divided:n}){const r=[RRouterNumber(e.requests)+" requests",RRouterNumber(e.inputTokens)+" input",RRouterNumber(e.outputTokens)+" output",RRouterNumber(e.cacheReadTokens+e.cacheWriteTokens)+" cached"].join(" · "),i=t?"Current route":e.lastUsedAt?new Date(e.lastUsedAt).toLocaleString():"Not used yet";return a.jsx(ie,{divided:n,description:r,label:s.label,variant:"card",children:a.jsx(se,{as:"span",color:t?"primary":"secondary",size:"sm",children:i})})}
function RRouterUsage(){const[s]=RRouterState(),e=RRouterProviders.find(t=>t.value===s.provider)??RRouterProviders[0],t=RRouterProviders.filter(n=>n.value===s.provider||(s.usage?.providers?.[n.value]?.requests??0)>0);return a.jsxs("div",{className:k("sand-usage-section","sand-9f619 sand-78zum5 sand-dt5ytf sand-ou54vl"),children:[a.jsx(re,{title:"Current provider",children:a.jsx(ie,{description:e.description,label:e.label,variant:"card",children:a.jsx(se,{as:"span",color:"secondary",size:"sm",children:"Selected"})})}),a.jsx(re,{title:"Tracked activity",children:a.jsx("div",{children:t.map((n,r)=>a.jsx(RRouterUsageSummary,{provider:n,usage:s.usage?.providers?.[n.value]??RRouterEmptyUsage,current:n.value===s.provider,divided:r>0},n.value))})}),s.provider==="cursor"?a.jsx(Na,{}):null]})}
`;
const COMPONENT_SOURCE = `${COMPONENT_HEAD}\n${VENDOR_ACCOUNTS_SNIPPET}\n${COMPONENT_TAIL}`;

const LANDING_TITLE_BEFORE = 'id:t,style:k.style,children:"Grok Bot"';
const LANDING_TITLE_AFTER = 'id:t,style:k.style,children:"BeeBot"';
const LANDING_GJN_BEFORE = 'function gjn(n){const e=he.c(7),{headingId:t,auth:s,onSignIn:r}=n,i=s.status.kind==="logging-in"||s.isPending&&s.status.kind!=="logged-in";let o;e[0]!==s||e[1]!==i||e[2]!==r?(o=i?p.jsx(kjn,{auth:s}):p.jsxs(p.Fragment,{children:[p.jsx(p0t,{autoFocus:!0,disabled:!s.isLoaded,onClick:r,trailingIcon:"arrow-right",children:"Sign in"}),s.error!=null?p.jsx(yjn,{message:s.error}):null]}),e[0]=s,e[1]=i,e[2]=r,e[3]=o):o=e[3];let l;return e[4]!==t||e[5]!==o?(l=p.jsx(h0t,{headingId:t,opticalDropPx:cjn,tagline:"Your team of always-on agents that you can give real work to.",children:o}),e[4]=t,e[5]=o,e[6]=l):l=e[6],l}';
const LANDING_GJN_AFTER = `function RVendorSetup(n){const t=n.headingId,s=[{value:"openrouter",label:"OpenRouter",base:"https://openrouter.ai/api/v1",model:"openai/gpt-4.1-mini",secret:"OPENROUTER_API_KEY"},{value:"openai",label:"OpenAI",base:"https://api.openai.com/v1",model:"gpt-4.1-mini",secret:"OPENAI_API_KEY"},{value:"deepseek",label:"DeepSeek",base:"https://api.deepseek.com",model:"deepseek-chat",secret:"DEEPSEEK_API_KEY"},{value:"custom",label:"Custom",base:"",model:"",secret:"CUSTOM_API_KEY"}],[r,i]=S.useState({provider:"openrouter",apiKey:"",baseUrl:s[0].base,modelId:s[0].model,busy:!1,error:null,keys:[]});S.useEffect(()=>{let e=!0;window.desktop.secrets.list().then(o=>{e&&i(l=>({...l,keys:Array.isArray(o?.keys)?o.keys:[]}))}).catch(()=>{});window.desktop.agent.getInferenceRouter().then(o=>{if(!e||o==null)return;const l=s.find(c=>c.value===o.provider)??s[0];i(c=>({...c,provider:l.value,baseUrl:o.http?.baseUrl||l.base,modelId:o.http?.modelId||l.model}))}).catch(()=>{});return()=>{e=!1}},[]);const o=s.find(e=>e.value===r.provider)??s[0],l=e=>{const u=s.find(d=>d.value===e)??o;i(d=>({...d,provider:u.value,baseUrl:u.base,modelId:u.model,error:null}))},c=async()=>{i(e=>({...e,busy:!0,error:null}));try{await window.desktop.agent.setInferenceRouter({provider:r.provider,apiKey:r.apiKey.trim(),baseUrl:r.baseUrl.trim(),modelId:r.modelId.trim()})}catch(e){i(u=>({...u,busy:!1,error:String(e?.message??e)}));return}i(e=>({...e,busy:!1}))},u={fontSize:13,height:34,width:"100%",padding:"0 10px",borderRadius:8,border:"1px solid #c8c8c8",background:"#fff",color:"#111",boxSizing:"border-box"},g={display:"grid",gap:6,textAlign:"left",fontSize:12,fontWeight:600,color:"#333"};return p.jsx(h0t,{headingId:t,opticalDropPx:cjn,tagline:"Choose a model vendor, paste an API key, and start.",children:p.jsxs("div",{style:{display:"grid",gap:12,justifyItems:"stretch",width:320},children:[p.jsxs("label",{style:g,children:["Vendor",p.jsxs("select",{"aria-label":"Vendor",value:r.provider,onChange:e=>l(e.target.value),style:u,children:s.map(e=>p.jsx("option",{value:e.value,children:e.label},e.value))})]}),p.jsxs("label",{style:g,children:["API key",p.jsx("input",{"aria-label":"API key",type:"password",value:r.apiKey,placeholder:r.keys.includes(o.secret)?"Key saved — paste to replace":"Paste API key",onChange:e=>i(d=>({...d,apiKey:e.target.value})),style:u})]}),p.jsxs("label",{style:g,children:["Base URL",p.jsx("input",{"aria-label":"Base URL",value:r.baseUrl,onChange:e=>i(d=>({...d,baseUrl:e.target.value})),style:u})]}),p.jsxs("label",{style:g,children:["Model ID",p.jsx("input",{"aria-label":"Model ID",value:r.modelId,onChange:e=>i(d=>({...d,modelId:e.target.value})),style:u})]}),p.jsx(p0t,{disabled:r.busy||r.apiKey.trim().length===0,onClick:()=>void c(),children:r.busy?"Saving…":"Start using"}),r.error?p.jsx(yjn,{message:r.error}):null]})})}
function gjn(n){return p.jsx(RVendorSetup,{headingId:n.headingId,auth:n.auth,onSignIn:n.onSignIn})}`;

const CREATE_AGENT_BEFORE = "function MOn(n){const e=n.roster,t=S.useCallback((r,i)=>e.createAgent({...r,origin:\"user\",...i}),[e]),s=lr(e.deleteAgents);";
const ACCOUNT_MENU_SNIPPET = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "sand-account-menu.snippet.js"), "utf8");
const GROUP_UI_SNIPPET = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "sand-group-ui.snippet.js"), "utf8");
const createOverlay = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "sand-create-overlay.snippet.js"), "utf8");
const paths = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "persona-shape-paths.json"), "utf8");
const monAt = createOverlay.indexOf("function MOn(");
if (monAt < 0) throw new Error("create overlay is missing function MOn(");
const CREATE_AGENT_AFTER = `const R_PATHS=${paths};\n${createOverlay.slice(0, monAt)}\n${ACCOUNT_MENU_SNIPPET}\n${GROUP_UI_SNIPPET}\n${createOverlay.slice(monAt)}`;
export const LANDING_ABOUT_WRAP = `;(function(){
  function wrap(){
    if(window.__sandAboutWrapped) return true;
    const d=window.desktop;
    if(!d||typeof d.onOpenAbout!=="function") return false;
    try{
      const orig=d.onOpenAbout.bind(d);
      const wrapped=function(listener){
        window.__sandOpenAboutOverlay=listener;
        return orig(listener);
      };
      try{ d.onOpenAbout=wrapped; }
      catch{
        try{ Object.defineProperty(d,"onOpenAbout",{configurable:!0,writable:!0,value:wrapped}); }
        catch{ window.__sandAboutWrapFailed=1; }
      }
    }catch{
      window.__sandAboutWrapFailed=1;
    }
    window.__sandAboutWrapped=1;
    return true;
  }
  if(!wrap()){
    const t=setInterval(()=>{ if(wrap()) clearInterval(t); },20);
    setTimeout(()=>clearInterval(t),8000);
  }
})();
`;

export function patchOriginalLanding(source) {
  let patched = replaceExactlyOnce(source, LANDING_TITLE_BEFORE, LANDING_TITLE_AFTER, "landing title");
  patched = replaceExactlyOnce(patched, LANDING_GJN_BEFORE, LANDING_GJN_AFTER, "landing sign-in");
  patched = replaceExactlyOnce(patched, CREATE_AGENT_BEFORE, CREATE_AGENT_AFTER, "create bot sheet");
  return `${LANDING_ABOUT_WRAP}${patched}`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) throw new Error(`Original renderer ${label} anchor is missing or ambiguous.`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchOriginalSettingsRegistry(source) {
  return replaceExactlyOnce(source, REGISTRY_BEFORE, REGISTRY_AFTER, "settings registry");
}

export function patchOriginalSettingsPanel(source) {
  let patched = replaceExactlyOnce(source, COMPONENT_ANCHOR, `${COMPONENT_SOURCE}${COMPONENT_ANCHOR}`, "component insertion");
  patched = replaceExactlyOnce(patched, GENERAL_BEFORE, GENERAL_AFTER, "Router panel switch");
  patched = replaceExactlyOnce(patched, USAGE_BEFORE, USAGE_AFTER, "Usage panel switch");
  patched = replaceExactlyOnce(patched, APPEARANCE_BEFORE, APPEARANCE_AFTER, "language setting");
  return patched;
}

export async function applyOriginalRendererRouterPatch({ stageRoot }) {
  const assetsRoot = path.join(stageRoot, "dist", "renderer", "assets");
  const registryCandidates = [];
  const panelCandidates = [];
  const landingCandidates = [];
  for (const name of await readdir(assetsRoot)) {
    if (!name.endsWith(".js")) continue;
    const target = path.join(assetsRoot, name);
    const source = await readFile(target, "utf8");
    if (source.includes(REGISTRY_BEFORE)) registryCandidates.push({ name, target, source });
    if (source.includes(COMPONENT_ANCHOR) && source.includes(GENERAL_BEFORE) && source.includes(USAGE_BEFORE)) panelCandidates.push({ name, target, source });
    if (source.includes(LANDING_GJN_BEFORE) && source.includes(LANDING_TITLE_BEFORE)) landingCandidates.push({ name, target, source });
  }
  if (registryCandidates.length !== 1 || panelCandidates.length !== 1 || landingCandidates.length !== 1) {
    throw new Error(`Expected one original Settings registry, panel, and landing chunk, found ${registryCandidates.length}/${panelCandidates.length}/${landingCandidates.length}.`);
  }
  const changes = [];
  const currentByTarget = new Map();
  for (const [role, candidate, transform] of [
    ["registry", registryCandidates[0], patchOriginalSettingsRegistry],
    ["panel", panelCandidates[0], patchOriginalSettingsPanel],
    ["landing", landingCandidates[0], patchOriginalLanding],
  ]) {
    const current = currentByTarget.get(candidate.target) ?? candidate.source;
    const patched = transform(current);
    currentByTarget.set(candidate.target, patched);
    changes.push({
      role,
      path: `dist/renderer/assets/${candidate.name}`,
      original: { bytes: Buffer.byteLength(candidate.source), sha256: sha256(candidate.source) },
      patched: { bytes: Buffer.byteLength(patched), sha256: sha256(patched) },
    });
  }
  for (const [target, patched] of currentByTarget) {
    await writeFile(target, patched);
  }
  const record = {
    schemaVersion: 1,
    mode: "original-renderer-settings-extension",
    chunks: changes,
    features: ["settings-router-provider", "settings-local-docker-vm", "usage-current-provider", "vendor-setup-landing"],
    transformations: ["settings-registry", "router-panel", "usage-panel", "vendor-landing"],
  };
  const provenancePath = path.join(stageRoot, "dist", "renderer-router-extension.json");
  await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, provenancePath, provenanceBytes: (await stat(provenancePath)).size };
}
