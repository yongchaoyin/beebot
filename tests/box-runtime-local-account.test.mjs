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
