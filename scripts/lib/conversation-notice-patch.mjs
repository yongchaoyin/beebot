import { createHash } from "node:crypto";

/** Replace the pinned lazy notice display, not its persisted entry or dispatcher. */
export function patchConversationNoticeChunk(source) {
  if (createHash("sha256").update(source).digest("hex") !== "d26defda2a80163d7782b5a0b5ee669eded6694f7ffc54ef64baa64f2a8242ea") {
    throw new Error("Pinned conversation notice differs; refusing an unreviewed replacement");
  }
  return source.replace("function m(i){", "function ROriginalNotice(i){")
    .replace("export{m as default};", `function m(n){return typeof window!=="undefined"&&window.__beebotConversationNotice?c.jsx(window.__beebotConversationNotice,{...n,original:c.jsx(ROriginalNotice,n)}):c.jsx(ROriginalNotice,n)}export{m as default};`);
}
