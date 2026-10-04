import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

const snippet=readFileSync(new URL("./beebot-draft-delivery.snippet.js",import.meta.url),"utf8");
export function draftDeliverySnippet(){
  const output=buildSync({entryPoints:[new URL("../../frontend/src/recovered/features/conversation/cards/transcript-card/draft-delivery.ts",import.meta.url).pathname],bundle:true,write:false,platform:"browser",format:"iife",globalName:"BB_DraftDelivery",target:"es2023",logLevel:"silent"}).outputFiles[0].text;
  return output+"\n"+snippet;
}
function replace(source,anchor,replacement,label){if(source.split(anchor).length!==2)throw new Error(`Draft renderer anchor changed: ${label}`);return source.replace(anchor,replacement);}
export function patchDraftDeliveryRenderer(source){
  if(source.includes('getDraftDelivery:{args:"object",reply:"record"}'))throw new Error("Draft renderer anchor changed: already patched RPC table");
  let result=replace(source,'sendPrompt:{args:"object",reply:"send-result"}','getDraftDelivery:{args:"object",reply:"record"},resolveDraftDelivery:{args:"object",reply:"record"},sendPrompt:{args:"object",reply:"send-result"}',"RPC table");
  result=replace(result,'sendPrompt:"send",promptAcceptanceStatus:','getDraftDelivery:"transcript",resolveDraftDelivery:"send",sendPrompt:"send",promptAcceptanceStatus:',"RPC domain");
  result=replace(result,'setGroupMembers:we=>e.setGroupMembers(we)','getDraftDelivery:we=>e.getDraftDelivery(we),resolveDraftDelivery:we=>e.resolveDraftDelivery(we),setGroupMembers:we=>e.setGroupMembers(we)',"roster bridge");
  return result;
}
export function patchDraftDeliveryChunks(source,kind){
  const email=kind==="email",name=email?"Ms":"vs",react=email?"as":"rs",frame=email?"bs":"ps",outer=email?"ks":"js";
  const start=source.indexOf(`function ${name}(`),end=source.indexOf(`export{${name} as default};`,start);
  if(start<0||end<0||!source.slice(start,end).includes(email?'function qs(){}function Cs(){}':'function Ss(){}function zs(){}'))throw new Error(`Draft renderer anchor changed: ${kind} card`);
  const replacement=`function ${name}(props){const {entry,adjacency={}}=props;const card=window.__beebotDraftCard?e.jsx(window.__beebotDraftCard,{React:${react},entry}):e.jsx("p",{role:"alert",children:"Draft actions unavailable. Content is preserved."});return e.jsx(${outer},{entry,children:e.jsx(${frame},{className:"sand-${kind}-composer-wrap",isGroupStart:adjacency.isGroupStart,timestampMs:entry.timestampMs,variant:"question",children:card})});}`;
  return source.slice(0,start)+replacement+source.slice(end);
}
