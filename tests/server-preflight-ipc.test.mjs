import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const temp = await mkdtemp(path.join(os.tmpdir(), 'beebot-preflight-ipc-'));
await build({ entryPoints: [path.resolve('source/electron-main/beebot-provisioning/ipc.ts')], outfile: path.join(temp, 'ipc.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node26' });
const { installServerPreflightIpc } = createRequire(import.meta.url)(path.join(temp, 'ipc.cjs'));
test.after(() => rm(temp, { recursive: true, force: true }));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function harness(picker = async () => ({ canceled: true, filePaths: [] })) {
  const app = new EventEmitter(), managers = [], windows = [];
  let handle;
  class Manager {
    calls = [];
    cancel() { this.calls.push(['cancel']); }
    async setIdentity(value) { this.calls.push(['identity', value]); }
    async scan(target) { this.calls.push(['scan', target]); return { target }; }
    previewInstall(options) { this.calls.push(["previewInstall", options]); return { status: "review_only", canInstall: false }; }
    async inspect(id, fingerprint) { this.calls.push(['inspect', id, fingerprint]); return { installed: false }; }
  }
  installServerPreflightIpc({ app, ipcMain: { handle(channel, listener) { assert.equal(channel, 'beebot:server-preflight'); handle = listener; } }, BrowserWindow: { getAllWindows: () => windows }, dialog: { showOpenDialog: picker } }, '/app/index.html', () => { const m = new Manager(); managers.push(m); return m; });
  function window() {
    const contents = new EventEmitter(); contents.mainFrame = {}; contents.getURL = () => 'file:///app/index.html#settings'; contents.send = () => assert.fail('No unrelated events');
    windows.push({ webContents: contents });
    const event = { sender: contents, senderFrame: contents.mainFrame };
    return { contents, event, send: request => handle(event, request) };
  }
  return { app, managers, window, send: (...args) => handle(...args) };
}
const ok = result => { assert.equal(result.ok, true); return result.value; };
const code = (result, expected) => assert.deepEqual(result, { ok: false, error: { code: expected } });

test('native preflight rejects foreign windows, remote pages, subframes and malformed messages before creating a session', async () => {
  const h = harness(), a = h.window();
  code(await h.send({ sender: {}, senderFrame: {} }, { action: 'open' }), 'CONNECTION_FAILED');
  code(await h.send({ ...a.event, senderFrame: {} }, { action: 'open' }), 'CONNECTION_FAILED');
  a.contents.getURL = () => 'https://example.test/';
  code(await a.send({ action: 'open' }), 'CONNECTION_FAILED');
  a.contents.getURL = () => 'file:///app/index.html';
  for (const malformed of [null, [], 'open']) code(await a.send(malformed), 'INVALID_TARGET');
  assert.equal(h.managers.length, 0);
});
test('window sessions are independent; guessed or stale session ids cannot run another window check', async () => {
  const h = harness(), a = h.window(), b = h.window();
  const first = ok(await a.send({ action: 'open' })), other = ok(await b.send({ action: 'open' }));
  assert.notEqual(first.sessionId, other.sessionId);
  code(await b.send({ action: 'scan', sessionId: first.sessionId, target: {} }), 'CANCELLED');
  ok(await a.send({ action: 'close', ...first }));
  code(await a.send({ action: 'scan', ...first }), 'CANCELLED');
  ok(await b.send({ action: 'scan', ...other, target: { host: 'node.test' } }));
  assert.equal(h.managers[1].calls.filter(x => x[0] === 'scan').length, 1);
});
test('native picker passes only its own selected path to manager and returns only filename to renderer', async () => {
  let options;
  const h = harness(async input => { options = input; return { canceled: false, filePaths: ['/private/owner/.ssh/id_ed25519'] }; }), a = h.window();
  const s = ok(await a.send({ action: 'open' }));
  const selected = ok(await a.send({ action: 'chooseKey', ...s, path: '/attacker/key', command: 'anything' }));
  assert.deepEqual(selected, { canceled: false, label: 'id_ed25519' });
  assert.deepEqual(h.managers[0].calls.at(-1), ['identity', '/private/owner/.ssh/id_ed25519']);
  assert.deepEqual(options.properties, ['openFile', 'showHiddenFiles']);
  ok(await a.send({ action: 'useAgent', ...s })); assert.deepEqual(h.managers[0].calls.at(-1), ['identity', undefined]);
});
test('picker cancellation preserves selection; delayed picker after session closure cannot change identity', async () => {
  const gate = deferred(), h = harness(() => gate.promise), a = h.window();
  const s = ok(await a.send({ action: 'open' })); const pending = a.send({ action: 'chooseKey', ...s });
  ok(await a.send({ action: 'close', ...s })); gate.resolve({ canceled: false, filePaths: ['/not/to/use'] });
  code(await pending, 'CANCELLED'); assert.equal(h.managers[0].calls.some(x => x[0] === 'identity'), false);
  const other = harness(), b = other.window(), s2 = ok(await b.send({ action: 'open' }));
  assert.deepEqual(ok(await b.send({ action: 'chooseKey', ...s2 })), { canceled: true });
  assert.equal(other.managers[0].calls.some(x => x[0] === 'identity'), false);
});
test('navigation, destruction and application quit invalidate sessions and remove listeners', async () => {
  for (const kind of ['did-start-navigation', 'destroyed', 'before-quit']) {
    const h = harness(), a = h.window(), s = ok(await a.send({ action: 'open' }));
    (kind === 'before-quit' ? h.app : a.contents).emit(kind);
    code(await a.send({ action: 'inspect', ...s }), 'CANCELLED');
    assert.equal(a.contents.listenerCount('destroyed'), 0); assert.equal(a.contents.listenerCount('did-start-navigation'), 0);
    assert.deepEqual(h.managers[0].calls, [['cancel']]);
  }
});
test('cancelling an in-flight read fences late results without touching unrelated sessions', async () => {
  const gate = deferred(), h = harness(), a = h.window(), s = ok(await a.send({ action: 'open' }));
  h.managers[0].scan = () => gate.promise;
  const pending = a.send({ action: 'scan', ...s, target: {} });
  ok(await a.send({ action: 'cancel', ...s })); gate.resolve({ target: { host: 'old' } }); code(await pending, 'CANCELLED');
});
test('same-window reopen disposes prior manager and unknown mutation operations never reach it', async () => {
  const h = harness(), a = h.window(), old = ok(await a.send({ action: 'open' })), s = ok(await a.send({ action: 'open' }));
  assert.deepEqual(h.managers[0].calls, [['cancel']]); assert.notEqual(s.sessionId, old.sessionId);
  for (const action of ['apply', 'install', 'sudo', 'login', 'pair', 'reset', 'run']) code(await a.send({ action, ...s, command: 'rm -rf /' }), 'INVALID_TARGET');
  assert.deepEqual(h.managers[1].calls, []);
});
test('unexpected native diagnostics cannot leak paths, credentials or remote output', async () => {
  const h = harness(async () => { throw new Error('/private/key Bearer SECRET password=PASSWORD'); }), a = h.window(), s = ok(await a.send({ action: 'open' }));
  const result = await a.send({ action: 'chooseKey', ...s }); code(result, 'CONNECTION_FAILED');
  assert.doesNotMatch(JSON.stringify(result), /SECRET|PASSWORD|private\/key/);
});


test('native preview remains window-bound and forwards options only, never a forged report or release policy', async () => {
  const h = harness(), a = h.window(), b = h.window();
  const s = ok(await a.send({ action: 'open' }));
  const options = { domain: 'bot.example.test', name: 'My BeeBot' };
  code(await b.send({ action: 'previewInstall', ...s, options }), 'CANCELLED');
  const reply = ok(await a.send({ action: 'previewInstall', ...s, options, report: { engine: 'local_linux' }, image: 'attacker', keys: {} }));
  assert.deepEqual(reply, { status: 'review_only', canInstall: false });
  assert.deepEqual(h.managers[0].calls, [['previewInstall', options]]);
  ok(await a.send({ action: 'close', ...s }));
  code(await a.send({ action: 'previewInstall', ...s, options }), 'CANCELLED');
});
