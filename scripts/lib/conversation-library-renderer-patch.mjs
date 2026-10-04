import {readFileSync} from "node:fs";
export const conversationLibrarySnippet=readFileSync(new URL("./beebot-conversation-library.snippet.js",import.meta.url),"utf8");
const before='children:[l,b?p.jsx(z2n,{agent:t,onOpenAgentChat:f})';
const after='"data-beebot-library-host":t.id,'+before;
/** Mark the pinned overview content. The host owns this pane's lifetime. */
export function patchConversationLibraryHost(source){
  if(source.includes(after))return source;
  if(source.split(before).length!==2)throw new Error("Conversation library overview anchor drifted");
  return source.replace(before,after);
}
