import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { patchPresenceCreatePicker } from "../scripts/lib/presence-create-picker-patch.mjs";

const native = await readFile(new URL("../scripts/lib/sand-create-overlay.snippet.js", import.meta.url), "utf8");
const groupMarker = "window.__sandPickCreateGroup=async function({onCreate}={}){";
const patched = patchPresenceCreatePicker(native);
const bundle = await build({ bundle: true, write: false, format: "iife", globalName: "AvatarRig", platform: "browser", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' }, stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import * as React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {mountAvatarPicker} from './frontend/src/presence/avatar-picker';
import {CreateBotSheet} from './frontend/src/recovered/features/roster/create-bot-sheet';
export {mountAvatarPicker};
export function mountSheet(host){const root=createRoot(host);let language='zh',vendors=[{id:'api-1',label:'Test API'}],drafts=[];
 const render=()=>flushSync(()=>root.render(<CreateBotSheet language={language} vendors={vendors} onCancel={()=>{}} onCreate={draft=>drafts.push(draft)}/>));render();
 return{drafts,update(next){language=next.language??language;vendors=next.vendors??vendors;render()},click(node){flushSync(()=>node.click())},unmount(){flushSync(()=>root.unmount())}}}
` } });
function rig(t) {
  const window = new Window({ url: "https://beebot.test", settings: { enableJavaScriptEvaluation: true } });
  window.console.timeStamp = () => {};
  const errors = []; window.addEventListener("error", event => errors.push(event.message));
  window.document.body.innerHTML = '<main></main><input id="existing-draft" value="Keep this draft">';
  window.eval(bundle.outputFiles[0].text + ";window.AvatarRig=AvatarRig;window.RPresenceUI=AvatarRig");
  t.after(async () => { window.document.getElementById("sand-create-bot-sheet")?.__sandDismiss?.(); await window.happyDOM.close(); });
  return { window, document: window.document, host: window.document.querySelector("main"), api: window.AvatarRig, errors };
}
const clean = value => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const choose = (host, kind, value) => host.querySelector(`[data-kind="${kind}"] [data-value="${value}"]`);

test("creation picker exposes eight distinct shapes and eleven original colors without a second action system", t => {
  const { host, api, errors } = rig(t); const changed = [];
  const picker = api.mountAvatarPicker(host, { shape: "blob", color: "green", language: "zh", onChange: v => changed.push(v) }); t.after(() => picker.destroy());
  assert.equal(host.querySelectorAll('[data-kind="shape"] [role="radio"]').length, 8);
  assert.equal(host.querySelectorAll('[data-kind="color"] [role="radio"]').length, 11);
  assert.equal(new Set([...host.querySelectorAll('[data-kind="shape"] [data-part="body"]')].map(node => node.getAttribute("d"))).size, 8);
  assert.equal(host.querySelectorAll('[tabindex="0"]').length, 2);
  assert.equal(host.querySelectorAll("select").length, 0);
  assert.deepEqual(changed, []); assert.deepEqual(errors, []);
});

test("shape/color choices are independent across all 88 combinations and preserve the SVG and draft nodes", t => {
  const { host, document, api } = rig(t); let current;
  const picker = api.mountAvatarPicker(host, { shape: "blob", color: "green", language: "en", onChange: v => { current = v; } }); t.after(() => picker.destroy());
  const svg = host.querySelector(".bb-avatar-picker__preview svg"), eyes = svg.querySelector(".bb-character__eyes"), input = document.querySelector("input");input.focus();
  for (const shape of ["blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"]) for (const color of ["black", "brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray"]) {
    choose(host, "shape", shape).click(); choose(host, "color", color).click();
    assert.deepEqual(clean(current), { shape, color });
    assert.equal(choose(host, "shape", shape).getAttribute("aria-checked"), "true");
    assert.equal(choose(host, "color", color).getAttribute("aria-checked"), "true");
    assert.equal(host.querySelector(".bb-avatar-picker__preview svg"), svg); assert.equal(svg.querySelector(".bb-character__eyes"), eyes);
    assert.equal(document.querySelector("input"), input); assert.equal(input.value, "Keep this draft");
  }
});

test("keyboard, localization, pending lock and disposal preserve selection without creating a Bot", t => {
  const { host, window, api } = rig(t); const changed = [];
  const picker = api.mountAvatarPicker(host, { shape: "blob", color: "blue", language: "zh", onChange: v => changed.push(clean(v)) });
  const first = choose(host, "shape", "blob");first.focus();first.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.deepEqual(changed.at(-1), { shape: "pebble", color: "blue" });
  assert.equal(window.document.activeElement, choose(host, "shape", "pebble"));
  picker.setLanguage("en");assert.equal(host.querySelector('[data-kind="shape"]').getAttribute("aria-label"), "Shape");
  picker.setDisabled(true);choose(host, "color", "red").click();assert.equal(changed.length, 1);
  assert.equal(host.querySelectorAll('[role="radio"]:disabled').length, 19);
  picker.setDisabled(false);const color = choose(host, "color", "red");color.click();assert.deepEqual(changed.at(-1), { shape: "pebble", color: "red" });
  picker.destroy();picker.destroy();color.click();assert.equal(changed.length, 2);assert.equal(host.children.length, 0);
});

test("legacy shape identity survives color edits and remounting displays the same selection", t => {
  const { host, api } = rig(t); let draft;
  let picker = api.mountAvatarPicker(host, { shape: "hex", color: "green", language: "en", onChange: v => { draft = clean(v); } });
  assert.equal(choose(host, "shape", "hex").getAttribute("aria-checked"), "true");
  choose(host, "color", "blue").click();assert.deepEqual(draft, { shape: "hex", color: "blue" });picker.destroy();
  picker = api.mountAvatarPicker(host, { ...draft, language: "en", onChange: () => assert.fail("mount must not write preferences") });t.after(() => picker.destroy());
  assert.equal(choose(host, "shape", "hex").getAttribute("aria-checked"), "true");assert.equal(choose(host, "color", "blue").getAttribute("aria-checked"), "true");
});

test("actual React New Bot sheet submits selected identity and retains it on API and language refresh", t => {
  const { host, api, errors } = rig(t), app = api.mountSheet(host);t.after(() => app.unmount());
  const input = host.querySelector("input"), svg = host.querySelector(".bb-avatar-picker__preview svg");
  app.click(choose(host, "shape", "cloud"));app.click(choose(host, "color", "violet"));
  app.update({ language: "en", vendors: [{ id: "api-1", label: "Renamed API" }, { id: "api-2", label: "Other API" }] });
  assert.equal(host.querySelector("input"), input);assert.equal(host.querySelector(".bb-avatar-picker__preview svg"), svg);
  app.click([...host.querySelectorAll("button")].find(button => button.textContent.trim() === "Get started"));
  assert.deepEqual(clean(app.drafts), [{ name: "New Bot", avatarColor: "violet", avatarShape: "cloud", inferenceVendorId: "api-1" }]);assert.deepEqual(errors, []);
});

function nativeRig(t) {
  const context = rig(t), { window } = context;
  window.desktop = { agent: { getUiLanguage: async () => ({ language: "zh" }), getInferenceVendors: async () => ({ vendors: [{ id: "api-1", label: "Test API" }], defaultVendorId: "api-1" }) }, nodes: { onChanged: () => () => {} } };
  window.__beebotServerBots = { listServers: async () => [{ id: "server-1", name: "Server", status: "online" }] };
  // Execute actual New Bot code and its real modal helpers. No model/network calls.
  window.eval(patched.slice(0, patched.indexOf(groupMarker)));
  return context;
}

test("native New Bot exposes choices immediately and submits them without repainting the name field", async t => {
  const { window, document, errors } = nativeRig(t);
  const pending = window.__sandPickCreateBot({ name: "Daily helper" });await tick();
  const host = document.getElementById("sand-create-bot-sheet"), input = host.querySelector('[data-create-field="name"]');
  assert.equal(host.querySelector("details"), null);assert.equal(host.querySelectorAll('[role="radio"]').length, 19);
  input.value = "生活助手";input.dispatchEvent(new window.Event("input", { bubbles: true }));
  choose(host, "shape", "wedge").click();choose(host, "color", "cyan").click();
  assert.equal(host.querySelector('[data-create-field="name"]'), input);assert.equal(input.value, "生活助手");
  host.querySelector('[data-create-field="submit"]').click();
  const result = await pending;assert.equal(result.name, "生活助手");assert.equal(result.avatarShape, "wedge");assert.equal(result.avatarColor, "cyan");
  assert.equal(document.querySelector(".bb-avatar-picker"), null);assert.deepEqual(errors, []);
});

test("native pending failure locks appearance then preserves it for retry", async t => {
  const { window, document } = nativeRig(t); let reject;
  const pending = window.__sandPickCreateBot({}, { onCreate: () => new Promise((_, fail) => { reject = fail; }) });await tick();
  const host = document.getElementById("sand-create-bot-sheet");choose(host, "shape", "tablet").click();choose(host, "color", "blue").click();
  host.querySelector('[data-create-field="submit"]').click();await tick();assert.equal(host.querySelectorAll('[role="radio"]:disabled').length, 19);
  reject(new Error("Test failure"));await tick();assert.equal(host.querySelectorAll('[role="radio"]:disabled').length, 0);
  assert.equal(choose(host, "shape", "tablet").getAttribute("aria-checked"), "true");assert.equal(choose(host, "color", "blue").getAttribute("aria-checked"), "true");
  host.__sandDismiss();assert.equal(await pending, null);
});

test("native remote request keeps selected shape and color through server selection", async t => {
  const { window, document } = nativeRig(t);const requests=[];
  window.__sandCreateAgent = async value => { requests.push(clean(value)); };
  const pending=window.__sandPickCreateBot({name:"Remote helper"});await tick();
  let host=document.getElementById("sand-create-bot-sheet");choose(host,"shape","pebble").click();choose(host,"color","magenta").click();
  const server=host.querySelector('[data-create-field="deployment"]');server.value="server-1";server.dispatchEvent(new window.Event("change",{bubbles:true}));
  host.querySelector('[data-create-field="submit"]').click();await pending;
  assert.equal(requests.length,1);assert.equal(requests[0].avatarShape,"pebble");assert.equal(requests[0].avatarColor,"magenta");assert.equal(requests[0].deploymentServerId,"server-1");
});

test("native patch is scoped, preserves Group and transport code, and fails on unknown anchors", () => {
  assert.equal(patched.slice(patched.indexOf(groupMarker)), native.slice(native.indexOf(groupMarker)));
  for (const line of native.split("\n").filter(line => line.includes("const draft=") || line.includes("const remote=") || line.includes("await onCreate(draft)") || line.includes("await window.__sandCreateAgent"))) assert.ok(patched.includes(line));
  assert.throws(() => patchPresenceCreatePicker(native.replace("  let appearanceOpen=false;", "  let appearanceOpen=true;")), /anchor mismatch/);
  assert.throws(() => patchPresenceCreatePicker(patched), /anchor mismatch/);
  assert.throws(() => patchPresenceCreatePicker(native + native), /boundary mismatch/);
});
