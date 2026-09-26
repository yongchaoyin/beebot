import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { createConversationNotice, isRoutineConversationNotice } from "../frontend/src/presence/conversation-notice.ts";

const Component = createConversationNotice(React);
const receipt = {kind:"notice", id:"review-1", text:"User reviewed and accepted this version.", controlActor:"user",
  collaborationEvent:{actor:"user",task:{state:"accepted",review:{id:"review-1",reviewer:"user",verdict:"accept"}}}};
const render = entry => renderToStaticMarkup(React.createElement(Component,{entry}));

test("saved manual acceptance receipts are presentation-only bookkeeping", () => {
  const original = JSON.stringify(receipt);
  assert.equal(isRoutineConversationNotice(receipt),true);
  assert.equal(render(receipt),"");
  assert.equal(JSON.stringify(receipt),original,"presentation cannot rewrite the durable review");
});

test("lookalike prose, normal messages, and malformed metadata never hide real conversation", () => {
  for(const entry of [
    {...receipt,kind:"message"}, {...receipt,kind:"send-message"}, {...receipt,controlActor:undefined},
    {...receipt,collaborationEvent:undefined}, {...receipt,collaborationEvent:null},
    {...receipt,collaborationEvent:{actor:"bot",task:receipt.collaborationEvent.task}},
    {...receipt,collaborationEvent:{actor:"user",task:{state:"accepted",review:{id:"another",reviewer:"user",verdict:"accept"}}}},
    {...receipt,collaborationEvent:{actor:"user",task:{state:"accepted",review:{id:"review-1",reviewer:"bot",verdict:"accept"}}}},
  ]) {
    assert.equal(isRoutineConversationNotice(entry),false);
    assert.match(render(entry),/User reviewed and accepted/);
  }
});

test("requested changes, status answers, errors and Stop remain visible", () => {
  const changes={...receipt,text:"Please fix the missing result.",collaborationEvent:{actor:"user",task:{state:"changes-requested",review:{id:"review-1",reviewer:"user",verdict:"changes"}}}};
  assert.equal(isRoutineConversationNotice(changes),false);assert.match(render(changes),/Please fix/);
  for(const code of ["recorded_work_status","delivery_recovery","work_review_wake_failed","conversation_stop_requested","delivery_failed"]){
    const entry={kind:"notice",id:code,code,text:`Visible ${code}`};
    assert.equal(isRoutineConversationNotice(entry),false);assert.match(render(entry),new RegExp(code));
  }
});

test("readable renderer projection preserves typed receipt and failure metadata", async () => {
  const compiled = await build({stdin:{contents:'export {projectTranscriptEntry} from "./frontend/src/production/model.ts";',resolveDir:process.cwd(),loader:"ts"},
    bundle:true,format:"esm",platform:"node",write:false});
  const {projectTranscriptEntry} = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
  const projected = projectTranscriptEntry({...receipt,timestampMs:123},0,"Bot");
  assert.equal(projected.timestampMs,123);assert.equal(render(projected),"");
  assert.deepEqual(projected.collaborationEvent,receipt.collaborationEvent);
  const failure=projectTranscriptEntry({kind:"notice",id:"failure",code:"delivery_failed",replyTo:"original",text:"Actual failure",timestampMs:124},1,"Bot");
  const markup=render(failure);
  assert.match(markup,/<details/);assert.match(markup,/Actual failure/);assert.match(markup,/data-reply-to="original"/);
});
