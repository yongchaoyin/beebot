import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "acorn";
import { simple } from "acorn-walk";
import { sourceAppDir } from "../scripts/lib/config.mjs";
import { brandProductLiterals } from "../scripts/lib/product-branding.mjs";
import { UI_ZH_TRANSLATIONS } from "../scripts/lib/ui-language-catalog.mjs";
import { patchUiLanguageFormatters } from "../scripts/lib/ui-language-formatters.mjs";

const parseModule = source => parse(source, { ecmaVersion: "latest", sourceType: "module" });
const files = ["index-UbX-y3il.js", "index-BlqerJhg.js", "view-B5Ug8wEm.js", "view-QqBtBG74.js"];
// Read the immutable build inputs, not dist or a package being rebuilt by another
// test. Branding is the same prerequisite used by the shipped renderer adapter.
const chunks = new Map(await Promise.all(files.map(async name => {
  const original = await readFile(path.join(sourceAppDir, "dist/renderer/assets", name), "utf8");
  const before = brandProductLiterals(original).source;
  const after = patchUiLanguageFormatters(before, name);
  return [name, { before, after, beforeAst: parseModule(before), afterAst: parseModule(after) }];
})));
const main = chunks.get(files[0]), settings = chunks.get(files[1]);
const runtime = await readFile(new URL("../scripts/lib/ui-language-runtime.snippet.js", import.meta.url), "utf8");

function functionSource(chunk, name, original = false) {
  const ast = original ? chunk.beforeAst : chunk.afterAst;
  const matches = ast.body.filter(node => node.type === "FunctionDeclaration" && node.id.name === name);
  assert.equal(matches.length, 1, `one actual function named ${name}`);
  const node = matches[0];
  return (original ? chunk.before : chunk.after).slice(node.start, node.end);
}

function variableSource(chunk, name) {
  const matches = [];
  simple(chunk.afterAst, { VariableDeclarator(node) { if (node.id.name === name) matches.push(node); } });
  assert.equal(matches.length, 1, `one actual variable named ${name}`);
  const node = matches[0];
  return chunk.after.slice(node.start, node.end);
}

async function languageRig() {
  const window = new EventTarget();
  window.desktop = { agent: {
    getUiLanguage: async () => ({ language: "en" }),
    setUiLanguage: async language => ({ language }),
  } };
  const document = { documentElement: {} };
  new Function("window", "document", "Event", "BB_UI_ZH", runtime)(window, document, Event, UI_ZH_TRANSLATIONS);
  const api = window.__beebotUiLanguage;
  await api.initialize();
  return {
    api,
    load(chunk, name, dependencies = {}, prelude = "") {
      const bindings = { window, BB_uiText: api.text, BB_uiFormat: api.format, ...dependencies };
      return new Function(...Object.keys(bindings), `${prelude};${functionSource(chunk, name)};return ${name};`)(...Object.values(bindings));
    },
  };
}

function decisions(source, ast) {
  const result = [];
  simple(ast, {
    SwitchCase(node) { if (node.test) result.push(["case", source.slice(node.test.start, node.test.end)]); },
    BinaryExpression(node) {
      if (!["===", "!==", "==", "!=", "<", ">", "<=", ">=", "in", "instanceof"].includes(node.operator)) return;
      if (![node.left, node.right].some(child => child.type === "Literal" && typeof child.value === "string")) return;
      const expression = source.slice(node.start, node.end);
      // This new presentation-only branch selects the date locale. All original
      // operation, permission and state comparisons must retain their bytes.
      if (expression === 'window.__beebotUiLanguage.snapshot()==="zh"') return;
      result.push([node.operator, expression]);
    },
  });
  return result;
}

test("reviewed formatters parse in all four actual chunks without changing operation comparisons or switch values", () => {
  for (const [name, chunk] of chunks) {
    assert.notEqual(chunk.after, chunk.before, name);
    assert.deepEqual(decisions(chunk.after, chunk.afterAst), decisions(chunk.before, chunk.beforeAst), name);
  }
  const unrelated = 'function label(value){return "General"+value}';
  assert.equal(patchUiLanguageFormatters(unrelated, "unrelated.js"), unrelated);
});

test("permission labels follow the selected language without changing permission values", async () => {
  const rig = await languageRig(), permission = rig.load(main, "XGn");
  for (const language of ["zh", "en", "zh"]) {
    await rig.api.set(language);
    for (const [value, english, chinese] of [["ask", "Ask every time", "每次询问"], ["always", "Always allow", "始终允许"], ["never", "Never allow", "从不允许"]]) {
      assert.equal(permission(value), language === "zh" ? chinese : english);
      assert.equal(permission(chinese), undefined, "a translated label does not become an accepted permission ID");
    }
    assert.equal(permission("General"), undefined);
  }
});

test("message placeholders and previews translate their shell while preserving names, user text and URLs", async () => {
  const rig = await languageRig();
  const placeholder = rig.load(main, "$4n");
  // The original preview delegates text normalization; this identity stand-in
  // isolates whether the language adapter itself changes dynamic user content.
  const preview = rig.load(main, "put", { o5e: value => value, Zun: () => { throw new Error("unused attachment branch"); } });
  for (const language of ["zh", "en", "zh"]) {
    await rig.api.set(language);
    const names = [{ name: "General" }, { name: "Save {0}" }, { name: "同事" }];
    assert.equal(placeholder(names), language === "zh" ? "向 General, Save {0}, 同事 发消息" : "Message General, Save {0}, 同事");
    for (const value of ["General", "Save {0}", "Never allow", "用户原文\n第二行"]) assert.equal(preview({ kind: "text", text: value }), value);
    const url = "https://example.invalid/General?title=Save%20%7B0%7D";
    assert.equal(preview({ kind: "link", url }), language === "zh" ? `已发送链接 · ${url}` : `Sent a link · ${url}`);
    assert.equal(preview(null), "");
  }
});

test("update statuses translate known UI text and preserve dynamic backend errors and versions", async () => {
  const rig = await languageRig(), disabled = rig.load(settings, "Ze"), update = rig.load(settings, "ua", { Ze: disabled });
  for (const language of ["zh", "en", "zh"]) {
    await rig.api.set(language);
    const version = "General {0}";
    assert.equal(update({ state: { type: "available", version } }).text,
      language === "zh" ? `BeeBot ${version} 已发布` : `BeeBot ${version} is available`);
    for (const errorMessage of ["Save {0}", "General", "原始服务端错误\n第二行"]) {
      const result = update({ state: { type: "idle", lastCheck: { result: "error", errorMessage } } });
      assert.equal(result.text, `${language === "zh" ? "检查更新失败：" : "Update check failed: "}${errorMessage}`);
      assert.equal(result.tone, "error");
    }
    assert.equal(update({ state: { type: "idle", lastCheck: { result: "error" } } }).text,
      language === "zh" ? "检查更新失败：未知错误" : "Update check failed: unknown error");
    assert.equal(update({ state: { type: "checking" } }).tone, "default");
  }
});

test("attachment counts use natural units and retain attachment kind IDs", async () => {
  const rig = await languageRig(), labels = variableSource(main, "mut");
  const attachment = rig.load(main, "the", {}, `const ${labels}`);
  const cases = [
    ["image", 1, "1 image", "1 张图片"], ["image", 2, "2 images", "2 张图片"],
    ["file", 1, "1 file", "1 个文件"], ["file", 2, "2 files", "2 个文件"],
    ["table", 3, "3 spreadsheets", "3 份表格"], ["pdf", 2, "2 PDFs", "2 份 PDF"],
    ["audio", 2, "2 audio files", "2 个音频文件"],
  ];
  for (const language of ["zh", "en", "zh"]) {
    await rig.api.set(language);
    for (const [kind, count, english, chinese] of cases) assert.equal(attachment(kind, count), language === "zh" ? chinese : english);
    assert.throws(() => attachment("图片", 1), TypeError, "display copy cannot replace an attachment kind ID");
  }
  assert.ok(main.before.includes(labels), "the source attachment table remains byte-for-byte unchanged");
});

test("connection UI preserves external service names and operation metadata", async () => {
  const rig = await languageRig();
  const connection = rig.load(main, "Zon", {
    Ja: (verb, text, icon) => ({ verb, text, icon }), XCe: value => value, Yon: value => value,
  });
  for (const language of ["zh", "en", "zh"]) {
    await rig.api.set(language);
    const value = connection("General");
    assert.equal(value.text, language === "zh" ? "正在连接 General" : "Connecting to General");
    assert.equal(value.verb, "connecting");
    assert.deepEqual(value.icon, { kind: "connector", service: "General" });
    assert.equal(connection(null).text, language === "zh" ? "正在连接第三方应用" : "Connecting to a third party app");
  }
});

test("message accessibility labels preserve dynamic authors, timestamps and message IDs", async () => {
  const rig = await languageRig();
  const message = rig.load(main, "Wht", { Lme: value => value, ZAe: value => value.sender, hGe: 100 });
  const reply = rig.load(main, "rCn", { Wht: message });
  const actions = rig.load(main, "aCn", { Wht: message, Lme: value => value, OEn: value => value });
  for (const language of ["zh", "en", "zh"]) {
    await rig.api.set(language);
    const input = { role: "article", author: "General {0}", timestampMs: "18:18:16", id: "t2s7" };
    assert.equal(message(input), language === "zh" ? "General {0} 的消息" : "General {0} message");
    assert.equal(reply(input), language === "zh" ? "回复General {0} 的消息" : "Reply to General {0} message");
    assert.equal(actions(input), language === "zh" ? "General {0} 的消息的操作，发送时间 18:18:16（t2s7）" : "Message actions for General {0} message at 18:18:16 (t2s7)");
    assert.equal(actions({ ...input, timestampMs: null }), language === "zh" ? "General {0} 的消息的操作（t2s7）" : "Message actions for General {0} message (t2s7)");
    assert.equal(message({ sender: "user" }), language === "zh" ? "你的消息" : "your message");
    assert.equal(message({ sender: "agent" }), language === "zh" ? "Bot 的消息" : "Agent message");
  }
});

test("existing date formatter objects and sidebar dates follow live language changes", async () => {
  const rig = await languageRig(), factory = rig.load(main, "BB_uiDateFormatter");
  const options = { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" };
  const formatter = factory(options), date = new Date("2026-09-23T12:00:00Z");
  const dayStart = value => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const sidebar = rig.load(main, "l5e", { Lze: dayStart, Qun: 86_400_000 });
  const recent = new Date(); recent.setDate(recent.getDate() - 3); recent.setHours(12, 0, 0, 0);
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(12, 0, 0, 0);
  for (const language of ["zh", "en", "zh"]) {
    await rig.api.set(language);
    const locale = language === "zh" ? "zh-CN" : "en";
    assert.equal(formatter.format(date), new Intl.DateTimeFormat(locale, options).format(date));
    assert.equal(sidebar(recent.getTime()), recent.toLocaleDateString(locale, { weekday: "long" }));
    assert.equal(sidebar(yesterday.getTime()), language === "zh" ? "昨天" : "Yesterday");
    assert.equal(sidebar(0), "");
  }
});

test("unreviewed function or label-table drift and repeated formatter patching fail closed", () => {
  const original = functionSource(main, "XGn", true);
  const drifted = main.before.replace(original, original.replace('"Never allow"', '"General"'));
  assert.notEqual(drifted, main.before);
  assert.throws(() => patchUiLanguageFormatters(drifted, files[0]), /differs from the reviewed upstream.*XGn/);
  const labels = variableSource(main, "mut");
  const changedTable = main.before.replace(labels, labels.replace('singular:"image"', 'singular:"General"'));
  assert.notEqual(changedTable, main.before);
  assert.throws(() => patchUiLanguageFormatters(changedTable, files[0]), /anchor drift: attachment label table/);
  for (const [name, chunk] of chunks) assert.throws(() => patchUiLanguageFormatters(chunk.after, name), /differs from the reviewed upstream/);
});
