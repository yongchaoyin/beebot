import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

// Real Host/session/SQLite lifecycle. Only model and worker-process I/O is replaced.
const directory = await mkdtemp(path.join(os.tmpdir(), "beebot-empty-roster-"));
after(() => rm(directory, { recursive: true, force: true }));
const root = fileURLToPath(new URL("../", import.meta.url));
const outfile = path.join(directory, "runtime.cjs");
await build({
  stdin: { contents: `
    export { SandSessionConversationState } from './source/host/extensions/session/session-conversation-state.ts';
    export { SandAgentSessionStore } from './source/host/extensions/session/agent-session.ts';
    export { SandSessionMaterialization } from './source/host/extensions/session/session-materialization.ts';
    export { TranscriptManager } from './source/host/extensions/transcript/transcript-manager.ts';
    export { NoActiveSessionError } from './source/host/extensions/transcript/session-runtime.ts';
    export { loadInitialTranscriptResiliently } from './source/host/host-initial-transcript-load.ts';
  `, resolveDir: root, loader: "ts" },
  bundle: true, platform: "node", format: "cjs", target: "node26", outfile, logLevel: "silent",
});
const runtime = createRequire(import.meta.url)(outfile);
const deferred = () => Promise.withResolvers();

async function workspace(t) {
  const rootDir = await mkdtemp(path.join(directory, "agents-"));
  const managers = [];
  function open() {
    const store = new runtime.SandAgentSessionStore(rootDir, () => undefined, {
      createConversationState(store) {
        return new runtime.SandSessionConversationState({ rootDir, ctx: {}, openSession: id => store.openSession(id), deriveOutline: () => [], deriveState: async () => ({ turns: [] }) });
      },
      createMaterialization(store) {
        return new runtime.SandSessionMaterialization({
          ctx: {}, rootDir,
          createBlobWorkerPool: () => ({ closeAll: async () => {} }),
          createAgentStore: () => ({ getFullConversation: async () => null, resetFromDb: async () => {}, dispose: async () => {} }),
          createMemoryStore: dir => store.createMemoryStore(dir),
          resolveUserTimeZone: () => undefined,
          agentExists: id => store.agentExists(id), getAgentDir: id => store.getAgentDir(id),
          readActiveAgentId: () => store.readActiveAgentId(),
        });
      },
    });
    const tm = new runtime.TranscriptManager(store, null, null);
    managers.push(tm);
    const events = [], rosters = [];
    tm.subscribe(event => events.push(event));
    tm.subscribeAgents(event => rosters.push(event));
    return { tm, store, events, rosters };
  }
  t.after(async () => { for (const tm of managers) if (!tm.disposed) await tm.dispose(); });
  return { open };
}
const create = (tm, name) => tm.createAgent({ name }, "user", { isIntroductionSuppressed: true });
const entry = (id, text) => ({ id, kind: "message", role: "user", content: text, timestamp: Date.now() });

async function assertEmpty({ tm, store }) {
  assert.deepEqual(await tm.listAgents(), []);
  assert.deepEqual(await store.listAgentRecordIds(), []);
  assert.equal(await store.countOwnedAgents(), 0);
  assert.equal(tm.sessions.activeSession, undefined);
  assert.equal(tm.sessions.getAnnouncedActiveAgentId(), null);
  assert.equal(store.readActiveAgentId(), null);
  assert.deepEqual(await tm.ensureLoaded(), []);
}

test("fresh Host startup and repeated read-only calls leave a truly empty persistent roster", async t => {
  const w = await workspace(t), h = w.open();
  assert.equal(await runtime.loadInitialTranscriptResiliently(h.tm), 0);
  assert.deepEqual(await Promise.all([h.tm.listAgents(), h.tm.listAgents(), h.tm.ensureLoaded()]), [[], [], []]);
  assert.deepEqual(await h.tm.getConversationOutline("missing"), []);
  assert.equal(await h.tm.sessions.tryEnsureSession(), null);
  await assert.rejects(h.tm.sessions.ensureSession(), error => error instanceof runtime.NoActiveSessionError && error.code === "no_active_session" && error.message === "No Bot is selected. Create or select a Bot first.");
  await h.tm.roster.emitAgents();
  assert.equal(h.rosters.at(-1).activeAgentId, "");
  assert.deepEqual(h.rosters.at(-1).agents, []);
  assert.ok(h.events.some(e => e.type === "snapshot" && e.activeAgentId === "" && e.entries.length === 0));
  await assertEmpty(h);
  await h.tm.dispose();
  await assertEmpty(w.open());
});

test("a stale selected ID is cleared without recreating a deleted Bot", async t => {
  const h = (await workspace(t)).open();
  h.store.writeActiveAgentId("previously-deleted");
  await h.tm.ensureLoaded();
  await assertEmpty(h);
});

test("explicit first creation persists exactly one identity and its SQLite history across restart", async t => {
  const w = await workspace(t), h = w.open();
  await h.tm.ensureLoaded();
  const result = await create(h.tm, "First colleague");
  const id = result.agent.id, saved = entry("saved-first", "Keep this conversation");
  h.tm.sessions.activeSession.db.appendTranscriptEntry(saved);
  assert.equal(h.store.readActiveAgentId(), id);
  assert.deepEqual(await h.store.listAgentRecordIds(), [id]);
  await h.tm.dispose();
  const restored = w.open();
  const entries = await restored.tm.ensureLoaded();
  assert.equal(restored.tm.sessions.activeSession.id, id);
  assert.deepEqual(entries, [saved]);
  assert.deepEqual((await restored.tm.listAgents()).map(a => a.id), [id]);
});

test("deleting the last Bot clears persisted selection, deferred activation and transcript, including restart", async t => {
  const w = await workspace(t), h = w.open();
  const { agent } = await create(h.tm, "Only colleague");
  h.tm.sessions.appendEntry(entry("last-history", "Old conversation"));
  const deferredActivation = new AbortController();
  h.tm.sessions.windowedActivationAbort = deferredActivation;
  h.tm.sessions.pendingActivationAgentId = agent.id;
  assert.deepEqual((await h.tm.deleteAgents([agent.id])).transcript, []);
  assert.equal(deferredActivation.signal.aborted, true);
  assert.equal(h.tm.sessions.pendingActivationAgentId, null);
  assert.equal(h.tm.sessions.inMemoryTranscriptAgentId, null);
  assert.deepEqual(h.tm.sessions.getEntries(), []);
  assert.deepEqual(h.rosters.at(-1).agents, []);
  assert.equal(h.rosters.at(-1).activeAgentId, "");
  assert.ok(h.events.some(e => e.type === "cleared"));
  await assertEmpty(h);
  await h.tm.dispose();
  const again = w.open();
  await assertEmpty(again);
  const replacement = await create(again.tm, "Explicit replacement");
  assert.notEqual(replacement.agent.id, agent.id);
  assert.deepEqual(await again.store.listAgentRecordIds(), [replacement.agent.id]);
});

test("deleting the last real Group leaves empty, while deleting a Bot with a survivor selects existing identity", async t => {
  const w = await workspace(t), h = w.open();
  const a = await create(h.tm, "A"), b = await create(h.tm, "B");
  const group = await h.tm.createGroup({ name: "Team", memberIds: [a.agent.id, b.agent.id] });
  assert.equal(group.agent.isGroup, true);
  await h.tm.deleteAgents([a.agent.id, b.agent.id]);
  assert.equal(h.tm.sessions.activeSession.id, group.agent.id);
  assert.deepEqual((await h.tm.listAgents()).map(a => a.id), [group.agent.id]);
  await h.tm.deleteAgents([group.agent.id]);
  await assertEmpty(h);
  const nextA = await create(h.tm, "Survivor"), nextB = await create(h.tm, "Delete me");
  await h.tm.deleteAgents([nextB.agent.id]);
  assert.equal(h.tm.sessions.activeSession.id, nextA.agent.id);
  assert.deepEqual(await h.store.listAgentRecordIds(), [nextA.agent.id]);
});

test("empty startup followed by explicit background creation loads its saved transcript", async t => {
  const h = (await workspace(t)).open();
  await h.tm.ensureLoaded();
  const saved = entry("background-history", "Already received work");
  const mint = h.tm.agentLifecycle.mintAgentSession.bind(h.tm.agentLifecycle);
  h.tm.agentLifecycle.mintAgentSession = async (...args) => {
    const session = await mint(...args);
    assert.equal(session.db.appendTranscriptEntry(saved), true);
    return session;
  };
  const result = await h.tm.createBackgroundAgent({ name: "Background colleague" }, "user", { isIntroductionSuppressed: true });
  assert.equal(h.tm.sessions.activeSession.id, result.agent.id);
  assert.deepEqual(await h.tm.ensureLoaded(), [saved]);
});

test("existing unnamed legacy identities are retained rather than guessed to be disposable placeholders", async t => {
  const w = await workspace(t), h = w.open();
  const old = await h.store.createFallbackSession(id => h.store.openSession(id));
  h.tm.sessions.liveSessions.set(old.id, old);
  await h.tm.dispose();
  const restored = w.open();
  await restored.tm.ensureLoaded();
  assert.equal(restored.tm.sessions.activeSession.id, old.id);
  assert.deepEqual(await restored.store.listAgentRecordIds(), [old.id]);
  assert.equal((await restored.tm.listAgents())[0].name, "Grok");
});

test("a concurrent empty roster read cannot clear a newly explicitly created active Bot", async t => {
  const h = (await workspace(t)).open(), entered = deferred(), release = deferred();
  t.after(release.resolve);
  const list = h.store.listAgents.bind(h.store);
  let intercept = true;
  h.store.listAgents = async (...args) => {
    if (!intercept) return list(...args);
    intercept = false;
    const result = await list(...args);
    entered.resolve(); await release.promise; return result;
  };
  const reading = h.tm.ensureLoaded();
  await entered.promise;
  const { agent } = await create(h.tm, "Concurrent colleague");
  release.resolve();
  await reading;
  assert.equal(h.tm.sessions.activeSession.id, agent.id);
  assert.equal(h.store.readActiveAgentId(), agent.id);
  assert.deepEqual(await h.store.listAgentRecordIds(), [agent.id]);
});

test("a missing-target send fails without minting, then an explicitly created Bot receives all three queued sends", { timeout: 15000 }, async t => {
  const h = (await workspace(t)).open(), entered = deferred(), release = deferred(), finished = deferred();
  t.after(release.resolve);
  h.tm.execution = { ...h.tm.execution, canExecute: true };
  await assert.rejects(h.tm.sendPrompt("No implicit Bot", {}), { code: "no_active_session" });
  await assertEmpty(h);
  const { agent } = await create(h.tm, "Ready colleague");
  const calls = [];
  h.tm.runnerRegistry.getRunner = () => ({ expireAutoReviewApprovals() {} });
  h.tm.turnRuntime.runTurn = async (session, _runner, prompt, options) => {
    calls.push(prompt);
    try {
      if (calls.length === 1) { entered.resolve(); await release.promise; }
      h.tm.sendPipeline.deliveries.settle(session.dbPath, options.messageId, session.id, "replied");
    } finally {
      h.tm.runLifecycle.endSessionRun(session);
      if (calls.length === 3) finished.resolve();
    }
  };
  await h.tm.sendPrompt("first", { agentId: agent.id, awaitTurn: false });
  await entered.promise;
  await h.tm.sendPrompt("second", { agentId: agent.id, awaitTurn: false });
  await h.tm.sendPrompt("third", { agentId: agent.id, awaitTurn: false });
  assert.deepEqual(calls, ["first"]);
  release.resolve(); await finished.promise;
  assert.deepEqual(calls, ["first", "second", "third"]);
  assert.equal(h.tm.sessions.activeSession.db.getTranscriptEntries().filter(e => e.role === "user").length, 3);
  assert.deepEqual(await h.store.listAgentRecordIds(), [agent.id]);
});


test("late transcript reads and opens cannot recreate a deleted or nonexistent database", async t => {
  const h = (await workspace(t)).open();
  const { agent } = await create(h.tm, "Delete before late read");
  await h.tm.deleteAgents([agent.id]);
  for (const id of [agent.id, "never-created"]) {
    assert.deepEqual(h.store.readAgentTranscriptEntries(id), []);
    assert.deepEqual(await h.store.getAgentTranscriptEntries(id), []);
    assert.deepEqual(h.tm.sessions.getAgentTranscriptPage(id, { untilMs: Date.now(), limit: 10 }), { entries: [] });
    assert.deepEqual(h.tm.sessions.getAgentTranscriptWindow(id, { limit: 10 }), { entries: [], threadCounts: {} });
    assert.deepEqual(h.tm.sessions.getAgentTranscriptTail(id, { limit: 10 }), { entries: [] });
    assert.deepEqual(h.tm.sessions.getAgentThread(id, "missing"), { entries: [] });
    await assert.rejects(h.tm.openAgentTail(id, 10), { name: "AgentGoneError" });
    await assert.rejects(h.tm.openAgentWindowed(id, 10), { name: "AgentGoneError" });
    await h.store.markAgentViewed(id);
    assert.equal(h.store.agentDirExists(id), false);
  }
  await assertEmpty(h);
});

test("a stale boot roster result cannot restore a Bot deleted while that read was pending", async t => {
  const w = await workspace(t), original = w.open();
  const { agent } = await create(original.tm, "Will be deleted");
  await original.tm.dispose();
  const h = w.open(), entered = deferred(), release = deferred();
  t.after(release.resolve);
  const list = h.store.listAgents.bind(h.store);
  let intercept = true;
  h.store.listAgents = async (...args) => {
    if (!intercept) return list(...args);
    intercept = false;
    const snapshot = await list(...args);
    entered.resolve(); await release.promise; return snapshot;
  };
  const reading = h.tm.ensureLoaded();
  await entered.promise;
  await h.tm.deleteAgents([agent.id]);
  release.resolve();
  assert.deepEqual(await reading, []);
  await assertEmpty(h);
});

test("the standalone store's transcript fallback and viewed marker also keep unknown IDs absent", async t => {
  const rootDir = await mkdtemp(path.join(directory, "standalone-"));
  const store = new runtime.SandAgentSessionStore(rootDir);
  assert.deepEqual(await store.getAgentTranscriptEntries("unknown"), []);
  await store.markAgentViewed("unknown");
  assert.equal(store.agentDirExists("unknown"), false);
  assert.deepEqual(await store.listAgentRecordIds(), []);
});
