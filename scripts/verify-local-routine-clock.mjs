import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

// Isolated actual-clock Node check; the scheduled callback models the model/OS
// boundary. It uses no account, inference provider, production profile or HTTP.
assert.equal(process.versions.node, "26.5.0", "Use the repository's pinned Node");
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(path.join(os.tmpdir(), "beebot-real-cron-"));
let scheduler, timeout;
try {
  const outfile = path.join(directory, "runtime.cjs");
  await build({ stdin: { contents: `export { FileAutomationStore, LOCAL_SCHEDULE_CLAIMS_DIRNAME } from './source/host/automations/automation-store.ts'; export { LocalRoutineScheduler } from './source/host/extensions/automations/local-routine-scheduler.ts';`, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "cjs", target: "node26", outfile, logLevel: "silent" });
  const runtime = createRequire(import.meta.url)(outfile);
  const stores = ["bot", "group"].map(id => ({ id, store: new runtime.FileAutomationStore(path.join(directory, id, "automations")) }));
  for (const { store } of stores) store.upsert({ name: "Fixture follow-up", prompt: "Inspect only this isolated fixture. Stay silent when unchanged.", purpose: "proactive-followup", executionOwner: "local", isEnabled: true, trigger: { type: "cron", schedule: "* * * * *" } });
  const { promise, resolve } = Promise.withResolvers();
  const calls = [];
  scheduler = new runtime.LocalRoutineScheduler({
    getTimeZone: () => "UTC", isReady: () => true,
    listAutomations: async () => stores.flatMap(({ id, store }) => store.listDefinitions().map(automation => ({ agentId: id, automation }))),
    fire: async args => { calls.push(args); if (calls.length === 2) resolve(); return "ok"; },
  });
  scheduler.start();
  console.log("Waiting for the next real cron minute and Node's independent 15 second polling loop.");
  await Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("The real Node clock did not dispatch both cron targets")), 90_000); })]);
  assert.deepEqual(calls.map(v => v.agentId).sort(), ["bot", "group"]);
  assert.equal(new Set(calls.map(v => v.scheduledForMs)).size, 1);
  for (const { store } of stores) assert.equal(readdirSync(path.join(store.automationsDir, store.listDefinitions()[0].id, runtime.LOCAL_SCHEDULE_CLAIMS_DIRNAME)).length, 1);
  console.log(JSON.stringify({ node: process.versions.node, realClock: true, schedule: "* * * * *", targets: calls.map(v => v.agentId), scheduledFor: new Date(calls[0].scheduledForMs).toISOString(), checks: 5, externalActions: 0 }));
} finally {
  clearTimeout(timeout); scheduler?.stop(); await rm(directory, { recursive: true, force: true });
}
