import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Window } from "happy-dom";
import { buildConversationUiFixture } from "./helpers/conversation-ui-fixture.mjs";

const wait = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(check) {
  for (let i = 0; i < 60; i++) { if (check()) return; await wait(); }
  assert.fail("Conversation component did not reach the expected state");
}

test("shipped conversation component exposes real pending states and scoped controls inline", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "beebot-ui-"));
  const window = new Window({ url: "https://beebot.local" });
  t.after(async () => { window.__fixtureActivityRoot?.unmount(); await window.happyDOM.close(); await rm(directory, { recursive: true, force: true }); });
  await buildConversationUiFixture(directory);
  const html = await readFile(path.join(directory, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script(?: src="([^"]+)")?>([\s\S]*?)<\/script>/g)];
  window.document.write(html.replace(/<script(?: src="[^"]+")?>[\s\S]*?<\/script>/g, ""));
  for (const [, source, content] of scripts) window.eval(source ? await readFile(path.join(directory, source), "utf8") : content);
  await until(() => window.document.querySelector(".bb-conversation-status"));
  const button = label => [...window.document.querySelectorAll(".bb-conversation-status button")].find(node => node.textContent === label);
  assert.equal(window.document.querySelector("dialog"), null);
  button("查看").click(); await until(() => button("取消尚未开始的处理"));
  button("取消尚未开始的处理").click(); await until(() => window.__fixtureCalls.length === 1);
  assert.deepEqual(JSON.parse(JSON.stringify(window.__fixtureCalls[0])), ["cancel", { agentId: "room", messageId: "q2", expectedRevision: 3 }]);
  await until(() => !button("停止本会话工作").disabled);
  button("引用追问").click(); assert.deepEqual(JSON.parse(JSON.stringify(window.__fixtureCalls[1])), ["reply", "q2"]);
  button("停止本会话工作").click(); await until(() => window.__fixtureCalls.length === 3);
  assert.deepEqual(JSON.parse(JSON.stringify(window.__fixtureCalls[2])), ["stop", { agentId: "room" }]);
  assert.equal(window.document.querySelector("dialog"), null);
  window.__sandUiLanguage = "en"; window.dispatchEvent(new window.Event("sand-ui-language-changed"));
  await until(() => button("Stop this conversation's work"));
  assert.match(window.document.querySelector(".bb-conversation-status").textContent, /Outcome unknown|waiting|processing/);
});
