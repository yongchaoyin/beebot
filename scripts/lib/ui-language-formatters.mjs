import { createHash } from "node:crypto";
import { parse } from "acorn";
import { UI_ZH_TRANSLATIONS } from "./ui-language-catalog.mjs";
import { patchUiLanguageMentions } from "./ui-language-mentions.mjs";

// Reviewed, branded upstream UI formatter bodies. These functions supply copy
// outside JSX props. Their hashes bind this exception to a known implementation;
// arbitrary helpers, messages and transport values are not localization inputs.
const FORMATTERS = {
  "index-UbX-y3il.js": {
    XGn: "1284d5ee32a4b218a64170d537e93f32f1acb0a9f56fe17267bc6e8c8c484098",
    _ln: "302d92aa77756230c5561a2281c311a705006d9c61b7a3e0ed44092bea54a69f",
    dse: "75fcf5632fcba5a64dc49430a734d8d1111e07086a98677758df18e52c1d66f4",
    Zon: "dbd6c6c83b2eb8d560c2c942f836d82755dc7c5ce226568c77238f35dce3f247",
    Fct: "be41c818989fd252a29842ad23558146ab3f80eca8cd4bc2e1d74a3864b1ccc2",
    Zun: "f03af755ce8a05cbaf418c22bbe1047012b98925756bc2cef1063c32d0ba7a6b",
    the: "e43783ade1a029e10c57c67432f003f4d5ea30f37098ee910744715e390199c2",
    put: "a0da8d918491e6c22b987282c08288855c616ea4f1fa7e947d11ad55ec67c9ea",
    $4n: "1d525c6b3a2bf28d69beec0fb5551c3e2e60941ca050a6ca31262fa2d9387abd",
    T9n: "d2c76d56fdec85f45b0a65988e9adbb4458c7cfc230e58b3a331cee49aee9d13",
    u5n: "5629904c40c3f1c82af863f31673ad115ceefd908857202a651402688b7866f1",
    JIn: "10b1f6e89d50dc06b3352abd5f80b45071b040eff60b1c3b440436a9dc59b385",
    ept: "666233665763223cece1b05435bc735e02e7457c50e9442850a4da6d307333fc",
    l5e: "3fecabaf9745107e18a766dbf3c8f2c671d5b42780144d0afaff04a6b3706ea9",
    Wht: "c0063ec878f30d89e6ea8ac059212a74a2b6318d10f72d0f913e8f096d9aa25d",
    rCn: "d0330835177a08ccd49272f131387075d189e38de9997ea7a9550e00b0f130fb",
    aCn: "6e7d91f60e4f06316af097e1860496c9630f203a14e1977f45b1d61db344e754",
  },
  "index-BlqerJhg.js": {
    ca: "cf58696d1944bf9d65c543febd63f1fe864b82bb3b443990a3056fb3a5f950ec",
    Ze: "61a44b8dc43a0c456e3aa14fab030da44d18b4039bc683fe78f1ccd260fa8849",
    ua: "ff10c88200a2f376c0dc2ca0df2dd78978f264cb3be3b3c2c448b3dba31502b6",
  },
  "view-B5Ug8wEm.js": {
    _l: "ec6facda519eabca9be8ae6c30b8ab60dcb335e006e9ae9b01a80fa4b73dbfd6",
    ct: "e05dbc0d3b4eb80d9dc5a54cdb20e4611ce92446db89b92a86a4815d44ac08e7",
    bi: "0e340dd8fc8fedf1fad33e4534d022bc016c4f5305657c4ce1bcbe5d3f04ca49",
    vi: "e29a81412d9f079ea7d538adfd655167c348b7eb78af7740216f3f601e166186",
  },
  "view-QqBtBG74.js": {
    J: "718c5ed7da930a8ab390a5967979dad3a08c8e2d6d347b3ffc258986b8ac7c32",
    ue: "be13e10b0660b0fe3fc0b4e639541362d51fa9b9f03b8532ee017a4d0592dec7",
  },
};
const UI_LOCALE = 'window.__beebotUiLanguage.snapshot()==="zh"?"zh-CN":"en"';
const TRANSCRIPT_VIEWPORT_REF = 'Rn=>{const pn=Rn?.viewportElement??null,hs=Rn?.rootElement??null;if(pn==null||hs==null){ce(null),Se(null);return}pn.setAttribute("aria-label","Conversation transcript"),pn.setAttribute("aria-live","off"),pn.setAttribute("role","log"),pn.tabIndex=0,ce(pn),Se(hs),fe(pn);const Cs=ws=>{ws.target instanceof Node&&pn.contains(ws.target)||ke.read()?.interruptForUserGesture(pn.scrollTop)};hs.addEventListener("pointerdown",Cs,{passive:!0});const Hn=()=>be.probe();return pn.addEventListener("scroll",Hn,{passive:!0}),()=>{hs.removeEventListener("pointerdown",Cs),pn.removeEventListener("scroll",Hn),fe(null),ce(null),Se(null)}}';
const ATTACHMENT_LABELS = 'mut={image:{singular:"image",plural:"images"},video:{singular:"video",plural:"videos"},audio:{singular:"audio file",plural:"audio files"},pdf:{singular:"PDF",plural:"PDFs"},markdown:{singular:"Markdown file",plural:"Markdown files"},table:{singular:"spreadsheet",plural:"spreadsheets"},json:{singular:"JSON file",plural:"JSON files"},text:{singular:"text file",plural:"text files"},document:{singular:"document",plural:"documents"},archive:{singular:"archive",plural:"archives"},file:{singular:"file",plural:"files"}}';

function replaceOnce(source, before, after, name) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`UI language formatter anchor drift: ${name}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function patchUiLanguageFormatters(source, name) {
  const file = name.split(/[\\/]/).at(-1);
  const expected = FORMATTERS[file];
  if (!expected) return source;
  source = patchUiLanguageMentions(source, name);
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const edits = [];

  // Each recursive result only rewrites reviewed constant copy. Dynamic values
  // retain their original expressions, including raw names, URLs and errors.
  function render(node) {
    // Comparisons are decisions, never display copy. In particular, names such
    // as "Computer" can also be executable tool kinds or other operation IDs.
    if (node.type === "BinaryExpression" && ["===", "!==", "==", "!=", "<", ">", "<=", ">=", "in", "instanceof"].includes(node.operator)) return source.slice(node.start, node.end);
    if (node.type === "Literal" && typeof node.value === "string" && Object.hasOwn(UI_ZH_TRANSLATIONS, node.value)) {
      return `(BB_uiText(${JSON.stringify(node.value)}))`;
    }
    if (node.type === "TemplateLiteral") {
      const key = node.quasis.map((part, i) => part.value.cooked + (i < node.expressions.length ? `{${i}}` : "")).join("");
      if (Object.hasOwn(UI_ZH_TRANSLATIONS, key)) {
        return `(BB_uiFormat(${JSON.stringify(key)},[${node.expressions.map(render).join(",")}]))`;
      }
    }
    const children = [];
    for (const [key, value] of Object.entries(node)) {
      // A label such as "Computer" is also an executable tool kind. Translating
      // case tests or keys would change control flow rather than presentation.
      if (node.type === "SwitchCase" && key === "test") continue;
      if ((node.type === "Property" || node.type === "MethodDefinition") && key === "key") continue;
      if (node.type === "MemberExpression" && key === "property") continue;
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === "object" && typeof child.type === "string" && Number.isInteger(child.start)) children.push(child);
      }
    }
    let result = source.slice(node.start, node.end);
    for (const child of children.sort((a, b) => b.start - a.start)) {
      const replacement = render(child);
      result = result.slice(0, child.start - node.start) + replacement + result.slice(child.end - node.start);
    }
    return result;
  }

  for (const [functionName, hash] of Object.entries(expected)) {
    const matches = ast.body.filter(node => node.type === "FunctionDeclaration" && node.id?.name === functionName);
    if (matches.length !== 1) throw new Error(`UI language formatter must occur once: ${file}:${functionName}`);
    const node = matches[0], before = source.slice(node.start, node.end);
    if (createHash("sha256").update(before).digest("hex") !== hash) {
      throw new Error(`UI language formatter differs from the reviewed upstream: ${file}:${functionName}`);
    }
    let after;
    if (file === "index-UbX-y3il.js" && functionName === "the") {
      // The selector remains the original attachment-kind ID. Only the count
      // template composed from the authenticated closed label table is translated.
      replaceOnce(source, ATTACHMENT_LABELS, ATTACHMENT_LABELS, "attachment label table");
      after = 'function the(n,e){const t=mut[n];return BB_uiFormat("{0} "+(e===1?t.singular:t.plural),[e])}';
    } else {
      after = render(node);
    }
    if (file === "index-UbX-y3il.js" && functionName === "l5e") {
      if ((after.match(/toLocaleTimeString\(\[\],/g) ?? []).length !== 1 || (after.match(/toLocaleDateString\(\[\],/g) ?? []).length !== 3) throw new Error("UI language formatter locale anchors drift: sidebar time");
      after = after.replaceAll("toLocaleTimeString([],", `toLocaleTimeString(${UI_LOCALE},`).replaceAll("toLocaleDateString([],", `toLocaleDateString(${UI_LOCALE},`);
    }
    if (after === before) throw new Error(`UI language formatter has no catalog copy: ${file}:${functionName}`);
    edits.push({ start: node.start, end: node.end, text: after });
  }
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);

  if (file === "index-UbX-y3il.js") {
    // The enclosing conversation component subscribes through BB_uiMemo; a
    // language change regenerates this cached ref without replacing its DOM.
    result = replaceOnce(result, TRANSCRIPT_VIEWPORT_REF, TRANSCRIPT_VIEWPORT_REF.replace('pn.setAttribute("aria-label","Conversation transcript")', 'pn.setAttribute("aria-label",BB_uiText("Conversation transcript"))'), "transcript viewport ref");
    result = replaceOnce(result, 'c=s&&u!=null?"Open account menu, new update available":"Open account menu"', 'c=s&&u!=null?BB_uiText("Open account menu, new update available"):BB_uiText("Open account menu")', "account button accessibility label");
    result = replaceOnce(result, 'idleLabel:"Update",isPending:t,onConfirm:()=>m(!1),pendingLabel:"Updating…"', 'idleLabel:BB_uiText("Update"),isPending:t,onConfirm:()=>m(!1),pendingLabel:BB_uiText("Updating…")', "computer update confirmation labels");
    for (const [variable, options] of [
      ["jIn", '{hour:"numeric",minute:"2-digit"}'],
      ["DIn", '{weekday:"short",month:"short",day:"numeric"}'],
      ["RIn", '{month:"short",day:"numeric",year:"numeric"}'],
    ]) {
      result = replaceOnce(result, `${variable}=new Intl.DateTimeFormat(void 0,${options})`, `${variable}=BB_uiDateFormatter(${options})`, `${variable} date locale`);
    }
    // Match the upstream .format-only contract and retain one Intl instance per
    // selected language, instead of constructing one for every message row.
    result += `\nfunction BB_uiDateFormatter(options){let locale,formatter;return{format(value){const next=${UI_LOCALE};if(locale!==next){formatter=new Intl.DateTimeFormat(next,options);locale=next}return formatter.format(value)}}}\n`;
  }

  if (file === "index-BlqerJhg.js") {
    // These two UI variables mix formatter/JSX branches with static copy. Keep
    // the dynamic branches untouched instead of widening generic alias inference.
    for (const copy of [
      "Route web traffic from BeeBot's computer out through this desktop instead of the cloud. Applies to new connections.",
      "BeeBot's computer wasn't provisioned with the egress tunnel — start a new one to use this.",
    ]) result = replaceOnce(result, `E=${JSON.stringify(copy)}`, `E=BB_uiText(${JSON.stringify(copy)})`, "egress description branch");
    const trackDescription = "Stable is the safe default. Other tracks ship new builds earlier and more often. Switching checks for updates right away.";
    result = replaceOnce(result, `}):${JSON.stringify(trackDescription)},s[32]=h`, `}):BB_uiText(${JSON.stringify(trackDescription)}),s[32]=h`, "update track description branch");
    // These two closed tables contain UI labels only. Read the label at render
    // time while preserving option value IDs and the source table's bytes.
    const themes = 'const ha={system:"Follow System",light:"Light",dark:"Dark"},ba=_s.map(s=>({value:s,label:ha[s]}))';
    result = replaceOnce(result, themes, 'const ha={system:"Follow System",light:"Light",dark:"Dark"},ba=_s.map(s=>({value:s,get label(){return BB_uiText(ha[s])}}))', "theme labels");
    const tracks = 'Xe={stable:"Stable",nightly:"Nightly",dogfood:"Dogfood"}';
    if (result.indexOf(tracks) < 0 || result.indexOf(tracks) !== result.lastIndexOf(tracks)) throw new Error("UI language formatter anchor drift: update track labels");
    result = replaceOnce(result, 'function fa(s){return{value:s,label:Xe[s]}}', 'function fa(s){return{value:s,get label(){return BB_uiText(Xe[s])}}}', "update track formatter");
  }
  return result;
}
