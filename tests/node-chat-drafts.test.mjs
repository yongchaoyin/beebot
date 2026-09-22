import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Window } from "./helpers/renderer-controller-window.mjs";

const source = await readFile(new URL("../scripts/lib/beebot-node-chat-controller.snippet.js", import.meta.url), "utf8");
async function boot(t, status) {
  const window = new Window(); t.after(() => window.close());
  const calls = [];
  const profiles = ["a", "b"].map(id => ({ id, nodeId: "node-" + id, name: id, status: "online" }));
  const work = { id: "g", botId: "bot", prompt: "Existing work", status, version: 1, createdAt: 1 };
  window.desktop = { nodes: {
    onChanged: () => () => {},
    async request(input) {
      calls.push({ ...input });
      if (input.action === "list") return structuredClone(profiles);
      if (input.action === "snapshot") return { node: { id: "node-" + input.id }, bots: [{ id: "bot", name: "同事" }], goals: input.id === "a" && work.status ? [structuredClone(work)] : [] };
      if (input.action === "submitGoal") return { goalId: "new" };
      throw new Error("Unexpected command: " + input.action);
    },
  } };
  window.eval(source); await Promise.resolve();
  const controller = window.__beebotNodeChat;
  const open = id => controller.open(id, { id: "bot", name: "同事" });
  await open("a");
  return { controller, profiles, work, open, state: () => controller.getSnapshot(), sends: () => calls.filter(c => c.action === "submitGoal") };
}
for (const status of ["queued", "running"]) test(`explicit follow-ups queue while remote work is ${status} without interrupting it`, async t => {
  const ui = await boot(t, status);
  for (const text of ["第二个问题", "第三个问题"]) { ui.controller.setDraft(text); await ui.controller.send(text); }
  assert.deepEqual(ui.sends().map(item=>item.prompt), ["第二个问题", "第三个问题"]);
  assert.equal(new Set(ui.sends().map(item=>item.key)).size, 2);
  assert.equal(ui.work.status, status, "ordinary sending does not cancel or amend the existing action");
  ui.controller.setDraft("仍未发送的草稿");await ui.open("b");ui.controller.setDraft("B independent draft");
  await ui.open("a");assert.equal(ui.state().draft,"仍未发送的草稿");
  ui.work.status="review";await ui.controller.refresh();assert.equal(ui.sends().length,2,"completion never auto-sends a draft");
});
test("remote cancellation must resolve before new work is submitted", async t => {
  const ui=await boot(t,"cancelling");ui.controller.setDraft("Later");await ui.controller.send("Later");
  assert.equal(ui.sends().length,0);assert.equal(ui.state().draft,"Later");assert.match(ui.state().error,/Stop is still being confirmed/);
});

test("offline drafts stay editable and are never sent automatically after reconnect", async t => {
  const ui = await boot(t, null);
  ui.profiles[0].status = "signed-out"; await ui.controller.refresh();
  ui.controller.setDraft("尚未发送"); await ui.controller.send("尚未发送");
  assert.equal(ui.sends().length, 0);
  ui.profiles[0].status = "online"; await ui.controller.refresh();
  assert.equal(ui.state().draft, "尚未发送"); assert.equal(ui.sends().length, 0);
});
