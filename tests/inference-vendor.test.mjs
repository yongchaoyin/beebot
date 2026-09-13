import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { transform } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorSourcePath = path.join(repoRoot, "source/shared/inference-vendor.ts");

async function loadVendorModule() {
  const source = await readFile(vendorSourcePath, "utf8");
  const { code: output } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("http vendor presets expose OpenRouter, OpenAI, DeepSeek, and custom defaults", async () => {
  const vendor = await loadVendorModule();
  assert.deepEqual(vendor.HTTP_INFERENCE_VENDORS, ["openrouter", "openai", "deepseek", "custom"]);
  assert.equal(vendor.vendorPreset("openrouter").defaultBaseUrl, "https://openrouter.ai/api/v1");
  assert.equal(vendor.vendorPreset("openrouter").defaultModelId, "openai/gpt-4.1-mini");
  assert.equal(vendor.vendorPreset("openrouter").secretKey, "OPENROUTER_API_KEY");
  assert.equal(vendor.vendorPreset("openai").defaultBaseUrl, "https://api.openai.com/v1");
  assert.equal(vendor.vendorPreset("openai").defaultModelId, "gpt-4.1-mini");
  assert.equal(vendor.vendorPreset("openai").secretKey, "OPENAI_API_KEY");
  assert.equal(vendor.vendorPreset("deepseek").defaultBaseUrl, "https://api.deepseek.com");
  assert.equal(vendor.vendorPreset("deepseek").defaultModelId, "deepseek-chat");
  assert.equal(vendor.vendorPreset("deepseek").secretKey, "DEEPSEEK_API_KEY");
  assert.equal(vendor.vendorPreset("custom").defaultBaseUrl, "");
  assert.equal(vendor.vendorPreset("custom").defaultModelId, "");
  assert.equal(vendor.vendorPreset("custom").secretKey, "CUSTOM_API_KEY");
});

test("vendor setup requires an API key and custom base URL plus model id", async () => {
  const vendor = await loadVendorModule();
  assert.equal(vendor.validateVendorSetup({ provider: "openrouter", apiKey: "" }).ok, false);
  assert.equal(vendor.validateVendorSetup({ provider: "cursor", apiKey: "sk" }).ok, false);
  assert.equal(vendor.validateVendorSetup({ provider: "custom", apiKey: "sk" }).ok, false);
  assert.equal(vendor.validateVendorSetup({ provider: "custom", apiKey: "sk", baseUrl: "https://llm.example/v1" }).ok, false);

  const openrouter = vendor.validateVendorSetup({ provider: "openrouter", apiKey: " sk-or " });
  assert.equal(openrouter.ok, true);
  assert.equal(openrouter.provider, "openrouter");
  assert.equal(openrouter.apiKey, "sk-or");
  assert.equal(openrouter.http.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(openrouter.http.modelId, "openai/gpt-4.1-mini");

  const custom = vendor.validateVendorSetup({
    provider: "custom",
    apiKey: "sk-custom",
    baseUrl: " https://llm.example/v1/ ",
    modelId: " my-model ",
  });
  assert.equal(custom.ok, true);
  assert.equal(custom.http.baseUrl, "https://llm.example/v1");
  assert.equal(custom.http.modelId, "my-model");
});

test("stored http config overrides vendor defaults", async () => {
  const vendor = await loadVendorModule();
  const resolved = vendor.resolveVendorHttpConfig("deepseek", {
    baseUrl: "https://api.deepseek.com/v1",
    modelId: "deepseek-reasoner",
  });
  assert.deepEqual(resolved, { baseUrl: "https://api.deepseek.com/v1", modelId: "deepseek-reasoner" });
  assert.deepEqual(vendor.resolveVendorHttpConfig("openai", { baseUrl: "", modelId: "" }), {
    baseUrl: "https://api.openai.com/v1",
    modelId: "gpt-4.1-mini",
  });
});

test("routed HTTP models are told they have a computer and must use tools", async () => {
  const source = await readFile(path.join(repoRoot, "source/host/extensions/inference/provider-session.ts"), "utf8");
  assert.match(source, /your own Linux computer/);
  assert.match(source, /SendMessage tool is available/);
  assert.match(source, /hostSuppliedTools/);
  const coordinator = await readFile(path.join(repoRoot, "source/node-agent-coordinator/inference-router.ts"), "utf8");
  assert.match(coordinator, /isHttpInferenceVendor\(provider\)/);
});

test("local account is presented when Cursor is signed out and local setup is active", async () => {
  const vendor = await loadVendorModule();
  assert.deepEqual(vendor.LOCAL_ACCOUNT_STATUS, {
    kind: "logged-in",
    authId: "local",
    displayName: "Local",
  });
  assert.deepEqual(
    vendor.mapAuthStatus({ kind: "logged-in", authId: "cursor-user", email: "a@b.c" }, { localAccountActive: true }),
    { kind: "logged-in", authId: "cursor-user", email: "a@b.c" },
  );
  assert.deepEqual(
    vendor.mapAuthStatus({ kind: "logged-out" }, { localAccountActive: true }),
    vendor.LOCAL_ACCOUNT_STATUS,
  );
  assert.deepEqual(
    vendor.mapAuthStatus({ kind: "logged-out" }, { localAccountActive: false }),
    { kind: "logged-out" },
  );
});
