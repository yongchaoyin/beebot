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
for (const status of ["queued", "running", "cancelling"]) test(`editable drafts do not amend or create tasks while work is ${status}`, async t => {
  const ui = await boot(t, status);
  ui.controller.setDraft("请保持原来的 UI 风格");
  await ui.controller.send(ui.state().draft);
  assert.equal(ui.sends().length, 0);
  assert.equal(ui.state().draft, "请保持原来的 UI 风格");
  assert.match(ui.state().error, /draft was not sent/);
  await ui.open("b"); ui.controller.setDraft("B independent draft");
  await ui.open("a"); assert.equal(ui.state().draft, "请保持原来的 UI 风格");
  ui.work.status = "review"; await ui.controller.refresh();
  assert.equal(ui.sends().length, 0, "completion does not auto-send a draft");
  await ui.controller.send(ui.state().draft);
  assert.equal(ui.sends().length, 1, "only an explicit later send creates new work");
});

test("offline drafts stay editable and are never sent automatically after reconnect", async t => {
  const ui = await boot(t, null);
  ui.profiles[0].status = "signed-out"; await ui.controller.refresh();
  ui.controller.setDraft("尚未发送"); await ui.controller.send("尚未发送");
  assert.equal(ui.sends().length, 0);
  ui.profiles[0].status = "online"; await ui.controller.refresh();
  assert.equal(ui.state().draft, "尚未发送"); assert.equal(ui.sends().length, 0);
});
