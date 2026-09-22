import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Window } from "happy-dom";

const tick = () => new Promise(resolve => setTimeout(resolve, 15));

test("real transcript retains its DOM, closes menus and separates uncertain from retryable delivery", async () => {
  const compiled = await build({
    stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client"; import {flushSync} from "react-dom";
      import {ConversationTranscript} from "./frontend/src/recovered/features/conversation/workspace/transcript";
      const root=createRoot(document.getElementById("root")); const events=[]; const original={kind:"message",id:"stable",role:"user",author:"You",text:"Keep this message",timestampMs:1,clientNonce:"nonce"};
      window.fixture={events,render(delivery){flushSync(()=>root.render(<ConversationTranscript entries={[{...original,delivery}]} onReply={()=>events.push("reply")} onCopyMessage={()=>events.push("copy")} onResendFailedSend={()=>events.push("resend")} onCancelQueuedSend={()=>events.push("cancel")} onCheckSendReceipt={async()=>{events.push("check");throw Error("Receipt still unknown; nothing resent.")}} />));},unmount(){flushSync(()=>root.unmount());}};`,
      resolveDir: process.cwd(), loader: "tsx", sourcefile: "honeyline-message-test.tsx" },
    outfile: "/tmp/beebot-lifecycle-test.js", bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent", define: { "process.env.NODE_ENV": '"development"' },
  });
  const window = new Window({ url: "http://127.0.0.1/" });
  const errors = [];
  // happy-dom lacks this optional browser profiling hook used by React dev.
  window.console.timeStamp = () => {};
  window.console.error = (...args) => errors.push(args.map(String).join(" "));
  window.document.body.innerHTML = '<input aria-label="Draft" value="draft stays"><div id="root"></div>';
  try {
    window.eval(compiled.outputFiles.find(file => file.path.endsWith(".js")).text);
    const fixture = window.fixture, document = window.document;
    fixture.render("sent"); await tick();
    const anchor = document.querySelector(".sand-message-action-anchor");
    const message = document.querySelector(".sand-message");
    assert.ok(anchor); assert.ok(message);
    const trigger = document.querySelector('[aria-label="More message actions"]');
    trigger.click(); await tick(); assert.ok(document.querySelector('[role="menu"]'));
    const draft = document.querySelector("input"); draft.focus();
    for (const phase of ["queued", "pending", "failed", "uncertain", "sent", "queued", "sent"]) {
      fixture.render(phase); await tick();
      assert.equal(document.querySelector(".sand-message-action-anchor"), anchor, `anchor retained in ${phase}`);
      assert.equal(document.querySelector(".sand-message"), message, `body retained in ${phase}`);
      assert.equal(document.querySelector('[role="menu"]'), null, "stale menu cannot survive loss of eligibility");
      assert.equal(document.activeElement, draft); assert.equal(draft.value, "draft stays");
      assert.equal(document.querySelector('[role="toolbar"]') != null, phase === "sent");
      assert.equal([...document.querySelectorAll("button")].some(x => x.textContent === "Resend"), phase === "failed");
    }
    fixture.render("uncertain"); await tick();
    const check = [...document.querySelectorAll("button")].find(x => x.textContent === "Check receipt");
    assert.ok(check); check.click(); await tick(); await tick();
    assert.deepEqual([...fixture.events], ["check"]);
    assert.match(document.querySelector('[role="status"]').textContent, /nothing resent/);
    assert.equal(errors.length, 0, errors.join("\n"));
    fixture.unmount();
  } finally { await window.happyDOM.close(); }
});
