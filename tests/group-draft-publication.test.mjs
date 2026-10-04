import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { Window } from "happy-dom";
import { continuityHarness, deferred, until } from "./helpers/continuity-harness.mjs";
import { conversationLibrarySnippet } from "../scripts/lib/conversation-library-renderer-patch.mjs";

const proposals = [
  { type: "email-draft", draft: { to: ["b@example.test"], subject: "@B @Ghost (pass)", body: "(pass)\n@B @Ghost\nhttps://draft.example.test/private" } },
  { type: "slack-draft", draft: { target: "C123456789", body: "(pass)\n@B @Ghost\nhttps://draft.example.test/private" } },
];
const publicEntries = h => h.entries("room").filter(entry => entry.kind === "send-message");
async function executeProposal(h, call, message, id) {
  const tool = h.runtime.createSendMessageTool({ getIngestAttachment: () => undefined,
    onSendMessage: value => call.publish(value) });
  const handler = { emitPartialToolCall() {}, executeToolCall: (ctx, _initial, _id, execute) => execute(ctx) };
  const args = (async function* () { yield JSON.stringify(message); })();
  const result = await tool.execute(h.runtime.createContext(), handler, args, { toolCallId: id });
  assert.equal(result.result.case, "success");
  return result.result.value.messageId;
}
async function assertNoLibraryDrafts(t, entries) {
  const window = new Window({ url: "https://beebot.local" });
  t.after(() => window.happyDOM.close());
  window.eval(conversationLibrarySnippet);
  window.snapshot = { entries };
  assert.equal(window.eval('RProjectConversationLibrary(window.snapshot,"room").length'), 0,
    "a delivered draft proposal is not a delivered external artifact/link");
}

for (const proposal of proposals) test(`actual Group ${proposal.type}: first/second/third real SendMessage cards persist while human follow-ups arrive`, async t => {
  const gate = deferred(); t.after(gate.resolve); let h, turn = 0; const receipts = [];
  h = await continuityHarness(t, { runMember: async call => {
    if (++turn === 1) {
      for (let index = 0; index < 3; index++) {
        const version = { ...proposal, draft: { ...proposal.draft, body: `${proposal.draft.body}\nProposal ${index + 1}` } };
        receipts.push(await executeProposal(h, call, version, `proposal-${index}`));
        if (index === 0) await gate.promise;
      }
    }
    return [];
  } });
  await h.send("@{a} Prepare an external draft for my review.");
  await until(() => receipts.length === 1);
  await h.send("@{a} Keep the proposed target unchanged.");
  await h.send("@{a} Retain my latest boundary.");
  assert.ok(h.tm.runLifecycle.inFlightRunCounts.size > 0);
  gate.resolve(); await h.drain();
  const entries = publicEntries(h);
  assert.equal(entries.length, 3); assert.equal(new Set(receipts).size, 3);
  assert.ok(receipts.every(id => typeof id === "string" && id));
  assert.deepEqual(entries.map(entry => entry.id), receipts);
  assert.ok(entries.every(entry => entry.message.type === proposal.type && entry.author.id === "a"));
  assert.ok(entries.every(entry => entry.draftDelivery === undefined), "proposal publication never performs or confirms an external send");
  assert.deepEqual(entries.map(entry => entry.message.draft), [0, 1, 2].map(index => ({ ...proposal.draft, body: `${proposal.draft.body}\nProposal ${index + 1}` })));
  assert.ok(h.calls.every(call => call.id === "a"), "external draft data never addresses or wakes Bot B/Ghost");
  assert.ok(h.calls.length >= 2, "the second and third human messages continue after the running turn");
  assert.deepEqual(h.errors, []);
  const history = h.tm.groupChat.readGroupHistory(h.sessions.get("room")).filter(message => receipts.includes(message.id));
  assert.equal(history.length, 3);
  for (const item of history) {
    assert.equal(item.awaitingUser, true); assert.equal(item.speaker.id, "a");
    assert.match(item.content, /draft proposal for user confirmation\. Publishing the proposal does not send it externally/);
    assert.doesNotMatch(item.content, /@B|@Ghost|draft\.example|\(pass\)/);
  }
  const delivery = h.records("room").find(record => entries[0].replyTo === record.id);
  assert.equal(delivery.state, "replied"); assert.deepEqual(delivery.responses.a, receipts);
  assert.equal(h.entries("room").filter(entry => entry.kind === "message" && entry.role === "user").length, 3);
  await assertNoLibraryDrafts(t, h.entries("room"));
});

test("a human quote of a Group draft routes to its real author and never treats draft data as a peer assignment", async t => {
  let h, receipt, turn = 0;
  h = await continuityHarness(t, { runMember: async call => {
    if (++turn === 1) receipt = await executeProposal(h, call, proposals[0], "original-draft");
    return [];
  } });
  await h.send("@{a} Prepare a draft."); await h.drain();
  await h.send("Please revise this proposal within the original boundary.", "room", { replyToId: receipt }); await h.drain();
  assert.deepEqual(h.calls.map(call => call.id), ["a", "a"]);
  assert.match(h.calls[1].prompt, /Email draft proposal for user confirmation\. Publishing the proposal does not send it externally/);
  assert.doesNotMatch(h.calls[1].prompt, /@Ghost|draft\.example/);
  assert.deepEqual(h.errors, []); assert.equal(publicEntries(h).length, 1);
});

test("Group draft SendMessage has no success receipt or public card when the durable write fails", async t => {
  let h, rejected = false;
  h = await continuityHarness(t, { runMember: async call => {
    const db = h.sessions.get("room").db; db.durable = false;
    try { await assert.rejects(executeProposal(h, call, proposals[1], "failed-draft"), /Group message was not saved/); rejected = true; }
    finally { db.durable = true; }
    return [];
  } });
  await h.send("@{a} Prepare a draft."); await h.drain();
  assert.equal(rejected, true); assert.equal(publicEntries(h).length, 0); assert.deepEqual(h.errors, []);
  assert.equal(h.events.some(event => event.entry?.kind === "send-message"), false);
});

test("a removed Group draft author cannot publish a card or obtain a success receipt", async t => {
  const gate = deferred(); t.after(gate.resolve); let h, rejected = false;
  h = await continuityHarness(t, { runMember: async call => {
    await gate.promise;
    await assert.rejects(executeProposal(h, call, proposals[0], "removed-author"), error => error.code === "unknown_group_member");
    rejected = true; return [];
  } });
  await h.send("@{a} Prepare a draft."); await until(() => h.calls.length === 1);
  h.runtime.writeSandGroupConfig(path.dirname(h.sessions.get("room").dbPath), { version: 1, memberIds: ["b"] });
  gate.resolve(); await h.drain();
  assert.equal(rejected, true); assert.equal(publicEntries(h).length, 0); assert.deepEqual(h.errors, []);
});
