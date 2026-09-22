import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadContinuityRuntime } from "./helpers/load-continuity-runtime.mjs";
import { createContinuityHarness, until } from "./helpers/continuity-harness.mjs";

const runtime = await loadContinuityRuntime({ after: callback => after(callback) });

test("real single-chat send boundary accepts three questions without interrupting or dropping any", async t => {
  const h = createContinuityHarness(t, runtime), gate = h.gate();
  h.select("A");
  h.hooks.set("A", async (call, publish) => { if (call.prompt === "First") await gate.promise; publish(`Answer ${call.prompt}`); });
  await h.send("A", "First"); await until(() => h.calls.length === 1);
  await h.send("A", "Second"); await h.send("A", "Third");
  assert.equal(h.calls.length, 1); assert.deepEqual(h.interruptions, []);
  assert.deepEqual(h.receipts("A").map(item => item.recipients[0].phase), ["processing", "queued", "queued"]);
  gate.resolve(); await h.idle();
  assert.deepEqual(h.calls.map(call => call.prompt), ["First", "Second", "Third"]);
  assert.deepEqual(h.receipts("A").map(item => item.recipients[0].phase), ["responded", "responded", "responded"]);
  assert.equal(h.entries("A").filter(entry => entry.kind === "send-message").length, 3);
});

test("an idle group colleague answers a second question while another member is still running", async t => {
  const h = createContinuityHarness(t, runtime), gate = h.gate();
  h.select("room");
  h.hooks.set("A", async (_call, publish) => { await gate.promise; publish("A answer"); });
  h.hooks.set("B", async (_call, publish) => publish("B answer"));
  await h.send("room", "@A First"); await until(() => h.calls.some(call => call.botId === "A"));
  await h.send("room", "@B Second");
  await until(() => h.entries("room").some(entry => entry.message?.content === "B answer"), "B must not wait for the previous room turn");
  assert.equal(h.entries("room").some(entry => entry.message?.content === "A answer"), false);
  assert.deepEqual(h.interruptions, []);
  gate.resolve(); await h.idle();
  const requests = h.entries("room").filter(entry => entry.role === "user");
  assert.deepEqual(requests.map(entry => entry.beebotDelivery.recipients[0].phase), ["responded", "responded"]);
});

test("third group message cannot supersede the second directed request", async t => {
  const h = createContinuityHarness(t, runtime), gate = h.gate();
  h.select("room");
  let first = true;
  h.hooks.set("A", async (call, publish) => {
    if (!call.prompt.includes("You were mentioned.")) { publish("(pass)"); return; }
    call.directedQuestion = true;
    if (first) { first = false; await gate.promise; } publish("A response");
  });
  h.hooks.set("B", async (call, publish) => publish(call.prompt.includes("You were mentioned.") ? "B response" : "(pass)"));
  await h.send("room", "@A First"); await until(() => h.calls.length > 0);
  await h.send("room", "@B Second"); await h.send("room", "@A Third");
  await until(() => h.calls.some(call => call.botId === "B")); gate.resolve(); await h.idle();
  const requests = h.entries("room").filter(entry => entry.role === "user");
  assert.deepEqual(requests.map(entry => entry.beebotDelivery.recipients[0].phase), ["responded", "responded", "responded"]);
  assert.equal(h.calls.filter(call => call.botId === "A" && call.directedQuestion).length, 2);
});

test("failed group member is visible without preventing later questions or other colleagues", async t => {
  const h = createContinuityHarness(t, runtime); h.select("room");
  h.hooks.set("A", async () => { throw new Error("simulated provider failure"); });
  h.hooks.set("B", async (_call, publish) => publish("Still working"));
  await h.send("room", "@A Question"); await h.idle();
  assert.equal(h.receipts("room")[0].recipients[0].phase, "failed");
  assert.ok(h.entries("room").some(entry => entry.beebotNotice));
  await h.send("room", "@B Next question"); await h.idle();
  assert.ok(h.entries("room").some(entry => entry.message?.content === "Still working"));
});

test("a direct message neither interrupts group work nor overlaps execution of the same Bot", async t => {
  const h = createContinuityHarness(t, runtime), gate = h.gate(); h.select("room");
  h.hooks.set("group:A", async (_call, publish) => { await gate.promise; publish("Group result"); });
  h.hooks.set("direct:A", async (_call, publish) => publish("Private answer"));
  await h.send("room", "@A Work"); await until(() => h.calls.length === 1);
  await h.send("A", "Private question");
  assert.equal(h.calls.length, 1); assert.deepEqual(h.interruptions, []);
  gate.resolve(); await h.idle();
  assert.equal(h.calls.filter(call => call.botId === "A").length, 2);
  assert.ok(h.entries("room").some(entry => entry.message?.content === "Group result"));
  assert.ok(h.entries("A").some(entry => entry.message?.content === "Private answer"));
  assert.equal(h.entries("room").some(entry => entry.message?.content === "Private answer"), false);
});

test("same client nonce retries coalesce; intentional identical messages retain separate identities", async t => {
  const h = createContinuityHarness(t, runtime), gate = h.gate(); h.select("A");
  h.hooks.set("A", async (_call, publish) => { await gate.promise; publish("Done"); });
  await h.send("A", "Same", { clientNonce: "stable" });
  await h.send("A", "Same", { clientNonce: "stable" });
  await h.send("A", "Same", { clientNonce: "different" });
  gate.resolve(); await h.idle();
  assert.equal(h.calls.length, 2); assert.equal(h.receipts("A").length, 2);
  await assert.rejects(h.send("A", "Different input", { clientNonce: "stable" }), /NONCE_DIGEST_MISMATCH/);
});

test("source message and pending recipients are stored in the same initial SQLite write", async t => {
  const h = createContinuityHarness(t, runtime); h.select("A");
  const db = h.sessions.get("A").db, append = db.appendTranscriptEntry.bind(db), snapshots = [];
  db.appendTranscriptEntry = entry => { if (entry.role === "user") snapshots.push(structuredClone(entry)); return append(entry); };
  await h.send("A", "Durable first"); await h.idle();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].beebotDelivery.recipients[0].phase, "queued");
  assert.equal(snapshots[0].beebotDelivery.input.prompt, "Durable first");
  assert.match(snapshots[0].beebotDelivery.inputDigest, /^[a-f0-9]{64}$/);
});

test("a durable echo survives a missing acceptance-file record without another execution", async t => {
  const h = createContinuityHarness(t, runtime); h.select("A");
  await h.send("A", "One external action", { clientNonce: "lost-acceptance" }); await h.idle();
  h.tm.acceptanceLedger.clear({ accountSlot: "host", clientNonce: "lost-acceptance" });
  assert.equal(h.tm.acceptanceLedger.lookup({ accountSlot: "host", clientNonce: "lost-acceptance" }).outcome, "not-found");
  const initial = h.entries("A").filter(entry => entry.role === "user");
  assert.equal(initial.length, 1);
  await h.send("A", "One external action", { clientNonce: "lost-acceptance" }); await h.idle();
  assert.equal(h.entries("A").filter(entry => entry.role === "user").length, 1);
  assert.equal(h.calls.length, 1);
});

test("failed durable storage rejects the send before any model or external work starts", async t => {
  const h = createContinuityHarness(t, runtime); h.select("A");
  const db = h.sessions.get("A").db, append = db.appendTranscriptEntry.bind(db);
  db.appendTranscriptEntry = entry => entry.role === "user" ? false : append(entry);
  await assert.rejects(h.send("A", "Must not run"), /persist|sav/i);
  assert.equal(h.calls.length, 0); assert.equal(h.entries("A").length, 0);
  db.appendTranscriptEntry = append;
  await h.send("A", "Now durable"); await h.idle(); assert.equal(h.calls.length, 1);
});

test("ambiguous or removed mentions are rejected before creating a misleading accepted message", async t => {
  const h = createContinuityHarness(t, runtime); h.select("room");
  await assert.rejects(h.send("room", "@{not-a-member} Please do this"), /not a member/);
  assert.equal(h.entries("room").filter(entry => entry.role === "user").length, 0);
  assert.equal(h.calls.length, 0);
});

test("a failed single Bot leaves an inline notice and accepts a later message", async t => {
  const h = createContinuityHarness(t, runtime); h.select("A");
  h.hooks.set("A", async () => { throw new Error("simulated model failure"); });
  await h.send("A", "First"); await h.idle();
  assert.equal(h.receipts("A")[0].recipients[0].phase, "failed");
  assert.ok(h.entries("A").some(entry => entry.beebotNotice?.code === "failed"));
  h.hooks.delete("A"); await h.send("A", "Second"); await h.idle();
  assert.equal(h.receipts("A")[1].recipients[0].phase, "responded");
});

test("explicitly stopping a single chat cancels its queue, not a new later message", async t => {
  const h = createContinuityHarness(t, runtime), gate = h.gate(); h.select("A");
  h.hooks.set("A", async (call, publish) => { if (call.prompt === "First") await gate.promise; publish(call.prompt); });
  await h.send("A", "First"); await until(() => h.calls.length === 1); await h.send("A", "Second");
  await runtime.stopConversation(h.tm, { agentId: "A" });
  gate.resolve(); await h.idle();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.receipts("A").map(record => record.recipients[0].phase), ["uncertain", "cancelled"]);
  await h.send("A", "New message after stop"); await h.idle();
  assert.equal(h.calls.length, 2); assert.equal(h.receipts("A").at(-1).recipients[0].phase, "responded");
});

test("stopping one group cannot interrupt the same colleague working in another group", async t => {
  const h = createContinuityHarness(t, runtime, { groups: { room: ["A", "B"], other: ["A", "B"] } }), gate = h.gate();
  h.select("other");
  h.hooks.set("A", async (_call, publish) => { await gate.promise; publish("Other-group result"); });
  await h.send("other", "@A First"); await until(() => h.calls.some(call => call.botId === "A"));
  await h.send("room", "@A Queued here");
  await runtime.stopConversation(h.tm, { agentId: "room" });
  assert.deepEqual(h.interruptions, []);
  gate.resolve(); await h.idle();
  assert.ok(h.entries("other").some(entry => entry.message?.content === "Other-group result"));
  assert.equal(h.entries("room").some(entry => entry.message?.content === "Other-group result"), false);
});

test("conversation switch during a slow reply preserves delivery in its original chat", async t => {
  const h = createContinuityHarness(t, runtime), gate = h.gate(); h.select("room");
  h.hooks.set("A", async (_call, publish) => { await gate.promise; publish("Room-only answer"); });
  await h.send("room", "@A Wait"); await until(() => h.calls.length === 1);
  h.select("B"); gate.resolve(); await h.idle();
  assert.ok(h.entries("room").some(entry => entry.message?.content === "Room-only answer"));
  assert.equal(runtime.getTranscript().some(entry => entry.message?.content === "Room-only answer"), false);
  assert.equal(h.entries("B").length, 0);
});

test("old process attempts become uncertain and are never replayed automatically", async t => {
  const h = createContinuityHarness(t, runtime); h.select("A");
  const session = h.sessions.get("A"), source = { id: "before-crash", kind: "message", role: "user", content: "External write", timestampMs: Date.now() };
  session.db.appendTranscriptEntry(source);
  const ledger = new runtime.ConversationDeliveries(h.tm, session);
  ledger.accept(source.id, ["A"], { prompt: "External write", attachmentPaths: [] });
  ledger.start(source.id, "A");
  session.db.updateTranscriptEntry(source.id, entry => ({ ...entry, beebotDelivery: { ...entry.beebotDelivery, recipients: entry.beebotDelivery.recipients.map(item => ({ ...item, owner: "previous-host-process" })) } }));
  await runtime.recoverConversationDeliveries(h.tm); await h.idle();
  assert.equal(ledger.read(source.id).recipients[0].phase, "uncertain");
  assert.equal(h.calls.length, 0);
  assert.ok(h.entries("A").some(entry => entry.beebotNotice?.code === "recovery-review"));
  await runtime.recoverConversationDeliveries(h.tm); await h.idle();
  assert.equal(h.calls.length, 0);
});

test("never-started durable single-chat input resumes once without duplicating its original echo", async t => {
  const h = createContinuityHarness(t, runtime); h.select("A");
  const session = h.sessions.get("A"), source = { id: "queued-before-restart", kind: "message", role: "user", content: "Pending question", timestampMs: Date.now() };
  session.db.appendTranscriptEntry(source);
  new runtime.ConversationDeliveries(h.tm, session).accept(source.id, ["A"], { prompt: "Pending question", attachmentPaths: [] });
  await runtime.recoverConversationDeliveries(h.tm); await h.idle();
  await runtime.recoverConversationDeliveries(h.tm); await h.idle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.entries("A").filter(entry => entry.role === "user").length, 1);
  assert.equal(h.receipts("A")[0].recipients[0].phase, "responded");
});

test("queued group messages resume their fixed recipients rather than the latest @ mention", async t => {
  const h = createContinuityHarness(t, runtime); h.select("room");
  const session = h.sessions.get("room"), ledger = new runtime.ConversationDeliveries(h.tm, session);
  for (const [id, botId] of [["queued-1", "B"], ["queued-2", "A"]]) {
    session.db.appendTranscriptEntry({ id, kind: "message", role: "user", content: `@${botId} Pending ${id}`, timestampMs: Date.now() });
    ledger.accept(id, [botId]);
    h.hooks.set(botId, async (call, publish) => publish(call.prompt.includes("You were mentioned.") ? `${botId} answered` : "(pass)"));
  }
  await runtime.recoverConversationDeliveries(h.tm); await h.idle();
  assert.equal(ledger.read("queued-1").recipients[0].phase, "responded");
  assert.equal(ledger.read("queued-2").recipients[0].phase, "responded");
  assert.equal(h.entries("room").filter(entry => entry.role === "user").length, 2);
});

test("stale completion tokens cannot overwrite a stopped or newer delivery", async t => {
  const h = createContinuityHarness(t, runtime), session = h.sessions.get("A");
  session.db.appendTranscriptEntry({ id: "source", kind: "message", role: "user", content: "Check", timestampMs: Date.now() });
  const ledger = new runtime.ConversationDeliveries(h.tm, session);
  ledger.accept("source", ["A"]); const token = ledger.start("source", "A");
  ledger.stop(); ledger.settle("source", "A", token, "responded", ["late-result"]);
  assert.equal(ledger.read("source").recipients[0].phase, "uncertain");
  ledger.settle("source", "A", "invented-token", "responded");
  assert.equal(ledger.read("source").recipients[0].phase, "uncertain");
});
