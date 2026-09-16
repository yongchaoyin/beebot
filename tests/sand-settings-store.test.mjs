import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadStore() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "beebot-settings-store-"));
  const output = path.join(temporary, "sand-settings-store.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/shared/node/settings/sand-settings-store.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

const vendor = {
  id: "vmu1dwcwa",
  label: "DeepSeek",
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  modelId: "deepseek-chat",
  secretKey: "VENDOR_vmu1dwcwa_KEY",
};

function settingsWithVendors(extra = {}) {
  return {
    version: 1,
    mcpBoxServers: [],
    autoUpdateWhenIdleOptIn: false,
    egressTunnelEnabled: false,
    webauthnProxyEnabled: true,
    mcpCustomInstructions: {},
    mcpCustomInstructionsByServerId: {},
    mcpDisabledToolsByServerId: {},
    conciergeConsent: "unset",
    settingsMigrations: ["downgrade-persisted-max-fast"],
    inferenceVendors: [vendor],
    defaultInferenceVendorId: vendor.id,
    inferenceProvider: "deepseek",
    inferenceHttp: { baseUrl: vendor.baseUrl, modelId: vendor.modelId },
    localAccountActive: true,
    boxRuntime: "local-docker",
    ...extra,
  };
}

test("reading notification config does not overwrite a corrupt settings.json", async () => {
  const loaded = await loadStore();
  const dir = await mkdtemp(path.join(os.tmpdir(), "beebot-settings-corrupt-"));
  try {
    const settingsPath = path.join(dir, "settings.json");
    writeFileSync(settingsPath, "{not-json");
    const store = new loaded.module.SandSettingsStore(settingsPath);
    store.getNotificationConfig();
    store.setUserTimeZone("Asia/Shanghai");
    assert.equal(await readFile(settingsPath, "utf8"), "{not-json");
  } finally {
    await loaded.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("reading notification config does not drop saved model APIs", async () => {
  const loaded = await loadStore();
  const dir = await mkdtemp(path.join(os.tmpdir(), "beebot-settings-vendors-"));
  try {
    const settingsPath = path.join(dir, "settings.json");
    await writeFile(settingsPath, `${JSON.stringify(settingsWithVendors(), null, 2)}\n`);
    const store = new loaded.module.SandSettingsStore(settingsPath);
    store.getNotificationConfig();
    const saved = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(saved.inferenceVendors[0].id, "vmu1dwcwa");
    assert.equal(saved.inferenceProvider, "deepseek");
    assert.equal(store.getInferenceVendors()[0].id, "vmu1dwcwa");
  } finally {
    await loaded.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("empty model APIs are restored from leftover vendor secrets", async () => {
  const loaded = await loadStore();
  const dir = await mkdtemp(path.join(os.tmpdir(), "beebot-settings-recover-"));
  try {
    const settingsPath = path.join(dir, "settings.json");
    const secretsPath = path.join(dir, "box-secrets.json");
    const emptied = settingsWithVendors();
    delete emptied.inferenceVendors;
    delete emptied.defaultInferenceVendorId;
    delete emptied.inferenceProvider;
    delete emptied.inferenceHttp;
    delete emptied.localAccountActive;
    delete emptied.boxRuntime;
    await writeFile(settingsPath, `${JSON.stringify(emptied, null, 2)}\n`);
    await writeFile(secretsPath, `${JSON.stringify({
      version: 1,
      secrets: {
        DEEPSEEK_API_KEY: "sk-test",
        VENDOR_vmu1dwcwa_KEY: "sk-test",
      },
    })}\n`);
    const store = new loaded.module.SandSettingsStore(settingsPath);
    const vendors = store.getInferenceVendors();
    assert.equal(vendors.length, 1);
    assert.equal(vendors[0].id, "vmu1dwcwa");
    assert.equal(vendors[0].provider, "deepseek");
    const saved = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(saved.inferenceVendors[0].id, "vmu1dwcwa");
    assert.equal(saved.localAccountActive, true);
    assert.equal(existsSync(path.join(dir, "settings.json.bak")), true);
  } finally {
    await loaded.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
