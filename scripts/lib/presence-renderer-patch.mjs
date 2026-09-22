import { buildSync } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let shared;
export function presenceSharedModule() {
  return shared ??= buildSync({ entryPoints: [fileURLToPath(new URL("../../frontend/src/presence/packaged-ui.ts", import.meta.url))], bundle: true, write: false, format: "iife", globalName: "RPresenceUI", platform: "browser", target: "chrome136", minify: false }).outputFiles[0].text;
}
const once = (source, before, after, label) => {
  const offset = source.indexOf(before);
  if (offset < 0 || source.indexOf(before, offset + before.length) >= 0) throw new Error(`Presence pinned renderer anchor mismatch: ${label}`);
  return source.slice(0, offset) + after + source.slice(offset + before.length);
};
const avatarSource = readFileSync(new URL("./sand-create-overlay.snippet.js", import.meta.url), "utf8");
const svgStart = avatarSource.indexOf("function RBotSvg(");
const svgEnd = avatarSource.indexOf("async function RLang(", svgStart);
const ORIGINAL_AVATAR_SHA = "dbc709983249f0bcbcb6b2fd7c1d9c9ee220c5cc2c29e019adcaa92f94ba705e";

/** Replace only display components in the verified compatibility renderer.
 * Caller records original/patched chunk hashes; no message transport, auth, message dispatch,
 * photo handling, group membership, quote or permission code is replaced. */
export function patchPresenceRenderer(source) {
  const start = source.indexOf("function sd(n){");
  const end = source.indexOf("const lin=", start);
  if (start < 0 || end < 0 || createHash("sha256").update(source.slice(start, end)).digest("hex") !== ORIGINAL_AVATAR_SHA) {
    throw new Error("Presence persona renderer differs from the pinned 0.18 source");
  }
  let result = source.slice(0, start) + `function sd(n){
    const style=Fe(Slt.root,n.style),size="sizeCss" in n?n.sizeCss:n.sizePx;
    return p.jsxs("span",{"aria-hidden":true,className:re("sand-grok-bot-mark","bb-persona",style.className,n.className),"data-grok-state":n.state??"idle","data-paused":n.paused||undefined,style:{...style.style,width:size,height:size},children:[
      p.jsx(RPresenceCharacter(),{color:n.color,shape:n.shape,state:n.state,paused:n.paused,sizePx:n.sizePx,sourceId:n.sourceId,emphasis:n.emphasis,spinSignal:n.spinSignal,ref:n.ref,isFollowingPointer:n.isFollowingPointer,followTarget:n.followTarget,motionPriority:n.motionPriority,avatarIdentity:n.avatarIdentity??n.sourceId}),n.children
    ]});
  }` + source.slice(end);
  result = once(result, 'viewBox:ent,children:p.jsx("use",{height:J1.height,href:k,width:J1.width,x:J1.minX,y:J1.minY})', 'viewBox:"0 0 64 64",children:p.jsx("use",{href:k})', "live avatar mirror");
  result = once(result, avatarSource.slice(svgStart, svgEnd), 'function RBotSvg(shape,colorId,size){return RPresenceUI.createCharacterSvg(document,shape,colorId,size)}\n', "creation/group artwork");
  result = once(result, 'className:re("sand-agents-sidebar__new-actions",v.className),style:v.style,children:[m!=null', 'className:re("sand-agents-sidebar__new-actions",v.className),style:v.style,children:[p.jsx("span",{className:"bb-wordmark",children:"BeeBot"}),m!=null', "sidebar wordmark");
  // Recompute this small identity row, instead of adding a new value to the
  // compiled memo cache without updating its dependency vector.
  result = once(result, 'let B;e[97]!==N||e[98]!==E||e[99]!==A||e[100]!==I?(B=p.jsxs("div",{className:N,style:E,children:[A,I]}),e[97]=N,e[98]=E,e[99]=A,e[100]=I,e[101]=B):B=e[101];let R;', 'const B=p.jsxs("div",{className:N,style:E,children:[A,I,p.jsx(RPresenceWorkStatus(),{agent:t})]});let R;', "header work status");

  const avatarStart = result.indexOf("function Iee(n){"), avatarEnd = result.indexOf("function pln(", avatarStart);
  if (avatarStart < 0 || avatarEnd < 0 || createHash("sha256").update(result.slice(avatarStart, avatarEnd)).digest("hex") !== "03248da90575b211b0cfe2d08852262caac7297a4ab1df4ea900be83627c038b") throw new Error("Presence avatar dispatcher differs from pinned source");
  result = result.slice(0, avatarStart) + `function Iee(n){
    const {avatarKey:t,dataUrl:s,size:r="md",fillPx:i,state:o="idle",shape:l,color:c,isStatic:y=true,style:m}=n;
    const sourceId=S.useId(),f=r,O=i??Jj[f];
    if(s!=null&&s.length>0)return p.jsx(au,{"aria-hidden":true,className:"sand-agent-avatar","data-size":f,sizePx:O,src:s,style:m});
    return p.jsx(sd,{className:"sand-agent-avatar",color:c??sle(t),paused:y,shape:l??u4e(t),sizePx:O,state:o,style:m,sourceId:"bb-visible-"+sourceId,avatarIdentity:kct(t)});
  }` + result.slice(avatarEnd);
  result = once(result, 'function wbe(n){return n==null||!xge(n)?eZ:KCe(n)?"thinking":nln(n.currentActivity??null)}function mct({rosterAgent:n,surfaceFacts:e}){if(n?.awaitingUserResponse!=null)return eZ;const t=wbe(n);return t===eZ?wbe(e):t}',
    'function wbe(n){return RPresenceUI.avatarStateFromAgent(n??{})}function mct({rosterAgent:n,surfaceFacts:e}){return RPresenceUI.avatarStateFromAgent(n??e??{})}', "shared live state projection");
  result = once(result, "PQ=[{id:\"black\",label:\"Black\",value:\"#000\"},{id:\"brown\",label:\"Brown\",value:\"#936439\"},{id:\"red\",label:\"Red\",value:\"#FF263C\"},{id:\"orange\",label:\"Orange\",value:\"#FF6700\"},{id:\"yellow\",label:\"Yellow\",value:\"#FF9800\"},{id:\"green\",label:\"Green\",value:\"#00C972\"},{id:\"cyan\",label:\"Cyan\",value:\"#00BCA6\"},{id:\"blue\",label:\"Blue\",value:\"#1084FE\"},{id:\"violet\",label:\"Violet\",value:\"#9159FE\"},{id:\"magenta\",label:\"Magenta\",value:\"#FF309B\"},{id:\"gray\",label:\"Gray\",value:\"#777777\"}]", "PQ=[{\"id\":\"black\",\"label\":\"Slate\",\"value\":\"#B6C0D0\"},{\"id\":\"brown\",\"label\":\"Stone\",\"value\":\"#C8BFC4\"},{\"id\":\"red\",\"label\":\"Rose\",\"value\":\"#DCBCC0\"},{\"id\":\"orange\",\"label\":\"Dusk\",\"value\":\"#C8BEC8\"},{\"id\":\"yellow\",\"label\":\"Cloud\",\"value\":\"#A8BBD2\"},{\"id\":\"green\",\"label\":\"Sage\",\"value\":\"#B6CDC7\"},{\"id\":\"cyan\",\"label\":\"Mist\",\"value\":\"#ADD0DB\"},{\"id\":\"blue\",\"label\":\"Blue\",\"value\":\"#ADC3EA\"},{\"id\":\"violet\",\"label\":\"Lilac\",\"value\":\"#C4BBDE\"},{\"id\":\"magenta\",\"label\":\"Blush\",\"value\":\"#D7BDC9\"},{\"id\":\"gray\",\"label\":\"Gray\",\"value\":\"#BEC5D0\"}]", "neutral persisted color keys");
  result = once(result, "function dqn(n){const e=he.c(8),{bob:t,children:s}=n;let r;e[0]===Symbol.for(\"react.memo_cache_sentinel\")?(r={className:\"sand-1lliihq sand-h8yej3 sand-5yr21d sand-19hwp5s sand-1aquc0h sand-a4qsjk sand-pz12be sand-4hg4is\"},e[0]=r):r=e[0];const i=r,o=`${t.amplitudePx}px`,l=`${t.periodMs}ms`,c=`${t.delayMs}ms`;let u;e[1]!==o||e[2]!==l||e[3]!==c?(u={...i.style,\"--cast-bob-amp\":o,animationDuration:l,animationDelay:c},e[1]=o,e[2]=l,e[3]=c,e[4]=u):u=e[4];const d=u;let m;return e[5]!==s||e[6]!==d?(m=p.jsx(\"span\",{className:i.className,style:d,children:s}),e[5]=s,e[6]=d,e[7]=m):m=e[7],m}", "function dqn(n){return n.children}", "welcome motion ownership");
  result = once(result, 'function Y_t(n){const{from:e,to:t,angle:s}=K_t(n);return`linear-gradient(${s+90}deg, ${e}, ${t})`}', 'function Y_t(n){const c=RPresenceUI.avatarColors[n]??RPresenceUI.avatarColors.blue;return`linear-gradient(${c},${c})`}', "neutral color swatches");
  result = once(result, 'k=Ij.map(I=>{const P=i&&m===I,', 'k=RPresenceUI.avatarShapes.map(I=>{const P=i&&RPresenceUI.characterVariant(m)===RPresenceUI.characterVariant(I),', "six original avatar choices");
  result = once(result, 'p.jsx("span",{"aria-hidden":!0,className:O.className,style:{...O.style,maskImage:X2n.get(I)}})', 'p.jsx("span",{"aria-hidden":!0,className:"bb-shape-selection","data-selected":P})', "neutral shape focus ring");
  result = once(result, 'A=p.jsxs("div",{className:f,children:[v,E]})', 'A=p.jsxs("div",{className:f,children:[p.jsx(sd,{className:"bb-avatar-preview",color:u,shape:m,sizePx:76,state:"idle",paused:false,isFollowingPointer:true,motionPriority:100}),v,E,p.jsx(RPresenceMotionSetting(),{})]})', "live editor and motion preference");

  result = once(result, 'new URL("app-icon-C7NKj2u7.png",import.meta.url)', 'new URL("beebot-app-icon.svg",import.meta.url)', "neutral welcome application icon");

  return `${presenceSharedModule()}\nfunction RPresenceCharacter(){return RPresenceCharacter.value??=RPresenceUI.createPresenceCharacter(S)}\nfunction RPresenceMotionSetting(){return RPresenceMotionSetting.value??=RPresenceUI.createPresenceMotionSetting(S)}\nfunction RPresenceWorkStatus(){return RPresenceWorkStatus.value??=RPresenceUI.createPresenceWorkStatus(S)}\n${result}`;
}
