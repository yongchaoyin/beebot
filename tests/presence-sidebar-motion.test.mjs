import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { createCharacterSvg } from "../frontend/src/presence/avatar-art.ts";
import { expressionFromState, expressionPaths, expressionPose } from "../frontend/src/presence/avatar-expression.ts";
import { registerAvatarMotion, setAvatarMotionPreference } from "../frontend/src/presence/avatar-motion.ts";
import { createComposerSubmissionQueue } from "../frontend/src/recovered/features/conversation/workspace/submission.ts";

const face = svg => ({
  left: svg.querySelectorAll("[data-part=eyes]")[0].getAttribute("d"),
  right: svg.querySelectorAll("[data-part=eyes]")[1].getAttribute("d"),
  mouth: svg.querySelector("[data-part=mouth]").getAttribute("d"),
  gaze: svg.querySelector(".bb-character__gaze").getAttribute("transform"),
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Actual sidebar-sized SVG/controller. Browser scheduling and WAAPI completion
 * are controlled, with one shared document clock and real DOM ancestry. */
function rig(t) {
  const win = new Window({ url: "https://beebot.test", settings: { enableJavaScriptEvaluation: true } }), doc = win.document;
  win.console.timeStamp = () => {};
  doc.hasFocus = () => true; Object.defineProperty(win.navigator, "hardwareConcurrency", { value: 8, configurable: true });
  let now = 100, serial = 0, nextFrame = Infinity;
  const timers = new Map(), frames = new Map(), animations = [], observers = [], actors = [], samples = [];
  const media = new win.EventTarget(); media.matches = false; win.matchMedia = () => media;
  win.performance.now = () => now;
  win.setTimeout = (fn, delay = 0) => { const id = ++serial; timers.set(id, { fn, at: now + Math.max(1, delay) }); return id; };
  win.clearTimeout = id => timers.delete(id);
  win.requestAnimationFrame = fn => { const id = ++serial; if (!frames.size) nextFrame = now + 10; frames.set(id, fn); return id; };
  win.cancelAnimationFrame = id => { frames.delete(id); if (!frames.size) nextFrame = Infinity; };
  win.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(svg) { this.targets.add(svg); } unobserve(svg) { this.targets.delete(svg); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
  };
  win.SVGElement.prototype.animate = function(keyframes, options) {
    const item = { node: this, keyframes, options, startedAt: now, endsAt: now + options.duration,
      cancelled: false, finished: false, cancel() { if (!this.cancelled) { this.cancelled = true; this.oncancel?.(); } } };
    animations.push(item); return item;
  };
  const active = () => animations.filter(a => !a.cancelled && !a.finished);
  const atBaseline = a => same(face(a.svg), expressionPaths(expressionPose(expressionFromState(a.options.state)), "blob", a.options.size));
  const sample = () => samples.push({ at: now, frames: frames.size, timers: timers.size,
    moving: actors.filter(a => !a.destroyed && (!atBaseline(a) || active().some(animation => animation.node.closest("svg") === a.svg))).map(a => a.id),
    states: actors.filter(a => !a.destroyed).map(a => [a.id, a.svg.dataset.state, a.svg.dataset.expression]) });
  const advance = duration => {
    const end = now + duration;
    for (let count = 0; ; count++) {
      assert.ok(count < 50000, "sidebar motion must not spin continuously");
      const due = Math.min(nextFrame, ...[...timers.values()].map(t => t.at), ...active().map(a => a.endsAt));
      if (due > end) { now = end; sample(); return; } now = due;
      for (const [id, timer] of [...timers]) if (timer.at <= now && timers.delete(id)) timer.fn();
      for (const animation of active()) if (animation.endsAt <= now) { animation.finished = true; animation.onfinish?.(); }
      if (nextFrame <= now) { const callbacks = [...frames.values()]; frames.clear(); nextFrame = Infinity; for (const callback of callbacks) callback(now); }
      sample();
    }
  };
  const visible = (svg, value = true) => observers.find(o => o.targets.has(svg))?.callback([{ target: svg, isIntersecting: value }]);
  const avatar = ({ surface = "sand-agent-item", parent, ...options } = {}) => {
    const row = doc.createElement("div"); row.className = surface;
    if (parent) { const outer = doc.createElement("div"); outer.className = parent; outer.append(row); doc.body.append(outer); } else doc.body.append(row);
    const svg = createCharacterSvg(doc, "blob", "blue", options.size ?? 28); row.append(svg);
    const current = { state: "idle", identity: `sidebar:${actors.length}`, priority: 50, size: 28, ...options };
    const handle = registerAvatarMotion(svg, current);
    const actor = { id: actors.length, svg, row, handle, options: current, destroyed: false,
      update(next) { Object.assign(current, next); handle.update(current); },
      destroy() { this.destroyed = true; handle.destroy(); } };
    actors.push(actor); visible(svg); return actor;
  };
  t.after(async () => { for (const a of actors) a.destroy(); await win.happyDOM.close(); });
  return { win, doc, media, timers, frames, animations, observers, actors, samples, active, avatar, visible, advance, atBaseline,
    now: () => now, jump: ms => { now += ms; } };
}

test("visible idle sidebar colleagues receive fair, staggered accents without changing their real state", t => {
  const r = rig(t), roster = Array.from({ length: 10 }, () => r.avatar()); r.advance(120000);
  const touched = new Set(r.samples.flatMap(s => s.moving));
  assert.equal(touched.size, roster.length, "rotation eventually reaches every visible colleague");
  assert.ok(r.samples.every(s => s.moving.length <= 1), "idle sidebar accents do not run as a flock");
  assert.ok(r.samples.every(s => s.frames <= 1 && s.timers <= 1), "one document owns the scheduling budget");
  assert.ok(r.samples.every(s => s.states.every(([, state, expression]) => state === "idle" && expression === "idle")), "a visual accent is not work or success");
  const quiet = r.samples.filter(s => !s.moving.length && !s.frames);
  assert.ok(quiet.length > 5, "idle accents have real quiet intervals without rAF");
  assert.ok(r.animations.length && r.animations.every(a => a.options.iterations === 1));
  assert.equal(r.observers.length, 1);
});

test("idle motion is limited to an opted-in list surface, excluding unrelated static and historical avatars", t => {
  const r = rig(t), row = r.avatar(), plain = r.avatar({ surface: "ordinary-static-icon" }), optedOut = r.avatar({ ambient: false }),
    tiny = r.avatar({ size: 22 }), history = r.avatar({ parent: "sand-message", paused: true }), collage = r.avatar({ parent: "sand-group-avatar", paused: true });
  r.advance(45000); const touched = new Set(r.samples.flatMap(s => s.moving));
  assert.ok(touched.has(row.id));
  for (const a of [plain, optedOut, tiny, history, collage]) { assert.ok(!touched.has(a.id)); assert.ok(r.atBaseline(a)); }
});

test("one working colleague shares at most one remaining slot with sidebar life; two workers preempt it", t => {
  const r = rig(t), roster = Array.from({ length: 5 }, () => r.avatar()), one = r.avatar({ surface: "sand-chat-header", state: "speaking", identity: "worker:1", priority: 100, ambient: false });
  r.advance(45000); assert.ok(r.samples.some(s => s.moving.some(id => roster.some(a => a.id === id))), "one active worker leaves a quiet sidebar slot");
  assert.ok(r.samples.every(s => s.moving.length <= 2));
  const two = r.avatar({ surface: "sand-chat-header", state: "working", identity: "worker:2", priority: 100, ambient: false });
  const start = r.samples.length; r.advance(20000);
  assert.ok(r.samples.slice(start).every(s => s.moving.every(id => id === one.id || id === two.id)), "two workers suspend ambient list accents");
  assert.ok(r.samples.slice(start).every(s => s.moving.length <= 2));
  two.destroy(); const resumed = r.samples.length; r.advance(30000);
  assert.ok(r.samples.slice(resumed).some(s => s.moving.some(id => roster.some(a => a.id === id))), "ambient rotation resumes after the work slot is freed");
});

test("the same Bot's primary avatar excludes its sidebar mirror without excluding another colleague", t => {
  const r = rig(t), primary = r.avatar({ surface: "sand-chat-header", state: "speaking", identity: "shared-bot", priority: 100, ambient: false }),
    mirror = r.avatar({ identity: "shared-bot" }), other = r.avatar({ identity: "other-bot" });
  r.advance(45000); const touched = new Set(r.samples.flatMap(s => s.moving));
  assert.ok(touched.has(primary.id)); assert.ok(touched.has(other.id)); assert.ok(!touched.has(mirror.id));
  assert.ok(r.atBaseline(mirror));
});

for (const mode of ["subtle", "off", "reduced", "blur", "hidden", "offscreen"]) test(`${mode} stops sidebar accents and resume starts a fresh quiet cadence`, t => {
  const r = rig(t), a = r.avatar();
  const toggle = value => {
    if (mode === "subtle" || mode === "off") setAvatarMotionPreference(r.doc, value ? mode : "auto");
    if (mode === "reduced") { r.media.matches = value; r.media.dispatchEvent(new r.win.Event("change")); }
    if (mode === "blur") r.win.dispatchEvent(new r.win.Event(value ? "blur" : "focus"));
    if (mode === "hidden") { Object.defineProperty(r.doc, "hidden", { value, configurable: true }); r.doc.dispatchEvent(new r.win.Event("visibilitychange")); }
    if (mode === "offscreen") r.visible(a.svg, !value);
  };
  for (let i = 0; i < 1000 && r.atBaseline(a) && !r.active().length; i++) r.advance(10);
  assert.ok(!r.atBaseline(a) || r.active().length, "suspend a real accent in progress");
  toggle(true); assert.equal(r.frames.size, 0); assert.equal(r.timers.size, 0); assert.equal(r.active().length, 0); assert.ok(r.atBaseline(a));
  r.jump(600000); const count = r.animations.length; toggle(false); r.advance(500);
  assert.equal(r.animations.length, count); assert.ok(r.atBaseline(a), "no catch-up motion immediately after resuming");
  r.advance(12000); assert.ok(r.samples.some(s => s.at >= r.now() - 12000 && s.moving.includes(a.id)), "normal fresh accents resume");
});

test("changing a currently accented list Bot to work cancels the idle sequence and settles to its real expression", t => {
  const r = rig(t), a = r.avatar();
  for (let i = 0; i < 1000 && r.atBaseline(a) && !r.active().length; i++) r.advance(10);
  const old = [...r.active()]; a.update({ state: "reading" });
  assert.ok(old.every(animation => animation.cancelled)); r.advance(360);
  assert.equal(a.svg.dataset.state, "thinking"); assert.equal(a.svg.dataset.expression, "reading"); assert.ok(r.atBaseline(a));
  a.update({ state: "offline" }); const count = r.animations.length; r.advance(30000);
  assert.equal(a.svg.dataset.state, "offline"); assert.ok(r.atBaseline(a)); assert.equal(r.animations.length, count); assert.equal(r.timers.size, 0); assert.equal(r.frames.size, 0);
});

test("destroying idle list actors releases animations, their shared clock and observers", t => {
  const r = rig(t), roster = Array.from({ length: 8 }, () => r.avatar()); r.advance(9000);
  for (const a of roster) a.destroy(); const count = r.animations.length;
  assert.equal(r.active().length, 0); assert.equal(r.timers.size, 0); assert.equal(r.frames.size, 0); assert.ok(r.observers[0].disconnected);
  r.advance(60000); assert.equal(r.animations.length, count);
});

test("React pausing an active sidebar accent preserves the new static face on its reused SVG", async t => {
  const { buildAvatarExpressionHarness } = await import("./helpers/avatar-expression-harness.mjs");
  const code = await buildAvatarExpressionHarness(), r = rig(t);
  const host = r.doc.createElement("div"); host.className = "sand-agent-item"; r.doc.body.append(host);
  r.win.eval(code + ";window.AvatarQA=AvatarQA;");
  const app = r.win.AvatarQA.lifecycle(host);
  try {
    app.update({ state: "idle", sizePx: 28, avatarIdentity: "sidebar:react", motionPriority: 50 });
    const svg = host.querySelector("svg"), idle = expressionPaths(expressionPose("idle"), "blob", 28);
    r.visible(svg); r.avatar({ identity: "another-sidebar-colleague" });
    for (let i = 0; i < 2000 && same(face(svg), idle) && !r.active().some(a => a.node.closest("svg") === svg); i++) r.advance(10);
    assert.ok(!same(face(svg), idle) || r.active().some(a => a.node.closest("svg") === svg), "the real React controller owns an active ambient accent");
    app.update({ state: "error", paused: true });
    assert.equal(host.querySelector("svg"), svg, "React reuses the already-painted SVG during layout-effect cleanup");
    const error = expressionPaths(expressionPose("error"), "blob", 28);
    assert.deepEqual(face(svg), error, "old idle controller destruction must not repaint the new error face");
    r.advance(15000);
    assert.deepEqual(face(svg), error, "remaining sidebar actors cannot revive the destroyed controller");
    assert.ok(!r.active().some(a => a.node.closest("svg") === svg));
  } finally { app.unmount(); }
});

for (const conversation of ["single-bot", "group-room"]) test(`${conversation}: sidebar accents preserve focus, drafts and second/third queued sends`, async t => {
  const r = rig(t); Array.from({ length: 4 }, () => r.avatar());
  const worker = r.avatar({ surface: "sand-chat-header", state: "thinking", identity: "current-worker", priority: 100, ambient: false });
  const input = r.doc.createElement("textarea"); r.doc.body.append(input); input.focus();
  const calls = [], pending = new Map();
  const queue = createComposerSubmissionQueue({ isTransportDown: () => false,
    send: value => { calls.push(value); return new Promise(resolve => pending.set(value.nonce, resolve)); } });
  t.after(() => queue.dispose());
  const receipts = [];
  for (const [index, draft] of ["第一条", "第二条草稿", "第三条草稿"].entries()) {
    input.value = draft; input.setSelectionRange(1, 2); r.advance(9000);
    assert.equal(r.doc.activeElement, input); assert.equal(input.value, draft); assert.equal(input.selectionStart, 1);
    receipts.push(queue.submit({ nonce: String(index), agentId: conversation, prompt: input.value, attachments: [], createdAtMs: r.now() }));
    worker.update({ state: index % 2 ? "speaking" : "reading" });
  }
  assert.ok(r.samples.some(s => s.moving.some(id => id !== worker.id)), "real sidebar accents ran during composition");
  assert.deepEqual(calls.map(c => c.prompt), ["第一条"]);
  for (let index = 0; index < 3; index++) { pending.get(String(index))(); await new Promise(resolve => setImmediate(resolve)); }
  assert.deepEqual(calls.map(c => c.prompt), ["第一条", "第二条草稿", "第三条草稿"]);
  assert.deepEqual(await Promise.all(receipts.map(r => r.completion)), ["sent", "sent", "sent"]);
  assert.equal(r.doc.activeElement, input); assert.equal(input.value, "第三条草稿"); assert.equal(input.selectionStart, 1);
});
