import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { transform } from "esbuild";
import { Window } from "happy-dom";
import { buildNodeChat } from "../scripts/lib/build-node-chat.mjs";

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

test("packaged source chat keeps remote actions on the selected Bot and hides unsupported local controls", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "beebot-chat-component-"));
  const window = new Window({ url: "https://beebot.local/renderer/index.html" });
  let cleanup;
  try {
    await buildNodeChat({ assetsRoot: directory });
    const css = await readFile(path.join(directory, "beebot-node-chat.css"), "utf8");
    assert.ok(css.startsWith("@scope (#beebot-node-chat) {"));
    assert.doesNotMatch(css, /@font-face|@property/);
    const source = await readFile(path.join(directory, "beebot-node-chat.js"), "utf8");
    const converted = await transform(source, { format: "iife", globalName: "NodeChatTest", define: { "import.meta.url": '"https://beebot.local/assets/beebot-node-chat.js"' } });
    window.eval(converted.code);
    const root = window.document.createElement("div");
    root.id = "beebot-node-chat";
    window.document.body.append(root);
    let snapshot = {
      active: true, connectionId: "server-b", bot: { id: "bot-b", name: "Remote Bot", avatarColor: "cyan", avatarShape: "cloud" },
      server: { name: "Docker B", baseUrl: "http://127.0.0.1:17432", status: "online" },
      messages: [{ id: "answer", role: "assistant", text: "The file is ready.", createdAt: 1000, goalId: "run-b", status: "review", version: 3 }],
      draft: "Please continue", busy: false, error: null, loading: false, runningGoal: null, uncertainGoal: null,
    };
    const listeners = new Set();
    const calls = [];
    const change = (patch) => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
    const store = {
      getSnapshot: () => snapshot, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      setDraft: (text) => change({ draft: text }),
      send: async (text) => { calls.push(["send", snapshot.connectionId, snapshot.bot.id, text]); change({ draft: "" }); },
      accept: async (...args) => { calls.push(["accept", ...args]); },
      stop: async (...args) => { calls.push(["stop", ...args]); },
      reconcile: async (...args) => { calls.push(["reconcile", ...args]); },
      reconnect: async () => { calls.push(["reconnect"]); }, close: () => {},
    };
    cleanup = window.NodeChatTest.mountNodeChat(root, store);
    await tick(); await tick();
    assert.equal(root.querySelector(".sand-chat-header")?.textContent, "Remote BotDocker B");
    assert.match(root.querySelector(".sand-virtual-transcript")?.textContent ?? "", /The file is ready/);
    assert.equal(root.querySelector('[aria-label="Attach file"]'), null);
    assert.equal(root.querySelector('[aria-label="Start voice input"]'), null);
    assert.equal(root.querySelector('[aria-label*="Computer"]'), null);
    assert.equal(root.querySelector('[type="file"]'), null);
    const complete = [...root.querySelectorAll("button")].find((button) => button.textContent === "Mark complete");
    assert.ok(complete); complete.click(); await tick();
    assert.deepEqual(calls[0], ["accept", "run-b", 3]);
    const send = root.querySelector('[aria-label="Send message"]');
    assert.ok(send); send.click(); await tick();
    assert.deepEqual(calls[1], ["send", "server-b", "bot-b", "Please continue"]);
    assert.equal(snapshot.draft, "");
    change({ runningGoal:{id:"existing",status:"running"}, draft:"Second question" });await tick();
    assert.equal(root.querySelector('[aria-label="Send message"]').disabled,false);
    assert.match(root.textContent,/New requests wait their turn/);
    change({runningGoal:null,draft:""});await tick();
    change({ connectionId: "server-a", bot: { id: "bot-a", name: "Other Bot" }, draft: "Keep this draft", messages: [], server: { ...snapshot.server, status: "reconnecting" } });
    await tick();
    assert.equal(root.querySelector('[aria-label="Send message"]').disabled, true);
    assert.match(root.textContent, /Server disconnected/);
    assert.equal(calls.length, 2, "switching the view must never send or accept work");
    assert.doesNotMatch(root.textContent, /The file is ready/);
    change({ server: { ...snapshot.server, status: "online" }, uncertainGoal: { id: "interrupted-a", version: 4 } });
    await tick();
    assert.equal(root.querySelector('[aria-label="Send message"]').disabled, true);
    assert.match(root.textContent, /Review interruption/);
    cleanup(); cleanup = undefined; await tick();
    assert.equal(listeners.size, 0);
    assert.equal(root.childElementCount, 0);
  } finally {
    cleanup?.();
    await window.happyDOM.close();
    await rm(directory, { recursive: true, force: true });
  }
});
