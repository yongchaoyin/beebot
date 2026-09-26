import { createHash } from "node:crypto";
import { parse } from "acorn";

const MAIN = "index-UbX-y3il.js";
const ROW_HASH = "ad6513a50982ec0f64b4fb10a7fd33b907e1ba9fbe554c26fe863ef2a727f5e4";
const TYPE_LABELS = 'const J5n={assistants:"Agent",automations:"Routine",tools:"Plugin"};function _5n(n){return n.isGroup===!0?"Group":J5n[n.category]}';

function once(source, anchor, replacement, description) {
  const start = source.indexOf(anchor);
  if (start < 0 || source.indexOf(anchor, start + anchor.length) >= 0) {
    throw new Error(`UI language mention anchor drift: ${description}`);
  }
  return source.slice(0, start) + replacement + source.slice(start + anchor.length);
}

// Translate only the suggestion row's display reads. In particular, the
// builder's label/insert.label, filtering and selected mention IDs stay raw.
export function patchUiLanguageMentions(source, name) {
  if (name.split(/[\\/]/).at(-1) !== MAIN) return source;
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const rows = ast.body.filter(node => node.type === "FunctionDeclaration" && node.id?.name === "z5n");
  if (rows.length !== 1) throw new Error("UI language mention row must occur once");
  const row = rows[0], before = source.slice(row.start, row.end);
  if (createHash("sha256").update(before).digest("hex") !== ROW_HASH) {
    throw new Error("UI language mention row differs from the reviewed upstream");
  }
  // _5n returns only this closed UI vocabulary, never a Bot's dynamic name.
  once(source, TYPE_LABELS, TYPE_LABELS, "closed type labels");
  once(source, 'const Zwe="__everyone__";', 'const Zwe="__everyone__";', "everyone identity");
  let after = once(before, ',k=t.label;', ',k=t.id===Zwe&&window.__beebotUiLanguage.snapshot()==="zh"?BB_uiText("All members"):t.label;', "everyone display");
  after = once(after, 'b=_5n(t)', 'b=BB_uiText(_5n(t))', "type display");
  return source.slice(0, row.start) + after + source.slice(row.end);
}
