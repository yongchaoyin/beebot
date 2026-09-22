import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildSync } from "esbuild";
import { Window } from "happy-dom";
import { presenceFromWork, normalizePresence, gazeOffset } from "../frontend/src/presence/state.ts";
import { workLabel } from "../frontend/src/honeyline/status.ts";
import { characterLayers, characterVariant, SHAPES } from "../frontend/src/presence/avatar-art.ts";

const cases = [
  ["empty is not evidence of work", {}, "idle"],
  ["stale activity is ignored", { isRunning: false, currentActivity: { verb: "searching" } }, "idle"],
  ["active run is thinking", { isRunning: true }, "thinking"],
  ["authoritative running phase", { workPhase: "running" }, "thinking"],
  ["composing wins over a stale tool", { isRunning: true, isComposingMessage: true, currentActivity: { verb: "searching" } }, "speaking"],
  ["boolean false is not a request", { awaitingUserResponse: false }, "idle"],
  ["actual request is attention", { awaitingUserResponse: { id: "approval" }, isComposingMessage: true }, "needs_user"],
  ["colleague wait is not user input", { waiting: { kind: "agent", targetName: "Kai" }, awaitingUserResponse: true }, "waiting"],
  ["resource wait is not thinking", { waiting: { kind: "resource" }, isRunning: true }, "waiting"],
  ["free text cannot assign responsibility", { waitingReason: "Approval maybe" }, "waiting"],
  ["review is not completion", { workPhase: "review", isRunning: true }, "waiting"],
  ["queue is not execution", { workPhase: "queued", isRunning: true }, "waiting"],
  ["cancelled is not running", { workPhase: "cancelled", isRunning: true }, "paused"],
  ["failure is not waiting", { workPhase: "failed", waiting: { kind: "user" } }, "error"],
  ["unknown receipt is not failure", { workPhase: "uncertain", isRunning: true }, "unknown"],
  ["offline dominates cached work", { connectionState: "offline", isComposingMessage: true }, "offline"],
  ["unknown connection stays unknown", { connectionState: "unknown", workPhase: "succeeded" }, "unknown"],
  ["completion ignores stale flags", { workPhase: "succeeded", isRunning: true, awaitingUserResponse: true }, "idle"],
];
for (const [name, facts, expected] of cases) test(`Presence: ${name}`, () => {
  assert.equal(presenceFromWork(facts), expected);
  const label = workLabel(facts);
  if (expected === "speaking") assert.equal(label.en, "Writing a reply");
  if (expected === "needs_user") assert.equal(label.state, "attention");
  if (expected === "waiting") assert.equal(label.state, "waiting");
  if (["offline", "unknown"].includes(expected)) assert.equal(label.state, "unknown");
});

test("legacy persona IDs retain six deterministic neutral silhouettes, not antennae", () => {
  assert.equal(new Set(["blob", "tablet", "pebble", "wedge", "cloud", "squircle"].map(characterVariant)).size, 6);
  assert.equal(SHAPES.length, 6);
  assert.equal(characterVariant("hex"), characterVariant("squircle"));
  assert.equal(characterLayers("blob", "yellow")[0].attrs.fill, "#C4CBD5");
  assert.equal(characterLayers("blob", "__proto__")[0].attrs.fill, "#C4CBD5");
  assert.deepEqual(characterLayers("cloud", "blue"), characterLayers("cloud", "blue"));
  assert.doesNotMatch(JSON.stringify(characterLayers()), /E6B84A|M24 13 20 7|M25 15l-3-7/i);
  for (const shape of ["__proto__", "constructor", '<script/>']) assert.ok(SHAPES[characterVariant(shape)]);
  assert.equal(normalizePresence("working"), "thinking");
  assert.equal(normalizePresence("__proto__"), "idle");
});

test("gaze stays bounded and handles malformed or invisible geometry", () => {
  const rect = { left: 0, top: 0, width: 64, height: 64 };
  assert.deepEqual(gazeOffset(rect, { x: 32, y: 32 }), { x: 0, y: 0 });
  assert.deepEqual(gazeOffset(rect, { x: 1e9, y: -1e9 }), { x: 2.4, y: -1.8 });
  assert.deepEqual(gazeOffset({ ...rect, width: 0 }, { x: 500, y: 0 }), { x: 0, y: 0 });
  assert.deepEqual(gazeOffset(rect, { x: NaN, y: Infinity }), { x: 0, y: 0 });
});

function compile(entry, globalName) {
  return buildSync({ entryPoints: [entry], bundle: true, write: false, format: "iife", platform: "browser", globalName, logLevel: "silent" }).outputFiles[0].text;
}
const motionBundle = compile("frontend/src/presence/motion.ts", "MotionA");

test("native and remote bundles share one visibility-aware bounded motion coordinator", async t => {
  const window = new Window({ url: "https://beebot.test" });
  t.after(() => window.happyDOM.close());
  const document = window.document;
  let clock = 1000, hidden = false, reduced = false, next = 1;
  const timers = new Map(), frames = new Map(), animations = [], observers = [], listeners = new Map();
  Object.defineProperty(document, "hidden", { get: () => hidden });
  document.hasFocus = () => true;
  window.Date.now = () => clock;
  const media = new window.EventTarget(); Object.defineProperty(media, "matches", { get: () => reduced });
  window.matchMedia = () => media;
  window.setTimeout = (fn, delay) => { const id = next++; timers.set(id, { fn, time: clock + delay }); return id; };
  window.clearTimeout = id => timers.delete(id);
  window.requestAnimationFrame = fn => { const id = next++; frames.set(id, fn); return id; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  window.addEventListener = (name, fn, ...rest) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); add(name, fn, ...rest); };
  window.removeEventListener = (name, fn, ...rest) => { listeners.get(name)?.delete(fn); remove(name, fn, ...rest); };
  window.IntersectionObserver = class {
    observed = new Set(); disconnected = false;
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(node) { this.observed.add(node); }
    unobserve(node) { this.observed.delete(node); }
    disconnect() { this.disconnected = true; this.observed.clear(); }
    emit(node, visible) { this.callback([{ target: node, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]); }
  };
  const make = (id, parentClass = "sand-chat-header") => {
    const parent = document.createElement("div"); parent.className = parentClass;
    parent.innerHTML = `<svg data-id="${id}" width="36" height="36"><g data-motion-part="head"><g data-motion-part="gaze"><g data-motion-part="blink"></g><g data-motion-part="mouth"></g></g></g></svg>`;
    document.body.append(parent); const svg = parent.firstElementChild;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 36, height: 36, right: 36, bottom: 36 });
    for (const part of svg.querySelectorAll("g")) part.animate = (keyframes, timing) => {
      const result = { target: part, keyframes, timing, cancelled: false, cancel() { this.cancelled = true; this.oncancel?.(); } };
      animations.push(result); return result;
    };
    return svg;
  };
  window.eval(motionBundle + "\nwindow.MotionA = MotionA;");
  window.eval(motionBundle.replace(/MotionA/g, "MotionB") + "\nwindow.MotionB = MotionB;");
  const a = make("a"), duplicate = make("duplicate"), b = make("b"), c = make("c"), history = make("history", "sand-transcript-row");
  const options = (identity, state = "idle") => ({ identity, state, paused: false, surface: "header", following: true });
  const handles = [window.MotionA.registerAvatarMotion(a, options("same", "speaking")), window.MotionB.registerAvatarMotion(duplicate, options("same")), window.MotionB.registerAvatarMotion(b, options("b")), window.MotionA.registerAvatarMotion(c, options("c")), window.MotionB.registerAvatarMotion(history, options("history", "speaking"))];
  assert.equal(observers.length, 1); assert.equal(listeners.get("pointermove").size, 1);
  assert.equal(timers.size, 0, "offscreen portraits have no timer");
  handles[0].look({ x: 200, y: 200 });
  for (const node of [a, duplicate, b, c, history]) observers[0].emit(node, true);
  assert.equal(document.querySelectorAll('[data-motion="active"]').length, 2);
  assert.equal(duplicate.dataset.motion, undefined, "same colleague has only one animated occurrence");
  assert.notEqual(history.dataset.motion, "active", "historical messages remain static");
  assert.match(a.querySelector('[data-motion-part="gaze"]').style.transform, /2.40px/);
  assert.equal(timers.size, 1);
  for (let i = 0; i < 40; i++) window.dispatchEvent(new window.PointerEvent("pointermove", { clientX: 200, clientY: 100, pointerType: "mouse" }));
  assert.equal(frames.size, 1, "pointer moves coalesce instead of starting RAF loops");
  for (const [id, fn] of [...frames]) { frames.delete(id); fn(clock); }
  assert.equal(frames.size, 0);
  const [timerId, timer] = [...timers][0]; timers.delete(timerId); clock = timer.time; timer.fn();
  assert.ok(animations.some(item => item.target.dataset.motionPart === "mouth"));
  assert.equal(timers.size, 1);
  reduced = true; media.dispatchEvent(new window.Event("change"));
  assert.equal(timers.size, 0); assert.equal(frames.size, 0); assert.equal(document.querySelectorAll('[data-motion="active"]').length, 0);
  assert.ok(animations.every(item => item.cancelled));
  const count = animations.length; handles[0].gesture("spin"); assert.equal(animations.length, count, "reduced motion blocks imperative gestures too");
  reduced = false; media.dispatchEvent(new window.Event("change"));
  window.dispatchEvent(new window.Event("blur")); assert.equal(timers.size, 0);
  window.dispatchEvent(new window.Event("focus")); assert.equal(timers.size, 1);
  hidden = true; document.dispatchEvent(new window.Event("visibilitychange")); assert.equal(timers.size, 0);
  hidden = false; document.dispatchEvent(new window.Event("visibilitychange")); assert.equal(timers.size, 1);
  observers[0].emit(a, false); assert.notEqual(a.dataset.motion, "active");
  handles[1].update({ ...options("same"), paused: true }); assert.notEqual(duplicate.dataset.motion, "active");
  document.documentElement.dataset.beebotMotion = "off"; window.dispatchEvent(new window.Event("beebot-motion-changed")); assert.equal(timers.size, 0);
  delete document.documentElement.dataset.beebotMotion; window.dispatchEvent(new window.Event("beebot-motion-changed"));
  window.MotionA.gestureVisibleAvatar(document, "b", "bounce"); assert.ok(animations.at(-1).keyframes.some(frame => frame.transform === "translateY(-2px)"));
  for (const handle of handles) { handle.dispose(); handle.dispose(); }
  assert.equal(timers.size, 0); assert.equal(frames.size, 0); assert.equal(observers[0].disconnected, true);
  for (const name of ["pointermove", "blur", "focus", "beebot-motion-changed"]) assert.equal(listeners.get(name)?.size, 0, `${name} listener leaked`);
  assert.equal(document[Symbol.for("beebot.presence.motion.v1")], undefined);
});

const tick = () => new Promise(resolve => setTimeout(resolve, 15));
test("real avatars retain identity, custom photos, editor focus and static historical messages", async t => {
  const output = buildSync({ stdin: { contents: `import React from "react";import {createRoot} from "react-dom/client";import {flushSync} from "react-dom";
    import {AgentAvatar} from "./frontend/src/recovered/features/conversation/workspace/agent-avatar";
    import {ConversationTranscript} from "./frontend/src/recovered/features/conversation/workspace/transcript";
    const root=createRoot(document.getElementById("root"));
    window.fixture={render(state){flushSync(()=>root.render(<><div id="first"><AgentAvatar agentId="a" state={state} /></div><div id="second"><AgentAvatar agentId="a" state={state} /></div><AgentAvatar agentId="photo" dataUrl="data:image/png;base64,AA=="/><AgentAvatar agentId="group" kind="group" memberIds={["a","b","c","d","e"]}/><ConversationTranscript isTransportDown={state==="offline"} entries={[{kind:"message",id:"known",role:"assistant",author:"Kai",text:"Working",isStreaming:true,timestampMs:1},{kind:"message",id:"unknown",role:"assistant",author:"Kai",text:"No resolved identity",timestampMs:1}]} resolveMessageAvatar={entry=>entry.id==="known"?{agentId:"a"}:null}/></>));},unmount(){flushSync(()=>root.unmount());}};`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, outfile: "/tmp/presence-react-test.js", platform: "browser", format: "iife", jsx: "automatic", logLevel: "silent", define: { "process.env.NODE_ENV": '"development"' } });
  const window = new Window({ url: "https://beebot.test" }); t.after(() => window.happyDOM.close());
  const errors=[];window.console.timeStamp=()=>{};window.console.error=(...args)=>errors.push(args.join(" "));
  window.document.body.innerHTML='<input id="draft" value="Keep my draft"><div id="root"></div>';
  window.eval(output.outputFiles.find(file=>file.path.endsWith(".js")).text);
  window.fixture.render("idle");await tick();
  const doc=window.document, avatar=doc.querySelector("#first svg"), body=avatar.querySelector("path"), draft=doc.querySelector("#draft");
  draft.focus(); draft.setSelectionRange(2,5);
  for(const state of ["thinking","speaking","waiting","needs_user","error","offline","idle"]){
    window.fixture.render(state);await tick();
    assert.equal(doc.querySelector("#first svg"),avatar);assert.equal(avatar.querySelector("path"),body);assert.equal(avatar.dataset.presence,state);
    assert.equal(doc.activeElement,draft);assert.equal(draft.value,"Keep my draft");assert.equal(draft.selectionStart,2);
    assert.equal(doc.querySelector('[data-avatar-kind="photo"]').tagName,"IMG");
    assert.equal(doc.querySelectorAll('.sand-group-avatar svg[data-paused="true"]').length,3);
    assert.equal(doc.querySelector('[data-entry-id="known"] svg').dataset.presence,state==="offline"?"idle":"speaking");
    assert.equal(doc.querySelector('[data-entry-id="unknown"] svg'),null,"names do not invent agent identity");
  }
  const ids=[...doc.querySelectorAll("[id]")].map(node=>node.id);assert.equal(new Set(ids).size,ids.length,"no duplicated SVG source IDs");
  assert.deepEqual(errors,[]);window.fixture.unmount();await tick();assert.equal(doc[Symbol.for("beebot.presence.motion.v1")],undefined);
});

test("neutral theme exposes no old palette and keeps finite event-driven motion", async () => {
  const css = await readFile("frontend/src/presence/tokens.css", "utf8");
  assert.doesNotMatch(css, /#E6B84A|#F7F7F4|#D7B14A/i);
  assert.match(css, /data-beebot-theme="presence"/);
  const motion = await readFile("frontend/src/presence/motion.ts", "utf8");
  assert.doesNotMatch(motion, /setInterval|fetch\(|localStorage|postMessage/);
  assert.match(motion, /Symbol\.for\("beebot\.presence\.motion\.v1"\)/);
  const onboarding=await readFile("frontend/src/recovered/features/onboarding/signed-in/character.tsx","utf8");
  assert.doesNotMatch(onboarding, /requestAnimationFrame|linearGradient|BLOB_PATH/);
});
