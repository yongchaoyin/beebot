import assert from "node:assert/strict";
import test from "node:test";
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "acorn";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { simple } from "acorn-walk";
import { patchOriginalSettingsPanel } from "../scripts/lib/router-renderer-patch.mjs";
import { patchProductAccessCopy } from "../scripts/lib/product-settings-patch.mjs";
import { brandProductLiterals, retireUnusedBrandAssets } from "../scripts/lib/product-branding.mjs";
import { inspectProductAliases } from "../scripts/lib/product-identity-audit.mjs";
const compiled = await build({ entryPoints: ["frontend/src/recovered/features/access/cover/model.ts"], bundle: true, write: false, platform: "node", format: "cjs" });
const model = { exports: {} };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), model, model.exports);
const { accessNoticeCopy, accessCoverCopy, shouldShowAccessCover, openAccessOnboarding } = model.exports;

const original = await readFile("src/app/dist/renderer/assets/index-UbX-y3il.js", "utf8");
const policy = JSON.parse(await readFile("scripts/lib/retired-brand-assets.json", "utf8"));

function accessFunctions(source) {
  const values = [], functions = [];
  simple(parse(source, { ecmaVersion: "latest", sourceType: "module" }), {
    VariableDeclarator(node) {
      if (["Yvn", "Zvn"].includes(node.id?.name)) values.push(`const ${source.slice(node.start, node.end)};`);
    },
    FunctionDeclaration(node) {
      if (["Xvn", "T1t", "dzn"].includes(node.id?.name)) functions.push(source.slice(node.start, node.end));
    },
  });
  assert.equal(values.length, 2); assert.equal(functions.length, 3);
  return new Function([...values, ...functions, "return { notice: T1t, cover: dzn }"].join("\n"))();
}

const before = accessFunctions(original);
const after = accessFunctions(brandProductLiterals(patchProductAccessCopy(original)).source);

test("every shipped access state agrees with source copy without implying a BeeBot purchase", () => {
  for (const state of ["checking", "unknown", "granted", "unavailable", "paymentRequired"]) {
    for (const reason of ["none", "teamPrivacyMode", "teamSetupRequired", "teamAccessRequired", "notOffered", "freeTrialAvailable", "paywallIndividual", "paywallTeamMember", "paywallTeamAdmin", "unspecified"]) {
      const input = { state, reason };
      assert.deepEqual(after.notice(input), accessNoticeCopy(input));
      assert.deepEqual(after.cover(input), accessCoverCopy(input));
      // Copy corrections never turn a provider denial into "granted" or hide it.
      assert.equal(after.notice(input) == null, before.notice(input) == null);
      const text = JSON.stringify(after.cover(input));
      assert.doesNotMatch(text, /Grok Bot|\bCursor\b|Get Ultra|Premium seat|Start Trial|BeeBot needs/);
      assert.match(text, /external|provider/i);
      assert.match(text, /Settings/);
    }
  }
});

test("the access cover still respects denial, restored roster and computer recovery gates", () => {
  const baseline = { rosterFailureCode: "sand-access-blocked", hasReachedBox: false, isShowingRestoredRoster: false, isComputerRebuildLocked: false };
  assert.equal(shouldShowAccessCover(baseline), true);
  for (const field of ["hasReachedBox", "isShowingRestoredRoster", "isComputerRebuildLocked"]) {
    assert.equal(shouldShowAccessCover({ ...baseline, [field]: true }), false);
  }
  assert.equal(shouldShowAccessCover({ ...baseline, rosterFailureCode: null }), false);
});

test("connection help uses BeeBot documentation, never a retired purchase URL or authorization mutation", async () => {
  const calls = [];
  await openAccessOnboarding({ openExternal: async url => calls.push(url) });
  assert.deepEqual(calls, ["https://github.com/yongchaoyin/beebot#readme"]);
  assert.equal(before.notice({ state: "paymentRequired", reason: "paywallIndividual" }).title, "Grok Bot needs an Ultra plan");
});

test("modified or missing access copy anchors fail closed", () => {
  assert.throws(() => patchProductAccessCopy(original.replace('title:"Grok Bot needs an Ultra plan"', 'title:"new provider state"')), /differs from the reviewed/);
  assert.throws(() => patchProductAccessCopy(original.replace("Yvn={", "UnknownTable={")), /missing or ambiguous/);
  assert.throws(() => patchProductAccessCopy(original.replace("function dzn(n){", "function dzn(n){void 0;")), /differs from the reviewed/);
});

async function artworkFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "bb-identity-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assets = path.join(root, "assets"); await mkdir(assets);
  for (const entry of policy) await cp(`src/app/dist/renderer/assets/${entry.file}`, path.join(assets, entry.file));
  return { root, assets };
}
async function assertAllRetained(assets) {
  for (const entry of policy) await access(path.join(assets, entry.file));
}

for (const consumer of ["index.html", "panels/lazy.mjs", "assets/nested/theme.css", "assets/nested/media.svg", "manifest.webmanifest"]) {
  test(`retired artwork remains intact when referenced by ${consumer}`, async t => {
    const { root, assets } = await artworkFixture(t), ref = path.join(root, consumer);
    await mkdir(path.dirname(ref), { recursive: true });
    await writeFile(ref, `./assets/${policy.at(-1).file}?theme=light#preview`);
    await assert.rejects(retireUnusedBrandAssets(assets, { rendererRoot: root }), /still referenced/);
    await assertAllRetained(assets);
    await rm(ref);
    assert.equal((await retireUnusedBrandAssets(assets, { rendererRoot: root })).length, policy.length);
  });
}

test("missing or nonregular artwork fails before any other deletion", async t => {
  const { root, assets } = await artworkFixture(t), last = path.join(assets, policy.at(-1).file);
  await rm(last);
  await assert.rejects(retireUnusedBrandAssets(assets, { rendererRoot: root }), { code: "ENOENT" });
  for (const entry of policy.slice(0, -1)) await access(path.join(assets, entry.file));
  await mkdir(last);
  await assert.rejects(retireUnusedBrandAssets(assets, { rendererRoot: root }), /not a regular file/);
  for (const entry of policy.slice(0, -1)) await access(path.join(assets, entry.file));
});

test("asset scans reject symlinked input and a root outside the audited renderer", async t => {
  const { root, assets } = await artworkFixture(t);
  await symlink(path.join(assets, policy[0].file), path.join(root, "linked.svg"));
  await assert.rejects(retireUnusedBrandAssets(assets, { rendererRoot: root }), /symbolic link/);
  await assertAllRetained(assets);
  await assert.rejects(retireUnusedBrandAssets(assets, { rendererRoot: path.join(root, "other") }), /must belong/);
});

test("identity guard covers mixed-case product text, the entry HTML and retired onboarding links", async () => {
  for (const code of ['const label="grok bot settings";', 'const label=`GROK BOT settings`;', 'const href="https://cursor.com/bot/onboarding";']) {
    assert.equal((await inspectProductAliases("frontend/src/example.ts", code)).length, 1);
  }
  assert.equal((await inspectProductAliases("frontend/index.html", "<title>Grok Bot</title>")).length, 1);
  assert.deepEqual(await inspectProductAliases("source/example.ts", 'const model="grok-4", style="cursor: pointer", api="https://api2.cursor.sh";'), []);
  assert.deepEqual(await inspectProductAliases("source/example.ts", '// Grok Bot attribution comment\nexport const title="BeeBot";'), []);
});

test("usage UI has no retired plan, trial or purchase actions for any selectable provider", async () => {
  const result = await build({ bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic",
    loader: { ".css": "empty", ".woff2": "empty" },
    stdin: { resolveDir: process.cwd(), sourcefile: "usage-fixture.tsx", loader: "tsx", contents: `
      import { renderToStaticMarkup } from "react-dom/server";
      import { UsageSettingsPanel } from "./frontend/src/recovered/features/settings/overlay/panels";
      import { ROUTER_PROVIDERS } from "./frontend/src/recovered/features/settings/overlay/router";
      export const providers = ROUTER_PROVIDERS.map(p => ({ id:p.id, label:p.label }));
      export const render = provider => renderToStaticMarkup(<UsageSettingsPanel provider={provider}/>);
    ` } });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  for (const provider of module.exports.providers) {
    const html = module.exports.render(provider.id);
    assert.match(html, new RegExp(provider.label));
    assert.doesNotMatch(html, /Grok|Cursor|Ultra|Premium|Trial|<button|<a\s/i);
  }
  assert.match(module.exports.render(undefined), /OpenRouter/);
  assert.match(module.exports.render("cursor"), /Provider is not active/);
  const panel = await readFile("frontend/src/recovered/features/settings/overlay/panels.tsx", "utf8");
  const surface = await readFile("frontend/src/recovered/features/settings/overlay/desktop-surface.tsx", "utf8");
  assert.doesNotMatch(panel, /CANCEL_TRIAL_COPY|confirmCancelTrial|invokeUpgrade/);
  assert.doesNotMatch(surface, /cancelTrialDialogOpen|settings-usage-cancel-trial/);
});


test("settings close button stays in its header despite shared primitive position utilities", async () => {
  const style = await readFile("frontend/src/recovered/features/settings/overlay/view.css", "utf8");
  const rule = style.match(/\.sand-settings-panel__close \{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.match(rule, /position: absolute !important/);
  assert.match(rule, /right: 14px !important/);
  assert.match(rule, /left: auto !important/);
  assert.match(rule, /top: 11px !important/);
});

test("external service explanation separates its title/body and uses paired help-button colors", async () => {
  const view = await readFile("frontend/src/recovered/features/access/cover/view.tsx", "utf8");
  const css = await readFile("frontend/src/presence/presence.css", "utf8");
  assert.match(view, /<h2 id="bb-external-access-title">\{copy.title\}<\/h2>/);
  assert.match(view, /<p>\{copy.body\}<\/p>/);
  assert.match(css, /\.bb-external-access button \{[^}]*background: var\(--bb-accent\); color: var\(--bb-on-accent\)/);
});

test("actual shipped usage panel cannot revive the retired paywall through a saved provider", async () => {
  const { createElement } = await import("react");
  const jsx = await import("react/jsx-runtime");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const input = await readFile("src/app/dist/renderer/assets/index-BlqerJhg.js", "utf8");
  const output = patchOriginalSettingsPanel(input), declarations = [];
  simple(parse(output, { ecmaVersion: "latest", sourceType: "module" }), {
    VariableDeclarator(node) {
      if (["RRouterProviders", "RRouterEmptyUsage"].includes(node.id?.name)) declarations.push(`const ${output.slice(node.start, node.end)};`);
    },
    FunctionDeclaration(node) {
      if (["RRouterNumber", "RRouterUsageSummary", "RRouterUsage"].includes(node.id?.name)) declarations.push(output.slice(node.start, node.end));
    },
  });
  assert.equal(declarations.length, 5);
  assert.doesNotMatch(declarations.join("\n"), /a\.jsx\(Na/);
  const Row = ({ label, description, children }) => createElement("div", null, label, description, children);
  const Section = ({ title, children }) => createElement("section", null, createElement("h2", null, title), children);
  const Text = ({ children }) => createElement("span", null, children);
  for (const provider of ["cursor", "unknown-route", "openrouter", "codex"]) {
    const Panel = new Function("a", "k", "ie", "re", "se", "RRouterState", declarations.join("\n") + "\nreturn RRouterUsage;")(
      jsx, (...names) => names.join(" "), Row, Section, Text, () => [{ provider, usage: { providers: {} } }]);
    const html = renderToStaticMarkup(createElement(Panel));
    assert.doesNotMatch(html, /Ultra|Premium|Trial|<button|<a\s/);
    if (["cursor", "unknown-route"].includes(provider)) {
      assert.match(html, /Provider is not active/);
      assert.doesNotMatch(html, /Selected|Claude Code/);
    } else assert.match(html, /Selected/);
  }
});
