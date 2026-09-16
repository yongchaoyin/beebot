import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadFailure() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "beebot-group-turn-failure-"));
  const output = path.join(temporary, "group-turn-failure.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/host/extensions/transcript/group-turn-failure.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("a failed group member turn posts one room notice and a tray on the group", async () => {
  const loaded = await loadFailure();
  try {
    const notices = [];
    const trays = [];
    const seen = new Set();
    const error = new loaded.module.MissingInferenceVendorError("vmu1dwcwa");
    loaded.module.recordGroupTurnFailure({
      roomId: "group-1",
      epoch: 3,
      memberName: "蒹葭",
      error,
      seen,
      appendNotice: (text) => notices.push(text),
      pushError: (tray) => trays.push(tray),
    });
    loaded.module.recordGroupTurnFailure({
      roomId: "group-1",
      epoch: 3,
      memberName: "小凡",
      error,
      seen,
      appendNotice: (text) => notices.push(text),
      pushError: (tray) => trays.push(tray),
    });
    assert.equal(notices.length, 1);
    assert.match(notices[0], /Settings → Router/);
    assert.equal(trays.length, 1);
    assert.equal(trays[0].agentId, "group-1");
    assert.match(trays[0].title, /Model API/i);
  } finally {
    await loaded.dispose();
  }
});

test("group-chat-glue reports member turn failures instead of swallowing them", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    path.join(repoRoot, "source/host/extensions/transcript/group-chat-glue.ts"),
    "utf8",
  );
  assert.match(source, /recordGroupTurnFailure/);
  assert.doesNotMatch(
    source,
    /A failed member turn is a pass, not a room-wide failure/,
  );
});
