/** Isolated macOS Electron evidence from the actual packaged Presence bytes.
 * SVG, WAAPI and frame timestamps are native. Activation and work are fixtures;
 * this does not measure production FPS, power, or real model conversations. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { downloadArtifact } from "@electron/get";
import { extractFile } from "@electron/asar";
import { presenceSharedModule } from "./lib/presence-renderer-patch.mjs";

function browserFixture() {
  // Leave native time, rAF, IntersectionObserver and animate() untouched.
  Object.defineProperty(document, "hasFocus", { value: () => true, configurable: true });
  Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
  let actors = [], phase = "", frames = [], capturing = false, frameId;
  const events = [], nativeAnimate = SVGElement.prototype.animate;
  SVGElement.prototype.animate = function (keyframes, options) {
    const animation = nativeAnimate.call(this, keyframes, options);
    const timing = animation.effect.getTiming();
    const event = { phase, id: this.closest("svg")?.dataset.fixtureId, part: this.classList.contains("bb-character__body") ? "body" : "eyes", startedAt: performance.now(), duration: timing.duration, iterations: timing.iterations };
    events.push(event);
    animation.addEventListener("finish", () => { event.finishedAt = performance.now(); }, { once: true });
    animation.addEventListener("cancel", () => { event.cancelledAt = performance.now(); }, { once: true });
    return animation;
  };
  const face = svg => ({ eyes: [...svg.querySelectorAll("[data-part=eyes]")].map(n => n.getAttribute("d")), mouth: svg.querySelector("[data-part=mouth]").getAttribute("d"), gaze: svg.querySelector(".bb-character__gaze").getAttribute("transform") });
  const point = svg => { const m = svg.querySelector(".bb-character__body").getScreenCTM(); return { x: m.a * 32 + m.c * 32 + m.e, y: m.b * 32 + m.d * 32 + m.f, matrix: [m.a, m.b, m.c, m.d, m.e, m.f] }; };
  const sample = () => ({ at: performance.now(), actors: actors.map(actor => {
    const p = point(actor.svg), body = actor.svg.querySelector(".bb-character__body");
    const live = actor.svg.getAnimations({ subtree: true }).filter(a => a.playState === "running");
    return { id: actor.id, identity: actor.options.identity, size: actor.svg.getBoundingClientRect().width, state: actor.svg.dataset.state, expression: actor.svg.dataset.expression, selected: actor.svg.dataset.motion, faceChanged: JSON.stringify(face(actor.svg)) !== JSON.stringify(actor.face), bodyLive: live.some(a => a.effect.target === body), animationCount: live.length, displacement: Math.hypot(p.x - actor.point.x, p.y - actor.point.y), matrix: p.matrix };
  }) });
  function capture() { if (!capturing) return; const frame = sample(); frames.push(frame); window.__avatarFrame = frame; frameId = requestAnimationFrame(capture); }
  function finish() { capturing = false; cancelAnimationFrame(frameId); return { phase, frames, events: events.filter(event => event.phase === phase), baseline: actors.map(actor => ({ id: actor.id, options: actor.options, face: actor.face, point: actor.point })) }; }
  function create(id, state, identity, priority, ambient) {
    const row = document.createElement("div"); row.className = ambient ? "sand-agent-item" : "sand-chat-header";
    const svg = RPresenceUI.createCharacterSvg(document, "blob", state === "idle" ? "blue" : "green", 28); svg.dataset.fixtureId = id;
    const label = document.createElement("span"); label.textContent = id + " · " + state + " · 28px"; row.append(svg, label); document.getElementById("avatars").append(row);
    const options = { state, identity, priority, ambient, size: 28, shape: "blob" };
    const handle = RPresenceUI.registerAvatarMotion(svg, { ...options, paused: true });
    actors.push({ id, svg, handle, options, face: face(svg), point: point(svg) }); handle.update(options);
  }
  window.__avatar = {
    start(next) {
      if (capturing) finish(); for (const actor of actors) actor.handle.destroy(); actors = []; frames = []; phase = next; document.getElementById("avatars").replaceChildren();
      localStorage.removeItem("beebot.avatar-motion.v1"); window.dispatchEvent(new StorageEvent("storage", { key: "beebot.avatar-motion.v1" })); window.dispatchEvent(new Event("focus"));
      document.querySelector("h1").textContent = next === "idle" ? "Natural · idle list · actual 28px avatars" : "Natural · four work identities · Bot mirror stays still";
      if (next === "idle") for (let i = 0; i < 4; i++) create("idle-" + i, "idle", "native-idle:" + i, 50, true);
      else { for (const [i, state] of ["working", "reading", "searching", "speaking"].entries()) create("worker-" + i, state, "native-worker:" + i, 100, false); create("mirror", "idle", "native-worker:0", 50, true); create("idle-other", "idle", "native-idle-other", 50, true); }
      capturing = true; capture(); return sample();
    },
    finish, sample,
    off() { localStorage.setItem("beebot.avatar-motion.v1", "off"); window.dispatchEvent(new StorageEvent("storage", { key: "beebot.avatar-motion.v1", newValue: "off" })); return sample(); },
    destroy() { if (capturing) finish(); for (const actor of actors) actor.handle.destroy(); return sample(); },
    environment() { return { hardwareConcurrency: navigator.hardwareConcurrency, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, suppliedFocus: true, suppliedVisibility: true, nativeWAAPI: typeof nativeAnimate === "function", devicePixelRatio, nativeVisibility: document.visibilityState }; },
  };
}

async function nativeMain(config) {
  const { app, BrowserWindow } = require("electron"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
  app.setPath("userData", config.userData);
  const report = { passed: false, scope: "Actual packaged Presence bytes in isolated macOS Electron. Real SVG/WAAPI/frame samples; supplied document focus, visibility and work states. No model/profile and no production FPS/power claim.", electron: config.version, presenceSha256: config.presenceSha256, checks: [], phases: [], consoleErrors: [] };
  let win;
  const check = (label, value) => { assert.ok(value, label); report.checks.push(label); };
  const evaluate = code => win.webContents.executeJavaScript(code);
  const settle = () => evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const stable = frame => frame.actors.every(actor => !actor.faceChanged && !actor.bodyLive && actor.animationCount === 0 && actor.displacement < .01);
  const waitFor = code => evaluate("new Promise((resolve,reject)=>{const start=performance.now();function poll(){if(" + code + "){resolve(window.__avatar.sample());return;}if(performance.now()-start>7000){reject(Error('Native frame condition exceeded deadline'));return;}requestAnimationFrame(poll);}poll();})");
  function summarize(result) {
    const all = result.frames.flatMap(frame => frame.actors), bodies = result.events.filter(event => event.part === "body");
    return { phase: result.phase, frameCount: result.frames.length, elapsedMs: result.frames.at(-1).at - result.frames[0].at, maxScreenDisplacement: Math.max(...all.map(actor => actor.displacement)), maxMovingIdentities: Math.max(...result.frames.map(frame => new Set(frame.actors.filter(actor => actor.faceChanged || actor.bodyLive || actor.displacement > .01).map(actor => actor.identity)).size)), movingIds: [...new Set(all.filter(actor => actor.faceChanged || actor.bodyLive || actor.displacement > .01).map(actor => actor.id))], faceChangeFrames: result.frames.filter(frame => frame.actors.some(actor => actor.faceChanged)).length, bodyEpisodes: bodies.length, completedBodyEpisodes: bodies.filter(event => event.finishedAt !== undefined).length, quietFrames: result.frames.filter(stable).length, allFinite: result.events.every(event => event.iterations === 1 && Number.isFinite(event.duration) && event.duration > 0) };
  }
  const screenshot = async name => fs.writeFileSync(path.join(config.output, name + ".png"), (await win.capturePage()).toPNG());
  await app.whenReady();
  try {
    win = new BrowserWindow({ width: 760, height: 440, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.on("console-message", details => { if (details.level === "error") report.consoleErrors.push(details.message); });
    await win.loadFile(config.html); await settle(); report.environment = await evaluate("window.__avatar.environment()");
    check("native WAAPI available", report.environment.nativeWAAPI);
    check("real hardware supports the Natural budget", report.environment.hardwareConcurrency > 4);
    check("system reduced motion is off for this Natural fixture", report.environment.reducedMotion === false);
    await evaluate("window.__avatar.start('idle')"); await settle();
    check("actual SVG dimensions are 28px", (await evaluate("window.__avatar.sample()")).actors.every(actor => Math.abs(actor.size - 28) < .01));
    await screenshot("idle-baseline");
    await waitFor("window.__avatarFrame.actors.some(actor=>actor.displacement>=.9&&actor.faceChanged)");
    report.idlePeak = await evaluate("window.__avatar.sample()"); await screenshot("idle-motion");
    await evaluate("new Promise(resolve=>setTimeout(resolve,7000))");
    const idle = await evaluate("window.__avatar.finish()"), idleSummary = summarize(idle); report.phases.push(idleSummary);
    fs.writeFileSync(path.join(config.output, "idle-native-frames.json"), JSON.stringify(idle, null, 2));
    check("idle native frames change body and face visibly", idleSummary.maxScreenDisplacement >= .9 && idleSummary.faceChangeFrames > 0);
    check("idle stays within one identity and has at least two finite episodes", idleSummary.maxMovingIdentities === 1 && idleSummary.bodyEpisodes >= 2 && idleSummary.allFinite);
    check("idle has native finish events and quiet reset frames", idleSummary.completedBodyEpisodes >= 2 && idleSummary.quietFrames > 2);
    await evaluate("window.__avatar.start('workers')"); await settle(); await screenshot("workers-baseline");
    await waitFor("window.__avatarFrame.actors.filter(actor=>actor.bodyLive).length===4");
    report.workerPeak = await evaluate("window.__avatar.sample()"); await screenshot("workers-motion");
    await evaluate("new Promise(resolve=>setTimeout(resolve,5000))");
    const workers = await evaluate("window.__avatar.finish()"), workSummary = summarize(workers); report.phases.push(workSummary);
    fs.writeFileSync(path.join(config.output, "workers-native-frames.json"), JSON.stringify(workers, null, 2));
    check("all four work identities have native motion frames", [0, 1, 2, 3].every(i => workSummary.movingIds.includes("worker-" + i)) && workSummary.faceChangeFrames > 0);
    check("budget is four identities, idle and same-Bot mirror stay still", workSummary.maxMovingIdentities === 4 && !workSummary.movingIds.includes("mirror") && !workSummary.movingIds.includes("idle-other"));
    check("work episodes are finite with native finish evidence", workSummary.allFinite && workSummary.completedBodyEpisodes >= 4);
    await evaluate("window.__avatar.off()"); await settle(); report.off = await evaluate("window.__avatar.sample()");
    check("Off cancels effects and resets native face and body", stable(report.off)); await screenshot("workers-off-reset");
    report.destroyed = await evaluate("window.__avatar.destroy()"); check("destroy releases native effects", stable(report.destroyed));
    check("no renderer console errors", report.consoleErrors.length === 0); report.passed = true;
  } catch (error) { report.error = error.stack; }
  finally { fs.writeFileSync(path.join(config.output, "native-avatar-report.json"), JSON.stringify(report, null, 2)); win?.destroy(); app.exit(report.passed ? 0 : 1); }
}

assert.equal(process.platform, "darwin", "Native avatar verification requires macOS Electron.");
const root = process.cwd(), output = path.resolve(process.env.BEEBOT_AVATAR_REPORT_DIR || ".build/avatar-motion-verification");
const archivePath = path.resolve(process.env.BEEBOT_AVATAR_APP_ASAR || "dist/BeeBot.app/Contents/Resources/app.asar");
const temp = await mkdtemp(path.join(tmpdir(), "beebot-native-avatar-"));
try {
  await mkdir(output, { recursive: true }); await mkdir(path.join(temp, "user-data"));
  const renderer = extractFile(archivePath, "dist/renderer/assets/index-UbX-y3il.js").toString("utf8");
  const expected = presenceSharedModule(), offset = renderer.indexOf(expected);
  assert.ok(offset >= 0, "Actual ASAR renderer contains the current shared Presence module.");
  assert.equal(renderer.indexOf(expected, offset + expected.length), -1, "Presence entry is unambiguous.");
  const packaged = renderer.slice(offset, offset + expected.length);
  await writeFile(path.join(temp, "presence.css"), extractFile(archivePath, "dist/renderer/assets/beebot-presence.css"));
  await writeFile(path.join(temp, "fixture.js"), packaged + "\n(" + browserFixture.toString() + ")();");
  const html = path.join(temp, "avatar.html");
  await writeFile(html, `<!doctype html><html data-beebot-theme="presence"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'"><title>BeeBot native avatar verification</title><link rel="stylesheet" href="presence.css"><style>body{margin:0;padding:24px;background:#f7f8fa;color:#24272b;font:14px/1.5 system-ui}h1{font-size:16px;margin:0 0 18px}#avatars{display:grid;grid-template-columns:repeat(2,1fr);gap:18px 24px}.sand-agent-item,.sand-chat-header{display:flex;align-items:center;gap:12px;min-height:56px;padding:12px;background:white;border:1px solid #e0e3e7;border-radius:10px}.bb-character{flex-shrink:0}p{font-size:12px;color:#606974}</style></head><body><h1>Native avatar motion</h1><div id="avatars"></div><p>Isolated fixture · native SVG/WAAPI/frames · supplied activation and work · no model or user profile</p><script src="fixture.js"></script></body></html>`);
  const metadata = JSON.parse(await readFile(path.join(root, "node_modules/electron/package.json"), "utf8"));
  const checksums = JSON.parse(await readFile(path.join(root, "node_modules/electron/checksums.json"), "utf8"));
  const archive = await downloadArtifact({ version: metadata.version, artifactName: "electron", checksums, platform: "darwin", arch: process.arch });
  const runtime = path.join(temp, "electron"); execFileSync("/usr/bin/ditto", ["-x", "-k", archive, runtime], { timeout: 60_000 });
  assert.equal((await readFile(path.join(runtime, "version"), "utf8")).trim().replace(/^v/, ""), metadata.version);
  const config = { userData: path.join(temp, "user-data"), output, html, version: metadata.version, presenceSha256: createHash("sha256").update(packaged).digest("hex") };
  await writeFile(path.join(temp, "native.cjs"), "(" + nativeMain.toString() + ")(" + JSON.stringify(config) + ");");
  await new Promise((resolve, reject) => {
    const child = spawn(path.join(runtime, "Electron.app/Contents/MacOS/Electron"), [path.join(temp, "native.cjs")], { stdio: "inherit", env: { ...process.env } });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Native avatar verification exceeded 60 seconds")); }, 60_000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("Native avatar verification failed: " + (signal ?? code))); });
  });
  console.log(await readFile(path.join(output, "native-avatar-report.json"), "utf8"));
} finally { await rm(temp, { recursive: true, force: true }); }
