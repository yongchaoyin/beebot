import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadResolve() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "beebot-resolve-inference-"));
  const output = path.join(temporary, "resolve-inference.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/host/extensions/inference/resolve-inference.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

const deepseek = {
  id: "vmu1dwcwa",
  label: "DeepSeek",
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  modelId: "deepseek-chat",
  secretKey: "VENDOR_vmu1dwcwa_KEY",
};

test("a bot with a saved vendor uses that vendor, not the default", async () => {
  const loaded = await loadResolve();
  try {
    const routed = loaded.module.resolveInferenceForAgent("agent-1", {
      getInferenceVendor: (id) => id === "vmu1dwcwa" ? deepseek : undefined,
      getInferenceProvider: () => "cursor",
      readProfile: () => ({ inferenceVendorId: "vmu1dwcwa" }),
    });
    assert.equal(routed.provider, "deepseek");
    assert.equal(routed.vendor.id, "vmu1dwcwa");
  } finally {
    await loaded.dispose();
  }
});

test("a bot whose model API was deleted does not silently fall back to Cursor", async () => {
  const loaded = await loadResolve();
  try {
    assert.throws(
      () => loaded.module.resolveInferenceForAgent("agent-1", {
        getInferenceVendor: () => undefined,
        getInferenceProvider: () => "cursor",
        readProfile: () => ({ inferenceVendorId: "vmu1dwcwa" }),
      }),
      (error) => {
        assert.equal(error.name, "MissingInferenceVendorError");
        assert.match(error.message, /Settings → Router/);
        assert.equal(error.vendorId, "vmu1dwcwa");
        return true;
      },
    );
  } finally {
    await loaded.dispose();
  }
});
