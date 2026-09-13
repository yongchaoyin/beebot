import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "os";
import path from "path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadMirror(directory) {
  const output = path.join(directory, "transcript-mirror.mjs");
  await build({
    bundle: true,
    entryPoints: [path.join(repoRoot, "source/host/transcript-mirror/transcript-mirror.ts")],
    format: "esm",
    outfile: output,
    platform: "node",
    target: "node22",
  });
  return import(`${pathToFileURL(output).href}?${Date.now()}`);
}

test("first journal checkpoint initializes instead of demanding a prior recover", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "botfly-journal-"));
  try {
    const { FileTranscriptMirror } = await loadMirror(directory);
    const deriver = {
      async initial() { return [{ id: "t0", line: JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: "hello" }] } }) }]; },
      async derive() { return { occurrences: [] }; },
    };
    const mirror = new FileTranscriptMirror(path.join(directory, "transcripts"), () => {}, deriver);
    const id = "new-bot";
    await mirror.claimConversation(id);
    const checkpoint = { turns: [new Uint8Array([1, 2, 3])] };
    await assert.doesNotReject(() => mirror.prepareCheckpoint({}, id, checkpoint, {}));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
