import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadAck() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "beebot-ack-"));
  const output = path.join(temporary, "ack.mjs");
  await build({
    entryPoints: [path.join(repoRoot, "source/host/runner/start-of-turn-ack-reminder-middleware.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

function fakeExecutor(messages) {
  return {
    msgs: [...messages],
    getMessages() { return this.msgs; },
    getState() { return this.msgs; },
    clearMessages() { this.msgs = []; },
    appendMessages(value) {
      this.msgs = this.msgs.concat(Array.isArray(value) ? value : [value]);
    },
    stream() { return { ok: true }; },
  };
}

test("the first model stream of a user-visible turn injects the ack reminder before any tool call", async () => {
  const loaded = await loadAck();
  try {
    const executor = fakeExecutor([{ role: "user", content: "继续呀" }]);
    const middleware = loaded.module.createStartOfTurnAckReminderMiddleware()(executor);
    middleware.stream();
    const last = executor.msgs.at(-1);
    assert.equal(last?.providerOptions?.cursor?.sandStartOfTurnAckReminder, true);
    assert.match(String(last?.content ?? ""), /Acknowledge them RIGHT NOW/i);
  } finally {
    await loaded.dispose();
  }
});
