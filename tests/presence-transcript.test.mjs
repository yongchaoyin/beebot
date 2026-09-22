import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { buildPresenceTranscriptHarness } from "./helpers/presence-transcript-harness.mjs";
const code = await buildPresenceTranscriptHarness();
async function rig(t) {
  const window = new Window({ settings: { enableJavaScriptEvaluation: true } });
  t.after(() => window.happyDOM.close());
  // happy-dom lacks this browser-only React development profiling hook.
  window.console.timeStamp = () => {};
  const errors=[]; window.addEventListener("error",event=>errors.push(event.message));
  window.document.body.innerHTML='<main id="root"></main>';
  window.eval(code + "\nwindow.PresenceTestUI=PresenceTestUI;");
  const host=window.document.getElementById("root"); const app=window.PresenceTestUI.mountTranscript(host);
  t.after(()=>app.unmount());
  return {window,host,app,errors};
}
test("real React transcript keeps the same anchor and message through queued/pending/sent/failed", async t=>{
  const {host,app,errors}=await rig(t); const anchor=host.querySelector('.sand-message-action-anchor'), message=host.querySelector('.sand-message');
  assert.ok(anchor); assert.ok(message);
  for(const delivery of ['queued','pending','sent','failed','queued','sent']) {
    app.update({delivery});
    assert.equal(host.querySelector('.sand-message-action-anchor'),anchor,delivery);
    assert.equal(host.querySelector('.sand-message'),message,delivery);
    assert.equal(!!host.querySelector('[role="toolbar"]'),delivery==='sent');
  }
  assert.deepEqual(errors,[]);
});
test("real transcript unknown receipt has inline review but no blind resend",async t=>{
  const {window,host,app}=await rig(t); app.update({delivery:'failed',deliveryFailure:'unknown'});
  assert.match(host.textContent,/Delivery unconfirmed/);
  assert.ok(![...host.querySelectorAll('button')].some(b=>b.textContent==='Resend'));
  const click=text=>{const button=[...host.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(button,text);button.click()};
  click('Review queue'); await window.happyDOM.whenAsyncComplete();
  assert.match(host.textContent,/does not stop work already accepted/);
  click('Keep paused'); await window.happyDOM.whenAsyncComplete(); assert.equal(app.counts().deleted,0);
  click('Review queue'); await window.happyDOM.whenAsyncComplete(); click('Dismiss and continue queue');
  assert.equal(app.counts().deleted,1); assert.equal(app.counts().resent,0);
});
test("known unsent message exposes resend; read-only transitions do not remove the frame",async t=>{
  const {host,app,errors}=await rig(t); const anchor=host.querySelector('.sand-message-action-anchor');
  app.update({delivery:'failed',deliveryFailure:'rejected'});
  const resend=[...host.querySelectorAll('button')].find(b=>b.textContent==='Resend'); assert.ok(resend);resend.click();assert.equal(app.counts().resent,1);
  app.update({delivery:'sent'});app.readOnly(true);app.readOnly(false);
  assert.equal(host.querySelector('.sand-message-action-anchor'),anchor);assert.deepEqual(errors,[]);
});
test("live Chinese language changes preserve the frame and localize safe recovery",async t=>{
  const {window,host,app}=await rig(t); const frame=host.querySelector('.sand-message-action-anchor');
  app.update({delivery:'failed',deliveryFailure:'unknown'});
  window.__sandUiLanguage='zh';window.dispatchEvent(new window.Event('sand-ui-language-changed'));await window.happyDOM.whenAsyncComplete();
  assert.match(host.textContent,/送达结果待确认/);assert.match(host.textContent,/核对队列/);
  assert.equal(host.querySelector('.sand-message-action-anchor'),frame);
  app.update({delivery:'queued'});assert.match(host.textContent,/尚未发送 · 排队等待/);
});
