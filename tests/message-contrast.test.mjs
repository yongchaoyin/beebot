import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { buildMessageContrastHarness } from "./helpers/message-contrast-harness.mjs";
import { buildRuntimeThemeCss } from "../frontend/src/recovered/features/runtime-theme-token-installer.ts";

const tokens = await readFile(new URL("../frontend/src/presence/tokens.css", import.meta.url), "utf8");
const presenceCss = await readFile(new URL("../frontend/src/presence/presence.css", import.meta.url), "utf8");
const messageCss = await readFile(new URL("../frontend/src/presence/message-colors.css", import.meta.url), "utf8");
const original = await readFile(new URL("../src/app/dist/renderer/assets/index-lCyB53CO.css", import.meta.url), "utf8");
const theme = (await build({ entryPoints: ["frontend/src/presence/presence.css"], outfile: "theme.css", bundle: true, write: false })).outputFiles[0].text;
const fixture = await buildMessageContrastHarness();
const palettes = tokens.split("color-scheme:").slice(0, 2).map(chunk => Object.fromEntries([...chunk.matchAll(/--bb-([\w-]+): (#[\da-f]{6});/gi)].map(m => [m[1], m[2]])));
const luminance = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);

async function rig(t, mode) {
  const window = new Window({ settings: { enableJavaScriptEvaluation: true } });
  t.after(() => window.happyDOM.close());
  const d = window.document; d.documentElement.dataset.beebotTheme = "presence";
  d.documentElement.dataset.theme = "cursor-" + mode;
  for (const css of [original, buildRuntimeThemeCss("light"), buildRuntimeThemeCss("dark"), theme]) {
    const style = d.createElement("style"); style.textContent = css; d.head.append(style);
  }
  d.body.innerHTML = '<div id="root"></div>';
  window.console.timeStamp = () => {};
  window.eval(fixture.code + "\nwindow.MessageContrastUI = MessageContrastUI;");
  const app = window.MessageContrastUI.mount(d.getElementById("root")); app.theme(mode);
  t.after(() => app.unmount());
  return { window, d, app, color: selector => window.getComputedStyle(d.querySelector(selector)).color.toUpperCase() };
}

for (const [i, mode] of ["light", "dark"].entries()) {
  test(`${mode}: message, mentions, links, quotes and action palettes are paired`, () => {
    const p = palettes[i];
    for (const [fg, bg] of [["user-text", "user"], ["mention-text", "mention-bg"], ["link", "user"], ["muted", "user"], ["danger", "user"], ["on-accent", "accent"], ["code-text", "code-bg"]]) {
      assert.ok(contrast(p[fg], p[bg]) >= 4.5, `${mode}: ${fg}/${bg}`);
    }
    assert.notEqual(p["user-text"], p["on-accent"], "message ink must not reuse filled-button ink");
  });
  test(`${mode}: actual shipped bubble overrides ID-specific inverse utility; descendants keep their roles`, async t => {
    const { color, d, window } = await rig(t, mode); const p = palettes[i];
    assert.equal(color("#packaged-plain .sand-message"), p["user-text"]);
    assert.equal(color("#packaged-plain .sand-message-content"), p["user-text"]);
    assert.equal(color("#packaged-rich strong"), p["user-text"]);
    assert.equal(color("#packaged-rich [data-type=mention]"), p["mention-text"]);
    assert.equal(color("#packaged-rich a"), p.link);
    assert.equal(window.getComputedStyle(d.querySelector("#packaged-rich a")).textDecorationLine, "underline");
    // happy-dom propagates inherited !important unlike Chromium; verify the
    // quote role here and measure its resolved foreground in browser regression.
    assert.ok(d.querySelector("#packaged-rich blockquote").classList.contains("sand-19aaqeu"));
    assert.equal(color("#recovered .sand-message[data-role=user] .sand-mention"), p["mention-text"]);
    assert.equal(color("#recovered .sand-message[data-role=assistant] .sand-message-prose"), p.text);
    const user = d.querySelector("#packaged-plain .sand-message");
    assert.ok(original.includes(`.${[...user.classList].find(c => c === "sand-70xvah")}:not(#\\#)`), "fixture retains actual higher-specificity upstream ink rule");
  });
}

test("theme and delivery changes preserve message, mention, avatar and draft nodes", async t => {
  const { d, app, color } = await rig(t, "light");
  const bubble = d.querySelector("#packaged-rich .sand-message"), chip = bubble.querySelector('[data-type="mention"]'), avatar = chip.querySelector('svg'), editor = d.querySelector('[contenteditable="true"]');
  editor.focus(); editor.textContent = "保留草稿";
  for (const mode of ["dark", "light", "dark", "light"]) {
    app.theme(mode);
    for (const phase of ["queued", "pending", "failed", "uncertain", "sent"]) app.phase(phase);
    assert.equal(d.querySelector("#packaged-rich .sand-message"), bubble);
    assert.equal(bubble.querySelector('[data-type="mention"]'), chip);
    assert.equal(chip.querySelector('svg'), avatar);
    assert.equal(d.querySelector('[contenteditable="true"]'), editor);
    assert.equal(d.activeElement, editor);
    assert.equal(editor.textContent, "保留草稿");
    assert.equal(color("#packaged-plain .sand-message-content"), palettes[mode === "light" ? 0 : 1]["user-text"]);
  }
});

test("targeted theme cannot recolor every message child, global inverse tokens, or avatar fills", () => {
  assert.match(messageCss, /color: var\(--bb-user-text\) !important/);
  assert.match(theme, /--bb-user-text/);
  assert.match(theme, /--bb-mention-bg/);
  assert.doesNotMatch(messageCss, /--cursor-text-invert\s*:|--sand-text-on-primary\s*:|\*\s*\{|\bfill\s*:|opacity\s*:/);
  assert.match(messageCss, /forced-colors:\s*active/);
  assert.match(messageCss, /color: LinkText !important/);
});

// A theme flip changes the icon immediately. A background-only transition leaves
// it temporarily dark-on-dark (or white-on-white), even with good endpoint colors.
test("send control changes paired colors together while retaining press motion", () => {
  const rule = presenceCss.match(/html\[data-beebot-theme="presence"\] :is\(\.sand-prompt-send,[\s\S]*?\n\}/)?.[0];
  assert.ok(rule, "the shared send-control rule must exist");
  assert.match(rule, /background: var\(--bb-accent\); color: var\(--bb-on-accent\)/);
  assert.match(rule, /transition: transform var\(--bb-fast\)/);
  assert.doesNotMatch(rule, /transition:[^;]*(?:background|color|all)/);
});
