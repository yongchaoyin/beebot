import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "os";
import path from "path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { z } from "zod";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "beebot-http-tools-"));
  const output = path.join(directory, "http-tool-parameters.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/shared/http-tool-parameters.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(directory, { recursive: true, force: true }) };
}

test("HTTP tool parameters convert Zod into JSON Schema instead of dumping Zod internals", async () => {
  const loaded = await loadModule();
  try {
    const schema = loaded.module.resolveHttpToolParameters(z.object({ content: z.string() }));
    const json = schema?.jsonSchema ?? schema;
    assert.equal(json.type, "object");
    assert.ok(json.properties?.content);
    assert.equal(JSON.stringify(json).includes("_def"), false);
  } finally {
    await loaded.dispose();
  }
});

test("plain assistant text is wrapped as a SendMessage tool call", async () => {
  const loaded = await loadModule();
  try {
    async function* chunks() {
      yield { type: "text-delta", textDelta: "你好" };
      yield { type: "text-delta", textDelta: "世界" };
    }
    const events = [];
    for await (const event of loaded.module.withSyntheticSendMessage(chunks())) events.push(event);
    const send = events.find((event) => event.type === "tool-call");
    assert.deepEqual(send, {
      type: "tool-call",
      toolCallId: send.toolCallId,
      toolName: "SendMessage",
      args: { type: "text", content: "你好世界" },
    });
    assert.match(send.toolCallId, /^synthetic-send-/);
  } finally {
    await loaded.dispose();
  }
});
