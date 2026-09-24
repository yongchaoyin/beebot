import { EXTERNAL_ACCESS_BY_REASON, EXTERNAL_ACCESS_BY_STATE, EXTERNAL_ACCESS_UNKNOWN, EXTERNAL_FEEDBACK_MESSAGES } from "../../source/shared/product-access-copy.ts";
import { buildSync } from "esbuild";
import { parse } from "acorn";
import { simple } from "acorn-walk";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

let shared;
export function productConnectionsModule() {
  return shared ??= buildSync({ entryPoints: [fileURLToPath(new URL("../../frontend/src/recovered/features/settings/product-connections.ts", import.meta.url))], bundle: true, write: false, format: "iife", globalName: "RProductSettings", platform: "browser", target: "chrome136" }).outputFiles[0].text;
}

/** Only replace reviewed display functions, never account stores or auth IPC.
 * Drift is an error, not a reason to apply a fuzzy replacement. */
export function replaceProductComponent(source, name, sha256, replacement) {
  const matches = [];
  simple(parse(source, { ecmaVersion: "latest", sourceType: "module" }), {
    FunctionDeclaration(node) { if (node.id?.name === name) matches.push(node); },
  });
  const node = matches[0];
  if (matches.length !== 1 || createHash("sha256").update(source.slice(node.start, node.end)).digest("hex") !== sha256) {
    throw new Error(`Product component ${name} differs from the reviewed renderer`);
  }
  return source.slice(0, node.start) + replacement + source.slice(node.end);
}

export function patchProductConnections(source) {
  const result = replaceProductComponent(source, "Vs", "866ae4b5c5283e1a84e9a50cd10de035a0a2bb227728b3471a5457d2c2bcb673", `function Vs({auth}){
    const confirm=Ve(),[error,setError]=de.useState(null),[pending,setPending]=de.useState(false);
    const status=auth.status,loggedIn=status.kind==="logged-in"&&status.authId!=="local",loggingIn=status.kind==="logging-in";
    const disconnect=async()=>{if(pending)return;setPending(true);setError(null);try{if(loggedIn){if(await confirm(Qe))await auth.logout()}else if(loggingIn)await auth.cancelLogin()}catch(reason){setError(String(reason?.message??reason))}finally{setPending(false)}};
    return a.jsxs("div",{children:[a.jsx(RProductConnections,{}),(loggedIn||loggingIn)?a.jsxs("section",{className:"sand-account",children:[a.jsx("h3",{children:"Existing external service session"}),a.jsx("p",{children:status.email??status.displayName??"External provider"}),a.jsx(oe,{disabled:pending||!auth.isLoaded,onClick:disconnect,children:loggingIn?"Cancel":"Sign Out"}),error?a.jsx("p",{role:"alert",children:error}):null]}):null]})
  }`);
  const before = 'd=a.jsx(re,{title:"Account",children:a.jsx(Vs,{auth:t})})';
  if (result.split(before).length !== 2) throw new Error("Product connections group anchor differs");
  return productConnectionsModule() + '\nconst RProductConnections=RProductSettings.createProductConnections(de);\n' + result.replace(before, 'd=a.jsx(Vs,{auth:t})');
}

/** The native menu can also open via keyboard. Retiring only a pointer overlay
 * left official login, billing, iOS-download and support entries reachable. */
export function patchProductAccountMenu(source) {
  return replaceProductComponent(source, "Xln", "2fb200e0f1deac3eac8b4c0d6063532a115e74044ad9f775764ad1abf4a58d93", `function Xln({children,onOpenSettings}){
    const [open,setOpen]=S.useState(false),copy=RAccountCopy();
    const item=(id,label,action)=>p.jsx(It.Item,{onSelect:()=>{setOpen(false);action()},children:label},id);
    return p.jsxs(It,{open,onOpenChange:setOpen,placement:"top-start",children:[p.jsx(It.Trigger,{children}),p.jsx(It.Content,{"aria-label":copy.settings,minWidth:228,size:"md",children:p.jsxs(It.Section,{children:[item("settings",copy.settings,onOpenSettings),item("router",copy.configureAi,()=>ROpenSettings("router")),item("about",copy.about,ROpenAbout),item("docs",copy.documentation,()=>ROpenExternal(RAccountDocs(),copy.openFailed)),item("feedback",copy.feedback,()=>ROpenExternal(RAccountFeedback(),copy.openFailed))]})})]})
  }`);
}

/** Replace only the reviewed display tables. State/reason values and the denial
 * gate remain provider facts; no user gains access or gets silently rerouted. */
export function patchProductAccessCopy(source) {
  const replacements = {
    OVn: { hash: "fdf596a8110ff32092e52c32688cf609cccf899f99dd85036f5ca5175408cf24", copy: EXTERNAL_FEEDBACK_MESSAGES },
    Yvn: { hash: "a78e9141eb3ae3857a576ffce2cf5d79dc2c24a4612e3adc3dbe1cbb6a73c403", copy: EXTERNAL_ACCESS_BY_REASON },
    Zvn: { hash: "a0ddd04a4f9a8de012a068347646e5b687b112ca24a9261beb694c74b6af053a", copy: EXTERNAL_ACCESS_BY_STATE },
  };
  const edits = [];
  simple(parse(source, { ecmaVersion: "latest", sourceType: "module" }), {
    VariableDeclarator(node) {
      if (!Object.hasOwn(replacements, node.id?.name)) return;
      const expected = replacements[node.id.name], value = node.init;
      if (!value || createHash("sha256").update(source.slice(value.start, value.end)).digest("hex") !== expected.hash) {
        throw new Error(`Product access table ${node.id.name} differs from the reviewed renderer`);
      }
      edits.push({ start: value.start, end: value.end, value: JSON.stringify(expected.copy) });
    },
  });
  if (edits.length !== 3) throw new Error("Product access copy tables are missing or ambiguous");
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  return replaceProductComponent(result, "dzn", "e059291e70b0599735d15c98c4f68e8ee280c1b1ce802946e67f326e9cbaa49b",
    `function dzn(n){return T1t(n)??${JSON.stringify(EXTERNAL_ACCESS_UNKNOWN)}}`);
}
