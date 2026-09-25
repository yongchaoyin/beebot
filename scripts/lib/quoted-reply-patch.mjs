import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

let bundle;
function sharedModule() {
  return bundle ??= buildSync({entryPoints:[fileURLToPath(new URL('../../frontend/src/recovered/features/conversation/workspace/quoted-reply-ui.ts',import.meta.url))],bundle:true,write:false,platform:'browser',format:'iife',globalName:'RQuotedReplyUI',target:'es2022',minify:false}).outputFiles[0].text;
}
function once(source,before,after,label) {
  const at=source.indexOf(before);
  if(at<0||source.indexOf(before,at+before.length)>=0)throw new Error(`Pinned quoted reply anchor mismatch: ${label}`);
  return source.slice(0,at)+after+source.slice(at+before.length);
}
function replaceFunction(source,name,next,body) {
  const before=`function ${name}(n){`,end=`function ${next}(`;
  const start=source.indexOf(before),finish=source.indexOf(end,start+before.length);
  if(start<0||finish<0||source.indexOf(before,start+1)>=0)throw new Error(`Pinned quoted reply function mismatch: ${name}`);
  return source.slice(0,start)+body+source.slice(finish);
}
export function patchQuotedReplies(source) {
  let result=source;
  result=replaceFunction(result,'ide','_Ae','function ide(n){return RQuotedReplyUI.previewFromTranscript(n)}');
  result=replaceFunction(result,'pCn','Roe',`function pCn(n){
    const context=r1(),roster=Ra(),name=roster.find(bot=>bot.id===context.agentId)?.name;
    const preview=RQuotedReplyUI.previewFromTranscript(context.resolveEntry(n.targetId),name);
    const media=kAe(preview.kind==="image"?preview.url:"");
    return p.jsx(RQuoteComponents().QuotedReply,{targetId:n.targetId,scopeId:context.agentId,preview,thumbnailSrc:media?.status==="ready"&&media.kind==="image"?media.src:undefined,onNavigate:id=>context.revealQuotedEntry(id)});
  }`);
  // The composer preview is projected from the same real transcript entry by ide.
  result=once(result,'function Kvn(n){const e=he.c(16),','function RLegacyComposerQuote(n){const e=he.c(16),','composer quote');
  // Ordinary references stay inline instead of opening the inherited hover card.
  result=replaceFunction(result,'uPn','dPn',`function uPn(n){
    const context=r1(),roster=Ra(),name=roster.find(bot=>bot.id===context.agentId)?.name;
    const preview=RQuotedReplyUI.previewFromTranscript(n.entry,name);
    const media=kAe(preview.kind==="image"?preview.url:"");
    return p.jsx(RQuoteComponents().QuotedReply,{targetId:n.entry.id,scopeId:context.agentId,preview,variant:"reference",thumbnailSrc:media?.status==="ready"&&media.kind==="image"?media.src:undefined,onNavigate:id=>context.revealQuotedEntry(id)});
  }`);
  // Quote is a sibling *after* the answer/card, with the answer's alignment.
  // Preserve Roe's original actions, reactions, thread affordance and row owner.
  result=once(result,'className:re("sand-message-block",I.className),style:I.style,children:[O,_]',
    'className:re("sand-message-block",I.className),style:I.style,"data-quote-owner-role":pGe(t),children:[_,O]', 'reply below message');
  // Retain the original editor child index (Gr) and its React identity. Only
  // move the quote after the input; keep the compiler dependency list intact.
  result=once(result,'children:[Vr,si,Yi,ri,ii,Gr,br]',
    'children:[Vr,si,Yi,null,ii,Gr,ri,br]', 'draft quote below editor');
  // Ce/Je use the original paginated reveal machinery, but do not open a thread.
  result=once(result,'revealEntry:e.revealEntry,openThread:e.openThread','revealEntry:e.revealEntry,revealQuotedEntry:e.revealQuotedEntry,openThread:e.openThread','quote navigation context');
  result=once(result,'revealEntry:Pe,revealSearchHit:je',`revealEntry:Pe,revealQuotedEntry:De=>{if(e==null)return false;if(A!=null){ue.current={agentId:e,entryId:De,fromAgentId:e,pagesRequested:0,parkedAtMs:Date.now(),quoted:true};b(null);E(null);return}if(!Te(De)&&f){Je({agentId:e,entryId:De,fromAgentId:e,pagesRequested:1,parkedAtMs:Date.now(),quoted:true});return}if(!Te(De))return false;oe(De);return true},revealSearchHit:je`,'current conversation quote reveal');
  result=once(result,'isRevealSurfaceReady:De.boundaryAt==null||A==null','isRevealSurfaceReady:De.boundaryAt==null&&!De.quoted||A==null','quote reveal waits for main surface');
  result=once(result,'De.boundaryAt!=null?oe(De.entryId):Pe(De.entryId)','De.boundaryAt!=null||De.quoted===true?oe(De.entryId):Pe(De.entryId)','quote history reveal never opens thread');
  return `${sharedModule()}\nfunction RQuoteComponents(){return RQuoteComponents.value??=RQuotedReplyUI.createQuotedReplyUI(S)}\nfunction Kvn(n){const media=kAe(n.preview.kind==="image"?n.preview.url:"");return p.jsx(RQuoteComponents().ComposerQuote,{preview:n.preview,onClear:n.onClear,thumbnailSrc:media?.status==="ready"&&media.kind==="image"?media.src:undefined})}\n${result}`;
}
