import assert from "node:assert/strict";
import test from "node:test";
import { loadContinuityRuntime } from "./helpers/load-continuity-runtime.mjs";
import { createContinuityHarness, until } from "./helpers/continuity-harness.mjs";

test('inline activity projects actual receipts without disclosing private execution inputs', async t => {
  const r = await loadContinuityRuntime(t), h = createContinuityHarness(t,r);
  const gate = h.gate(); h.hooks.set('direct:A', async (_call,send) => { await gate.promise; send('Done'); });
  await h.send('A','First question'); await until(()=>h.calls.length===1);
  await h.send('A','Second question');
  const state = await r.getConversationActivity(h.tm,{agentId:'A'});
  assert.equal(state.conversationId,'A'); assert.equal(state.counts.processing,1); assert.equal(state.counts.queued,1);
  assert.doesNotMatch(JSON.stringify(state), /inputDigest|attachmentPaths|"owner"|"attempt"/);
  assert.equal(state.items[1].preview,'Second question');
  gate.resolve(); await until(()=>h.calls.length===2 && h.receipts('A')[1].recipients[0].phase==='responded');
  const done = await r.getConversationActivity(h.tm,{agentId:'A'});
  assert.equal(done.items.length,0); assert.equal(done.counts.processing,0);
});

test('cancelling a queued question checks its revision and never interrupts the running question', async t => {
  const r=await loadContinuityRuntime(t),h=createContinuityHarness(t,r),gate=h.gate();
  h.hooks.set('direct:A',async(_call,send)=>{await gate.promise;send('First done');});
  await h.send('A','First');await until(()=>h.calls.length===1);await h.send('A','Second');
  const state=await r.getConversationActivity(h.tm,{agentId:'A'}),item=state.items.find(row=>row.preview==='Second');
  await assert.rejects(r.cancelQueuedConversationMessage(h.tm,{agentId:'A',messageId:item.messageId,expectedRevision:item.revision-1}),/changed/);
  const result=await r.cancelQueuedConversationMessage(h.tm,{agentId:'A',messageId:item.messageId,expectedRevision:item.revision});
  assert.equal(result.runningWorkChanged,false);assert.equal(h.interruptions.length,0);
  gate.resolve();await until(()=>h.receipts('A')[0].recipients[0].phase==='responded');
  await new Promise(done=>setTimeout(done,30)); assert.equal(h.calls.length,1);
  assert.equal(h.receipts('A').find(receipt=>receipt.messageId===item.messageId).recipients[0].phase,'cancelled');
});
