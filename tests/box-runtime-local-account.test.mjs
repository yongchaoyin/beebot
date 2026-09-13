import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "os";
import path from "path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadStore(directory) {
  const output = path.join(directory, "sand-settings-store.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/shared/node/settings/sand-settings-store.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  return import(`${pathToFileURL(output).href}?${Date.now()}`);
}

test("local vendor accounts skip Cursor review and allow the computer without asking", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "botfly-box-runtime-"));
  try {
    const { SandSettingsStore } = await loadStore(directory);
    const store = new SandSettingsStore(path.join(directory, "settings.json"));
    store.setLocalAccountActive(true);
    assert.equal(store.getLocalToolPermission(), "always");
    assert.equal(store.getAutoReviewInstructions().isEnabled, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("settings keep multiple vendor APIs and resolve the one a bot selected", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "botfly-vendors-"));
  try {
    const { SandSettingsStore } = await loadStore(directory);
    const store = new SandSettingsStore(path.join(directory, "settings.json"));
    store.setInferenceProvider("deepseek");
    store.setInferenceHttp({ baseUrl: "https://api.deepseek.com", modelId: "deepseek-chat" });
    const legacy = store.getInferenceVendors();
    assert.equal(legacy.length, 1);
    assert.equal(legacy[0].id, "legacy");
    assert.equal(legacy[0].provider, "deepseek");
    store.setInferenceVendors([
      ...legacy,
      { id: "openai-main", label: "OpenAI main", provider: "openai", baseUrl: "https://api.openai.com/v1", modelId: "gpt-4.1-mini", secretKey: "VENDOR_openai-main_KEY" },
    ]);
    store.setDefaultInferenceVendorId("legacy");
    assert.equal(store.getInferenceVendors().length, 2);
    assert.equal(store.getDefaultInferenceVendorId(), "legacy");
    assert.equal(store.getInferenceVendor("openai-main")?.modelId, "gpt-4.1-mini");
    assert.equal(store.getInferenceVendor(undefined)?.id, "legacy");
    assert.equal(store.getInferenceVendor("")?.id, "legacy");
    assert.equal(store.getInferenceVendor("openai-main")?.provider, "openai");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local vendor accounts default to the local Docker computer", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "botfly-box-runtime-"));
  try {
    const { SandSettingsStore } = await loadStore(directory);
    const store = new SandSettingsStore(path.join(directory, "settings.json"));
    assert.equal(store.getBoxRuntime(), "remote");
    store.setLocalAccountActive(true);
    assert.equal(store.getBoxRuntime(), "local-docker");
    store.setBoxRuntime("remote");
    assert.equal(store.getBoxRuntime(), "remote");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
