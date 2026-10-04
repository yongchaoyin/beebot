import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "acorn";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { patchOriginalLanding } from "../scripts/lib/router-renderer-patch.mjs";

const original = await readFile(new URL("../src/app/dist/renderer/assets/index-UbX-y3il.js", import.meta.url), "utf8");
const patched = patchOriginalLanding(original);
function declarations(source) {
  const functions = new Map(), constants = new Map();
  for (const node of parse(source, { ecmaVersion: "latest", sourceType: "module" }).body) {
    if (node.type === "FunctionDeclaration") functions.set(node.id.name, source.slice(node.start, node.end));
    if (node.type === "VariableDeclaration") for (const part of node.declarations) {
      if (part.id.type === "Identifier") constants.set(part.id.name, `const ${source.slice(part.start, part.end)};`);
    }
  }
  return { functions, constants };
}
const upstream = declarations(original), shipped = declarations(patched);
const functions = ["oPe", "gMn", "yMn", "kMn", "hme", "aln", "eIe", "oln", "yct", "REn", "JZ", "Tpe", "Doe", "WTe", "ePe", "uGe", "QAe", "L2e", "AEn", "jht", "DEn", "pMn", "Rde", "fm", "Ott", "xEn", "qht", "Z5e", "IEn", "CEn", "jEn", "_tt", "cGe", "KAe", "bEn", "Lht", "YAe"];
const extracted = functions.map(name => {
  assert.ok(shipped.functions.has(name), `actual pinned renderer has ${name}`);
  return shipped.functions.get(name);
}).join("\n");
const constants = ["Bht", "JGe", "EEn", "vEn", "vbe"].map(name => {
  assert.ok(shipped.constants.has(name), `actual pinned renderer has ${name}`);
  return shipped.constants.get(name);
}).join("\n");
const css = await readFile(new URL("../frontend/src/presence/chat-density.css", import.meta.url), "utf8");
const bundle = await build({
  bundle: true, write: false, format: "iife", globalName: "AvatarPositionTest", platform: "browser", target: "chrome136", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  stdin: { resolveDir: process.cwd(), sourcefile: "actual-avatar-position-harness.tsx", loader: "tsx", contents: `
    import * as React from "react";
    import { createRoot } from "react-dom/client";
    import { flushSync } from "react-dom";
    import { c } from "react/compiler-runtime";
    import * as p from "react/jsx-runtime";
    export function mount(host, initial) {
      const root=createRoot(host), selected=[];
      let config={roster:[],agentId:"single-bot",isReadOnly:false,...initial}, rows=[];
      const he={c}, Ra=()=>config.roster, zde=()=>({selfAuthId:"self"});
      const selectAgent=id=>selected.push(id);
      const r1=()=>({...config,selectAgent});
      const re=(...names)=>names.filter(Boolean).join(" ");
      // Only leaf drawing, text, and the error boundary are controlled. Author
      // resolution, adjacency, wrappers, name buttons, and compiled memo hooks
      // below are the actual shipped components and helpers.
      const ml=({agent})=><img data-avatar-id={agent.id} data-avatar-color={agent.avatarColor} src={agent.avatarDataUrl||undefined}/>;
      const Iee=({avatarKey,dataUrl})=><img data-avatar-id={avatarKey} src={dataUrl||undefined}/>;
      const vt=({children,className})=><span className={className}>{children}</span>;
      const lme=({children})=><div data-boundary="transcript-row">{children}</div>;
      const IIn=({entry,adjacency})=><article data-message-id={entry.id} data-continued={String(adjacency.isContinuedToNext)}>{entry.content??entry.message?.content}</article>;
      const hMn=({entries})=><article>{entries.length} attachments</article>;
      const upt=({label})=><time>{label}</time>;
      const vpt=()=>null, ZPn=()=>null;
      ${constants}
      ${extracted}
      ${upstream.functions.get("oPe").replace("function oPe(", "function upstreamRow(")}
      return {
        render(nextRows, options={}) {
          rows=nextRows; config={...config,...options};
          const Row=config.originalPosition?upstreamRow:oPe;
          flushSync(()=>root.render(<>{rows.map((row,index)=><section key={row.entry?.id??index} data-row={row.entry?.id??row.kind}>{React.createElement(Row,{rows,index,staleWidgetIds:new Set(),isIndicatorTrailing:config.isIndicatorTrailing??false})}</section>)}</>));
        },
        selected:()=>selected,
        unmount:()=>flushSync(()=>root.unmount()),
      };
    }
  ` },
});
const code = bundle.outputFiles[0].text;
function rig(t, config = {}) {
  const window = new Window({ settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  window.console.timeStamp = () => {};
  const errors = [];
  window.addEventListener("error", event => errors.push(event.message));
  window.document.documentElement.dataset.beebotTheme = "presence";
  const style = window.document.createElement("style"); style.textContent = css; window.document.head.append(style);
  const host = window.document.createElement("main"); window.document.body.append(host);
  window.eval(code + "\nwindow.AvatarPositionTest=AvatarPositionTest;");
  const app = window.AvatarPositionTest.mount(host, config);
  t.after(() => { app.unmount(); window.happyDOM.close(); assert.deepEqual(errors, []); });
  const avatarRows = () => [...host.querySelectorAll("section")].filter(row => row.querySelector("[data-avatar-id]")).map(row => row.dataset.row);
  return { window, host, app, avatarRows };
}
const bot = { id: "bot-a", name: "Research colleague", avatarColor: "green", avatarShape: "cloud", avatarDataUrl: "data:image/png;base64,cGhvdG8=" };
const peer = { id: "bot-b", name: "Design colleague", avatarColor: "violet", avatarShape: "squircle" };
const send = (id, author = { id: bot.id, name: "Old display name" }, extra = {}) => ({ kind: "entry", entry: { kind: "send-message", id, author, message: { type: "text", content: `Message ${id}` }, ...extra } });
const human = (id, fromUser) => ({ kind: "entry", entry: { kind: "message", role: "user", id, content: `Message ${id}`, fromUser } });

test("the upstream renderer reproduces the tail-avatar bug with the same real component harness", t => {
  const r = rig(t, { roster: [bot], originalPosition: true });
  r.app.render([send("first"), send("second"), send("third")]);
  assert.deepEqual(r.avatarRows(), ["third"]);
  r.app.render([send("first"), send("second"), send("third")], { originalPosition: false });
  assert.deepEqual(r.avatarRows(), ["first"]);
});

for (const surface of ["single", "group"]) test(`${surface}: the very first avatar stays on the first message through second and third sends`, t => {
  const r = rig(t, { roster: [bot, peer], agentId: surface === "single" ? bot.id : "group-work" });
  const first = send("first");
  r.app.render([first]);
  assert.deepEqual(r.avatarRows(), ["first"]);
  const initialAvatar = r.host.querySelector("[data-avatar-id]");
  r.app.render([first, send("second")]);
  assert.deepEqual(r.avatarRows(), ["first"]);
  r.app.render([first, send("second"), send("third")]);
  assert.deepEqual(r.avatarRows(), ["first"]);
  assert.equal(r.host.querySelector("[data-avatar-id]"), initialAvatar, "appending messages must not move/remount the first avatar");
  assert.equal(initialAvatar.dataset.avatarId, bot.id);
  assert.equal(initialAvatar.getAttribute("src"), bot.avatarDataUrl);
  assert.equal(r.host.querySelectorAll(".sand-group-author").length, 1);
  assert.equal(r.host.querySelector(".sand-group-author").textContent, bot.name);
  r.host.querySelector(".sand-group-author").click();
  assert.deepEqual(Array.from(r.app.selected()), [bot.id]);
});

test("a running trailing indicator neither moves nor hides an established first-row avatar", t => {
  const r = rig(t, { roster: [bot] });
  const rows = [send("first"), send("second"), send("streaming", undefined, { streaming: true })];
  r.app.render(rows, { isIndicatorTrailing: true });
  assert.deepEqual(r.avatarRows(), ["first"]);
  const avatar = r.host.querySelector("[data-avatar-id]");
  r.app.render([rows[0], rows[1], send("streaming")], { isIndicatorTrailing: false });
  assert.deepEqual(r.avatarRows(), ["first"]);
  assert.equal(r.host.querySelector("[data-avatar-id]"), avatar);
});

test("each genuine change of author starts a new avatar run, including after a timestamp", t => {
  const r = rig(t, { roster: [bot, peer], agentId: "group-work" });
  r.app.render([send("a1"), send("a2"), send("b1", peer), send("b2", peer), { kind: "timestamp", timestampMs: 0, label: "Earlier" }, send("a3"), send("a4")]);
  assert.deepEqual(r.avatarRows(), ["a1", "b1", "a3"]);
  assert.deepEqual([...r.host.querySelectorAll(".sand-group-author")].map(node => node.textContent), [bot.name, peer.name, bot.name]);
  assert.deepEqual([...r.host.querySelectorAll("[data-avatar-id]")].map(node => node.dataset.avatarId), [bot.id, peer.id, bot.id]);
});

test("human name and photo stay with the first row and read-only mode does not create navigation", t => {
  const user = { authId: "human-1", name: "Human teammate", avatarUrl: "data:image/png;base64,aHVtYW4=" };
  const r = rig(t, { roster: [bot], agentId: "group-work", isReadOnly: true });
  r.app.render([human("h1", user), human("h2", user), send("bot-reply")]);
  assert.deepEqual(r.avatarRows(), ["h1", "bot-reply"]);
  const first = r.host.querySelector('[data-row="h1"]');
  assert.equal(first.querySelector("[data-avatar-id]").dataset.avatarId, user.authId);
  assert.equal(first.querySelector("[data-avatar-id]").getAttribute("src"), user.avatarUrl);
  assert.equal(first.querySelector(".sand-group-author").textContent, user.name);
  assert.equal(r.host.querySelectorAll(".sand-group-author button,button.sand-group-author").length, 0);
});

test("genuine unknown authors remain unwrapped without a fabricated name or avatar", t => {
  const r = rig(t, { roster: [bot] });
  r.app.render([send("unknown", null), { kind: "entry", entry: { kind: "message", id: "assistant-no-author", role: "assistant", content: "Unattributed legacy answer" } }]);
  assert.equal(r.host.querySelectorAll("article").length, 2);
  assert.equal(r.host.querySelectorAll(".sand-author-run").length, 0);
  assert.equal(r.host.querySelectorAll(".sand-group-author,[data-avatar-id]").length, 0);
});

test("the real first-row gutter computes top alignment and original adjacency remains intact", t => {
  const r = rig(t, { roster: [bot] });
  r.app.render([send("top"), send("bottom")]);
  const gutter = r.host.querySelector('[data-row="top"] .sand-author-run__gutter');
  assert.ok(gutter.querySelector("[data-avatar-id]"));
  assert.equal(r.window.getComputedStyle(gutter).alignSelf, "flex-start");
  assert.equal(shipped.functions.get("REn"), upstream.functions.get("REn"), "bubble adjacency itself is unchanged");
  assert.equal(shipped.functions.get("gMn"), upstream.functions.get("gMn"), "identity, photo, name and selection rules are unchanged");
});
