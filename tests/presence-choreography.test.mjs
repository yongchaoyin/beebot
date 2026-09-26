import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createCharacterSvg } from "../frontend/src/presence/avatar-art.ts";
import { expressionPaths, expressionPose } from "../frontend/src/presence/avatar-expression.ts";
import { registerAvatarMotion, setAvatarMotionPreference } from "../frontend/src/presence/avatar-motion.ts";
import { createComposerSubmissionQueue } from "../frontend/src/recovered/features/conversation/workspace/submission.ts";

const states = ["thinking", "reading", "searching", "writing", "working", "handoff", "speaking"];
const paths = svg => ({
  left: svg.querySelector("[data-part=eyes]").getAttribute("d"),
  right: svg.querySelectorAll("[data-part=eyes]")[1].getAttribute("d"),
  mouth: svg.querySelector("[data-part=mouth]").getAttribute("d"),
  gaze: svg.querySelector(".bb-character__gaze").getAttribute("transform"),
});
const baseline = state => expressionPaths(expressionPose(state), "blob", 36);

/** A real controller on DOM/SVG, with only the browser clock, viewport and WAAPI
 * replaced. Timeout deadlines and animation completion are honored, unlike a
 * test that invokes every queued callback once at an arbitrary timestamp. */
function rig(t, { hardware = 8, cadence = 10 } = {}) {
  const win = new Window({ url: "https://beebot.test" }), doc = win.document;
  doc.hasFocus = () => true;
  Object.defineProperty(win.navigator, "hardwareConcurrency", { value: hardware, configurable: true });
  let now = 100, serial = 0, frameDue = Infinity;
  const timers = new Map(), frames = new Map(), observers = [], animations = [], actors = [], samples = [], timerRuns = [];
  const media = new win.EventTarget(); media.matches = false; win.matchMedia = () => media;
  win.performance.now = () => now;
  win.setTimeout = (fn, delay = 0) => { const id = ++serial; timers.set(id, { fn, at: now + Math.max(1, delay) }); return id; };
  win.clearTimeout = id => timers.delete(id);
  win.requestAnimationFrame = fn => { const id = ++serial; if (!frames.size) frameDue = now + cadence; frames.set(id, fn); return id; };
  win.cancelAnimationFrame = id => { frames.delete(id); if (!frames.size) frameDue = Infinity; };
  win.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(node) { this.targets.add(node); }
    unobserve(node) { this.targets.delete(node); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
  };
  win.SVGElement.prototype.animate = function(keyframes, options) {
    const animation = { node: this, keyframes, options, startedAt: now, endsAt: now + options.duration,
      cancelled: false, finished: false, cancel() { if (!this.cancelled) { this.cancelled = true; this.oncancel?.(); } } };
    animations.push(animation); return animation;
  };
  const alive = () => animations.filter(a => !a.cancelled && !a.finished);
  const sample = () => samples.push({ at: now, frames: frames.size, faces: actors.map(a => paths(a.svg)), active: alive().map(a => a.node) });
  const advance = duration => {
    const target = now + duration;
    for (let steps = 0; ; steps++) {
      assert.ok(steps < 40000, "the finite controller must not spin on its clock");
      const due = Math.min(frameDue, ...[...timers.values()].map(v => v.at), ...alive().map(a => a.endsAt));
      if (due > target) { now = target; sample(); return; }
      now = due;
      for (const [id, timer] of [...timers]) if (timer.at <= now && timers.delete(id)) { timerRuns.push(now); timer.fn(); }
      for (const a of alive()) if (a.endsAt <= now) { a.finished = true; a.onfinish?.(); }
      if (frameDue <= now) { const pending = [...frames.values()]; frames.clear(); frameDue = Infinity; for (const fn of pending) fn(now); }
      sample();
    }
  };
  const visible = (svg, value = true) => observers.find(o => o.targets.has(svg))?.callback([{ target: svg, isIntersecting: value }]);
  const avatar = (options = {}) => {
    const svg = createCharacterSvg(doc, "blob", "blue", 36); doc.body.append(svg);
    let current = { state: "thinking", identity: "node:a", priority: 100, size: 36, ...options };
    const handle = registerAvatarMotion(svg, current);
    const actor = { svg, handle, update(value) { current = { ...current, ...value }; handle.update(current); } };
    actors.push(actor); visible(svg); return actor;
  };
  t.after(async () => { for (const a of actors) a.handle.destroy(); await win.happyDOM.close(); });
  return { win, doc, media, timers, frames, observers, animations, samples, timerRuns, alive, advance, avatar, visible,
    now: () => now, jump: ms => { now += ms; }, sample,
    flushDelayedTimer() {
      const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
      assert.ok(timer && timer.at <= now, "a due shared timer exists"); timers.delete(id); timerRuns.push(now); timer.fn(); sample();
    } };
}

function faceDelta(face, original) {
  const numbers = s => s.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return Object.keys(face).map(key => numbers(face[key]).map((v, i) => Math.round((v - numbers(original[key])[i]) * 100) / 100));
}

test("working expressions have distinct finite controller trajectories and return to their own baseline", t => {
  const signatures = new Map();
  for (const state of states) {
    const r = rig(t), a = r.avatar({ state }), original = baseline(state);
    const trace = [];
    for (let i = 0; i < 160; i++) { r.advance(150); trace.push(faceDelta(paths(a.svg), original)); }
    const accents = r.animations.filter(x => !x.node.matches(".bb-character__eyes"));
    assert.ok(trace.some(d => d.flat().some(x => x !== 0)) || accents.length, `${state} has a real accent in the controller`);
    const signature = JSON.stringify([trace, accents.map(x => [x.node.getAttribute("class"), x.keyframes])]);
    assert.ok(![...signatures.values()].includes(signature), `${state} does not reuse another state's trajectory`);
    signatures.set(state, signature);
    assert.ok(r.samples.some(s => s.at > 4000 && s.frames === 0 && s.active.length === 0 && JSON.stringify(s.faces[0]) === JSON.stringify(original)), `${state} has a settled, animation-free interval`);
    assert.ok(r.animations.every(x => x.options.iterations === 1 && Number.isFinite(x.options.duration)), `${state} never starts an infinite animation`);
  }
});

test("elapsed-time morph samples agree across frame rates and start a replacement at the painted pose", t => {
  const observed = [];
  for (const cadence of [10, 20, 30]) {
    const r = rig(t, { cadence }), a = r.avatar({ state: "thinking" });
    a.update({ state: "reading" }); r.advance(180); observed.push(paths(a.svg));
    const before = paths(a.svg); a.update({ state: "writing" }); assert.deepEqual(paths(a.svg), before);
    r.advance(360); assert.deepEqual(paths(a.svg), baseline("writing"));
    assert.equal(r.frames.size, 0, "state transitions release the frame loop");
  }
  assert.deepEqual(observed[0], observed[1]); assert.deepEqual(observed[1], observed[2]);
});

test("blinks have their own cadence instead of firing with every working accent", t => {
  const r = rig(t), a = r.avatar({ state: "speaking" }); r.advance(32000);
  const blinks = r.animations.filter(x => x.node.matches(".bb-character__eyes"));
  const accents = r.animations.filter(x => !x.node.matches(".bb-character__eyes"));
  assert.ok(blinks.length >= 2 && accents.length >= 2);
  assert.ok(accents.some(a => !blinks.some(b => b.startedAt === a.startedAt)), "accents can occur without blink");
  assert.ok(blinks.some(b => !accents.some(a => a.startedAt === b.startedAt)), "blinks can occur without accent");
  assert.equal(a.svg.dataset.expression, "speaking");
});

test("frequent real activity changes do not keep postponing the colleague's blink", t => {
  const r = rig(t), a = r.avatar({ state: "thinking" });
  for (let i = 0; i < 70; i++) { a.update({ state: states[i % states.length] }); r.advance(100); }
  assert.ok(r.animations.some(x => x.node.matches(".bb-character__eyes")), "blink timing survives frequent activity updates");
  assert.equal(a.svg.dataset.expression, states[69 % states.length]);
});

test("an overdue activity waits for a delayed frame without creating a 16ms timeout polling loop", t => {
  const r = rig(t, { cadence: 5000 }), a = r.avatar({ state: "thinking" }); a.update({ state: "reading" });
  r.advance(2000);
  assert.ok(r.timerRuns.length <= 4, `a settling pose scheduled ${r.timerRuns.length} timeouts while waiting for its frame`);
  assert.equal(r.frames.size, 1, "the same pending frame owns transition progress");
});

test("a held reading pose uses the sparse timeout and no animation-frame loop", t => {
  const r = rig(t), a = r.avatar({ state: "reading" }); r.advance(12000);
  const original = JSON.stringify(baseline("reading"));
  const held = r.samples.filter(s => s.frames === 0 && JSON.stringify(s.faces[0]) !== original);
  assert.ok(held.length >= 2, "the controller reaches nonbaseline held poses without rAF polling");
  assert.ok(r.samples.every(s => s.frames <= 1), "there is at most one shared frame request");
  assert.equal(a.svg.dataset.expression, "reading");
});

test("a delayed choreography callback skips expired steps and returns to baseline without replaying them", t => {
  const r = rig(t), a = r.avatar({ state: "reading" }), original = baseline("reading");
  for (let i = 0; i < 500 && (r.frames.size || JSON.stringify(paths(a.svg)) === JSON.stringify(original)); i++) r.advance(10);
  assert.equal(r.frames.size, 0); assert.notDeepEqual(paths(a.svg), original, "start from a real held reading pose");
  const distance = () => faceDelta(paths(a.svg), original).flat().reduce((sum, value) => sum + Math.abs(value), 0);
  const before = distance(); r.jump(60000); r.flushDelayedTimer();
  for (let i = 0; i < 6; i++) { r.advance(60); assert.ok(distance() <= before, "expired intermediate glances are not replayed"); }
  assert.deepEqual(paths(a.svg), original); assert.equal(r.frames.size, 0);
});

test("rapid state changes cancel old accents, preserve node identity and finish in the latest static state", t => {
  const r = rig(t), a = r.avatar({ state: "speaking" }); r.advance(2200);
  const svg = a.svg, body = svg.querySelector(".bb-character__body"), eyes = svg.querySelector("[data-part=eyes]");
  for (const state of ["reading", "searching", "working", "handoff", "writing"]) { a.update({ state }); r.advance(90); }
  a.update({ state: "needs_user" }); const count = r.animations.length; r.advance(60000);
  assert.equal(a.svg, svg); assert.equal(svg.querySelector(".bb-character__body"), body); assert.equal(svg.querySelector("[data-part=eyes]"), eyes);
  assert.deepEqual(paths(svg), baseline("needs_user")); assert.equal(svg.dataset.state, "needs_user");
  assert.equal(r.frames.size, 0); assert.equal(r.timers.size, 0); assert.equal(r.animations.length, count); assert.equal(r.alive().length, 0);
});

for (const mode of ["hidden", "blur", "offscreen", "reduced", "off"]) test(`${mode} cancels all motion and resume does not replay missed accents`, t => {
  const r = rig(t), a = r.avatar({ state: "speaking" }); a.handle.gesture("celebrate"); r.advance(120);
  const suspend = value => {
    if (mode === "hidden") { Object.defineProperty(r.doc, "hidden", { value, configurable: true }); r.doc.dispatchEvent(new r.win.Event("visibilitychange")); }
    if (mode === "blur") r.win.dispatchEvent(new r.win.Event(value ? "blur" : "focus"));
    if (mode === "offscreen") r.visible(a.svg, !value);
    if (mode === "reduced") { r.media.matches = value; r.media.dispatchEvent(new r.win.Event("change")); }
    if (mode === "off") setAvatarMotionPreference(r.doc, value ? "off" : "auto");
  };
  suspend(true); assert.equal(r.frames.size, 0); assert.equal(r.timers.size, 0); assert.equal(r.alive().length, 0);
  const count = r.animations.length; r.jump(600000); suspend(false);
  assert.deepEqual(paths(a.svg), baseline("speaking")); assert.equal(r.animations.length, count);
  r.advance(250); assert.equal(r.animations.length, count, "resumed actor waits for a fresh deadline");
  r.advance(12000); assert.ok(r.animations.length > count, "fresh motion eventually resumes");
  assert.ok(r.animations.slice(count).every(x => x.startedAt >= r.now() - 12250));
});

for (const power of ["subtle", "hardware", "saveData"]) test(`${power} keeps one blinking colleague, no action choreography or idle animation`, t => {
  const r = rig(t, { hardware: power === "hardware" ? 2 : 8 });
  if (power === "subtle") setAvatarMotionPreference(r.doc, "subtle");
  if (power === "saveData") Object.defineProperty(r.win.navigator, "connection", { value: { saveData: true } });
  const a = r.avatar({ state: "speaking", identity: "a" }), b = r.avatar({ state: "reading", identity: "b" });
  r.advance(20000); assert.ok(r.animations.length);
  assert.ok(r.animations.every(x => x.node.matches(".bb-character__eyes")));
  assert.equal(new Set(r.animations.map(x => x.node.closest("svg"))).size, 1);
  assert.deepEqual(paths(a.svg), baseline("speaking")); assert.deepEqual(paths(b.svg), baseline("reading")); assert.equal(r.frames.size, 0);
  a.update({ state: "idle" }); b.update({ state: "idle" }); assert.equal(r.timers.size, 0);
});

test("returning from subtle mode starts a fresh accent cadence instead of playing an overdue activity", t => {
  const r = rig(t), a = r.avatar({ state: "speaking" }); r.advance(1500);
  setAvatarMotionPreference(r.doc, "subtle"); r.advance(30000);
  const count = r.animations.length; setAvatarMotionPreference(r.doc, "auto"); r.advance(250);
  assert.deepEqual(paths(a.svg), baseline("speaking"));
  assert.ok(r.animations.slice(count).every(x => x.node.matches(".bb-character__eyes")), "old activity deadline cannot fire immediately after restoring natural motion");
  r.advance(10000); assert.ok(r.animations.slice(count).some(x => !x.node.matches(".bb-character__eyes")));
});

test("repeated same-node gestures cancel their predecessor and destruction releases every clock", t => {
  const r = rig(t), a = r.avatar({ state: "speaking" });
  for (const kind of ["greet", "nod", "ack", "celebrate", "nod"]) {
    a.handle.gesture(kind); r.advance(50);
    const active = r.alive(); assert.equal(new Set(active.map(x => x.node)).size, active.length, "one animation owner per SVG node");
  }
  a.handle.destroy(); assert.equal(r.frames.size, 0); assert.equal(r.timers.size, 0); assert.equal(r.alive().length, 0); assert.ok(r.observers[0].disconnected);
  const count = r.animations.length; a.update({ state: "working" }); a.handle.gesture("greet"); a.handle.reset(); r.advance(60000);
  assert.equal(r.animations.length, count); assert.equal(r.frames.size, 0); assert.equal(r.timers.size, 0);
});

test("a late completion from a replaced WAAPI animation cannot release its new node owner", t => {
  const r = rig(t), a = r.avatar({ state: "speaking" });
  a.handle.gesture("greet"); const old = r.animations.at(-1); a.handle.gesture("nod"); const current = r.animations.at(-1);
  assert.equal(old.node, current.node); assert.equal(old.cancelled, true); assert.equal(current.cancelled, false);
  old.onfinish?.(); old.oncancel?.(); assert.equal(current.cancelled, false);
  a.handle.destroy(); assert.equal(current.cancelled, true, "late old callback did not remove current animation from cancellation ownership");
});

test("losing and regaining the shared motion budget cancels the old sequence without catching up", t => {
  const r = rig(t), a = r.avatar({ state: "speaking", identity: "a", priority: 100 }); a.handle.gesture("celebrate"); r.advance(120);
  const b = r.avatar({ state: "speaking", identity: "b", priority: 200 }), c = r.avatar({ state: "speaking", identity: "c", priority: 180 });
  assert.equal(a.svg.dataset.motion, "still"); assert.deepEqual(paths(a.svg), baseline("speaking"));
  assert.ok(r.alive().every(x => x.node.closest("svg") !== a.svg));
  r.advance(30000); b.handle.destroy(); c.handle.destroy(); const count = r.animations.length;
  assert.equal(a.svg.dataset.motion, "auto"); r.advance(250); assert.equal(r.animations.length, count);
  r.advance(6000); assert.ok(r.animations.slice(count).some(x => x.node.closest("svg") === a.svg));
  assert.equal(r.observers.length, 1); assert.equal(r.timers.size, 1);
});

for (const conversation of ["bot-a", "group-project"]) test(`${conversation}: shared avatar updates preserve second/third drafts and the real send queue`, async t => {
  const r = rig(t), header = r.avatar({ state: "reading", identity: "same-bot", priority: 100 }), sidebar = r.avatar({ state: "reading", identity: "same-bot", priority: 50 });
  const other = r.avatar({ state: "working", identity: "colleague", priority: 80 });
  const input = r.doc.createElement("textarea"); r.doc.body.append(input); input.focus();
  const calls = [], pending = new Map();
  const queue = createComposerSubmissionQueue({ isTransportDown: () => false, send: value => { calls.push(value); return new Promise(resolve => pending.set(value.nonce, resolve)); } });
  t.after(() => queue.dispose());
  const submit = nonce => queue.submit({ nonce, agentId: conversation, prompt: input.value, attachments: [], createdAtMs: r.now() });
  input.value = "第一条"; const first = submit("first"); input.value = "第二条草稿"; input.setSelectionRange(1, 3);
  for (const a of [header, sidebar, other]) a.update({ state: "searching" }); r.advance(2300);
  assert.equal(r.doc.activeElement, input); assert.equal(input.value, "第二条草稿"); assert.equal(input.selectionStart, 1);
  const second = submit("second"); input.value = "第三条草稿"; input.setSelectionRange(2, 4);
  header.update({ state: "speaking" }); sidebar.update({ state: "speaking" }); other.update({ state: "handoff" }); r.advance(2300);
  assert.equal(r.doc.activeElement, input); assert.equal(input.value, "第三条草稿"); assert.equal(input.selectionStart, 2);
  const third = submit("third"); assert.deepEqual(calls.map(x => x.nonce), ["first"]);
  for (const nonce of ["first", "second", "third"]) { pending.get(nonce)(); await new Promise(resolve => setImmediate(resolve)); }
  assert.deepEqual(calls.map(x => x.prompt), ["第一条", "第二条草稿", "第三条草稿"]);
  assert.deepEqual(await Promise.all([first.completion, second.completion, third.completion]), ["sent", "sent", "sent"]);
  assert.equal(r.doc.activeElement, input); assert.equal(input.value, "第三条草稿"); assert.equal(input.selectionStart, 2);
  assert.equal(r.observers.length, 1); assert.equal(r.timers.size, 1);
  assert.ok(r.animations.every(x => x.node.closest("svg") !== sidebar.svg), "mirror avatar does not steal a second motion slot");
});
