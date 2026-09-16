import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patchPath = path.join(repoRoot, "scripts/lib/router-renderer-patch.mjs");

const REGISTRY_BEFORE = 'const wDn=[{id:"general",label:"General",icon:"settings-gear"},{id:"usage",label:"Usage & Billing",icon:"chart-bars"},{id:"beta",label:"Updates",icon:"cloud-download"}]';
const LANDING_TITLE_BEFORE = 'id:t,style:k.style,children:"Grok Bot"';
const LANDING_GJN_BEFORE = 'function gjn(n){const e=he.c(7),{headingId:t,auth:s,onSignIn:r}=n,i=s.status.kind==="logging-in"||s.isPending&&s.status.kind!=="logged-in";let o;e[0]!==s||e[1]!==i||e[2]!==r?(o=i?p.jsx(kjn,{auth:s}):p.jsxs(p.Fragment,{children:[p.jsx(p0t,{autoFocus:!0,disabled:!s.isLoaded,onClick:r,trailingIcon:"arrow-right",children:"Sign in"}),s.error!=null?p.jsx(yjn,{message:s.error}):null]}),e[0]=s,e[1]=i,e[2]=r,e[3]=o):o=e[3];let l;return e[4]!==t||e[5]!==o?(l=p.jsx(h0t,{headingId:t,opticalDropPx:cjn,tagline:"Your team of always-on agents that you can give real work to.",children:o}),e[4]=t,e[5]=o,e[6]=l):l=e[6],l}';
const CREATE_AGENT_BEFORE = "function MOn(n){const e=n.roster,t=S.useCallback((r,i)=>e.createAgent({...r,origin:\"user\",...i}),[e]),s=lr(e.deleteAgents);";
const COMPONENT_ANCHOR = "function Sa(s){";
const GENERAL_BEFORE = 'Q=x==="general"?a.jsx(Te,{children:a.jsx(Sa,{auth:t})}):null';
const USAGE_BEFORE = 'Z=x==="usage"?a.jsx(Te,{children:a.jsx(Na,{})}):null';
const APPEARANCE_BEFORE = 'l=a.jsx(re,{title:"Appearance",children:a.jsx(ie,{label:"Theme",variant:"card",children:a.jsx(ye,{"aria-label":"Theme",disabled:n,onValueChange:d,options:ba,placement:"bottom-end",size:"lg",value:e,variant:"filled"})})})';

test("registry Router item survives when landing patches the same renderer chunk", async () => {
  const { applyOriginalRendererRouterPatch } = await import(`${pathToFileURL(patchPath).href}?${Date.now()}`);
  const stageRoot = await mkdir(path.join(os.tmpdir(), "beebot-router-patch-"), { recursive: true }).then(async () => {
    const dir = path.join(os.tmpdir(), `beebot-router-patch-${Date.now()}`);
    await mkdir(path.join(dir, "dist/renderer/assets"), { recursive: true });
    return dir;
  });
  try {
    const sharedChunk = [
      REGISTRY_BEFORE,
      LANDING_TITLE_BEFORE,
      LANDING_GJN_BEFORE,
      CREATE_AGENT_BEFORE,
    ].join("\n");
    const panelChunk = [
      APPEARANCE_BEFORE,
      GENERAL_BEFORE,
      USAGE_BEFORE,
      COMPONENT_ANCHOR,
      "return null}",
    ].join("\n");
    await writeFile(path.join(stageRoot, "dist/renderer/assets/index-shared.js"), sharedChunk);
    await writeFile(path.join(stageRoot, "dist/renderer/assets/index-panel.js"), panelChunk);
    await applyOriginalRendererRouterPatch({ stageRoot });
    const patchedShared = await readFile(path.join(stageRoot, "dist/renderer/assets/index-shared.js"), "utf8");
    assert.match(patchedShared, /id:"router",label:"Router"/);
    assert.match(patchedShared, /RVendorSetup/);
    const patchedPanel = await readFile(path.join(stageRoot, "dist/renderer/assets/index-panel.js"), "utf8");
    assert.match(patchedPanel, /RRouterPanel/);
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
});
