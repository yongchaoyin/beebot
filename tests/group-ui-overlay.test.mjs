import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function boot(rosterRows) {
  const overlay = await readFile(path.join(repoRoot, "scripts/lib/sand-create-overlay.snippet.js"), "utf8");
  const groupUi = await readFile(path.join(repoRoot, "scripts/lib/sand-group-ui.snippet.js"), "utf8");
  const paths = await readFile(path.join(repoRoot, "scripts/lib/persona-shape-paths.json"), "utf8");
  const window = new Window({ url: "https://beebot.local/" });
  const { document } = window;
  window.R_PATHS = JSON.parse(paths);
  window.__sandRoster = { snapshots: { get: () => ({ agents: { rows: rosterRows } }) } };
  window.__sandUiLanguage = "en";
  window.__sandGroupUiTest = true;
  const cut = overlay.indexOf("if(!window.__sandPlusMenuBound)");
  const helpers = overlay.slice(0, cut > 0 ? cut : overlay.indexOf("function MOn("));
  window.eval(`const R_PATHS=${paths};\n${helpers}\n${groupUi}`);
  return { window, document };
}

test("group rows get a Group badge, member names, and stacked faces", async () => {
  const { window, document } = await boot([
    { id: "g1", name: "Launch room", isGroup: true, memberIds: ["a", "b"] },
    { id: "a", name: "Writer", isGroup: false, avatarShape: "hex", avatarColor: "green" },
    { id: "b", name: "Reviewer", isGroup: false, avatarShape: "blob", avatarColor: "blue" },
  ]);
  const row = document.createElement("button");
  row.setAttribute("data-agent-id", "g1");
  row.innerHTML = `<span class="sand-agent-item__avatar"></span><span class="sand-agent-item__body"><span class="sand-agent-item__name">Launch room</span></span>`;
  document.body.append(row);
  window.eval("RRefreshGroups()");
  assert.equal(row.getAttribute("data-sand-kind"), "group");
  assert.equal(row.querySelector(".sand-beebot-group-badge")?.textContent, "Group");
  assert.match(row.querySelector(".sand-beebot-group-sub")?.textContent ?? "", /2 bots/);
  assert.match(row.querySelector(".sand-beebot-group-sub")?.textContent ?? "", /Writer/);
  assert.ok(row.querySelector(".sand-beebot-group-stack svg"));
  await window.happyDOM.close();
});

test("group member picker skips other groups", async () => {
  const { window, document } = await boot([
    { id: "g1", name: "Room", isGroup: true, memberIds: ["a"] },
    { id: "a", name: "Writer", isGroup: false },
    { id: "g2", name: "Other room", isGroup: true, memberIds: [] },
  ]);
  for (const id of ["g1", "a", "g2"]) {
    const el = document.createElement("div");
    el.setAttribute("data-agent-id", id);
    el.innerHTML = `<span class="name">${id}</span>`;
    document.body.append(el);
  }
  const listed = window.eval("RListAgents()");
  assert.equal(JSON.stringify([...listed].map((row) => String(row.id))), JSON.stringify(["a"]));
  await window.happyDOM.close();
});

test("open group paints a member bar and @ mention menu", async () => {
  const { window, document } = await boot([
    { id: "g1", name: "Launch room", isGroup: true, memberIds: ["a", "b"] },
    { id: "a", name: "Writer", isGroup: false },
    { id: "b", name: "Reviewer", isGroup: false },
  ]);
  const row = document.createElement("button");
  row.setAttribute("data-agent-id", "g1");
  row.setAttribute("aria-current", "true");
  row.innerHTML = `<span class="sand-agent-item__name">Launch room</span>`;
  document.body.append(row);
  const header = document.createElement("div");
  header.className = "sand-chat-header";
  document.body.append(header);
  window.eval("RRefreshGroups()");
  const bar = document.getElementById("sand-beebot-group-bar");
  assert.ok(bar);
  assert.match(bar.textContent ?? "", /Writer/);
  assert.match(bar.textContent ?? "", /take turns/);
  const area = document.createElement("textarea");
  document.body.append(area);
  area.value = "@Wr";
  area.dispatchEvent(new window.Event("input", { bubbles: true }));
  const mention = document.getElementById("sand-beebot-mention");
  assert.ok(mention);
  assert.match(mention.textContent ?? "", /@Writer/);
  await window.happyDOM.close();
});
