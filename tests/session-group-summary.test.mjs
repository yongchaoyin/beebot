import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadSummaries() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "beebot-group-summary-"));
  const output = path.join(temporary, "session-summaries.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/host/extensions/session/session-summaries.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, temporary, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("group.json on disk marks roster summaries as groups with memberIds", async () => {
  const loaded = await loadSummaries();
  try {
    const agentDir = path.join(loaded.temporary, "group-agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(path.join(agentDir, "group.json"), JSON.stringify({
      version: 1,
      memberIds: ["bot-a", "bot-b"],
    }));
    const fields = loaded.module.groupRosterFields(agentDir);
    assert.equal(fields.isGroup, true);
    assert.deepEqual(fields.memberIds, ["bot-a", "bot-b"]);
    const summary = loaded.module.minimalAgentSummary({
      dirName: "group-agent",
      dbPath: path.join(agentDir, "store.db"),
    });
    assert.equal(summary.isGroup, true);
    assert.deepEqual(summary.memberIds, ["bot-a", "bot-b"]);
  } finally {
    await loaded.dispose();
  }
});

test("ordinary agent dirs are not groups", async () => {
  const loaded = await loadSummaries();
  try {
    const agentDir = path.join(loaded.temporary, "solo-bot");
    await mkdir(agentDir, { recursive: true });
    const fields = loaded.module.groupRosterFields(agentDir);
    assert.equal(fields.isGroup, false);
    assert.deepEqual(fields.memberIds, []);
  } finally {
    await loaded.dispose();
  }
});
