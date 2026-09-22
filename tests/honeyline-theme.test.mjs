import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Window } from "happy-dom";
import { installHoneyline } from "../frontend/src/honeyline/install.ts";
import { workLabel } from "../frontend/src/honeyline/status.ts";
import { characterLayers, characterVariant, createCharacterSvg } from "../frontend/src/honeyline/avatar-art.ts";
import { buildRuntimeThemeCss } from "../frontend/src/recovered/features/runtime-theme-token-installer.ts";

const tokens = await readFile(new URL("../frontend/src/presence/tokens.css", import.meta.url), "utf8");
const css = await readFile(new URL("../frontend/src/honeyline/honeyline.css", import.meta.url), "utf8");
const palette = chunk => Object.fromEntries([...chunk.matchAll(/--bee-([\w-]+): (#[\da-f]{6});/gi)].map(match => [match[1], match[2]]));
const luminance = hex => {
  const components = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return components.reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
};
const contrast = (a, b) => { const [low, high] = [luminance(a), luminance(b)].sort((a, b) => a - b); return (high + .05) / (low + .05); };

for (const [index, mode] of ["light", "dark"].entries()) {
  test(`Honeyline ${mode} text and focus contrast cover actual surfaces`, () => {
    const colors = palette(tokens.split("color-scheme:")[index]);
    for (const background of ["bg", "surface", "sidebar", "user", "selected"]) {
      for (const foreground of ["text", "muted", "link", "danger", "success", "warning"]) {
        const ratio = contrast(colors[foreground], colors[background]);
        assert.ok(ratio >= 4.5, `${mode} ${foreground}/${background}: ${ratio.toFixed(2)}`);
      }
      assert.ok(contrast(colors.focus, colors[background]) >= 3, `${mode} focus/${background}`);
    }
    assert.ok(contrast(colors["on-accent"], colors.accent) >= 4.5);
    assert.ok(contrast(colors["code-text"], colors["code-bg"]) >= 4.5);
  });
}

test("theme installation is idempotent and leaves preference, draft, focus, scroll and listeners alone", async t => {
  const window = new Window(); t.after(() => window.happyDOM.close());
  const { document } = window;
  document.documentElement.dataset.theme = "cursor-dark";
  document.body.innerHTML = '<div id="history">History</div><textarea aria-label="draft">Keep this draft</textarea>';
  const editor = document.querySelector("textarea"), history = document.querySelector("#history");
  editor.focus(); editor.setSelectionRange(4, 9); history.scrollTop = 20;
  const before = buildRuntimeThemeCss("dark");
  installHoneyline(document); installHoneyline(document);
  assert.equal(document.documentElement.dataset.theme, "cursor-dark");
  assert.equal(document.documentElement.dataset.beebotTheme, "presence");
  assert.equal(document.querySelector("textarea"), editor); assert.equal(document.activeElement, editor);
  assert.equal(editor.value, "Keep this draft"); assert.equal(editor.selectionStart, 4); assert.equal(history.scrollTop, 20);
  assert.equal(window.localStorage.length, 0); assert.equal(document.head.children.length, 0);
  assert.equal(buildRuntimeThemeCss("dark"), before, "immutable palette stays untouched");
});

test("work labels distinguish input needed, actual work and idle without inventing stages", () => {
  assert.equal(workLabel({ isRunning: false, currentActivity: { verb: "reading" } }), null, "stale activity is not work");
  assert.equal(workLabel({}), null);
  assert.equal(workLabel({ awaitingUserResponse: false }), null);
  assert.equal(workLabel({ waitingReason: "Permission needed" }).state, "waiting", "free text is not proof that the user owns an action");
  assert.equal(workLabel({ isRunning: true, awaitingUserResponse: { id: "permission" } }).state, "attention");
  assert.equal(workLabel({ isRunning: true, currentActivity: { verb: "reading" } }).zh, "正在查阅资料");
  assert.equal(workLabel({ isRunning: true, currentActivity: { verb: "running-commands" } }).en, "Running commands");
  assert.equal(workLabel({ isComposingMessage: true }).zh, "正在回复");
  assert.equal(workLabel({ isRunning: true, currentActivity: { verb: "unexpected" } }).en, "Working");
  assert.doesNotMatch(JSON.stringify(workLabel({ isRunning: true })), /complete|完成|%/i);
});

test("original avatars are deterministic, distinct and safe for untrusted persona values", async t => {
  const window = new Window(); t.after(() => window.happyDOM.close());
  for (const shape of ["blob", "tablet", "pebble", "wedge"]) assert.equal(characterVariant(shape), characterVariant(shape));
  assert.equal(new Set(["blob", "tablet", "pebble", "wedge"].map(characterVariant)).size, 4);
  const first = createCharacterSvg(window.document, "blob", "yellow", 32);
  const second = createCharacterSvg(window.document, "blob", "yellow", 32);
  assert.equal(first.outerHTML, second.outerHTML, "no random IDs or color drift");
  const hostile = createCharacterSvg(window.document, '"><script>alert(1)</script>', "__proto__", NaN);
  assert.equal(hostile.querySelector("script"), null); assert.equal(hostile.getAttribute("width"), "32");
  assert.equal(hostile.querySelector("path").getAttribute("fill"), "#C4CBD5");
  assert.ok(characterLayers("blob", "green").length >= 4);
});

test("CSS keeps reduced motion, forced colors, focus, readable code and inline collaboration states", () => {
  assert.match(css, /prefers-reduced-motion:\s*reduce/); assert.match(css, /forced-colors:\s*active/);
  assert.match(css, /:focus-visible/); assert.match(css, /font: 13px\/1\.65 var\(--bee-mono\)/);
  assert.match(css, /data-state="needs-review"/); assert.match(css, /data-bb-publication/);
  assert.doesNotMatch(css, /animation:[^;]*infinite|scroll-behavior:\s*smooth|\.sand-[0-9][a-z0-9]{5,}\b/);
});
