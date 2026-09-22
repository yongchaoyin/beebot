import { buildSync } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let shared;
export function honeylineSharedModule() {
  return shared ??= buildSync({ entryPoints: [fileURLToPath(new URL("../../frontend/src/honeyline/packaged-ui.ts", import.meta.url))], bundle: true, write: false, format: "iife", globalName: "RHoneylineUI", platform: "browser", target: "chrome136", minify: false }).outputFiles[0].text;
}
const once = (source, before, after, label) => {
  const offset = source.indexOf(before);
  if (offset < 0 || source.indexOf(before, offset + before.length) >= 0) throw new Error(`Honeyline pinned renderer anchor mismatch: ${label}`);
  return source.slice(0, offset) + after + source.slice(offset + before.length);
};
const avatarSource = readFileSync(new URL("./sand-create-overlay.snippet.js", import.meta.url), "utf8");
const svgStart = avatarSource.indexOf("function RBotSvg(");
const svgEnd = avatarSource.indexOf("async function RLang(", svgStart);
const ORIGINAL_AVATAR_SHA = "dbc709983249f0bcbcb6b2fd7c1d9c9ee220c5cc2c29e019adcaa92f94ba705e";

/** Replace only display components in the verified compatibility renderer.
 * Caller records original/patched chunk hashes; no transport, auth, dispatch,
 * photo handling, group membership, quote or permission code is replaced. */
export function patchHoneylineRenderer(source) {
  const start = source.indexOf("function sd(n){");
  const end = source.indexOf("const lin=", start);
  if (start < 0 || end < 0 || createHash("sha256").update(source.slice(start, end)).digest("hex") !== ORIGINAL_AVATAR_SHA) {
    throw new Error("Honeyline persona renderer differs from the pinned 0.18 source");
  }
  let result = source.slice(0, start) + `function sd(n){
    const style=Fe(Slt.root,n.style),size="sizeCss" in n?n.sizeCss:n.sizePx;
    return p.jsxs("span",{"aria-hidden":true,className:re("sand-grok-bot-mark","bee-persona",style.className,n.className),"data-grok-state":n.state??"idle","data-paused":n.paused||undefined,style:{...style.style,width:size,height:size},children:[
      p.jsx(RHoneylineCharacter(),{color:n.color,shape:n.shape,state:n.state,paused:n.paused,sizePx:n.sizePx,sourceId:n.sourceId,emphasis:n.emphasis,spinSignal:n.spinSignal,ref:n.ref}),n.children
    ]});
  }` + source.slice(end);
  result = once(result, 'viewBox:ent,children:p.jsx("use",{height:J1.height,href:k,width:J1.width,x:J1.minX,y:J1.minY})', 'viewBox:"0 0 64 64",children:p.jsx("use",{href:k})', "live avatar mirror");
  result = once(result, avatarSource.slice(svgStart, svgEnd), 'function RBotSvg(shape,colorId,size){return RHoneylineUI.createCharacterSvg(document,shape,colorId,size)}\n', "creation/group artwork");
  result = once(result, 'className:re("sand-agents-sidebar__new-actions",v.className),style:v.style,children:[m!=null', 'className:re("sand-agents-sidebar__new-actions",v.className),style:v.style,children:[p.jsx("span",{className:"bee-wordmark",children:"BeeBot"}),m!=null', "sidebar wordmark");
  // Recompute this small identity row, instead of adding a new value to the
  // compiled memo cache without updating its dependency vector.
  result = once(result, 'let B;e[97]!==N||e[98]!==E||e[99]!==A||e[100]!==I?(B=p.jsxs("div",{className:N,style:E,children:[A,I]}),e[97]=N,e[98]=E,e[99]=A,e[100]=I,e[101]=B):B=e[101];let R;', 'const B=p.jsxs("div",{className:N,style:E,children:[A,I,p.jsx(RHoneylineWorkStatus(),{agent:t})]});let R;', "header work status");
  return `${honeylineSharedModule()}\nfunction RHoneylineCharacter(){return RHoneylineCharacter.value??=RHoneylineUI.createHoneylineCharacter(S)}\nfunction RHoneylineWorkStatus(){return RHoneylineWorkStatus.value??=RHoneylineUI.createHoneylineWorkStatus(S)}\n${result}`;
}
