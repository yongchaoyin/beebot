import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";
import { applyOriginalRendererRouterPatch, patchOriginalSettingsPanel, patchOriginalSettingsRegistry } from "../scripts/lib/router-renderer-patch.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routerSourcePath = path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/router.ts");

async function loadRouterModule() {
  const source = await readFile(routerSourcePath, "utf8");
  const { code: output } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("router provider preference defaults to OpenRouter and round-trips every provider", async () => {
  const router = await loadRouterModule();
  assert.deepEqual(router.ROUTER_PROVIDERS.map(({ id }) => id), ["claude-code", "codex", "openrouter", "openai", "deepseek", "custom"]);
  assert.equal(router.parseRouterProviderPreference(null), "openrouter");
  assert.equal(router.parseRouterProviderPreference("not-json"), "openrouter");
  assert.equal(router.parseRouterProviderPreference(JSON.stringify({ schemaVersion: 1, provider: "unknown" })), "openrouter");

  let stored = null;
  const persistence = {
    async read(key) {
      assert.equal(key, router.ROUTER_PROVIDER_PERSISTENCE_KEY);
      return stored;
    },
    async write(key, value) {
      assert.equal(key, router.ROUTER_PROVIDER_PERSISTENCE_KEY);
      stored = value;
    }
  };
  for (const provider of router.ROUTER_PROVIDERS) {
    await router.saveRouterProvider(persistence, provider.id);
    assert.equal(await router.loadRouterProvider(persistence), provider.id);
  }
});

test("settings registry exposes Router with the native settings icon contract", async () => {
  const source = await readFile(path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/view.tsx"), "utf8");
  assert.match(source, /\{ id: "router", label: "Router", icon: "git-branch" \}/);
  assert.match(source, /\{ id: "servers", label: "Servers", icon: "servers" \}/);
});

test("shipped Settings includes Servers and passes the current close callback outside its original memo cache", async () => {
  const assets = path.join(repoRoot, "src/app/dist/renderer/assets");
  const registry = patchOriginalSettingsRegistry(await readFile(path.join(assets, "index-UbX-y3il.js"), "utf8"));
  const sections = new Function(`${registry.match(/const wDn=\[[^;]+?\]/)[0]};return wDn;`)();
  assert.equal(sections.filter((section) => section.id === "servers").length, 1);
  assert.equal(sections.find((section) => section.id === "servers").icon, "servers");
  const panel = patchOriginalSettingsPanel(await readFile(path.join(assets, "index-BlqerJhg.js"), "utf8"));
  await transform(panel, { loader: "js", format: "esm", target: "es2022" });
  const start = panel.indexOf("let Q;e[28]");
  const body = panel.slice(start, panel.indexOf("let Z;e[31]", start));
  const select = new Function("e", "x", "y", "t", "a", "Te", "Sa", "RRouterPanel", "RServersPanel", `${body};return Q;`);
  const cache = [], jsx = { jsx: (type, props) => ({ type, props }) };
  const oldClose = () => {}, latestClose = () => {};
  const render = (section, close) => select(cache, section, close, null, jsx, "ScrollPane", "General", "Router", "Servers");
  assert.equal(render("servers", oldClose).props.children.props.onOpenBot, oldClose);
  assert.equal(render("servers", latestClose).props.children.props.onOpenBot, latestClose);
  assert.equal(render("general", latestClose).props.children.type, "General");
});

test("packaging preserves Settings registration when landing and registry share the main chunk", async () => {
  const stageRoot = await mkdtemp(path.join(tmpdir(), "beebot-settings-composition-"));
  try {
    const assets = path.join(stageRoot, "dist/renderer/assets");
    await mkdir(assets, { recursive: true });
    for (const name of ["index-UbX-y3il.js", "index-BlqerJhg.js"]) {
      await copyFile(path.join(repoRoot, "src/app/dist/renderer/assets", name), path.join(assets, name));
    }
    const result = await applyOriginalRendererRouterPatch({ stageRoot });
    const main = await readFile(path.join(assets, "index-UbX-y3il.js"), "utf8");
    const sections = new Function(`${main.match(/const wDn=\[[^;]+?\]/)[0]};return wDn;`)();
    assert.deepEqual(sections.map((section) => section.id), ["general", "servers", "router", "usage", "beta"]);
    assert.ok(main.includes("function RLocalChatLayout(n)"), "the landing/chat transform is also retained");
    assert.ok(main.includes("function RBindCollaborationReview(runtime)"), "the real review UI ships in the pinned renderer");
    assert.ok(main.includes('getCollaboration:we=>e.getCollaboration(we)'), "read uses the actual coordinator bridge");
    assert.ok(main.includes('reviewCollaboration:we=>e.reviewCollaboration(we)'), "review uses the actual authenticated coordinator bridge");

    const registry = result.chunks.find((chunk) => chunk.role === "registry");
    const landing = result.chunks.find((chunk) => chunk.role === "landing");
    assert.equal(landing.original.sha256, registry.patched.sha256, "patch provenance records the shared chunk in sequence");
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
});

test("Router settings can add and remove multiple vendor APIs", async () => {
  const source = await readFile(path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/panels.tsx"), "utf8");
  assert.match(source, /Model APIs/);
  assert.match(source, /Add model/);
  assert.match(source, /onMakeDefault/);
  assert.match(source, /beginEdit/);
  const surface = await readFile(path.join(repoRoot, "frontend/src/recovered/features/settings/overlay/desktop-surface.tsx"), "utf8");
  assert.match(surface, /upsertInferenceVendor/);
  assert.match(surface, /deleteInferenceVendor/);
});
