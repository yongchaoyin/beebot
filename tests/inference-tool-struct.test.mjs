import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadConverters() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "beebot-inference-tools-"));
  const output = path.join(temporary, "converters.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/packages/chat-inference-proto/converters.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

function model() {
  return { modelId: "test-model", parameters: [] };
}

test("tools with missing parameters still encode instead of throwing Struct JSON errors", async () => {
  const loaded = await loadConverters();
  try {
    const request = loaded.module.buildStreamRequest({
      messages: [],
      requestedModel: model(),
      tools: [{ name: "WebSearch", description: "Search the web" }],
    });
    assert.equal(request.tools[0].name, "WebSearch");
    assert.deepEqual(request.tools[0].parameters.toJson(), {});
  } finally {
    await loaded.dispose();
  }
});

test("tools with nested undefined parameter fields still encode", async () => {
  const loaded = await loadConverters();
  try {
    const request = loaded.module.buildStreamRequest({
      messages: [],
      requestedModel: model(),
      tools: [{ name: "Search", description: "Search", parameters: { type: "object", extra: undefined } }],
    });
    assert.deepEqual(request.tools[0].parameters.toJson(), { type: "object" });
  } finally {
    await loaded.dispose();
  }
});

test("tools with undefined parameters do not call fromJsonString(undefined)", async () => {
  const loaded = await loadConverters();
  try {
    assert.doesNotThrow(() => loaded.module.buildStreamRequest({
      messages: [],
      requestedModel: model(),
      tools: [{ name: "Shell", description: "Run a command", parameters: undefined }],
    }));
  } finally {
    await loaded.dispose();
  }
});
