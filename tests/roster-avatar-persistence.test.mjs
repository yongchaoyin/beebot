import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { build } from "esbuild";
import { patchOriginalLanding } from "../scripts/lib/router-renderer-patch.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let runtime, compiledDirectory, pinned;
test.before(async () => {
  compiledDirectory = await mkdtemp(path.join(os.tmpdir(), "beebot-roster-avatar-runtime-"));
  const outfile = path.join(compiledDirectory, "runtime.cjs");
  await build({ stdin: { resolveDir: root, loader: "ts", contents: `
    export { SandClientPersistenceStore } from './source/shared/client-persistence-store.ts';
    export { createNodeClientPersistenceFiles } from './source/electron-main/secrets/secrets-ipc.ts';
    export { createRosterSnapshotStore, createRosterSnapshotSource } from './frontend/src/recovered/features/access/cover/roster-snapshot-store.ts';
  ` }, outfile, bundle: true, platform: "node", format: "cjs", target: "node26", logLevel: "silent" });
  runtime = createRequire(import.meta.url)(outfile);

  // Read the shipped adapter output and execute the actual row writer/decoder.
  // No substitute serializer can accidentally make a missing field test pass.
  const source = patchOriginalLanding(await readFile(path.join(root, "src/app/dist/renderer/assets/index-UbX-y3il.js"), "utf8"));
  const names = new Set(["Y0t", "tHn", "Mpe", "lKe", "Ppe"]), declarations = [];
  for (const node of parse(source, { ecmaVersion: "latest", sourceType: "module" }).body) {
    if (node.type === "FunctionDeclaration" && names.has(node.id?.name)) {
      declarations.push(source.slice(node.start, node.end)); names.delete(node.id.name);
    }
    if (node.type === "VariableDeclaration") for (const item of node.declarations) {
      if (item.id?.name === "oKe") declarations.push(`const ${source.slice(item.start, item.end)};`);
    }
  }
  assert.equal(names.size, 0, "all pinned writer/decoder dependencies must be found");
  assert.equal(declarations.length, 6, "the actual roster schema descriptor is included");
  pinned = new Function(`${declarations.join("\n")}\nreturn { writeRow:Y0t, readRow:tHn, schema:oKe };`)();
  assert.equal(pinned.schema.schemaVersion, 2);
  assert.equal(pinned.schema.slice, "roster.last-roster");
  assert.equal(pinned.schema.accountSensitive, true);
});
test.after(async () => { if (compiledDirectory) await rm(compiledDirectory, { recursive: true, force: true }); });

const agent = (id, appearance = {}) => ({
  id, name: `Colleague ${id}`, description: "Persistent colleague", title: "",
  avatarVersion: null, avatarDataUrl: null,
  createdAt: 1, updatedAt: 2, path: `/fixture/agents/${id}/agent.db`,
  lastEntry: null, lastMessageId: null, newestEntryId: null,
  hasUnread: false, unreadCount: 0, lastViewedAt: 0, lastActivityAt: 0,
  awaitingUserResponse: null, notificationsEnabled: false, notifyOnUpdatesEnabled: true,
  isHiddenFromSidebar: false, origin: "user", isGroup: false, memberIds: [], conversationPartnerIds: [],
  ...appearance,
});
const appearance = rows => rows.map(({ id, avatarShape, avatarColor }) => ({ id, avatarShape, avatarColor }));
const encode = rows => JSON.stringify({ schemaVersion: pinned.schema.schemaVersion, value: { rows: rows.map(pinned.writeRow) } });
function decode(value) {
  const envelope = JSON.parse(value);
  assert.equal(envelope.schemaVersion, pinned.schema.schemaVersion);
  return envelope.value.rows.map(row => {
    const restored = pinned.readRow(row);
    assert.ok(restored, "the real pinned decoder accepts every stored row");
    return restored;
  });
}
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "beebot-roster-avatar-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reopen = () => new runtime.SandClientPersistenceStore(directory, runtime.createNodeClientPersistenceFiles());
  return { directory, reopen, store: reopen() };
}
async function accountKey(accountSlot) {
  let key;
  // Use the real account-scoped client source, not a hand-written key encoder.
  const source = runtime.createRosterSnapshotSource({}, { read: async value => { key = value; return null; } });
  await source.readPersisted(accountSlot);
  return key;
}
function controlledSource(store, { read, list = async () => { throw new Error("Fixture transport is offline"); } } = {}) {
  const listeners = new Set();
  return {
    source: {
      readPersisted: async slot => read ? read(slot) : store.read(await accountKey(slot)),
      listAgents: list,
      subscribeAgents: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      subscribeAgentUpserted: () => () => {}, subscribeTransport: () => () => {},
    },
    emit: rows => { for (const listener of listeners) listener(rows); },
  };
}

test("four colleagues retain their own shape and green/green/blue/violet colors through a real disk restart", async t => {
  const f = await fixture(t), key = await accountKey("local-profile"), colleagues = [
    agent("a", { avatarShape: "cloud", avatarColor: "green" }),
    agent("b", { avatarShape: "blob", avatarColor: "green" }),
    agent("c", { avatarShape: "hex", avatarColor: "blue" }),
    agent("d", { avatarShape: "pebble", avatarColor: "violet" }),
  ];
  const group = agent("room", { name: "Shared workplace", isGroup: true, memberIds: colleagues.map(row => row.id), avatarShape: null, avatarColor: null });
  await f.store.write(key, encode([...colleagues, group]));
  const diskFiles = await readdir(f.directory);
  assert.equal(diskFiles.filter(name => name.endsWith(".blob")).length, 1);
  assert.equal(diskFiles.some(name => name.endsWith(".tmp")), false);
  const restored = decode(await f.reopen().read(key));
  assert.deepEqual(appearance(restored.slice(0, 4)), appearance(colleagues));
  assert.deepEqual(restored[4].memberIds, colleagues.map(row => row.id));
  assert.equal(restored[4].isGroup, true);
  assert.equal(restored[4].avatarShape, null, "the group must not acquire a member's identity");
  for (const row of restored) {
    assert.equal(row.avatarDataUrl, null);
    assert.equal(row.isRunning, false); assert.equal(row.isComposingMessage, false); assert.equal(row.isActive, false);
  }
});

test("equal Bot IDs in different account slots occupy isolated disk keys", async t => {
  const f = await fixture(t), a = await accountKey("owner.one"), b = await accountKey("owner%2Eone");
  assert.notEqual(a, b);
  assert.match(a, /owner%2Eone\.roster\.last-roster$/);
  assert.match(b, /owner%252Eone\.roster\.last-roster$/);
  await f.store.write(a, encode([agent("same-bot", { avatarShape: "cloud", avatarColor: "green" })]));
  await f.store.write(b, encode([agent("same-bot", { avatarShape: "hex", avatarColor: "violet" })]));
  const restarted = f.reopen();
  assert.deepEqual(appearance(decode(await restarted.read(a))), [{ id: "same-bot", avatarShape: "cloud", avatarColor: "green" }]);
  assert.deepEqual(appearance(decode(await restarted.read(b))), [{ id: "same-bot", avatarShape: "hex", avatarColor: "violet" }]);
  assert.equal(await restarted.read(await accountKey("another-owner")), null);
  assert.equal((await restarted.listKeys("sand.client.slice.account.")).length, 2);
});

test("authoritative appearance changes, empty resets and null clears replace older cached choices", async t => {
  const f = await fixture(t), key = await accountKey("local-profile");
  for (const next of [
    { avatarShape: "blob", avatarColor: "green" },
    { avatarShape: "teardrop", avatarColor: "violet" },
    { avatarShape: "", avatarColor: "" },
    { avatarShape: null, avatarColor: null },
  ]) {
    await f.reopen().write(key, encode([agent("a", next)]));
    const [row] = decode(await f.reopen().read(key));
    assert.deepEqual(appearance([row]), [{ id: "a", ...next }]);
  }
  await f.reopen().write(key, encode([agent("a")]));
  const [legacy] = decode(await f.reopen().read(key));
  assert.equal(Object.hasOwn(legacy, "avatarShape"), false, "a legacy absent field must not revive an older persisted value");
  assert.equal(Object.hasOwn(legacy, "avatarColor"), false);
});

test("photo version stays in its existing roster protocol while image bytes remain outside it and clear persists", async t => {
  const f = await fixture(t), key = await accountKey("photo-owner");
  const original = agent("a", { avatarShape: "cloud", avatarColor: "green", avatarVersion: "fixture-photo-version", avatarDataUrl: "data:image/png;base64,ZmFrZS1waG90by1maXh0dXJl" });
  await f.store.write(key, encode([original]));
  const serialized = await f.reopen().read(key), raw = JSON.parse(serialized).value.rows[0];
  assert.equal(raw.avatarVersion, original.avatarVersion);
  assert.equal(Object.hasOwn(raw, "avatarDataUrl"), false);
  assert.doesNotMatch(serialized, /data:image|base64|ZmFrZS/);
  const [restored] = decode(serialized);
  assert.equal(restored.avatarVersion, original.avatarVersion);
  assert.equal(restored.avatarDataUrl, null, "the separate photo cache resolves bytes; roster restore must not manufacture them");
  assert.deepEqual(appearance([restored]), appearance([original]));
  await f.reopen().write(key, encode([{ ...original, avatarVersion: null, avatarDataUrl: null }]));
  const [cleared] = decode(await f.reopen().read(key));
  assert.equal(cleared.avatarVersion, null); assert.equal(cleared.avatarDataUrl, null);
  assert.deepEqual(appearance([cleared]), appearance([original]), "clearing a photo preserves the explicitly selected character");
});

test("a late real disk restore cannot replace a fresher authoritative roster", async t => {
  const f = await fixture(t), key = await accountKey("local-profile");
  await f.store.write(key, encode([agent("a", { avatarShape: "blob", avatarColor: "green" })]));
  const began = Promise.withResolvers(), release = Promise.withResolvers();
  t.after(() => release.resolve());
  const feed = controlledSource(f.reopen(), { read: async () => { began.resolve(); await release.promise; return f.reopen().read(key); } });
  const snapshot = runtime.createRosterSnapshotStore({ source: feed.source });
  t.after(() => snapshot.dispose());
  const pending = snapshot.connect("local-profile");
  await began.promise;
  const current = [agent("a", { avatarShape: "hex", avatarColor: "blue" })];
  feed.emit(current);
  release.resolve(); await pending;
  assert.deepEqual(appearance(snapshot.get().agents), appearance(current));
  assert.equal(snapshot.get().hasCompleteRoster, true);
  assert.equal(snapshot.get().isShowingRestoredRoster, false);
});

test("account generation fences a late old-account disk restore with the same Bot ID", async t => {
  const f = await fixture(t), oldKey = await accountKey("old-owner"), newKey = await accountKey("new-owner");
  await f.store.write(oldKey, encode([agent("same-bot", { avatarShape: "cloud", avatarColor: "green" })]));
  const current = [agent("same-bot", { avatarShape: "hex", avatarColor: "violet" })];
  await f.store.write(newKey, encode(current));
  const began = Promise.withResolvers(), release = Promise.withResolvers();
  t.after(() => release.resolve());
  const feed = controlledSource(f.reopen(), { read: async slot => {
    if (slot === "old-owner") { began.resolve(); await release.promise; }
    return f.reopen().read(await accountKey(slot));
  } });
  const snapshot = runtime.createRosterSnapshotStore({ source: feed.source });
  t.after(() => snapshot.dispose());
  const old = snapshot.connect("old-owner"); await began.promise;
  await snapshot.connect("new-owner");
  assert.deepEqual(appearance(snapshot.get().agents), appearance(current));
  assert.equal(snapshot.get().isShowingRestoredRoster, true);
  release.resolve(); await old;
  assert.deepEqual(appearance(snapshot.get().agents), appearance(current));
  await snapshot.connect(null);
  assert.deepEqual(snapshot.get().agents, []);
  assert.equal(snapshot.get().transport, "down");
});
