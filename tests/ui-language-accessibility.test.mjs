import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { sourceAppDir } from "../scripts/lib/config.mjs";
import { brandProductLiterals } from "../scripts/lib/product-branding.mjs";
import { patchUiLanguageRenderer, uiLanguageBindings } from "../scripts/lib/ui-language-renderer-patch.mjs";

const name = "index-UbX-y3il.js";
const input = brandProductLiterals(await readFile(path.join(sourceAppDir, "dist/renderer/assets", name), "utf8")).source;
const output = patchUiLanguageRenderer(input, uiLanguageBindings(input, name)).source;
const ast = parse(output, { ecmaVersion: "latest", sourceType: "module" });
const node = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "i_n");
assert.ok(node, "the real conversation component is present");
const conversation = output.slice(node.start, node.end);
const cache = conversation.match(/^function i_n\(n\)\{const e=(BB_uiMemo\(he\.c\(\d+\)\))/)?.[1];
assert.ok(cache, "the real conversation uses the language-aware compiler cache");
const start = conversation.indexOf("let ve;"), end = conversation.indexOf("const ge=ve;", start);
assert.ok(start > 0 && end > start);
const viewportRef = conversation.slice(start, end + "const ge=ve;".length);
assert.ok(viewportRef.includes('pn.setAttribute("aria-label",BB_uiText("Conversation transcript"))'));
const runtime = patchUiLanguageRenderer("", { main: true }).source;
const fixture = `
import * as S from 'react';import * as he from 'react/compiler-runtime';import * as p from 'react/jsx-runtime';
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
${runtime}
const stats={mounts:0,unmounts:0,scrolls:0};
function Transcript(){
 const e=${cache};
 const ce=S.useCallback(()=>{},[]),Se=S.useCallback(()=>{},[]),fe=S.useCallback(()=>{},[]);
 const [ke]=S.useState(()=>({read:()=>null})),[be]=S.useState(()=>({probe(){stats.scrolls++}}));
 ${viewportRef}
 const attach=S.useCallback(element=>element?ge({viewportElement:element,rootElement:element}):undefined,[ge]);
 S.useEffect(()=>{stats.mounts++;return()=>{stats.unmounts++}},[]);
 return p.jsx('div',{ref:attach,'data-transcript':true,children:'General {0} — 用户原文'});
}
export function mount(host){const root=createRoot(host);flushSync(()=>root.render(p.jsx(Transcript,{})));return {stats,unmount(){flushSync(()=>root.unmount())}}}
`;
const bundle = await build({ bundle: true, write: false, format: "iife", globalName: "TranscriptFixture", platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' }, stdin: { resolveDir: path.resolve(import.meta.dirname, ".."), contents: fixture } });
const settle = async win => { await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); await win.happyDOM.whenAsyncComplete(); };

test("the actual cached viewport ref updates its accessibility label in place and cleans old scroll listeners", async t => {
  const win = new Window({ url: "https://beebot.test", settings: { enableJavaScriptEvaluation: true } });
  win.console.timeStamp = () => {};
  const errors = []; win.addEventListener("error", event => errors.push(event.message));
  win.desktop = { agent: { getUiLanguage: async () => ({ language: "en" }), setUiLanguage: async language => ({ language }) } };
  win.document.body.innerHTML = "<main></main>";
  win.eval(bundle.outputFiles[0].text + ";window.TranscriptFixture=TranscriptFixture;");
  const host = win.document.querySelector("main"), mounted = win.TranscriptFixture.mount(host);
  t.after(async () => { mounted.unmount(); await win.happyDOM.close(); });
  await settle(win);
  const viewport = host.querySelector("[data-transcript]"); viewport.focus();
  for (const [index, language] of ["zh", "en", "zh"].entries()) {
    await win.__beebotUiLanguage.set(language); await settle(win);
    assert.equal(host.querySelector("[data-transcript]"), viewport);
    assert.equal(viewport.getAttribute("aria-label"), language === "zh" ? "聊天记录" : "Conversation transcript");
    assert.equal(viewport.textContent, "General {0} — 用户原文");
    assert.equal(viewport.getAttribute("aria-live"), "off"); assert.equal(viewport.getAttribute("role"), "log");
    assert.equal(win.document.activeElement, viewport);
    viewport.dispatchEvent(new win.Event("scroll")); assert.equal(mounted.stats.scrolls, index + 1);
  }
  assert.equal(mounted.stats.mounts, 1); assert.equal(mounted.stats.unmounts, 0); assert.deepEqual(errors, []);
});
