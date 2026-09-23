import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, symlinkSync, chmodSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Only erase types; execute the actual dependency-free production module.
const source = readFileSync(new URL('../source/node/installation.ts', import.meta.url), 'utf8');
const api = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
function temporary(t) { const dir = mkdtempSync(path.join(tmpdir(), 'beebot-install-unit-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
const node = { nodeId: '11111111-1111-4111-8111-111111111111', publicUrl: 'https://node.example.test' };
const fakeKey = 'fixture-only-not-a-production-credential';

for (const command of ['init', 'start', 'doctor', 'verify', 'setup-link', 'configure-model']) {
  test(`CLI accepts an explicit data directory for ${command}`, () => assert.deepEqual(api.parseNodeArguments(command, ['--data-dir', '/private/node']), { 'data-dir': '/private/node' }));
}
test('CLI rejects duplicate/unknown/missing options and password arguments', () => {
  for (const args of [['--name', 'A', '--name', 'B'], ['--password', 'hidden'], ['--data-dir'], ['--name', '--public-url'], ['--setup-output', 'file']]) assert.throws(() => api.parseNodeArguments('init', args));
  assert.throws(() => api.parseNodeArguments('unknown', []));
  assert.throws(() => api.parseNodeArguments('start', ['--setup-output', 'anything']));
  assert.deepEqual(api.parseNodeArguments('init', ['--trusted-proxy', '--if-absent']), { 'trusted-proxy': true, 'if-absent': true });
});
test('stdin credentials are bounded and single-line', async () => {
  async function* chunks(...values) { yield* values; }
  assert.equal(await api.readModelKeyInput(chunks(Buffer.from(fakeKey), '\n')), fakeKey);
  for (const value of ['', 'a\nb', 'a\0b', 'a'.repeat(16 * 1024 + 1)]) await assert.rejects(api.readModelKeyInput(chunks(value)));
});
test('file credential wins, never falls back to an unrelated environment key', t => {
  const dir = temporary(t), file = path.join(dir, 'key');
  writeFileSync(file, fakeKey + '\n', { mode: 0o600 });
  assert.deepEqual(api.readModelCredential({ apiKeyEnv: 'CUSTOM_API_KEY', apiKeyFile: file }, { CUSTOM_API_KEY: 'other-fixture' }), { status: 'available', value: fakeKey });
  rmSync(file);
  assert.deepEqual(api.readModelCredential({ apiKeyEnv: 'CUSTOM_API_KEY', apiKeyFile: file }, { CUSTOM_API_KEY: 'other-fixture' }), { status: 'unreadable' });
  assert.deepEqual(api.readModelCredential(undefined, { CUSTOM_API_KEY: fakeKey }), { status: 'missing' });
});
test('credentials reject symlinks, directories, oversized and multiline files', t => {
  const dir = temporary(t), file = path.join(dir, 'key'), link = path.join(dir, 'link');
  writeFileSync(file, fakeKey, { mode: 0o600 }); symlinkSync(file, link);
  for (const target of [dir, link]) assert.deepEqual(api.readModelCredential({ apiKeyFile: target }, {}), { status: 'unreadable' });
  for (const content of ['a'.repeat(16385), 'a\nb']) {
    writeFileSync(file, content); assert.deepEqual(api.readModelCredential({ apiKeyFile: file }, {}), { status: 'unreadable' });
  }
});
test('diagnostics report configuration, not execution success or secret values', t => {
  const dir = temporary(t), host = path.join(dir, 'host.cjs'); writeFileSync(host, 'fixture');
  const report = api.inspectNodeReadiness({ ...node, model: {} }, { status: 'available', value: fakeKey }, host);
  assert.equal(report.status, 'configured'); assert.equal(report.model, 'configured_not_tested');
  assert.equal(report.executionProbe, 'not_run'); assert.equal(report.browser, 'not_advertised'); assert.equal(report.desktop, 'not_advertised');
  assert.ok(!JSON.stringify(report).includes(fakeKey));
  assert.equal(api.inspectNodeReadiness(node, { status: 'missing' }, host).status, 'configuration_required');
  assert.equal(api.inspectNodeReadiness(node, { status: 'missing' }, host + '-missing').status, 'degraded');
  assert.equal(api.inspectNodeReadiness({ ...node, model: {} }, { status: 'unreadable' }, host).model, 'credential_unreadable');
});
test('one-time setup receipt is private, node-bound, expiring and removable', t => {
  const dir = temporary(t), expiry = Date.now() + 10000;
  api.storeSetupLink(dir, node.nodeId, node.publicUrl, 'a'.repeat(43), expiry);
  assert.equal(statSync(path.join(dir, api.SETUP_FILE)).mode & 0o777, 0o600);
  assert.equal(api.loadSetupLink(dir, node), `${node.publicUrl}/setup?code=${'a'.repeat(43)}`);
  assert.throws(() => api.loadSetupLink(dir, { ...node, nodeId: 'other' }));
  assert.throws(() => api.loadSetupLink(dir, { ...node, publicUrl: 'https://other.example.test' }));
  assert.throws(() => api.loadSetupLink(dir, node, expiry));
  api.removeSetupLink(dir); api.removeSetupLink(dir);
  assert.throws(() => api.loadSetupLink(dir, node));
});
test('setup receipt rejects injected origins, extra query values and malformed records', t => {
  const dir = temporary(t);
  for (const url of ['https://attacker.example/setup?code=' + 'a'.repeat(43), node.publicUrl + '/setup?code=' + 'a'.repeat(43) + '&other=1', node.publicUrl + '/setup?code=bad', node.publicUrl + '/setup?code=' + 'a'.repeat(43) + '#x']) {
    writeFileSync(path.join(dir, api.SETUP_FILE), JSON.stringify({ version: 1, nodeId: node.nodeId, expiresAt: Date.now() + 10000, url }), { mode: 0o600 });
    assert.throws(() => api.loadSetupLink(dir, node));
  }
});
test('external verification pins the node and uses read-only HTTPS without redirects', async () => {
  let called = false;
  await api.verifyNodeEndpoint(node, async (url, options) => {
    called = true; assert.equal(url.href, node.publicUrl + '/v1/node');
    assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(options.headers, { accept: 'application/json' });
    return Response.json({ id: node.nodeId, nodeId: node.nodeId, protocolVersion: 1 });
  });
  assert.ok(called);
});
test('external verification rejects wrong identity/protocol, HTTP failure and excessive data', async () => {
  for (const value of [{ id: node.nodeId, nodeId: 'other', protocolVersion: 1 }, { id: node.nodeId, nodeId: node.nodeId, protocolVersion: 2 }, null]) await assert.rejects(api.verifyNodeEndpoint(node, async () => Response.json(value)));
  await assert.rejects(api.verifyNodeEndpoint(node, async () => new Response('unavailable', { status: 503 })));
  await assert.rejects(api.verifyNodeEndpoint(node, async () => new Response('a'.repeat(20000))));
  await assert.rejects(api.verifyNodeEndpoint(node, async () => { throw new Error('fixture TLS rejection'); }));
});

test('private readers reject world-readable credentials', t => {
  const dir = temporary(t), file = path.join(dir, 'key');
  writeFileSync(file, fakeKey, { mode: 0o600 }); chmodSync(file, 0o644);
  assert.deepEqual(api.readModelCredential({ apiKeyFile: file }, {}), { status: 'unreadable' });
});
test('argument errors do not echo an accidentally supplied credential', () => {
  assert.throws(() => api.parseNodeArguments('init', [fakeKey]), error => !error.message.includes(fakeKey));
});

test('readiness requires real files rather than readable directories', t => {
  const dir = temporary(t);
  const report = api.inspectNodeReadiness(node, { status: 'missing' }, dir, dir);
  assert.equal(report.hostBundle, 'missing'); assert.equal(report.shell, 'missing');
});
test('failed endpoint responses release their bodies without consuming server data', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 503 });
  await assert.rejects(api.verifyNodeEndpoint(node, async () => response));
  assert.equal(cancelled, true);
});
test('offline recovery flags require explicit options and reject credential arguments', () => {
  assert.deepEqual(api.parseNodeArguments('recovery-codes', ['--data-dir','/private/node','--output','/private/recovery.json','--confirm-recovery']), {'data-dir':'/private/node',output:'/private/recovery.json','confirm-recovery':true});
  for (const args of [['--output'],['--password','private'],['--confirm-recovery','yes'],['--confirm-recovery','--confirm-recovery']]) assert.throws(()=>api.parseNodeArguments('recovery-codes',args));
});
