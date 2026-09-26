import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import { sourceAppDir } from "../scripts/lib/config.mjs";
import { patchUiLanguageMentions } from "../scripts/lib/ui-language-mentions.mjs";
import { patchUiLanguageRenderer } from "../scripts/lib/ui-language-renderer-patch.mjs";
import { UI_ZH_TRANSLATIONS } from "../scripts/lib/ui-language-catalog.mjs";

const name = "index-UbX-y3il.js";
const before = await readFile(path.join(sourceAppDir, "dist/renderer/assets", name), "utf8");
const after = patchUiLanguageMentions(before, name);
const parseModule = source => parse(source, { ecmaVersion: "latest", sourceType: "module" });
const originalAst = parseModule(before), patchedAst = parseModule(after);
function functionSource(source, ast, name) {
  const matches = ast.body.filter(node => node.type === "FunctionDeclaration" && node.id?.name === name);
  assert.equal(matches.length, 1);
  return source.slice(matches[0].start, matches[0].end);
}
const originalRow = functionSource(before, originalAst, "z5n");
const patchedRow = functionSource(after, patchedAst, "z5n");
const typeLabel = functionSource(after, patchedAst, "_5n");
const builder = functionSource(after, patchedAst, "Q5n");
const source = patchUiLanguageRenderer(`const Zwe="__everyone__";const J5n={assistants:"Agent",automations:"Routine",tools:"Plugin"};${typeLabel}${builder}${patchedRow}`, {
  main: true, cacheBinding: "he", reactBinding: "S",
}).source;

// Execute the actual pinned builder and compiled row, with controlled JSX and
// hooks. The shared language runtime and cache transform are production code;
// React DOM/no-remount behavior is covered by packaged-ui-language.test.mjs.
async function rig() {
  const window = new EventTarget(), document = { documentElement: {} };
  window.desktop = { agent: { getUiLanguage: async () => ({ language: "en" }), setUiLanguage: async language => ({ language }) } };
  let cache;
  const he = { c(size) { return cache ??= Array(size).fill(Symbol.for("react.memo_cache_sentinel")); } };
  const S = { useSyncExternalStore(_subscribe, snapshot) { return snapshot(); } };
  const p = { jsx: (type, props) => ({ type, props }) };
  const bindings = { window, document, Event, he, S, p, re: (...values) => values.join(" "), Fe: () => ({ className: "item" }), kge: { item: {} }, Alt: "actual-row-button", R5n: "actual-row-icon" };
  const components = new Function(...Object.keys(bindings), `${source};return {row:z5n,build:Q5n,typeLabel:_5n}`)(...Object.values(bindings));
  await window.__beebotUiLanguage.initialize();
  return { ...components, api: window.__beebotUiLanguage, render(props) { return components.row({ rowIndex: 0, isActive: true, listboxId: "mentions", activeRef: null, onHover() {}, ...props }).props.children.props; } };
}

test("only the reviewed display row changes; IDs, builder, search and mention insertion retain their exact bytes", () => {
  assert.equal(after.replace(patchedRow, originalRow), before);
  for (const name of ["Q5n", "_5n", "O5n", "B5n", "mHe", "S5n"]) {
    assert.equal(functionSource(after, patchedAst, name), functionSource(before, originalAst, name), name);
  }
  assert.equal(UI_ZH_TRANSLATIONS["All members"], "所有成员");
  assert.equal(UI_ZH_TRANSLATIONS.everyone, undefined, "the insertion label must not become a generic translation key");
});

test("actual everyone row switches both ways while pointer and keyboard selection keep the original payload", async () => {
  const r = await rig();
  const entries = r.build({ getMembers: () => [{ id: "first", name: "小微" }, { id: "second", name: "everyone" }] });
  const entry = entries[0], original = JSON.stringify(entries), selections = [];
  Object.freeze(entry.insert); Object.freeze(entry);
  const onActivate = () => selections.push(entry.insert);
  for (const language of ["en", "zh", "en", "zh"]) {
    await r.api.set(language);
    const row = r.render({ entry, onActivate });
    assert.equal(row.name, language === "zh" ? "所有成员" : "everyone");
    assert.equal(row.trailing, language === "zh" ? "Bot" : "Agent");
    assert.equal(row.id, "mentions-option-0");
    let prevented = false;
    row.onPointerDown({ button: 0, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    row.onClick({ detail: 0 });
    const count = selections.length;
    row.onClick({ detail: 1 });
    row.onPointerDown({ button: 2, preventDefault() { throw new Error("secondary button"); } });
    assert.equal(selections.length, count, "pointer click does not duplicate activation");
    assert.equal(JSON.stringify(entries), original);
  }
  assert.equal(selections.length, 8);
  for (const payload of selections) {
    assert.equal(payload, entry.insert);
    assert.deepEqual(payload, { type: "mention", id: "__everyone__", label: "everyone" });
  }
});

for (const surface of ["single-bot", "group-room"]) test(`${surface}: Bot names matching UI copy remain user text in both languages`, async () => {
  const r = await rig();
  for (const name of ["everyone", "Agent", "All members", "General", "小微"]) {
    const member = { id: "bot-identity", name };
    const entries = r.build({ getMembers: () => surface === "single-bot" ? [member] : [member, { id: "other", name: "Other" }] });
    const entry = entries.find(row => row.id === member.id);
    const onActivate = () => {};
    for (const language of ["zh", "en", "zh"]) {
      await r.api.set(language);
      const row = r.render({ entry, onActivate });
      assert.equal(row.name, name);
      assert.equal(row.trailing, language === "zh" ? "Bot" : "Agent");
      assert.deepEqual(entry.insert, { type: "mention", id: member.id, label: name });
    }
    assert.equal(entries.some(row => row.id === "__everyone__"), surface === "group-room");
  }
});

test("the type label helper only returns the authenticated closed UI vocabulary", async () => {
  const r = await rig();
  for (const [category, label] of [["assistants", "Agent"], ["automations", "Routine"], ["tools", "Plugin"]]) {
    assert.equal(r.typeLabel({ category, name: "secret user text", label: "secret user text" }), label);
  }
  assert.equal(r.typeLabel({ category: "assistants", isGroup: true, label: "Group name" }), "Group");
  assert.equal(r.typeLabel({ category: "unknown", label: "secret user text" }), undefined);
});

test("unknown chunks are untouched and reviewed row/identity/type drift fails closed", () => {
  assert.equal(patchUiLanguageMentions("not even JavaScript", "unrelated.js"), "not even JavaScript");
  assert.throws(() => patchUiLanguageMentions(before.replace("function z5n(n){", "function z5n(n){void 0;"), name), /reviewed upstream/);
  assert.throws(() => patchUiLanguageMentions(before.replace('const Zwe="__everyone__";', 'const Zwe="other";'), name), /everyone identity/);
  assert.throws(() => patchUiLanguageMentions(before.replace('assistants:"Agent",automations:"Routine",tools:"Plugin"', 'assistants:"Agent",automations:"Routine",tools:"user value"'), name), /closed type labels/);
  assert.throws(() => patchUiLanguageMentions(before.replace("function z5n(n){", "function renamedRow(n){"), name), /row must occur once/);
});
